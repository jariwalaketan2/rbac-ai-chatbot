import { ChatOllama } from '@langchain/ollama';

// Module-level singleton — avoids reconstructing the client on every request.
let _model: ChatOllama | null = null;

export function getModel(): ChatOllama {
  if (!_model) {
    _model = new ChatOllama({
      model: process.env.OLLAMA_MODEL ?? 'qwen2.5:3b',
      baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      temperature: 0,
      numCtx: 2048,
      numThread: 2,
      numPredict: 256,
      keepAlive: '10m',
    });
  }
  return _model;
}

export function getActiveProvider(): string {
  return `ollama/${process.env.OLLAMA_MODEL ?? 'qwen2.5:3b'}`;
}
