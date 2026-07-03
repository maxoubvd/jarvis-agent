export interface IModelProvider {
  name: string;
  sendPrompt(prompt: string): Promise<string>;
}
