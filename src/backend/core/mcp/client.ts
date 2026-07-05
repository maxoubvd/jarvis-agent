import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';

export class JarvisMcpClient {
  private client: McpClient;

  constructor() {
    this.client = new McpClient(
      { name: 'jarvis-mcp-client', version: '0.0.1' },
      { capabilities: {} }
    );
  }

  public getClient(): McpClient {
    return this.client;
  }

  public async initialize(): Promise<void> {}
}
