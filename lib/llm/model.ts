import type { LanguageModel } from 'ai';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';

/**
 * Resolve the LLM at runtime from env vars. Pick the first provider whose
 * key is set. LLM_MODEL overrides the default model id for that provider.
 */
export function getModel(): LanguageModel {
  const explicit = process.env.LLM_MODEL;

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google(explicit ?? 'gemini-flash-latest');
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return anthropic(explicit ?? 'claude-haiku-4-5');
  }
  if (process.env.OPENAI_API_KEY) {
    return openai(explicit ?? 'gpt-4o-mini');
  }
  throw new Error(
    'No LLM provider configured. Set one of GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY in .env.local',
  );
}

export function getActiveProvider(): string {
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'none';
}
