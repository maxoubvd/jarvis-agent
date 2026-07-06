import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: undefined }
}));

import { McpManager, parametersFromJsonSchema } from '../../src/backend/core/mcp/manager.js';
import type { JarvisMcpClient, McpToolInfo } from '../../src/backend/core/mcp/client.js';
import type { ConfigManager, JarvisConfig, McpServerConfig } from '../../src/backend/config/config-manager.js';

function fakeConfigManager(mcpServers: Record<string, McpServerConfig>): ConfigManager {
  const config: JarvisConfig = {
    version: 1,
    models: { default: null, providers: {} },
    mcpServers
  };
  return { getConfig: () => config } as unknown as ConfigManager;
}

function fakeClient(tools: McpToolInfo[], failConnect = false): JarvisMcpClient {
  return {
    connect: failConnect
      ? vi.fn().mockRejectedValue(new Error('spawn failed'))
      : vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue(tools),
    callTool: vi.fn().mockResolvedValue('tool output'),
    close: vi.fn().mockResolvedValue(undefined),
    connected: false,
    lastError: null,
    serverName: 'x'
  } as unknown as JarvisMcpClient;
}

const echoTool: McpToolInfo = {
  name: 'echo',
  description: 'Echoes input',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'text to echo' },
      count: { type: 'integer', description: 'repeat count' }
    },
    required: ['text']
  }
};

describe('parametersFromJsonSchema', () => {
  it('maps properties and required flags', () => {
    const params = parametersFromJsonSchema(echoTool.inputSchema);
    expect(params).toEqual([
      { name: 'text', type: 'string', description: 'text to echo', required: true },
      { name: 'count', type: 'number', description: 'repeat count', required: false }
    ]);
  });

  it('handles empty schemas', () => {
    expect(parametersFromJsonSchema({})).toEqual([]);
  });
});

describe('McpManager', () => {
  const stdioConfig: McpServerConfig = { enabled: true, transport: 'stdio', command: 'npx' };

  it('connects enabled servers and exposes their tools as ToolDefinitions', async () => {
    const client = fakeClient([echoTool]);
    const manager = new McpManager(fakeConfigManager({ srv: stdioConfig }), () => client);
    await manager.initialize();

    const defs = manager.toToolDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('mcp__srv__echo');
    expect(defs[0].hitlAction).toBe('mcp');
    expect(defs[0].parameters[0].name).toBe('text');

    const output = await defs[0].execute({ text: 'hi' });
    expect(output).toBe('tool output');
    expect(client.callTool).toHaveBeenCalledWith('echo', { text: 'hi' });
  });

  it('skips disabled servers', async () => {
    const factory = vi.fn();
    const manager = new McpManager(
      fakeConfigManager({ off: { ...stdioConfig, enabled: false } }),
      factory
    );
    await manager.initialize();
    expect(factory).not.toHaveBeenCalled();
    expect(manager.toToolDefinitions()).toHaveLength(0);
  });

  it('isolates per-server connection failures and reports them in statuses', async () => {
    const good = fakeClient([echoTool]);
    const bad = fakeClient([], true);
    const manager = new McpManager(
      fakeConfigManager({ good: stdioConfig, bad: stdioConfig }),
      name => (name === 'good' ? good : bad)
    );
    await manager.initialize();

    expect(manager.toToolDefinitions()).toHaveLength(1);
    const statuses = manager.getStatuses();
    const badStatus = statuses.find(s => s.name === 'bad')!;
    expect(badStatus.connected).toBe(false);
    expect(badStatus.error).toBe('spawn failed');
    const goodStatus = statuses.find(s => s.name === 'good')!;
    expect(goodStatus.connected).toBe(true);
    expect(goodStatus.tools).toEqual(['echo']);
  });

  it('reload closes existing clients and reconnects', async () => {
    const client = fakeClient([echoTool]);
    const factory = vi.fn(() => client);
    const manager = new McpManager(fakeConfigManager({ srv: stdioConfig }), factory);
    await manager.initialize();
    await manager.reload();
    expect(client.close).toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
