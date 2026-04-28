import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type { Context } from '../auth/context';
import { audit } from '../audit/log';
import { getRevenueReport, getRevenueBreakdown } from '../services/revenue';
import { listTransactions } from '../services/transactions';
import { getUserDetails, listUsers } from '../services/users';

const timeRangeSchema = z.object({
  preset: z.enum([
    'LAST_QUARTER',
    'CURRENT_QUARTER',
    'YEAR_TO_DATE',
    'ALL_TIME',
    'LAST_30_DAYS',
    'LAST_90_DAYS',
    'LAST_12_MONTHS',
    'CUSTOM',
  ]),
  from: z
    .string()
    .optional()
    .describe('ISO date YYYY-MM-DD. Required if preset is CUSTOM.'),
  to: z
    .string()
    .optional()
    .describe('ISO date YYYY-MM-DD. Required if preset is CUSTOM.'),
});

const regionSchema = z.enum(['NA', 'EU', 'APAC']);
const txnTypeSchema = z.enum(['sale', 'refund']);
const roleSchema = z.enum(['ADMIN', 'ANALYST', 'SUPPORT']);

function withAudit<TArgs, TResult>(
  toolName: string,
  ctx: Context,
  fn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | { ok: false; error: string }> {
  return async (args: TArgs) => {
    const start = Date.now();
    try {
      const result = await fn(args);
      audit({
        userId: ctx.userId,
        orgId: ctx.orgId,
        tool: toolName,
        args,
        allowed: true,
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      audit({
        userId: ctx.userId,
        orgId: ctx.orgId,
        tool: toolName,
        args,
        allowed: false,
        reason: message,
        durationMs: Date.now() - start,
      });
      // Safe shape — never leak raw exception details to the LLM.
      return { ok: false, error: 'Service error executing tool.' };
    }
  };
}

type ToolDef = {
  permission: string | null; // null = available to everyone
  build: (ctx: Context) => Tool;
};

const REGISTRY: Record<string, ToolDef> = {
  getRevenueReport: {
    permission: 'READ_REVENUE',
    build: (ctx) =>
      tool({
        description:
          "Get total revenue (sales minus refunds) for the caller's organization over a time range, optionally filtered by region or transaction type. Returns a single aggregate.",
        inputSchema: z.object({
          timeRange: timeRangeSchema,
          region: regionSchema.optional(),
          type: txnTypeSchema.optional(),
        }),
        execute: withAudit('getRevenueReport', ctx, (args) =>
          getRevenueReport(args, ctx),
        ),
      }),
  },

  getRevenueBreakdown: {
    permission: 'READ_REVENUE',
    build: (ctx) =>
      tool({
        description:
          "Group revenue by region (NA/EU/APAC) or by calendar month (YYYY-MM) for the caller's organization over a time range. Use this for trend, comparison, or 'top X' questions.",
        inputSchema: z.object({
          timeRange: timeRangeSchema,
          groupBy: z.enum(['region', 'month']),
        }),
        execute: withAudit('getRevenueBreakdown', ctx, (args) =>
          getRevenueBreakdown(args, ctx),
        ),
      }),
  },

  listTransactions: {
    permission: 'READ_REVENUE',
    build: (ctx) =>
      tool({
        description:
          "List individual transactions in the caller's organization, newest first. Capped at 100. Use for browsing recent activity or finding specific transactions.",
        inputSchema: z.object({
          timeRange: timeRangeSchema.optional(),
          region: regionSchema.optional(),
          type: txnTypeSchema.optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }),
        execute: withAudit('listTransactions', ctx, (args) =>
          listTransactions(args, ctx),
        ),
      }),
  },

  getUserDetails: {
    permission: 'READ_USERS',
    build: (ctx) =>
      tool({
        description:
          "Look up a single user by email within the caller's organization. Returns the same 'not found' shape whether the email exists in a different org or not at all.",
        inputSchema: z.object({
          email: z.string().email(),
        }),
        execute: withAudit('getUserDetails', ctx, (args) =>
          getUserDetails(args, ctx),
        ),
      }),
  },

  listUsers: {
    permission: 'READ_USERS',
    build: (ctx) =>
      tool({
        description:
          "List users in the caller's organization, optionally filtered by role (ADMIN/ANALYST/SUPPORT).",
        inputSchema: z.object({
          role: roleSchema.optional(),
        }),
        execute: withAudit('listUsers', ctx, (args) => listUsers(args, ctx)),
      }),
  },

  finalize: {
    permission: null,
    build: () =>
      tool({
        description:
          "Deliver the final, user-facing answer. Call this exactly once when you have enough information from prior tool results to answer the user. The `answer` string must only contain facts derived from tool results in this turn — never invent numbers, names, or dates.",
        inputSchema: z.object({
          answer: z
            .string()
            .min(1)
            .describe(
              'Plain-English answer for the user, grounded entirely in tool results from this turn.',
            ),
        }),
        execute: async (args) => ({ ok: true, finalized: true, ...args }),
      }),
  },

  respondWithoutData: {
    permission: null,
    build: () =>
      tool({
        description:
          'Use when no data tool can answer the request. Reasons: OUT_OF_SCOPE (forecasting, causal analysis, weather, anything outside available tools), NEED_CLARIFICATION (a required input is missing with no sensible default), NO_DATA (a data tool was called and returned empty).',
        inputSchema: z.object({
          reason: z.enum(['OUT_OF_SCOPE', 'NEED_CLARIFICATION', 'NO_DATA']),
          missing: z
            .string()
            .optional()
            .describe('For NEED_CLARIFICATION: name of the missing input.'),
          details: z
            .string()
            .optional()
            .describe('Optional short context (one short phrase).'),
        }),
        execute: async (args) => ({ ok: true, refused: true, ...args }),
      }),
  },
};

export function getToolsForContext(ctx: Context): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const [name, def] of Object.entries(REGISTRY)) {
    if (def.permission === null || ctx.permissions.includes(def.permission)) {
      out[name] = def.build(ctx);
    }
  }
  return out;
}

export function listAvailableToolNames(ctx: Context): string[] {
  return Object.entries(REGISTRY)
    .filter(
      ([, d]) => d.permission === null || ctx.permissions.includes(d.permission),
    )
    .map(([name]) => name);
}

export function listAvailableDataToolNames(ctx: Context): string[] {
  return Object.entries(REGISTRY)
    .filter(
      ([, d]) =>
        d.permission !== null && ctx.permissions.includes(d.permission),
    )
    .map(([name]) => name);
}
