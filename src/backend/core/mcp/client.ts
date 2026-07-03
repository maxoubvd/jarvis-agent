import { Client as McpClient } from '@modelcontextprotocol/sdk/client';

export class JarvisMcpClient {
  private client: McpClient;

  constructor() {
    this.client = new McpClient({
      name: 'jarvis-mcp-client',
      version: '0.0.1'
    } as any);
  }

  public async initialize(): Promise<void> {
    console.log('JarvisMcpClient: initialisation');
  }
}
