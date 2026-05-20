import { type NextRequest } from 'next/server';
import { buildContextFromUserId } from '@/lib/auth/context';
import { listTransactions, type ListTransactionsArgs } from '@/lib/services/transactions';
import { warmDb } from '@/lib/db/client';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return Response.json({ error: 'Missing x-user-id' }, { status: 401 });

  const ctx = await buildContextFromUserId(userId);
  if (!ctx) return Response.json({ error: 'Unknown user' }, { status: 401 });
  if (!ctx.permissions.includes('READ_REVENUE')) {
    return Response.json({ error: `Your role (${ctx.role}) doesn't have permission to access transactions.` }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10));
  const region = searchParams.get('region') || undefined;
  const type = searchParams.get('type') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  await warmDb();

  const args: ListTransactionsArgs = {
    offset,
    region: region as ListTransactionsArgs['region'],
    type: type as ListTransactionsArgs['type'],
    timeRange: (from || to) ? { from, to } : undefined,
  };

  const result = await listTransactions(args, ctx);
  return Response.json(result);
}
