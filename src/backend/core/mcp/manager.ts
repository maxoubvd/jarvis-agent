import { JarvisMcpClient, McpToolInfo } from './client.js';
import type { ConfigManager, McpServerConfig } from '../../config/config-manager.js';
import { getConfigManager } from '../../config/config-manager.js';
import { getBuiltinMcpServers } from './builtin.js';
import { IN_PROCESS_SERVERS } from './in-process.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ToolDefinition, ToolParameter } from '../agent/tool-registry.js';
import { operationLogger } from '../../services/logger.js';

/** Statut d'un tool exposé par un serveur (activable individuellement). */
export interface McpToolStatus {
  name: string;
  description: string;
  enabled: boolean;
}

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
  tools: McpToolStatus[];
  error?: string;
  /** true = serveur de base (défini dans le code, non supprimable). */
  builtin?: boolean;
  description?: string;
}

interface ResolvedServer {
  name: string;
  config: McpServerConfig;
  builtin: boolean;
  description?: string;
  /** Fabrique du serveur in-process (builtins implémentés dans l'extension). */
  inProcessFactory?: () => Server;
}

/** Convertit un JSON Schema MCP en liste de ToolParameter du registre. */
export function parametersFromJsonSchema(schema: Record<string, unknown>): ToolParameter[] {
  const properties = (schema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: prop.type === 'number' || prop.type === 'integer'
      ? 'number'
      : prop.type === 'boolean'
        ? 'boolean'
        : 'string',
    description: prop.description ?? '',
    required: required.has(name)
  }));
}

interface ConnectedServer {
  client: JarvisMcpClient;
  tools: McpToolInfo[];
}

/**
 * Gère le cycle de vie des serveurs MCP configurés (`mcpServers` de la
 * config) : connexion, découverte des tools, adaptation en ToolDefinition
 * pour la boucle agentique, statuts pour la Settings UI.
 */
export class McpManager {
  private servers = new Map<string, ConnectedServer>();
  private errors = new Map<string, string>();
  private initialized = false;

  constructor(
    private readonly cfg: ConfigManager = getConfigManager(),
    /** Fabrique injectable (tests). */
    private readonly clientFactory: (
      name: string,
      config: McpServerConfig,
      inProcessFactory?: () => Server
    ) => JarvisMcpClient = (name, config, inProcessFactory) =>
      new JarvisMcpClient(name, config, inProcessFactory),
    /** Dossier du workspace ouvert (fourni par l'appelant — pas d'import vscode ici). */
    private readonly workspaceFolder?: string
  ) {}

  /**
   * Serveurs effectifs : les serveurs de base (activation/tools surchargés par
   * `config.builtinMcp`) puis les serveurs utilisateur. Un serveur utilisateur
   * portant le nom d'un builtin masque ce dernier.
   */
  private resolveServers(): ResolvedServer[] {
    const config = this.cfg.getConfig();
    const userServers = config.mcpServers ?? {};
    const overrides = config.builtinMcp ?? {};

    const builtins: ResolvedServer[] = getBuiltinMcpServers(this.workspaceFolder)
      .filter(b => !(b.id in userServers))
      .map(b => ({
        name: b.id,
        config: {
          ...b.config,
          // Un builtin lié au workspace reste listé mais inconnectable sans dossier.
          enabled:
            b.requiresWorkspace && !this.workspaceFolder
              ? false
              : overrides[b.id]?.enabled ?? b.config.enabled,
          disabledTools: overrides[b.id]?.disabledTools
        },
        builtin: true,
        description: b.description,
        inProcessFactory: b.inProcess ? IN_PROCESS_SERVERS[b.id] : undefined
      }));

    const users: ResolvedServer[] = Object.entries(userServers).map(([name, cfg]) => ({
      name,
      config: cfg,
      builtin: false
    }));

    return [...builtins, ...users];
  }

  /** Connecte tous les serveurs activés ; les erreurs sont isolées par serveur. */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.connectAll();
  }

  private async connectAll(): Promise<void> {
    await Promise.all(
      this.resolveServers()
        .filter(server => server.config.enabled)
        .map(async ({ name, config, inProcessFactory }) => {
          try {
            const client = this.clientFactory(name, config, inProcessFactory);
            await client.connect();
            const tools = await client.listTools();
            this.servers.set(name, { client, tools });
            this.errors.delete(name);
            operationLogger.log('mcp', `Serveur ${name} connecté (${tools.length} tools)`, 'success');
          } catch (err) {
            let msg = err instanceof Error ? err.message : String(err);
            // Erreur la plus fréquente sur les serveurs Python : uv absent du PATH.
            if (config.command === 'uvx' && /enoent|not found|introuvable/i.test(msg)) {
              msg = `uv (uvx) introuvable — installez uv : https://docs.astral.sh/uv/ (${msg})`;
            }
            this.errors.set(name, msg);
            operationLogger.log('mcp', `Serveur ${name} injoignable: ${msg}`, 'error');
          }
        })
    );
  }

  /** Ferme tout puis reconnecte selon la config courante. */
  public async reload(): Promise<void> {
    await Promise.all([...this.servers.values()].map(s => s.client.close().catch(() => undefined)));
    this.servers.clear();
    this.errors.clear();
    this.initialized = true;
    await this.connectAll();
  }

  public getStatuses(): McpServerStatus[] {
    return this.resolveServers().map(({ name, config, builtin, description }) => {
      const connected = this.servers.get(name);
      const disabled = new Set(config.disabledTools ?? []);
      return {
        name,
        enabled: config.enabled,
        connected: !!connected,
        tools:
          connected?.tools.map(t => ({
            name: t.name,
            description: t.description,
            enabled: !disabled.has(t.name)
          })) ?? [],
        error: this.errors.get(name),
        builtin,
        description
      };
    });
  }

  /** Tools MCP découverts, adaptés au registre agentique (HITL `mcp`). */
  public toToolDefinitions(): ToolDefinition[] {
    const disabledByServer = new Map(
      this.resolveServers().map(s => [s.name, new Set(s.config.disabledTools ?? [])])
    );
    const definitions: ToolDefinition[] = [];
    for (const [serverName, { client, tools }] of this.servers) {
      const disabled = disabledByServer.get(serverName) ?? new Set<string>();
      for (const tool of tools) {
        if (disabled.has(tool.name)) continue;
        definitions.push({
          name: `mcp__${serverName}__${tool.name}`,
          description: `[MCP:${serverName}] ${tool.description}`,
          parameters: parametersFromJsonSchema(tool.inputSchema),
          hitlAction: 'mcp',
          execute: async args => {
            operationLogger.log('mcp', `${serverName}/${tool.name} ${JSON.stringify(args)}`);
            return client.callTool(tool.name, args);
          }
        });
      }
    }
    return definitions;
  }

  public async dispose(): Promise<void> {
    await Promise.all([...this.servers.values()].map(s => s.client.close().catch(() => undefined)));
    this.servers.clear();
  }
}
