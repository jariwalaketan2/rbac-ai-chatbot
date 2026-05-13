import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';

type SupportedModel = ChatOllama | ChatOpenAI;

let _model: SupportedModel | null = null;

function isOpenAICompatible(): boolean {
  const url = process.env.OLLAMA_BASE_URL ?? '';
  return url.endsWith('/v1') || url.includes('/v1/');
}

export function getModel(): SupportedModel {
  if (!_model) {
    if (isOpenAICompatible()) {
      _model = new ChatOpenAI({
        model: process.env.OLLAMA_MODEL ?? 'qwen3:8b',
        apiKey: process.env.OPENAI_API_KEY || 'vllm',
        configuration: {
          baseURL: process.env.OLLAMA_BASE_URL,
        },
        temperature: 0,
        maxTokens: 1024,
      });
    } else {
      _model = new ChatOllama({
        model: process.env.OLLAMA_MODEL ?? 'qwen3.5:9b',
        baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        temperature: 0,
        numCtx: 4096,
        numThread: 2,
        numPredict: 1024,
        keepAlive: '10m',
      });
    }
  }
  return _model;
}

export function getActiveProvider(): string {
  const model = process.env.OLLAMA_MODEL ?? 'qwen3.5:9b';
  return isOpenAICompatible() ? `openai-compat/${model}` : `ollama/${model}`;
}
