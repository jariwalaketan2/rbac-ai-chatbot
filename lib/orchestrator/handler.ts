import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import type { Context } from '../auth/context';
import { getModel, getActiveProvider } from '../llm/model';
import { getToolsForContext, listAvailableToolNames, listAvailableDataToolNames } from '../tools/registry';
import { buildSystemPrompt } from './prompt';
import type { RefusalReason } from './refusal';

export type ToolCallSummary = { name: string; args: unknown };
export type ToolResultSummary = { name: string; result: unknown };

export type ToolSchema = { name: string; description: string };

export type StreamEvent =
  | { type: 'metadata'; provider: string; availableTools: string[] }
  | { type: 'debug'; systemPrompt: string; toolSchemas: ToolSchema[] }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'text_chunk'; text: string }
  | { type: 'thinking_chunk'; text: string }
  | { type: 'guard'; fired: boolean; reason?: string; textSample?: string }
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
  const boundTools = getToolsForContext(ctx);
  const toolSchemas: ToolSchema[] = boundTools.map((t) => ({
    name: t.name,
    description: (t as { description?: string }).description ?? '',
  }));

  yield { type: 'metadata', provider: getActiveProvider(), availableTools };
  yield { type: 'debug', systemPrompt, toolSchemas };

  const agent = createReactAgent({
    llm: getModel(),
    tools: boundTools,
    stateModifier: systemPrompt,
  });

  const toolCalls: ToolCallSummary[] = [];
  const toolResults: ToolResultSummary[] = [];
  let textBuffer = '';
  let steps = 0;

  type Chunk = {
    _getType?(): string;
    content?: unknown;
    tool_call_chunks?: Array<{ id?: string; name?: string; args?: string; index?: number }>;
    name?: string;
  };

  // Pending tool calls assembled from streaming chunks (id → {name, args})
  const pendingCalls = new Map<string, { name: string; args: string }>();
  const emittedIds = new Set<string>();

  // Real-time <think>...</think> splitter: text_chunk for visible output,
  // thinking_chunk for think-block tokens (forwarded to keep Cloudflare alive,
  // ignored by the frontend switch statement).
  let tagBuf = '';
  let inThink = false;

  async function* emitTokens(token: string, final = false): AsyncGenerator<StreamEvent> {
    tagBuf += token;
    for (;;) {
      if (inThink) {
        const end = tagBuf.indexOf('</think>');
        if (end >= 0) {
          if (end > 0) yield { type: 'thinking_chunk', text: tagBuf.slice(0, end) };
          tagBuf = tagBuf.slice(end + 8);
          inThink = false;
        } else {
          const safe = final ? tagBuf.length : Math.max(0, tagBuf.length - 8);
          if (safe > 0) { yield { type: 'thinking_chunk', text: tagBuf.slice(0, safe) }; tagBuf = tagBuf.slice(safe); }
          break;
        }
      } else {
        const start = tagBuf.indexOf('<think>');
        if (start >= 0) {
          if (start > 0) { const out = tagBuf.slice(0, start); textBuffer += out; yield { type: 'text_chunk', text: out }; }
          tagBuf = tagBuf.slice(start + 7);
          inThink = true;
        } else {
          const safe = final ? tagBuf.length : Math.max(0, tagBuf.length - 7);
          if (safe > 0) { const out = tagBuf.slice(0, safe); textBuffer += out; yield { type: 'text_chunk', text: out }; tagBuf = tagBuf.slice(safe); }
          break;
        }
      }
    }
  }

  // streamMode:'messages' yields one [chunk, metadata] tuple per token,
  // keeping data flowing to the client (and through Cloudflare) continuously.
  const stream = await agent.stream(
    { messages: [new HumanMessage(`/no_think ${message}`)] },
    { streamMode: 'messages', recursionLimit: 25 },
  );

  for await (const [chunk, metadata] of stream as AsyncIterable<[Chunk, { langgraph_node: string }]>) {
    const node = (metadata as { langgraph_node: string }).langgraph_node;

    // Tool results arrive as complete ToolMessage objects from the tools node
    if (node === 'tools') {
      steps++;
      // Flush any pending tool calls before emitting the result
      for (const [id, tc] of pendingCalls) {
        if (!emittedIds.has(id)) {
          let args: unknown;
          try { args = JSON.parse(tc.args); } catch { args = tc.args; }
          toolCalls.push({ name: tc.name, args });
          yield { type: 'tool_call', name: tc.name, args };
          emittedIds.add(id);
        }
      }
      pendingCalls.clear();

      const raw = typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content ?? '');
      let result: unknown;
      try { result = JSON.parse(raw); } catch { result = raw; }
      const name = chunk.name ?? '';
      toolResults.push({ name, result });
      yield { type: 'tool_result', name, result };
      continue;
    }

    if (node !== 'agent') continue;

    // Accumulate tool call argument chunks
    for (const tc of chunk.tool_call_chunks ?? []) {
      const id = tc.id ?? String(tc.index ?? '0');
      if (tc.name) {
        pendingCalls.set(id, { name: tc.name, args: tc.args ?? '' });
      } else if (tc.args) {
        const existing = pendingCalls.get(id);
        if (existing) existing.args += tc.args;
      }
    }

    // Stream text tokens — thinking tokens forwarded as thinking_chunk (keeps
    // Cloudflare connection alive), visible tokens forwarded as text_chunk.
    const token = typeof chunk.content === 'string' ? chunk.content : '';
    if (token) yield* emitTokens(token);
  }

  // Flush any partial tag remaining in the buffer
  yield* emitTokens('', true);

  // Emit tool calls not yet emitted (edge case: no tool result followed them)
  for (const [id, tc] of pendingCalls) {
    if (!emittedIds.has(id)) {
      let args: unknown;
      try { args = JSON.parse(tc.args); } catch { args = tc.args; }
      toolCalls.push({ name: tc.name, args });
      yield { type: 'tool_call', name: tc.name, args };
    }
  }

  steps += toolCalls.length === 0 ? 1 : 2;

  // Hallucination guard: numeric claim with no data tool called this turn
  const dataCallsMade = toolCalls.filter((c) => dataTools.includes(c.name));
  const guardFired = dataCallsMade.length === 0 && HALLUCINATION_PATTERN.test(textBuffer);

  yield {
    type: 'guard',
    fired: guardFired,
    reason: guardFired ? 'Response contained numbers/amounts but no data tool was called' : undefined,
    textSample: guardFired ? textBuffer.slice(0, 300) : undefined,
  };

  if (guardFired) {
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
