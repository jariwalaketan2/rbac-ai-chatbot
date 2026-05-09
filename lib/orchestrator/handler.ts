import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import type { AIMessage, ToolMessage } from '@langchain/core/messages';
import type { Context } from '../auth/context';
import { getModel, getActiveProvider } from '../llm/model';
import { getToolsForContext, listAvailableToolNames, listAvailableDataToolNames } from '../tools/registry';
import { buildSystemPrompt } from './prompt';
import type { RefusalReason } from './refusal';

export type ToolCallSummary = { name: string; args: unknown };
export type ToolResultSummary = { name: string; result: unknown };

export type StreamEvent =
  | { type: 'metadata'; provider: string; availableTools: string[] }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'text_chunk'; text: string }
  | { type: 'done'; steps: number; refusal: { reason: RefusalReason; details?: string } | null; usedFinalize: boolean };

export type ChatResponse = {
  text: string;
  provider: string;
  availableTools: string[];
  toolCalls: ToolCallSummary[];
  toolResults: ToolResultSummary[];
  refusal: { reason: RefusalReason; missing?: string; details?: string } | null;
  usedFinalize: boolean;
  steps: number;
};

const HALLUCINATION_PATTERN = /\$\d|\b\d{2,}\b/;

export async function* streamQuery(
  message: string,
  ctx: Context,
): AsyncGenerator<StreamEvent> {
  const availableTools = listAvailableToolNames(ctx);
  const dataTools = listAvailableDataToolNames(ctx);
  const systemPrompt = buildSystemPrompt({ orgId: ctx.orgId, role: ctx.role, availableTools });

  yield { type: 'metadata', provider: getActiveProvider(), availableTools };

  const agent = createReactAgent({
    llm: getModel(),
    tools: getToolsForContext(ctx),
    stateModifier: systemPrompt,
  });

  const toolCalls: ToolCallSummary[] = [];
  const toolResults: ToolResultSummary[] = [];
  let textBuffer = '';
  let steps = 0;

  // streamMode:'updates' gives complete node outputs — no chunk assembly needed.
  // LangGraph still calls ChatOllama.stream() internally, keeping the Ollama
  // connection alive with token chunks (resets write-timeout each chunk).
  const stream = await agent.stream(
    { messages: [new HumanMessage(message)] },
    { streamMode: 'updates', recursionLimit: 25 },
  );

  for await (const update of stream as AsyncIterable<Record<string, { messages: unknown[] }>>) {
    steps++;

    if (update.agent) {
      for (const msg of update.agent.messages as AIMessage[]) {
        // Tool calls this step
        for (const tc of msg.tool_calls ?? []) {
          toolCalls.push({ name: tc.name, args: tc.args });
          yield { type: 'tool_call', name: tc.name, args: tc.args };
        }
        // Final answer — no tool calls in this message
        if (!msg.tool_calls?.length) {
          const text = typeof msg.content === 'string' ? msg.content : '';
          if (text) {
            textBuffer = text;
            yield { type: 'text_chunk', text };
          }
        }
      }
    }

    if (update.tools) {
      for (const tm of update.tools.messages as ToolMessage[]) {
        let result: unknown;
        try {
          result = typeof tm.content === 'string' ? JSON.parse(tm.content) : tm.content;
        } catch {
          result = tm.content;
        }
        toolResults.push({ name: tm.name ?? '', result });
        yield { type: 'tool_result', name: tm.name ?? '', result };
      }
    }
  }

  // Hallucination guard: numeric claim with no data tool called this turn
  const dataCallsMade = toolCalls.filter((c) => dataTools.includes(c.name));
  if (dataCallsMade.length === 0 && HALLUCINATION_PATTERN.test(textBuffer)) {
    yield { type: 'done', steps, refusal: { reason: 'OUT_OF_SCOPE', details: 'no backing tool result' }, usedFinalize: false };
    return;
  }

  yield { type: 'done', steps, refusal: null, usedFinalize: dataCallsMade.length > 0 };
}

// Convenience wrapper used by the eval script and tests.
export async function handleQuery(message: string, ctx: Context): Promise<ChatResponse> {
  const availableTools = listAvailableToolNames(ctx);
  let text = '';
  const toolCalls: ToolCallSummary[] = [];
  const toolResults: ToolResultSummary[] = [];
  let refusal: ChatResponse['refusal'] = null;
  let usedFinalize = false;
  let steps = 0;
  let provider = '';

  for await (const event of streamQuery(message, ctx)) {
    if (event.type === 'metadata') provider = event.provider;
    else if (event.type === 'tool_call') toolCalls.push({ name: event.name, args: event.args });
    else if (event.type === 'tool_result') toolResults.push({ name: event.name, result: event.result });
    else if (event.type === 'text_chunk') text += event.text;
    else if (event.type === 'done') {
      steps = event.steps;
      refusal = event.refusal;
      usedFinalize = event.usedFinalize;
      if (refusal) text = "I can't answer that without verified data. Please rephrase or ask about available data.";
    }
  }

  return { text, provider, availableTools, toolCalls, toolResults, refusal, usedFinalize, steps };
}
