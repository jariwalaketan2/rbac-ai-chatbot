import { generateText, stepCountIs, hasToolCall } from 'ai';
import type { Context } from '../auth/context';
import { getModel, getActiveProvider } from '../llm/model';
import {
  getToolsForContext,
  listAvailableToolNames,
  listAvailableDataToolNames,
} from '../tools/registry';
import { buildSystemPrompt } from './prompt';
import { refusalText, type RefusalReason } from './refusal';

export type ToolCallSummary = { name: string; args: unknown };
export type ToolResultSummary = { name: string; result: unknown };

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

export async function handleQuery(
  message: string,
  ctx: Context,
): Promise<ChatResponse> {
  const tools = getToolsForContext(ctx);
  const availableTools = listAvailableToolNames(ctx);
  const dataTools = listAvailableDataToolNames(ctx);

  const system = buildSystemPrompt({
    orgId: ctx.orgId,
    role: ctx.role,
    availableTools,
  });

  const result = await generateText({
    model: getModel(),
    system,
    prompt: message,
    tools,
    toolChoice: 'required',
    // Stop as soon as finalize or respondWithoutData is called (they are terminators).
    // stepCountIs(4) is a safety cap in case neither fires.
    stopWhen: [
      hasToolCall('finalize'),
      hasToolCall('respondWithoutData'),
      stepCountIs(4),
    ],
    maxRetries: 0, // fail fast — let the route layer handle retries/rate-limit UX
  });

  // Collect tool calls and results across ALL steps, not just the last one.
  // In AI SDK v5, result.toolCalls only contains the final step's calls.
  const toolCalls: ToolCallSummary[] = result.steps.flatMap((s) =>
    (s.toolCalls ?? []).map((c) => ({
      name: c.toolName,
      args: (c as { input?: unknown }).input ?? (c as { args?: unknown }).args,
    })),
  );

  const toolResults: ToolResultSummary[] = result.steps.flatMap((s) =>
    (s.toolResults ?? []).map((r) => ({
      name: r.toolName,
      result:
        (r as { output?: unknown }).output ??
        (r as { result?: unknown }).result,
    })),
  );

  const lastFinalize = [...toolCalls].reverse().find((c) => c.name === 'finalize');
  const lastRefusal = [...toolCalls]
    .reverse()
    .find((c) => c.name === 'respondWithoutData');

  const dataCallsMade = toolCalls.filter((c) => dataTools.includes(c.name));

  let text: string;
  let refusal: ChatResponse['refusal'] = null;
  let usedFinalize = false;

  if (lastRefusal) {
    const args = lastRefusal.args as {
      reason: RefusalReason;
      missing?: string;
      details?: string;
    };
    refusal = {
      reason: args.reason,
      missing: args.missing,
      details: args.details,
    };
    text = refusalText(
      args.reason,
      { availableTools },
      { missing: args.missing, details: args.details },
    );
  } else if (lastFinalize) {
    const answer = (lastFinalize.args as { answer?: string }).answer ?? '';

    // Hallucination guard: if the model produced a numeric claim with no
    // backing data tool call this turn, refuse instead of repeating it.
    if (
      dataCallsMade.length === 0 &&
      HALLUCINATION_PATTERN.test(answer)
    ) {
      refusal = { reason: 'OUT_OF_SCOPE', details: 'no backing tool result' };
      text = refusalText(
        'OUT_OF_SCOPE',
        { availableTools },
        { details: 'no backing tool result' },
      );
    } else {
      usedFinalize = true;
      text = answer;
    }
  } else {
    refusal = { reason: 'OUT_OF_SCOPE' };
    text = "I couldn't complete that request. Try rephrasing.";
  }

  return {
    text,
    provider: getActiveProvider(),
    availableTools,
    toolCalls,
    toolResults,
    refusal,
    usedFinalize,
    steps: result.steps?.length ?? 1,
  };
}
