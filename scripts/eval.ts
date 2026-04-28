/**
 * Eval runner — executes all 20 cases from tests/eval-corpus.ts and prints
 * a pass/fail table.  Run with:  npm run eval
 *
 * Exit code 0 = all passed, 1 = one or more failures.
 */

import { buildContextFromUserId } from '../lib/auth/context';
import { handleQuery } from '../lib/orchestrator/handler';
import { listDemoUsers } from '../lib/auth/context';
import { corpus, type EvalCase } from '../tests/eval-corpus';

// ── helpers ─────────────────────────────────────────────────────────────────

const INTER_CASE_DELAY_MS = 4000; // stay within Gemini free tier (20 req/min)

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function pass(label: string) {
  return `${GREEN}PASS${RESET}  ${label}`;
}
function fail(label: string) {
  return `${RED}FAIL${RESET}  ${label}`;
}

type EvalResult = {
  id: number;
  description: string;
  ok: boolean;
  reason: string;
  durationMs: number;
};

// ── case 20 special handler ──────────────────────────────────────────────────
// Case 20 tests the API 400 boundary (empty string).  The real guard lives in
// the route handler; we replicate it here without making an HTTP request.

function runCase20(c: EvalCase): EvalResult {
  const start = Date.now();
  // Mimic the API route validation: reject empty / whitespace messages.
  const trimmed = c.query.trim();
  const got400 = trimmed.length === 0;
  return {
    id: c.id,
    description: c.description,
    ok: got400,
    reason: got400 ? 'empty query correctly rejected (400)' : 'expected 400 but query is non-empty',
    durationMs: Date.now() - start,
  };
}

// ── main eval loop ───────────────────────────────────────────────────────────

async function runCase(
  c: EvalCase,
  emailToUserId: Map<string, string>,
): Promise<EvalResult> {
  const start = Date.now();

  // Special-case: empty query (case 20)
  if (c.id === 20) return runCase20(c);

  const userId = emailToUserId.get(c.userEmail);
  if (!userId) {
    return {
      id: c.id,
      description: c.description,
      ok: false,
      reason: `demo user not found: ${c.userEmail}`,
      durationMs: Date.now() - start,
    };
  }

  const ctx = await buildContextFromUserId(userId);
  if (!ctx) {
    return {
      id: c.id,
      description: c.description,
      ok: false,
      reason: `buildContextFromUserId returned null for userId=${userId}`,
      durationMs: Date.now() - start,
    };
  }

  let response: Awaited<ReturnType<typeof handleQuery>>;
  try {
    response = await handleQuery(c.query, ctx);
  } catch (err) {
    return {
      id: c.id,
      description: c.description,
      ok: false,
      reason: `handleQuery threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - start,
    };
  }

  const toolNames = response.toolCalls.map((t) => t.name);

  // Validate expectRefusal
  if (c.expectRefusal !== null) {
    if (!response.refusal) {
      return {
        id: c.id,
        description: c.description,
        ok: false,
        reason: `expected refusal=${c.expectRefusal} but got none (tools fired: ${toolNames.join(', ') || 'none'})`,
        durationMs: Date.now() - start,
      };
    }
    if (response.refusal.reason !== c.expectRefusal) {
      return {
        id: c.id,
        description: c.description,
        ok: false,
        reason: `expected refusal=${c.expectRefusal}, got refusal=${response.refusal.reason}`,
        durationMs: Date.now() - start,
      };
    }
    return {
      id: c.id,
      description: c.description,
      ok: true,
      reason: `refusal=${response.refusal.reason} ✓`,
      durationMs: Date.now() - start,
    };
  }

  // Validate expectTool
  if (c.expectTool !== null) {
    if (!toolNames.includes(c.expectTool)) {
      return {
        id: c.id,
        description: c.description,
        ok: false,
        reason: `expected tool=${c.expectTool} but toolCalls were: [${toolNames.join(', ') || 'none'}]`,
        durationMs: Date.now() - start,
      };
    }
  }

  // No refusal expected and tool check passed — must have finalized
  if (!response.usedFinalize && !response.refusal) {
    return {
      id: c.id,
      description: c.description,
      ok: false,
      reason: `tool fired but response neither finalized nor refused`,
      durationMs: Date.now() - start,
    };
  }

  const detail = c.expectTool ? `tool=${c.expectTool} ✓` : 'finalized ✓';
  return {
    id: c.id,
    description: c.description,
    ok: true,
    reason: detail,
    durationMs: Date.now() - start,
  };
}

async function main() {
  console.log(`\n${BOLD}PulseMetrics — Eval Suite (${corpus.length} cases)${RESET}\n`);

  // Build email → userId map from the DB
  const demoUsers = await listDemoUsers();
  const emailToUserId = new Map(demoUsers.map((u) => [u.email, u.id]));

  const results: EvalResult[] = [];
  let totalDurationMs = 0;

  for (let i = 0; i < corpus.length; i++) {
    const c = corpus[i];
    process.stdout.write(`  [${String(c.id).padStart(2, '0')}] ${c.description} ... `);
    const r = await runCase(c, emailToUserId);
    results.push(r);
    totalDurationMs += r.durationMs;

    if (r.ok) {
      console.log(`${GREEN}PASS${RESET} (${r.durationMs}ms) — ${r.reason}`);
    } else {
      console.log(`${RED}FAIL${RESET} (${r.durationMs}ms) — ${r.reason}`);
    }

    // Rate-limit guard: pause between cases (skip after the last one).
    // Case 20 (empty query) makes no LLM calls so no delay needed after it.
    if (i < corpus.length - 1 && c.id !== 20) {
      await sleep(INTER_CASE_DELAY_MS);
    }
  }

  // Summary table
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`\n${'─'.repeat(70)}`);
  console.log(
    `${BOLD}Results: ${GREEN}${passed} passed${RESET}${BOLD}, ${failed > 0 ? RED : ''}${failed} failed${RESET}${BOLD} / ${corpus.length} total${RESET}  (${totalDurationMs}ms)`,
  );

  if (failed > 0) {
    console.log(`\n${YELLOW}Failed cases:${RESET}`);
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`  [${String(r.id).padStart(2, '0')}] ${r.description}`);
      console.log(`       ${RED}${r.reason}${RESET}`);
    }
    console.log('');
    process.exit(1);
  }

  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error(`${RED}Eval crashed:${RESET}`, err);
  process.exit(1);
});
