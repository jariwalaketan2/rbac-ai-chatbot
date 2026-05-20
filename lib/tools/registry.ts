import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { Context } from '../auth/context';
import { audit } from '../audit/log';
import { getRevenueReport, getRevenueBreakdown, type RevenueReportArgs, type BreakdownArgs } from '../services/revenue';
import { listTransactions, type ListTransactionsArgs } from '../services/transactions';
import { getUserDetails, listUsers, type GetUserDetailsArgs, type ListUsersArgs } from '../services/users';
import { PAGE_SIZE } from '../services/transactions';

const timeRangeSchema = z.object({
  from: z.string().optional().describe('ISO date YYYY-MM-DD. Omit for no lower bound (all history).'),
  to:   z.string().optional().describe('ISO date YYYY-MM-DD. Omit for no upper bound (up to today). Compute dates from today\'s date in the system prompt.'),
});

const regionSchema = z.enum(['NA', 'EU', 'APAC']);
const txnTypeSchema = z.enum(['sale', 'refund']);
const roleSchema = z.enum(['ADMIN', 'ANALYST', 'SUPPORT']);

function withAudit<TArgs, TResult>(
  toolName: string,
  permission: string,
  ctx: Context,
  fn: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | { ok: false; error: string }> {
  return async (args: TArgs) => {
    if (!ctx.permissions.includes(permission)) {
      audit({ userId: ctx.userId, orgId: ctx.orgId, tool: toolName, args, allowed: false, reason: 'insufficient permissions', durationMs: 0 });
      return { ok: false, error: `Your role (${ctx.role}) doesn't have permission to access this data.` };
    }
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
      return { ok: false, error: message };
    }
  };
}

type ToolDef = {
  permission: string;
  build: (ctx: Context) => DynamicStructuredTool;
};

const REGISTRY: Record<string, ToolDef> = {
  getRevenueReport: {
    permission: 'READ_REVENUE',
    build: (ctx) =>
      tool(
        withAudit('getRevenueReport', 'READ_REVENUE', ctx, (args: RevenueReportArgs) => getRevenueReport(args, ctx)),
        {
          name: 'getRevenueReport',
          description:
            `Get aggregate stats computed over ALL matching transactions (not paginated). Returns:
- totalRevenue: net revenue (sales minus refunds) — use for revenue queries
- transactionCount: exact count — use for "how many transactions" queries
- averageAmount: mean transaction amount — use for "average deal size" queries
- maxAmount: largest single transaction — use for "biggest deal" queries
- minAmount: smallest single transaction
If transactionCount=0: no transactions found. If the queried period is entirely in the future, note that — don't report as missing historical data.
If transactionCount>0 and totalRevenue=$0: sales were fully offset by refunds.
Use this tool for ALL calculations. Never compute aggregates from listTransactions rows. Self-contained — do not follow up with listTransactions unless the user explicitly asked to see transaction rows.`,
          schema: z.object({
            timeRange: timeRangeSchema,
            region: regionSchema.optional().describe('Only set if user explicitly asks to filter by region.'),
            type: txnTypeSchema.optional().describe('Only set if user explicitly asks to filter by type.'),
          }),
        },
      ),
  },

  getRevenueBreakdown: {
    permission: 'READ_REVENUE',
    build: (ctx) =>
      tool(
        withAudit('getRevenueBreakdown', 'READ_REVENUE', ctx, (args: BreakdownArgs) => getRevenueBreakdown(args, ctx)),
        {
          name: 'getRevenueBreakdown',
          description:
            "Group revenue by a dimension over a time range. Returns an array of {group, totalRevenue, transactionCount} — one entry per group that has data. Use for trends, period-over-period comparisons, or regional breakdowns.",
          schema: z.object({
            timeRange: timeRangeSchema,
            groupBy: z.string().describe("'region' (NA/EU/APAC) | 'month' (YYYY-MM) | 'year' (YYYY) | 'quarter' (YYYY-Q#) | 'type' (sale/refund)."),
          }),
        },
      ),
  },

  listTransactions: {
    permission: 'READ_REVENUE',
    build: (ctx) =>
      tool(
        withAudit('listTransactions', 'READ_REVENUE', ctx, (args: ListTransactionsArgs) => listTransactions(args, ctx)),
        {
          name: 'listTransactions',
          description:
            `List individual transactions newest first. Do not use for user, admin, or role-related questions — those require getUserDetails or listUsers. Omit timeRange entirely when no specific period is requested (e.g. "show recent transactions", "list all transactions", or any query without an explicit date range). Returns: totalCount (exact total before LIMIT), count (rows shown, capped at ${PAGE_SIZE}), hasMore, rows. Always present each returned row to the user first, then on a new line after the list: state "Showing [count] of [totalCount] total." If hasMore: true, follow that with: "Type 'next transactions' to load more, or filter by date range, region, or type." For any calculation (total, count, average, biggest), use getRevenueReport instead.`,
          schema: z.object({
            timeRange: timeRangeSchema.optional(),
            region: regionSchema.optional().describe('Only set if user explicitly asks to filter by region.'),
            type: txnTypeSchema.optional().describe('Only set if user explicitly asks to filter by type.'),
            limit: z.number().int().min(1).max(PAGE_SIZE).default(PAGE_SIZE).optional(),
            offset: z.number().int().min(0).default(0).optional().describe('Rows to skip. Page N = offset (N-1) × 10. Only set if user explicitly asks for a specific page or offset.'),
          }),
        },
      ),
  },

  getUserDetails: {
    permission: 'READ_USERS',
    build: (ctx) =>
      tool(
        withAudit('getUserDetails', 'READ_USERS', ctx, (args: GetUserDetailsArgs) => getUserDetails(args, ctx)),
        {
          name: 'getUserDetails',
          description:
            "Look up a single user by email address — requires email, not name. Returns user fields (id, email, name, role) if found, or a not-found shape (same whether the email doesn't exist or belongs to a different org).",
          schema: z.object({
            email: z.string().email(),
          }),
        },
      ),
  },

  listUsers: {
    permission: 'READ_USERS',
    build: (ctx) =>
      tool(
        withAudit('listUsers', 'READ_USERS', ctx, (args: ListUsersArgs) => listUsers(args, ctx)),
        {
          name: 'listUsers',
          description:
            `List users in the caller's organization, optionally filtered by role. Omit role entirely unless the user explicitly asks to filter by a specific role (e.g. "list admins", "show analysts") — never set role for "all users" or "list users" queries. Returns: totalCount (exact total), count (rows shown, capped at ${PAGE_SIZE}), hasMore, rows. Always present each returned row to the user. Always use totalCount when reporting how many users exist. If hasMore: true, say "showing [count] of [totalCount] total" and offer to filter by role.`,
          schema: z.object({
            role: roleSchema.optional().describe('Only set if user explicitly asks to filter by a specific role.'),
          }),
        },
      ),
  },
};

export function getToolsForContext(ctx: Context): DynamicStructuredTool[] {
  return Object.values(REGISTRY).map((def) => def.build(ctx));
}

export function listAvailableToolNames(ctx: Context): string[] {
  return Object.entries(REGISTRY)
    .filter(([, def]) => ctx.permissions.includes(def.permission))
    .map(([name]) => name);
}

export function listAvailableDataToolNames(ctx: Context): string[] {
  return listAvailableToolNames(ctx);
}
