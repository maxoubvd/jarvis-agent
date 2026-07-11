import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: undefined }
}));

import { getBuiltinMcpServers, builtinCommandString } from '../../src/backend/core/mcp/builtin.js';
import { McpManager } from '../../src/backend/core/mcp/manager.js';
import type { JarvisMcpClient, McpToolInfo } from '../../src/backend/core/mcp/client.js';
import type { ConfigManager, JarvisConfig } from '../../src/backend/config/config-manager.js';

// `isGitRepository()` (builtin.ts) fait un vrai `fs.existsSync`, donc les
// dossiers "C:\\proj" fictifs d'avant ne suffisent plus pour tester le
// comportement du builtin git — il faut de vrais dossiers sur disque.
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

/** Comme fakeClient, mais `connect()` ne résout qu'après un micro-délai — simule le temps réel de spawn/handshake d'un serveur MCP. */
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
    // Régression : "Recette Jarvis" est un sous-dossier d'un repo parent —
    // `git` CLI le résout via auto-discovery, mais mcp-server-git non, donc il
    // échouait toujours avec "not a valid Git repository". Le builtin doit
    // rester désactivé par défaut dans ce cas précis, alors que filesystem
    // (qui ne dépend pas de git) reste activé normalement.
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
    // fetch reçoit sa fabrique in-process
    const fetchCall = factory.mock.calls.find(c => c[0] === 'fetch')!;
    expect(typeof fetchCall[2]).toBe('function');
    // filesystem/git nécessitent un dossier ouvert
    expect(names).not.toContain('filesystem');
    expect(names).not.toContain('git');
  });

  it('lets concurrent initialize() callers wait for the same in-flight connection', async () => {
    // Régression : `getSettings` et `getMcpStatus` sont postés quasi
    // simultanément par le webview (handleTabChange) et appellent chacun,
    // indépendamment, `await mcp.initialize()` puis lisent les statuts tout de
    // suite après. Avec un simple booléen "initialized", le second appelant
    // voyait déjà true et son `await` résolvait aussitôt — avant que
    // connectAll() n'ait fini de se connecter — donc il lisait des statuts
    // vides. En pratique ça se traduisait par "je ne vois plus les tools des
    // serveurs" dans les Settings. Chaque branche ci-dessous lit SES PROPRES
    // statuts juste après SON `await`, sans jamais attendre l'autre branche
    // (contrairement à un `Promise.all`, qui masquerait le bug en attendant
    // de toute façon la branche la plus lente).
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
    // Une seule connexion réelle par serveur malgré les deux appels concurrents.
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

  it('connects workspace-bound builtins when the workspaceFolder is a git repository', async () => {
    const factory = vi.fn(() => fakeClient());
    const manager = new McpManager(fakeConfigManager({}), factory, gitRepoDir);
    await manager.initialize();
    const names = factory.mock.calls.map(c => c[0]);
    expect(names).toContain('filesystem');
    // git est activé par défaut dès que le dossier est lui-même un repo git
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
    // filesystem ne dépend pas de git : il se connecte normalement.
    expect(names).toContain('filesystem');
    expect(names).not.toContain('git');
    // ...mais reste listé dans les statuts (pour proposer le flow "git init").
    const statusNames = manager.getStatuses().map(s => s.name);
    expect(statusNames).toContain('git');
  });
});
