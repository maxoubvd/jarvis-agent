export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface IModelProvider {
  name: string;
  sendPrompt(messages: ChatMessage[]): Promise<string>;
  sendPromptStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void
  ): Promise<void>;
}
