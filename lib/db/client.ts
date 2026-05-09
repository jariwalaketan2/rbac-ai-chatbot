import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const sql = neon(process.env.DATABASE_URL);

export async function warmDb(): Promise<void> {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = 600;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sql`SELECT 1`;
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt));
      }
    }
  }
  throw new Error(`Database unavailable after ${MAX_ATTEMPTS} attempts: ${String(lastErr)}`);
}
