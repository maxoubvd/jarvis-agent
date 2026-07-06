import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '../../config/config-manager.js';

export interface McpToolInfo {
  name: string;
  description: string;
  /** JSON Schema des arguments, tel que déclaré par le serveur. */
  inputSchema: Record<string, unknown>;
}

/**
 * Client MCP réel : se connecte à un serveur (stdio ou SSE), découvre ses
 * tools et permet de les appeler. Une instance par serveur configuré.
 */
export class JarvisMcpClient {
  private client: McpClient;
  private transport: Transport | null = null;
  public connected = false;
  public lastError: string | null = null;

  constructor(
    public readonly serverName: string,
    private readonly config: McpServerConfig
  ) {
    this.client = new McpClient(
      { name: 'jarvis-mcp-client', version: '0.0.1' },
      { capabilities: {} }
    );
  }

  public async connect(): Promise<void> {
    try {
      this.transport = this.buildTransport();
      await this.client.connect(this.transport);
      this.connected = true;
      this.lastError = null;
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  private buildTransport(): Transport {
    if (this.config.transport === 'stdio') {
      if (!this.config.command) {
        throw new Error(`MCP ${this.serverName}: 'command' requis pour le transport stdio`);
      }
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env: this.config.env
      });
    }
    if (!this.config.url) {
      throw new Error(`MCP ${this.serverName}: 'url' requise pour le transport sse`);
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

  /** Appelle un tool et aplatit le contenu texte de la réponse. */
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
      throw new Error(text || `MCP tool ${name}: erreur sans message`);
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
