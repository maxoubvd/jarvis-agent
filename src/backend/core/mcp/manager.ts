import { JarvisMcpClient, McpToolInfo } from './client.js';
import type { ConfigManager, McpServerConfig, ToolPolicy } from '../../config/config-manager.js';
import { getConfigManager } from '../../config/config-manager.js';
import { getBuiltinMcpServers, isGitRepository } from './builtin.js';
import { IN_PROCESS_SERVERS } from './in-process.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ToolDefinition, ToolParameter } from '../agent/tool-registry.js';
import { operationLogger } from '../../services/logger.js';

/** Statut d'un tool exposé par un serveur (politique auto/ask/excluded). */
export interface McpToolStatus {
  name: string;
  description: string;
  enabled: boolean;
  /** Politique effective (défaut MCP : `ask`). */
  policy: ToolPolicy;
}

/**
 * Politique effective d'un tool serveur : config explicite > legacy
 * `disabledTools` (= excluded) > défaut `ask` (tout tool MCP demande
 * confirmation tant que l'utilisateur ne l'a pas passé en auto).
 */
export function mcpToolPolicy(config: McpServerConfig, tool: string): ToolPolicy {
  const explicit = config.toolPolicies?.[tool];
  if (explicit) return explicit;
  if (config.disabledTools?.includes(tool)) return 'excluded';
  return 'ask';
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
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, prop]) => {
    const propType = prop.type as string | undefined;

    if (propType === 'array') {
      return {
        name,
        type: 'array' as const,
        description: (prop.description as string) ?? '',
        required: required.has(name),
        jsonSchema: { type: 'array', items: prop.items }
      };
    }

    if (propType === 'object') {
      return {
        name,
        type: 'object' as const,
        description: (prop.description as string) ?? '',
        required: required.has(name),
        jsonSchema: { type: 'object', properties: prop.properties, required: prop.required }
      };
    }

    return {
      name,
      type: propType === 'number' || propType === 'integer'
        ? 'number' as const
        : propType === 'boolean'
          ? 'boolean' as const
          : 'string' as const,
      description: (prop.description as string) ?? '',
      required: required.has(name)
    };
  });
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
  /**
   * Single-flight guard : `getSettings` et `getMcpStatus` arrivent quasi
   * simultanément depuis le webview (handleTabChange poste les deux d'un
   * coup) et chacun appelle `initialize()`. Avec un simple booléen, le second
   * appel voyait "déjà initialisé" et repartait aussitôt lire des statuts
   * vides — la connexion réelle (connectAll) n'avait pas eu le temps de
   * s'exécuter. En gardant la Promise elle-même, tout appelant concurrent
   * attend la même connexion en cours au lieu de lire un état pas encore prêt.
   */
  private initPromise: Promise<void> | null = null;

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
      .map(b => {
        // Un builtin lié au workspace reste listé mais inconnectable sans
        // dossier ; un builtin lié à un dépôt git reste listé mais
        // inconnectable si le dossier n'est pas lui-même une racine git
        // (mcp-server-git échouerait avec "not a valid Git repository").
        // Les deux gardes l'emportent sur un éventuel override utilisateur —
        // sinon la connexion échoue quand même, juste plus tard.
        const blocked =
          (b.requiresWorkspace && !this.workspaceFolder) ||
          (b.requiresOwnGitRepo && !isGitRepository(this.workspaceFolder));
        return {
          name: b.id,
          config: {
            ...b.config,
            enabled: blocked ? false : overrides[b.id]?.enabled ?? b.config.enabled,
            disabledTools: overrides[b.id]?.disabledTools,
            toolPolicies: overrides[b.id]?.toolPolicies
          },
          builtin: true,
          description: b.description,
          inProcessFactory: b.inProcess ? IN_PROCESS_SERVERS[b.id] : undefined
        };
      });

    const users: ResolvedServer[] = Object.entries(userServers).map(([name, cfg]) => ({
      name,
      config: cfg,
      builtin: false
    }));

    return [...builtins, ...users];
  }

  /** Connecte tous les serveurs activés ; les erreurs sont isolées par serveur. */
  public async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.connectAll();
    }
    await this.initPromise;
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
    // Un appel concurrent à initialize() doit attendre CETTE reconnexion, pas
    // l'ancienne (déjà résolue) ni repartir aussitôt.
    this.initPromise = this.connectAll();
    await this.initPromise;
  }

  public getStatuses(): McpServerStatus[] {
    return this.resolveServers().map(({ name, config, builtin, description }) => {
      const connected = this.servers.get(name);
      return {
        name,
        enabled: config.enabled,
        connected: !!connected,
        tools:
          connected?.tools.map(t => {
            const policy = mcpToolPolicy(config, t.name);
            return {
              name: t.name,
              description: t.description,
              enabled: policy !== 'excluded',
              policy
            };
          }) ?? [],
        error: this.errors.get(name),
        builtin,
        description
      };
    });
  }

  /**
   * Politique effective de chaque tool MCP connecté, indexée par le nom
   * enregistré dans le registre agentique (`mcp__<serveur>__<tool>`).
   * Fusionnée dans `OrchestratorOptions.toolPolicies` (défaut : `ask`).
   */
  public toolPolicies(): Record<string, ToolPolicy> {
    const configs = new Map(this.resolveServers().map(s => [s.name, s.config]));
    const map: Record<string, ToolPolicy> = {};
    for (const [serverName, { tools }] of this.servers) {
      const config = configs.get(serverName);
      for (const tool of tools) {
        map[`mcp__${serverName}__${tool.name}`] = config ? mcpToolPolicy(config, tool.name) : 'ask';
      }
    }
    return map;
  }

  /**
   * Noms bruts des tools par serveur CONNECTÉ, hors politique `excluded`.
   * Alimente la déduplication des builtins doublonnés (builtin-dedup.ts) :
   * un serveur désactivé ou injoignable n'apparaît pas ici, donc ses
   * équivalents builtin restent disponibles.
   */
  public activeToolNames(): Map<string, Set<string>> {
    const configs = new Map(this.resolveServers().map(s => [s.name, s.config]));
    const map = new Map<string, Set<string>>();
    for (const [serverName, { tools }] of this.servers) {
      const config = configs.get(serverName);
      const names = tools
        .filter(t => !config || mcpToolPolicy(config, t.name) !== 'excluded')
        .map(t => t.name);
      if (names.length > 0) map.set(serverName, new Set(names));
    }
    return map;
  }

  /** Tools MCP découverts, adaptés au registre agentique (HITL `mcp`). */
  public toToolDefinitions(): ToolDefinition[] {
    const configByServer = new Map(this.resolveServers().map(s => [s.name, s.config]));
    const definitions: ToolDefinition[] = [];
    for (const [serverName, { client, tools }] of this.servers) {
      const config = configByServer.get(serverName);
      for (const tool of tools) {
        if (config && mcpToolPolicy(config, tool.name) === 'excluded') continue;
        definitions.push({
          name: `mcp__${serverName}__${tool.name}`,
          description: `[MCP:${serverName}] ${tool.description}`,
          parameters: parametersFromJsonSchema(tool.inputSchema),
          hitlAction: tool.name.includes('write_file') ? 'edit_existing_file' :
                      tool.name.includes('read_file') ? 'read_file' :
                      tool.name.includes('list_directory') ? 'list_directory' :
                      tool.name.includes('search') ? 'search' :
                      tool.name.includes('run_command') ? 'run_terminal_command' :
                      'mcp_custom',
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
