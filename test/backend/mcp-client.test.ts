import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConnect, FakeStdioClientTransport } = vi.hoisted(() => {
  /** Minimal pub/sub sufficient to simulate `.stderr` of a stdio transport (no 'events' import here: vi.hoisted() executes before module imports are evaluated). */
  class MiniEmitter {
    private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.listeners[event] ??= []).push(cb);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners[event] ?? []) cb(...args);
    }
  }

  /** Fake transport that behaves like a real stdio transport on stderr. */
  class FakeStdioClientTransport extends MiniEmitter {
    public stderr = new MiniEmitter();
    constructor(public params: unknown) {
      super();
    }
  }
  return { mockConnect: vi.fn(), FakeStdioClientTransport };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mockConnect;
    listTools = vi.fn();
    callTool = vi.fn();
    close = vi.fn();
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: FakeStdioClientTransport,
  getDefaultEnvironment: () => ({ PATH: '/usr/bin' })
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {}
}));

vi.mock('@modelcontextprotocol/sdk/inMemory.js', () => ({
  InMemoryTransport: { createLinkedPair: () => [{}, {}] }
}));

import { JarvisMcpClient } from '../../src/backend/core/mcp/client.js';

describe('JarvisMcpClient stderr capture', () => {
  beforeEach(() => {
    mockConnect.mockReset();
  });

  it('appends captured stderr to the error when the connection closes unexpectedly', async () => {
    // Regression: an MCP stdio server that crashes on startup (e.g., mcp-server-git
    // on an invalid repo) only reported "MCP error -32000: Connection closed"
    // — true but useless for diagnosing the real cause. Now we capture
    // the process stderr and add it to the displayed error message.
    mockConnect.mockImplementation(async (transport: InstanceType<typeof FakeStdioClientTransport>) => {
      transport.stderr.emit('data', Buffer.from('ERROR:mcp_server_git.server:not a valid Git repository\n'));
      throw new Error('MCP error -32000: Connection closed');
    });

    const client = new JarvisMcpClient('git', {
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git', '--repository', '/some/path']
    });

    await expect(client.connect()).rejects.toThrow(/Connection closed[\s\S]*not a valid Git repository/);
    expect(client.lastError).toContain('not a valid Git repository');
    expect(client.connected).toBe(false);
  });

  it('does not append anything when the process produced no stderr output', async () => {
    mockConnect.mockRejectedValue(new Error('spawn uvx ENOENT'));

    const client = new JarvisMcpClient('git', {
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git']
    });

    await expect(client.connect()).rejects.toThrow('spawn uvx ENOENT');
    expect(client.lastError).toBe('spawn uvx ENOENT');
  });

  it('succeeds normally when the server connects without emitting stderr', async () => {
    mockConnect.mockResolvedValue(undefined);

    const client = new JarvisMcpClient('git', {
      enabled: true,
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git']
    });

    await client.connect();
    expect(client.connected).toBe(true);
    expect(client.lastError).toBeNull();
  });
});
