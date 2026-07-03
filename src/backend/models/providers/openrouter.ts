import { IModelProvider } from '../abstract.js';

export class OpenRouterProvider implements IModelProvider {
  public name = 'openrouter';

  public async sendPrompt(prompt: string): Promise<string> {
    return `Réponse simulée pour OpenRouter : ${prompt}`;
  }
}
