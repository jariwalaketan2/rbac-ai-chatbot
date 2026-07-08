# PulseMetrics AI Chatbot — POC

RBAC/ABAC-gated AI chatbot for internal analytics. Users query revenue, transactions, and user data through a natural language interface. All answers are grounded in live DB tool calls — no hallucinated numbers.

> See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design doc (RBAC/ABAC model, streaming protocol, tool registry, security defenses). This README covers setup and a quick architecture overview.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 App Router |
| LLM Framework | LangChain + LangGraph `createReactAgent` (ReAct loop, `recursionLimit: 25`) |
| LLM Runtime | Dual-mode: local Ollama (`qwen3.5:9b`) **or** vLLM on Kaggle T4 via OpenAI-compat endpoint (`qwen3:8b`) |
| Database | Neon (PostgreSQL serverless) |
| Auth/RBAC | Header-based user context + permission-scoped tools |
| GPU Inference (POC) | Kaggle T4 + vLLM + cloudflared tunnel (current); Colab + Ollama (legacy, superseded) |

---

## Local Development

### Prerequisites

- Node.js 20+
- Either:
  - Ollama installed locally: `curl -fsSL https://ollama.com/install.sh | sh` then `ollama pull qwen3.5:9b`, **or**
  - A running Kaggle vLLM tunnel (see [GPU Inference](#gpu-inference-poc) below)

### Setup

```bash
cp .env.local.example .env.local
# Fill in DATABASE_URL and OLLAMA_BASE_URL
npm install
npm run dev
```

### `.env.local`

```env
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

# Local Ollama:
OLLAMA_MODEL=qwen3.5:9b
OLLAMA_BASE_URL=http://localhost:11434

# OR vLLM on Kaggle (OpenAI-compat) — set OLLAMA_BASE_URL to end in /v1:
# OLLAMA_MODEL=qwen3:8b
# OLLAMA_BASE_URL=https://<tunnel>.trycloudflare.com/v1
# OPENAI_API_KEY=vllm   # any string works, vLLM doesn't validate it
```

`lib/llm/model.ts` picks the backend automatically: if `OLLAMA_BASE_URL` ends with `/v1`, it uses `ChatOpenAI` against the vLLM endpoint; otherwise it uses `ChatOllama` against a local Ollama server.

### Send a query

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-user-id: admin-alice" \
  -d '{"message": "Show me revenue by region last quarter"}'
```

---

## GPU Inference (POC)

Running a 7-9B model on CPU (e.g. i5-6300U) is far too slow for interactive use — prefill alone can take minutes per request. The POC offloads inference to a free GPU notebook and exposes it to the local Next.js app via a cloudflared tunnel.

### Current: Kaggle T4 + vLLM

> **Notebook:** [`kaggle/chatbot_hosting_llm_code.ipynb`](kaggle/chatbot_hosting_llm_code.ipynb) — open in Kaggle, enable T4 GPU, run cells top to bottom.

```
Next.js app (local)
    ↓ HTTP
cloudflared tunnel (public HTTPS URL, .../v1)
    ↓ proxied to Kaggle
vLLM OpenAI-compat server (port 8000)
    ↓
qwen3:8b on T4 GPU
```

vLLM exposes a native OpenAI-compatible `/v1/chat/completions` endpoint, so no host-header proxy workaround is needed (unlike the old Ollama+Colab setup below). Once the notebook prints the tunnel URL, set `OLLAMA_BASE_URL=https://<tunnel>.trycloudflare.com/v1` in `.env.local` and restart `npm run dev`.

**Note:** the tunnel URL changes every time the Kaggle session restarts — update `.env.local` and restart the dev server each time.

### Legacy: Colab T4 + Ollama (superseded)

> **Notebook:** [`colab/chatbot_hosting_llm_code.ipynb`](colab/chatbot_hosting_llm_code.ipynb). Kept for reference; the Kaggle/vLLM path above is the current GPU backend.

```
Next.js app (local)
    ↓ HTTP
cloudflared tunnel (public HTTPS URL)
    ↓ proxied to Colab
Flask proxy (port 11435, strips Host header)
    ↓ localhost HTTP
Ollama serve (port 11434, OLLAMA_ORIGINS=*)
    ↓
qwen2.5:7b on T4 GPU
```

Ollama rejects requests whose `Host` header doesn't match `localhost` (DNS rebinding protection), which is why this path needed the extra Flask proxy to strip the tunnel's `Host` header — vLLM has no such restriction.

---

## Architecture

```
Browser / curl
    │
    ▼
POST /api/chat  { message: string }
Header: x-user-id: <user>
    │
    ▼
buildContextFromUserId()          ← resolves orgId, role, permissions from DB
    │
    ▼
warmDb()
    │
    ▼
LangGraph ReAct Agent (createReactAgent, recursionLimit: 25)
    │
    ├─ buildSystemPrompt()        ← injects org, role, pre-computed date ranges, rules
    ├─ getToolsForContext(ctx)    ← RBAC-filtered tools bound at agent-creation time
    └─ LLM (ChatOpenAI / ChatOllama — dual backend, see lib/llm/model.ts)
           │
           ├─ LLM decides tool → tool executes DB query (orgId injected from ctx) → result back to LLM
           ├─ LLM decides tool → ...  (up to 25 steps)
           └─ LLM writes final answer (grounded in tool results only)
    │
    ▼
Hallucination guard                ← blocks numeric answers with no tool call this turn
    │
    ▼
NDJSON stream of events:
  { type: 'metadata', provider, availableTools }
  { type: 'debug', systemPrompt, toolSchemas }
  { type: 'tool_call', name, args }
  { type: 'tool_result', name, result }
  { type: 'text_chunk', text }
  { type: 'thinking_chunk', text }   ← model <think> blocks, not shown to user
  { type: 'guard', fired, reason, textSample }
  { type: 'done', steps, refusal, usedFinalize }
  { type: 'error', message, retryable }
```

## RBAC / ABAC

Permissions are resolved per user at request time. Tools are filtered so a user can only call tools their permissions allow, and every tool query is automatically scoped to the user's `orgId` — cross-org data is structurally inaccessible (the LLM never receives `orgId` as an argument).

| Permission | Tools unlocked |
|---|---|
| `READ_REVENUE` | `getRevenueReport`, `getRevenueBreakdown`, `listTransactions` |
| `READ_USERS` | `getUserDetails`, `listUsers` |

See [`ARCHITECTURE.md`](ARCHITECTURE.md) §5–§7 for the full tool registry, system prompt rules, and security defenses (prompt injection, cross-org lookup, hallucination guard).
