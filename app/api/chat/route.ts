import { type NextRequest } from 'next/server';
import { buildContextFromUserId } from '@/lib/auth/context';
import { streamQuery } from '@/lib/orchestrator/handler';
import { warmDb } from '@/lib/db/client';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return Response.json({ error: 'Missing x-user-id header' }, { status: 401 });
  }

  const ctx = await buildContextFromUserId(userId);
  if (!ctx) {
    return Response.json({ error: 'Unknown user' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
  const message = body?.message;
  if (typeof message !== 'string' || !message.trim()) {
    return Response.json({ error: 'Body must be { message: string }' }, { status: 400 });
  }

  await warmDb();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamQuery(message.trim(), ctx)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('[/api/chat] error:', detail);
        const isRateLimit = /quota|rate.?limit|429|too many requests/i.test(detail);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'error',
              message: isRateLimit
                ? 'The AI service is temporarily busy. Please wait and try again.'
                : 'Something went wrong. Please try again.',
              retryable: isRateLimit || /fetch failed|timeout/i.test(detail),
            }) + '\n',
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  });
}
