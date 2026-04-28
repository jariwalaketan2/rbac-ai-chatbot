import { NextResponse, type NextRequest } from 'next/server';
import { buildContextFromUserId } from '@/lib/auth/context';
import { handleQuery } from '@/lib/orchestrator/handler';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json(
      { error: 'Missing x-user-id header' },
      { status: 401 },
    );
  }

  const ctx = await buildContextFromUserId(userId);
  if (!ctx) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  const message = body?.message;
  if (typeof message !== 'string' || !message.trim()) {
    return NextResponse.json(
      { error: 'Body must be { message: string }' },
      { status: 400 },
    );
  }

  try {
    const result = await handleQuery(message.trim(), ctx);
    return NextResponse.json(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[/api/chat] error:', detail);

    // Detect rate-limit / quota errors from any LLM provider and surface a
    // 429 so the UI can show a clean "try again" message instead of a 500.
    const isRateLimit =
      /quota|rate.?limit|429|too many requests|resource.?exhausted/i.test(detail);

    if (isRateLimit) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', message: 'The AI service is temporarily busy. Please wait a moment and try again.' },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { error: 'Orchestrator failure', message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}
