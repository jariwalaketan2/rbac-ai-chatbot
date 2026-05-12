import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { Context } from '../auth/context';
import { audit } from '../audit/log';
import { getRevenueReport, getRevenueBreakdown, type RevenueReportArgs, type BreakdownArgs } from '../services/revenue';
import { listTransactions, type ListTransactionsArgs } from '../services/transactions';
import { getUserDetails, listUsers, type GetUserDetailsArgs, type ListUsersArgs } from '../services/users';

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
  ]).describe(
    'Pick the preset that best matches the user\'s phrasing. ' +
    'LAST_QUARTER=previous calendar quarter; ' +
    'CURRENT_QUARTER=this quarter (not the full year); ' +
    'YEAR_TO_DATE=this year / so far this year / since January; ' +
    'ALL_TIME=all time / ever / no date filter; ' +
    'LAST_30_DAYS=last 30 days / past month; ' +
    'LAST_90_DAYS=last 90 days / past 3 months; ' +
    'LAST_12_MONTHS=last 12 months / past year; ' +
    'CUSTOM=specific date range (requires from+to).'
  ),
  from: z.string().optional().describe('ISO date YYYY-MM-DD. Required if preset is CUSTOM.'),
  to: z.string().optional().describe('ISO date YYYY-MM-DD. Required if preset is CUSTOM.'),
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
      return { ok: false, error: 'Service error executing tool.' };
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
        withAudit('getRevenueReport', ctx, (args: RevenueReportArgs) => getRevenueReport(args, ctx)),
        {
          name: 'getRevenueReport',
          description:
            "Get total revenue (sales minus refunds) for the caller's organization over a time range, optionally filtered by region or transaction type. Returns a single aggregate. Input must be { timeRange: { preset: '...' } } — always wrap preset inside timeRange.",
          schema: z.object({
            timeRange: timeRangeSchema,
            region: regionSchema.optional(),
            type: txnTypeSchema.optional(),
          }),
        },
      ),
  },

  getRevenueBreakdown: {
    permission: 'READ_REVENUE',
    build: (ctx) =>
      tool(
        withAudit('getRevenueBreakdown', ctx, (args: BreakdownArgs) => getRevenueBreakdown(args, ctx)),
        {
          name: 'getRevenueBreakdown',
          description:
            "Group revenue by region (NA/EU/APAC) or by calendar month (YYYY-MM) for the caller's organization over a time range. Use this for trend, comparison, or 'top X' questions.",
          schema: z.object({
            timeRange: timeRangeSchema,
            groupBy: z.enum(['region', 'month']),
          }),
        },
      ),
  },

  listTransactions: {
    permission: 'READ_REVENUE',
    build: (ctx) =>
      tool(
        withAudit('listTransactions', ctx, (args: ListTransactionsArgs) => listTransactions(args, ctx)),
        {
          name: 'listTransactions',
          description:
            "List individual transactions in the caller's organization, newest first. Capped at 100. Use for browsing recent activity or finding specific transactions.",
          schema: z.object({
            timeRange: timeRangeSchema.optional(),
            region: regionSchema.optional(),
            type: txnTypeSchema.optional(),
            limit: z.number().int().min(1).max(100).optional(),
          }),
        },
      ),
  },

  getUserDetails: {
    permission: 'READ_USERS',
    build: (ctx) =>
      tool(
        withAudit('getUserDetails', ctx, (args: GetUserDetailsArgs) => getUserDetails(args, ctx)),
        {
          name: 'getUserDetails',
          description:
            "Look up a single user by email within the caller's organization. Returns the same 'not found' shape whether the email exists in a different org or not at all.",
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
        withAudit('listUsers', ctx, (args: ListUsersArgs) => listUsers(args, ctx)),
        {
          name: 'listUsers',
          description:
            "List users in the caller's organization, optionally filtered by role (ADMIN/ANALYST/SUPPORT).",
          schema: z.object({
            role: roleSchema.optional(),
          }),
        },
      ),
  },
};

export function getToolsForContext(ctx: Context): DynamicStructuredTool[] {
  return Object.entries(REGISTRY)
    .filter(([, def]) => ctx.permissions.includes(def.permission))
    .map(([, def]) => def.build(ctx));
}

export function listAvailableToolNames(ctx: Context): string[] {
  return Object.entries(REGISTRY)
    .filter(([, def]) => ctx.permissions.includes(def.permission))
    .map(([name]) => name);
}

export function listAvailableDataToolNames(ctx: Context): string[] {
  return listAvailableToolNames(ctx);
}
