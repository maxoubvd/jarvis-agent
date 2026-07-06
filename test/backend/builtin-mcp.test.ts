import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: undefined }
}));

import { getBuiltinMcpServers, builtinCommandString } from '../../src/backend/core/mcp/builtin.js';
import { McpManager } from '../../src/backend/core/mcp/manager.js';
import type { JarvisMcpClient, McpToolInfo } from '../../src/backend/core/mcp/client.js';
import type { ConfigManager, JarvisConfig } from '../../src/backend/config/config-manager.js';

function fakeConfigManager(partial: Partial<JarvisConfig>): ConfigManager {
  const config: JarvisConfig = {
    version: 1,
    models: { default: null, items: [] },
    ...partial
  };
  return { getConfig: () => config } as unknown as ConfigManager;
}

function fakeClient(tools: McpToolInfo[] = []): JarvisMcpClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue(tools),
    callTool: vi.fn().mockResolvedValue('ok'),
    close: vi.fn().mockResolvedValue(undefined),
    connected: false,
    lastError: null,
    serverName: 'x'
  } as unknown as JarvisMcpClient;
}

describe('getBuiltinMcpServers', () => {
  it('always lists the 4 builtin servers, even without a workspace folder', () => {
    const ids = getBuiltinMcpServers().map(b => b.id);
    expect(ids).toEqual(['memory', 'filesystem', 'git', 'fetch']);
  });

  it('binds filesystem and git to the workspace folder when provided', () => {
    const servers = getBuiltinMcpServers('C:\\proj');
    expect(servers.find(b => b.id === 'filesystem')!.config.args).toContain('C:\\proj');
    expect(servers.find(b => b.id === 'git')!.config.args).toContain('C:\\proj');
  });

  it('enables memory/filesystem/fetch by default and keeps git opt-in (uvx required)', () => {
    const byId = new Map(getBuiltinMcpServers('C:\\proj').map(b => [b.id, b]));
    expect(byId.get('memory')!.config.enabled).toBe(true);
    expect(byId.get('filesystem')!.config.enabled).toBe(true);
    expect(byId.get('git')!.config.enabled).toBe(false);
    expect(byId.get('fetch')!.config.enabled).toBe(true);
    expect(byId.get('fetch')!.inProcess).toBe(true);
  });

  it('disables workspace-bound servers when no folder is open', () => {
    const byId = new Map(getBuiltinMcpServers().map(b => [b.id, b]));
    expect(byId.get('filesystem')!.config.enabled).toBe(false);
    expect(byId.get('filesystem')!.description).toContain('requires an open folder');
    expect(byId.get('git')!.config.enabled).toBe(false);
  });

  it('renders a readable command string, "(built-in)" for in-process servers', () => {
    const servers = getBuiltinMcpServers();
    expect(builtinCommandString(servers.find(b => b.id === 'memory')!)).toBe(
      'npx -y @modelcontextprotocol/server-memory'
    );
    expect(builtinCommandString(servers.find(b => b.id === 'fetch')!)).toBe('(built-in)');
  });
});

describe('McpManager with builtins', () => {
  it('connects default-enabled builtins (memory + in-process fetch) out of the box', async () => {
    const factory = vi.fn(() => fakeClient());
    const manager = new McpManager(fakeConfigManager({}), factory);
    await manager.initialize();
    const names = factory.mock.calls.map(c => c[0]);
    expect(names).toContain('memory');
    expect(names).toContain('fetch');
    // fetch reçoit sa fabrique in-process
    const fetchCall = factory.mock.calls.find(c => c[0] === 'fetch')!;
    expect(typeof fetchCall[2]).toBe('function');
    // filesystem/git nécessitent un dossier ouvert
    expect(names).not.toContain('filesystem');
    expect(names).not.toContain('git');
  });

  it('honors builtinMcp overrides (disable memory and fetch)', async () => {
    const factory = vi.fn(() => fakeClient());
    const manager = new McpManager(
      fakeConfigManager({ builtinMcp: { memory: { enabled: false }, fetch: { enabled: false } } }),
      factory
    );
    await manager.initialize();
    const names = factory.mock.calls.map(c => c[0]);
    expect(names).not.toContain('memory');
    expect(names).not.toContain('fetch');
  });

  it('never connects workspace-bound builtins without a folder, even if overridden on', async () => {
    const factory = vi.fn(() => fakeClient());
    const manager = new McpManager(
      fakeConfigManager({ builtinMcp: { filesystem: { enabled: true }, git: { enabled: true } } }),
      factory
    );
    await manager.initialize();
    const names = factory.mock.calls.map(c => c[0]);
    expect(names).not.toContain('filesystem');
    expect(names).not.toContain('git');
    // ...mais ils restent listés dans les statuts.
    const statusNames = manager.getStatuses().map(s => s.name);
    expect(statusNames).toContain('filesystem');
    expect(statusNames).toContain('git');
  });

  it('lets a user server shadow a builtin with the same name', async () => {
    const factory = vi.fn(() => fakeClient());
    const manager = new McpManager(
      fakeConfigManager({
        mcpServers: { memory: { enabled: true, transport: 'stdio', command: 'custom-memory' } }
      }),
      factory
    );
    await manager.initialize();
    const memoryCalls = factory.mock.calls.filter(c => c[0] === 'memory');
    expect(memoryCalls).toHaveLength(1);
    expect((memoryCalls[0][1] as { command: string }).command).toBe('custom-memory');
    const memoryStatus = manager.getStatuses().find(s => s.name === 'memory')!;
    expect(memoryStatus.builtin).toBe(false);
  });

  it('flags builtins in getStatuses with their description', async () => {
    const manager = new McpManager(
      fakeConfigManager({ builtinMcp: { memory: { enabled: false } } }),
      () => fakeClient()
    );
    await manager.initialize();
    const statuses = manager.getStatuses();
    const memory = statuses.find(s => s.name === 'memory')!;
    expect(memory.builtin).toBe(true);
    expect(memory.enabled).toBe(false);
    expect(memory.description).toBeTruthy();
  });

  it('connects workspace-bound builtins when a workspaceFolder is passed', async () => {
    const factory = vi.fn(() => fakeClient());
    const manager = new McpManager(fakeConfigManager({}), factory, 'C:\\proj');
    await manager.initialize();
    const names = factory.mock.calls.map(c => c[0]);
    expect(names).toContain('filesystem');
    // git reste opt-in
    expect(names).not.toContain('git');
    const statusNames = manager.getStatuses().map(s => s.name);
    expect(statusNames).toContain('git');
  });
});
