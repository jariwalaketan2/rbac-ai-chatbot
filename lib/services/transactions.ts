import { sql } from '../db/client';
import type { Context } from '../auth/context';
import { resolveTimeRange, type TimeRange } from './timeRange';
import type { Region, TxnType } from './revenue';

export type ListTransactionsArgs = {
  timeRange?: TimeRange;
  region?: Region;
  type?: TxnType;
  limit?: number;
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
  count: number;
  rows: TransactionRow[];
};

export async function listTransactions(
  args: ListTransactionsArgs,
  ctx: Context,
): Promise<TransactionList> {
  const tr: TimeRange = args.timeRange ?? { preset: 'ALL_TIME' };
  const { from, to } = resolveTimeRange(tr);
  const region = args.region ?? null;
  const type = args.type ?? null;
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);

  const rows = (await sql(
    `SELECT
       id,
       amount::float8 AS amount,
       type,
       region,
       occurred_at
     FROM transactions
     WHERE org_id = $1
       AND ($2::timestamptz IS NULL OR occurred_at >= $2)
       AND ($3::timestamptz IS NULL OR occurred_at <  $3)
       AND ($4::text         IS NULL OR region      = $4)
       AND ($5::text         IS NULL OR type        = $5)
     ORDER BY occurred_at DESC
     LIMIT $6`,
    [ctx.orgId, from, to, region, type, limit],
  )) as Array<{
    id: string;
    amount: number;
    type: TxnType;
    region: Region;
    occurred_at: string;
  }>;

  return {
    orgId: ctx.orgId,
    timeRange: tr,
    filters: { region, type },
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      type: r.type,
      region: r.region,
      occurredAt: r.occurred_at,
    })),
  };
}
