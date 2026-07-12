import { JarvisMcpClient, McpToolInfo } from './client.js';
import type { ConfigManager, McpServerConfig, ToolPolicy } from '../../config/config-manager.js';
import { getConfigManager } from '../../config/config-manager.js';
import { getBuiltinMcpServers, isGitRepository } from './builtin.js';
import { IN_PROCESS_SERVERS } from './in-process.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { ToolDefinition, ToolParameter } from '../agent/tool-registry.js';
import { operationLogger } from '../../services/logger.js';

/** Status of a tool exposed by a server (auto/ask/excluded policy). */
export interface McpToolStatus {
  name: string;
  description: string;
  enabled: boolean;
  /** Effective policy (MCP default: `ask`). */
  policy: ToolPolicy;
}

/**
 * Effective policy for a server tool: explicit config > legacy
 * `disabledTools` (= excluded) > default `ask` (every MCP tool asks for
 * confirmation until the user switches it to auto).
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
  /** true = built-in server (defined in code, not removable). */
  builtin?: boolean;
  description?: string;
}

interface ResolvedServer {
  name: string;
  config: McpServerConfig;
  builtin: boolean;
  description?: string;
  /** Factory for the in-process server (builtins implemented in the extension). */
  inProcessFactory?: () => Server;
}

/** Converts an MCP JSON Schema into a list of registry ToolParameters. */
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
 * Manages the lifecycle of configured MCP servers (`mcpServers` in the
 * config): connecting, discovering tools, adapting them into ToolDefinitions
 * for the agentic loop, and reporting statuses for the Settings UI.
 */
export class McpManager {
  private servers = new Map<string, ConnectedServer>();
  private errors = new Map<string, string>();
  /**
   * Single-flight guard: `getSettings` and `getMcpStatus` arrive almost
   * simultaneously from the webview (handleTabChange posts both at once)
   * and each calls `initialize()`. With a plain boolean, the second call
   * would see "already initialized" and immediately read back empty
   * statuses — the actual connection (connectAll) hadn't had time to run
   * yet. By keeping the Promise itself, any concurrent caller awaits the
   * same in-flight connection instead of reading a not-yet-ready state.
   */
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly cfg: ConfigManager = getConfigManager(),
    /** Injectable factory (tests). */
    private readonly clientFactory: (
      name: string,
      config: McpServerConfig,
      inProcessFactory?: () => Server
    ) => JarvisMcpClient = (name, config, inProcessFactory) =>
      new JarvisMcpClient(name, config, inProcessFactory),
    /** Open workspace folder (provided by the caller — no vscode import here). */
    private readonly workspaceFolder?: string
  ) {}

  /**
   * Effective servers: the built-in servers (activation/tools overridden by
   * `config.builtinMcp`) followed by user servers. A user server sharing a
   * builtin's name shadows it.
   */
  private resolveServers(): ResolvedServer[] {
    const config = this.cfg.getConfig();
    const userServers = config.mcpServers ?? {};
    const overrides = config.builtinMcp ?? {};

    const builtins: ResolvedServer[] = getBuiltinMcpServers(this.workspaceFolder)
      .filter(b => !(b.id in userServers))
      .map(b => {
        // A workspace-bound builtin stays listed but is unconnectable
        // without a folder; a builtin bound to a git repo stays listed but
        // is unconnectable if the folder isn't itself a git root
        // (mcp-server-git would fail with "not a valid Git repository").
        // Both guards take precedence over any user override — otherwise
        // the connection would fail anyway, just later.
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

  /** Connects all enabled servers; errors are isolated per server. */
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
            operationLogger.log('mcp', `Server ${name} connected (${tools.length} tools)`, 'success');
          } catch (err) {
            let msg = err instanceof Error ? err.message : String(err);
            // Most common error on Python servers: uv missing from PATH.
            if (config.command === 'uvx' && /enoent|not found|introuvable/i.test(msg)) {
              msg = `uv (uvx) not found — install uv: https://docs.astral.sh/uv/ (${msg})`;
            }
            this.errors.set(name, msg);
            operationLogger.log('mcp', `Server ${name} unreachable: ${msg}`, 'error');
          }
        })
    );
  }

  /** Closes everything then reconnects according to the current config. */
  public async reload(): Promise<void> {
    await Promise.all([...this.servers.values()].map(s => s.client.close().catch(() => undefined)));
    this.servers.clear();
    this.errors.clear();
    // A concurrent call to initialize() must wait for THIS reconnection, not
    // the old one (already resolved), and must not proceed immediately.
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
   * Effective policy of each connected MCP tool, indexed by the name
   * registered in the agent registry (`mcp__<server>__<tool>`).
   * Merged into `OrchestratorOptions.toolPolicies` (default: `ask`).
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
   * Raw tool names per CONNECTED server, excluding `excluded` policy.
   * Feeds the builtin deduplication (builtin-dedup.ts):
   * a disabled or unreachable server does not appear here, so its
   * builtin equivalents remain available.
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

  /** MCP tools discovered, adapted to the agent registry (HITL `mcp`). */
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
