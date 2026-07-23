import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: undefined }
}));

import { getBuiltinMcpServers, builtinCommandString } from '../../packages/core/src/core/mcp/builtin.js';
import { McpManager } from '../../packages/core/src/core/mcp/manager.js';
import type { JarvisMcpClient, McpToolInfo } from '../../packages/core/src/core/mcp/client.js';
import type { ConfigManager, JarvisConfig } from '../../packages/core/src/config/config-manager.js';

// `isGitRepository()` (builtin.ts) does a real `fs.existsSync`, so the
// old fake "C:\\proj" folders are no longer sufficient to test the
// builtin git behavior — we need real directories on disk.
let gitRepoDir: string;
let plainDir: string;

beforeAll(() => {
  gitRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-git-repo-'));
  fs.mkdirSync(path.join(gitRepoDir, '.git'));
  plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-plain-'));
});

afterAll(() => {
  fs.rmSync(gitRepoDir, { recursive: true, force: true });
  fs.rmSync(plainDir, { recursive: true, force: true });
});

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

/** Like fakeClient, but `connect()` only resolves after a micro-delay — simulates real spawn/handshake time of an MCP server. */
function slowFakeClient(tools: McpToolInfo[] = [], delayMs = 20): JarvisMcpClient {
  return {
    connect: vi.fn(() => new Promise<void>(resolve => setTimeout(resolve, delayMs))),
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

  it('enables memory/filesystem/git/fetch by default when the folder is itself a git repository', () => {
    const byId = new Map(getBuiltinMcpServers(gitRepoDir).map(b => [b.id, b]));
    expect(byId.get('memory')!.config.enabled).toBe(true);
    expect(byId.get('filesystem')!.config.enabled).toBe(true);
    expect(byId.get('git')!.config.enabled).toBe(true);
    expect(byId.get('fetch')!.config.enabled).toBe(true);
    expect(byId.get('fetch')!.inProcess).toBe(true);
  });

  it('disables workspace-bound servers when no folder is open', () => {
    const byId = new Map(getBuiltinMcpServers().map(b => [b.id, b]));
    expect(byId.get('filesystem')!.config.enabled).toBe(false);
    expect(byId.get('filesystem')!.description).toContain('requires an open folder');
    expect(byId.get('git')!.config.enabled).toBe(false);
  });

  it('keeps git disabled by default when the open folder is not itself a git repository', () => {
    // Regression: "Recette Jarvis" is a subfolder of a parent repo —
    // `git` CLI resolves it via auto-discovery, but mcp-server-git does not, so it
    // always failed with "not a valid Git repository". The builtin must
    // remain disabled by default in this specific case, while filesystem
    // (which does not depend on git) remains normally enabled.
    const byId = new Map(getBuiltinMcpServers(plainDir).map(b => [b.id, b]));
    expect(byId.get('filesystem')!.config.enabled).toBe(true);
    expect(byId.get('git')!.config.enabled).toBe(false);
    expect(byId.get('git')!.description).toContain('isn\'t a git repository');
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
    // fetch receives its in-process factory
    const fetchCall = factory.mock.calls.find(c => c[0] === 'fetch')!;
    expect(typeof fetchCall[2]).toBe('function');
    // filesystem/git require an open folder
    expect(names).not.toContain('filesystem');
    expect(names).not.toContain('git');
  });

  it('lets concurrent initialize() callers wait for the same in-flight connection', async () => {
    // Regression: `getSettings` and `getMcpStatus` are posted almost
    // simultaneously by the webview (handleTabChange) and each calls,
    // independently, `await mcp.initialize()` then reads the statuses right
    // after. With a simple "initialized" boolean, the second caller
    // would already see true and its `await` would resolve immediately — before
    // connectAll() finished connecting — so it would read empty statuses.
    // In practice this resulted in "I no longer see server tools" in Settings.
    // Each branch below reads ITS OWN statuses right after ITS `await`, without
    // ever waiting for the other branch (unlike `Promise.all`, which would hide
    // the bug by waiting for the slowest branch anyway).
    const factory = vi.fn(() => slowFakeClient([{ name: 'create_entities', description: '', inputSchema: {} }]));
    const manager = new McpManager(fakeConfigManager({}), factory);

    let toolsSeenBySecondCaller = -1;
    const first = manager.initialize();
    const second = manager.initialize().then(() => {
      toolsSeenBySecondCaller = manager.getStatuses().find(s => s.name === 'memory')!.tools.length;
    });

    await first;
    await second;

    expect(toolsSeenBySecondCaller).toBe(1);
    // Only one real connection per server despite the two concurrent calls.
    expect(factory.mock.calls.filter(c => c[0] === 'memory')).toHaveLength(1);
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
    // ...but they remain listed in the statuses.
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

  it('connects workspace-bound builtins when the workspaceFolder is a git repository', async () => {
    const factory = vi.fn(() => fakeClient());
    const manager = new McpManager(fakeConfigManager({}), factory, gitRepoDir);
    await manager.initialize();
    const names = factory.mock.calls.map(c => c[0]);
    expect(names).toContain('filesystem');
    // git is enabled by default as soon as the folder itself is a git repo
    expect(names).toContain('git');
    const statusNames = manager.getStatuses().map(s => s.name);
    expect(statusNames).toContain('git');
  });

  it('never connects the git builtin when the folder is not itself a git repository, even if explicitly overridden on', async () => {
    const factory = vi.fn(() => fakeClient());
    const manager = new McpManager(
      fakeConfigManager({ builtinMcp: { git: { enabled: true } } }),
      factory,
      plainDir
    );
    await manager.initialize();
    const names = factory.mock.calls.map(c => c[0]);
    // filesystem does not depend on git: it connects normally.
    expect(names).toContain('filesystem');
    expect(names).not.toContain('git');
    // ...but remains listed in the statuses (to offer the "git init" flow).
    const statusNames = manager.getStatuses().map(s => s.name);
    expect(statusNames).toContain('git');
  });
});
