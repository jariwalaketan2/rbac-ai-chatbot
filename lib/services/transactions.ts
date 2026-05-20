import { sql } from '../db/client';
import type { Context } from '../auth/context';
import { resolveTimeRange, type TimeRange } from './timeRange';
import type { Region, TxnType } from './revenue';

export const PAGE_SIZE = 10;

export type ListTransactionsArgs = {
  timeRange?: TimeRange;
  region?: Region;
  type?: TxnType;
  limit?: number;
  offset?: number;
};

export type TransactionRow = {
  id: string;
  amount: number;
  type: TxnType;
  region: Region;
  occurredAt: string;
};

export type TransactionList = {
  orgId: string;
  timeRange: TimeRange;
  filters: { region: Region | null; type: TxnType | null };
  totalCount: number;
  count: number;
  hasMore: boolean;
  rows: TransactionRow[];
};

export async function listTransactions(
  args: ListTransactionsArgs,
  ctx: Context,
): Promise<TransactionList> {
  const tr: TimeRange = args.timeRange ?? {};
  const { from, to } = resolveTimeRange(tr);
  const region = args.region ?? null;
  const type = args.type ?? null;
  const limit = Math.min(Math.max(args.limit ?? PAGE_SIZE, 1), PAGE_SIZE);
  const offset = Math.max(0, args.offset ?? 0);

  const raw = (await sql(
    `SELECT
       id,
       amount::float8 AS amount,
       type,
       region,
       occurred_at,
       COUNT(*) OVER() AS total_count
     FROM transactions
     WHERE org_id = $1
       AND ($2::timestamptz IS NULL OR occurred_at >= $2)
       AND ($3::timestamptz IS NULL OR occurred_at <  $3)
       AND ($4::text         IS NULL OR region      = $4)
       AND ($5::text         IS NULL OR type        = $5)
     ORDER BY occurred_at DESC
     LIMIT $6 OFFSET $7`,
    [ctx.orgId, from, to, region, type, limit, offset],
  )) as Array<{
    id: string;
    amount: number;
    type: TxnType;
    region: Region;
    occurred_at: string;
    total_count: number;
  }>;

  const totalCount = raw.length > 0 ? Number(raw[0].total_count) : 0;
  const hasMore = offset + limit < totalCount;
  const rows = raw;

  return {
    orgId: ctx.orgId,
    timeRange: tr,
    filters: { region, type },
    totalCount,
    count: rows.length,
    hasMore,
    rows: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      type: r.type,
      region: r.region,
      occurredAt: r.occurred_at,
    })),
  };
}
