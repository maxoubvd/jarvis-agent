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
 * Répertoires d'installation connus de `uv`/`uvx` (installateur officiel astral.sh),
 * absents du PATH hérité par l'Extension Host si l'outil a été installé après le
 * démarrage de VS Code (le process ne relit pas le PATH utilisateur à chaud).
 */
function knownUvInstallDirs(): string[] {
  const home = os.homedir();
  return process.platform === 'win32'
    ? [path.join(home, '.local', 'bin')]
    : [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin')];
}

/** Ajoute au PATH les répertoires connus d'installation de `uv`/`uvx` s'ils existent et n'y sont pas déjà. */
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
    private readonly config: McpServerConfig,
    /** Serveur in-process (builtin implémenté dans l'extension) : connexion par paire mémoire. */
    private readonly inProcessFactory?: () => Server
  ) {
    this.client = new McpClient(
      { name: 'jarvis-mcp-client', version: '0.0.1' },
      { capabilities: {} }
    );
  }

  public async connect(): Promise<void> {
    try {
      this.transport = await this.buildTransport();
      await this.client.connect(this.transport);
      this.connected = true;
      this.lastError = null;
    } catch (err) {
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
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
        throw new Error(`MCP ${this.serverName}: 'command' requis pour le transport stdio`);
      }
      // Fusionne avec l'environnement par défaut : un `env` fourni tel quel
      // REMPLACERAIT l'environnement du process (PATH perdu → npx/uvx cassés).
      let env = { ...getDefaultEnvironment(), ...this.config.env };
      if (this.config.command === 'uvx' || this.config.command === 'uv') {
        env = augmentPathForUv(env);
      }
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env
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
