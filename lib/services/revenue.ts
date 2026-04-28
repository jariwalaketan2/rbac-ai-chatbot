import { sql } from '../db/client';
import type { Context } from '../auth/context';
import { resolveTimeRange, type TimeRange } from './timeRange';

export type Region = 'NA' | 'EU' | 'APAC';
export type TxnType = 'sale' | 'refund';

export type RevenueReportArgs = {
  timeRange: TimeRange;
  region?: Region;
  type?: TxnType;
};

export type RevenueReport = {
  orgId: string;
  timeRange: TimeRange;
  filters: { region: Region | null; type: TxnType | null };
  totalRevenue: number;
  transactionCount: number;
  currency: 'USD';
};

export async function getRevenueReport(
  args: RevenueReportArgs,
  ctx: Context,
): Promise<RevenueReport> {
  const { from, to } = resolveTimeRange(args.timeRange);
  const region = args.region ?? null;
  const type = args.type ?? null;

  const rows = (await sql(
    `SELECT
       COALESCE(SUM(amount * CASE WHEN type = 'refund' THEN -1 ELSE 1 END), 0)::float8 AS total,
       COUNT(*)::int AS count
     FROM transactions
     WHERE org_id = $1
       AND ($2::timestamptz IS NULL OR occurred_at >= $2)
       AND ($3::timestamptz IS NULL OR occurred_at <  $3)
       AND ($4::text         IS NULL OR region      = $4)
       AND ($5::text         IS NULL OR type        = $5)`,
    [ctx.orgId, from, to, region, type],
  )) as Array<{ total: number; count: number }>;

  return {
    orgId: ctx.orgId,
    timeRange: args.timeRange,
    filters: { region, type },
    totalRevenue: rows[0].total,
    transactionCount: rows[0].count,
    currency: 'USD',
  };
}

export type BreakdownArgs = {
  timeRange: TimeRange;
  groupBy: 'region' | 'month';
};

export type Breakdown = {
  orgId: string;
  timeRange: TimeRange;
  groupBy: 'region' | 'month';
  rows: Array<{ key: string; total: number; count: number }>;
};

export async function getRevenueBreakdown(
  args: BreakdownArgs,
  ctx: Context,
): Promise<Breakdown> {
  // Defense-in-depth: even though Zod gates this, the service re-validates.
  if (args.groupBy !== 'region' && args.groupBy !== 'month') {
    throw new Error('Invalid groupBy');
  }

  const { from, to } = resolveTimeRange(args.timeRange);
  const groupExpr =
    args.groupBy === 'region' ? 'region' : "to_char(occurred_at, 'YYYY-MM')";

  const rows = (await sql(
    `SELECT
       ${groupExpr} AS key,
       COALESCE(SUM(amount * CASE WHEN type = 'refund' THEN -1 ELSE 1 END), 0)::float8 AS total,
       COUNT(*)::int AS count
     FROM transactions
     WHERE org_id = $1
       AND ($2::timestamptz IS NULL OR occurred_at >= $2)
       AND ($3::timestamptz IS NULL OR occurred_at <  $3)
     GROUP BY ${groupExpr}
     ORDER BY ${groupExpr}`,
    [ctx.orgId, from, to],
  )) as Array<{ key: string; total: number; count: number }>;

  return {
    orgId: ctx.orgId,
    timeRange: args.timeRange,
    groupBy: args.groupBy,
    rows,
  };
}
