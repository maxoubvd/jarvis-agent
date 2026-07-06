import { JarvisMcpClient, McpToolInfo } from './client.js';
import type { ConfigManager, McpServerConfig } from '../../config/config-manager.js';
import { getConfigManager } from '../../config/config-manager.js';
import type { ToolDefinition, ToolParameter } from '../agent/tool-registry.js';
import { operationLogger } from '../../services/logger.js';

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
  tools: string[];
  error?: string;
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
    private readonly clientFactory: (name: string, config: McpServerConfig) => JarvisMcpClient =
      (name, config) => new JarvisMcpClient(name, config)
  ) {}

  private getServerConfigs(): Record<string, McpServerConfig> {
    return this.cfg.getConfig().mcpServers ?? {};
  }

  /** Connecte tous les serveurs activés ; les erreurs sont isolées par serveur. */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.connectAll();
  }

  private async connectAll(): Promise<void> {
    const configs = this.getServerConfigs();
    await Promise.all(
      Object.entries(configs)
        .filter(([, config]) => config.enabled)
        .map(async ([name, config]) => {
          try {
            const client = this.clientFactory(name, config);
            await client.connect();
            const tools = await client.listTools();
            this.servers.set(name, { client, tools });
            this.errors.delete(name);
            operationLogger.log('mcp', `Serveur ${name} connecté (${tools.length} tools)`, 'success');
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
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
    const configs = this.getServerConfigs();
    return Object.entries(configs).map(([name, config]) => {
      const connected = this.servers.get(name);
      return {
        name,
        enabled: config.enabled,
        connected: !!connected,
        tools: connected?.tools.map(t => t.name) ?? [],
        error: this.errors.get(name)
      };
    });
  }

  /** Tools MCP découverts, adaptés au registre agentique (HITL `mcp`). */
  public toToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const [serverName, { client, tools }] of this.servers) {
      for (const tool of tools) {
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
