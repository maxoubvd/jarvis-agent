import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '../../config/config-manager.js';

/**
 * Known install directories for `uv`/`uvx` (official astral.sh installer),
 * missing from the PATH inherited by the Extension Host if the tool was
 * installed after VS Code started (the process doesn't re-read the user's
 * PATH on the fly).
 */
function knownUvInstallDirs(): string[] {
  const home = os.homedir();
  return process.platform === 'win32'
    ? [path.join(home, '.local', 'bin')]
    : [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin')];
}

/** Adds the known `uv`/`uvx` install directories to PATH if they exist and aren't already there. */
function augmentPathForUv(env: Record<string, string>): Record<string, string> {
  const sep = process.platform === 'win32' ? ';' : ':';
  const currentPath = env.PATH ?? '';
  const existing = new Set(currentPath.split(sep).filter(Boolean));
  const toAdd = knownUvInstallDirs().filter(dir => !existing.has(dir) && fs.existsSync(dir));
  if (toAdd.length === 0) return env;
  return { ...env, PATH: [currentPath, ...toAdd].filter(Boolean).join(sep) };
}

export interface McpToolInfo {
  name: string;
  description: string;
  /** JSON Schema of the arguments, as declared by the server. */
  inputSchema: Record<string, unknown>;
}

/**
 * Real MCP client: connects to a server (stdio or SSE), discovers its
 * tools, and allows calling them. One instance per configured server.
 */
export class JarvisMcpClient {
  private client: McpClient;
  private transport: Transport | null = null;
  public connected = false;
  public lastError: string | null = null;
  /**
   * Last stderr output of the stdio process (e.g. a Python traceback from a
   * `mcp-server-git` that crashes on startup). Without this, a connection
   * failure only surfaces as "MCP error -32000: Connection closed" — true
   * but useless for diagnosing *why* the process died.
   */
  private stderrBuffer = '';

  constructor(
    public readonly serverName: string,
    private readonly config: McpServerConfig,
    /** In-process server (builtin implemented in the extension): connected via an in-memory pair. */
    private readonly inProcessFactory?: () => Server
  ) {
    this.client = new McpClient(
      { name: 'jarvis-mcp-client', version: '0.0.1' },
      { capabilities: {} }
    );
  }

  private captureStderr(transport: Transport): void {
    if (!(transport instanceof StdioClientTransport) || !transport.stderr) return;
    transport.stderr.on('data', (chunk: Buffer) => {
      this.stderrBuffer = (this.stderrBuffer + chunk.toString()).slice(-4000);
    });
  }

  public async connect(): Promise<void> {
    try {
      this.transport = await this.buildTransport();
      this.captureStderr(this.transport);
      await this.client.connect(this.transport);
      this.connected = true;
      this.lastError = null;
    } catch (err) {
      this.connected = false;
      const baseMsg = err instanceof Error ? err.message : String(err);
      const stderr = this.stderrBuffer.trim();
      const msg = stderr ? `${baseMsg}\n${stderr}` : baseMsg;
      this.lastError = msg;
      throw new Error(msg);
    }
  }

  private async buildTransport(): Promise<Transport> {
    if (this.inProcessFactory) {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await this.inProcessFactory().connect(serverTransport);
      return clientTransport;
    }
    if (this.config.transport === 'stdio') {
      if (!this.config.command) {
        throw new Error(`MCP ${this.serverName}: 'command' is required for stdio transport`);
      }
      // Merge with the default environment: an `env` provided as-is would
      // REPLACE the process environment (PATH lost → npx/uvx broken).
      let env = { ...getDefaultEnvironment(), ...this.config.env };
      if (this.config.command === 'uvx' || this.config.command === 'uv') {
        env = augmentPathForUv(env);
      }
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env,
        stderr: 'pipe'
      });
    }
    if (!this.config.url) {
      throw new Error(`MCP ${this.serverName}: 'url' is required for sse transport`);
    }
    return new SSEClientTransport(new URL(this.config.url), {
      requestInit: this.config.headers ? { headers: this.config.headers } : undefined
    });
  }

  public async listTools(): Promise<McpToolInfo[]> {
    const result = await this.client.listTools();
    return (result.tools ?? []).map(tool => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>
    }));
  }

  /** Calls a tool and flattens the text content of the response. */
  public async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.client.callTool({ name, arguments: args });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map(part => {
        if (part.type === 'text') return part.text;
        return `[${part.type}]`;
      })
      .join('\n');
    if (result.isError) {
      throw new Error(text || `MCP tool ${name}: error with no message`);
    }
    return text;
  }

  public async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* best-effort */
    }
    this.connected = false;
  }
}
