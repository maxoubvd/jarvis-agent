import { IModelProvider } from '../abstract.js';

export class OllamaProvider implements IModelProvider {
  public name = 'ollama';

  public async sendPrompt(prompt: string): Promise<string> {
    return `Réponse simulée pour Ollama : ${prompt}`;
  }
}
