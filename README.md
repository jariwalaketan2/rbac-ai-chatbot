# PulseMetrics AI Chatbot — POC

RBAC/ABAC-gated AI chatbot for internal analytics. Users query revenue, transactions, and user data through a natural language interface. All answers are grounded in live DB tool calls — no hallucinated numbers.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 App Router |
| LLM Runtime | Ollama (`qwen2.5:7b`) |
| LLM Framework | LangChain + LangGraph ReAct agent |
| Database | Neon (PostgreSQL serverless) |
| Auth/RBAC | Header-based user context + permission-scoped tools |
| GPU Inference (POC) | Google Colab T4 + cloudflared tunnel |

---

## Local Development

### Prerequisites

- Node.js 20+
- Ollama installed: `curl -fsSL https://ollama.com/install.sh | sh`
- Model pulled: `ollama pull qwen2.5:7b`

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

OLLAMA_MODEL=qwen2.5:7b
OLLAMA_BASE_URL=http://localhost:11434
```

### Send a query

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-user-id: admin-alice" \
  -d '{"message": "Show me revenue by region last quarter"}'
```

---

## Google Colab GPU Inference (POC)

> **Notebook:** [`colab/ollama_gpu_setup.ipynb`](colab/ollama_gpu_setup.ipynb) — open in Colab, enable T4 GPU, run cells top to bottom.

When running on CPU (e.g. i5-6300U), `qwen2.5:7b` prefill alone takes ~250s per request — well over Ollama's 5-minute hard timeout. The solution for the POC is to offload inference to a free Colab T4 GPU (~4s per query) and expose it to the local Next.js app via a cloudflared tunnel.

### Why this works

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

Ollama rejects requests whose `Host` header doesn't match `localhost` (DNS rebinding protection). The Flask proxy on port 11435 strips the cloudflare `Host` header before forwarding to Ollama, bypassing this check.

---

### Colab Setup — Full Code

Open a new Google Colab notebook, enable GPU runtime (**Runtime → Change runtime type → T4 GPU**), then run these cells in order.

#### Cell 1 — Install Ollama

```python
import subprocess, time

result = subprocess.run(
    'curl -fsSL https://ollama.com/install.sh | sh',
    shell=True, capture_output=True, text=True
)
print(result.stdout[-500:])
print(result.stderr[-200:])
```

#### Cell 2 — Start Ollama with origins open

```python
import subprocess, time, os, requests

subprocess.run(['pkill', '-9', '-f', 'ollama'], capture_output=True)
time.sleep(2)

env = os.environ.copy()
env['OLLAMA_ORIGINS'] = '*'
env['OLLAMA_HOST'] = '0.0.0.0:11434'

proc = subprocess.Popen(
    ['ollama', 'serve'],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    env=env
)
time.sleep(4)

r = requests.get('http://localhost:11434/api/tags')
print('✓ Ollama running:', r.status_code)
```

#### Cell 3 — Pull the model

```python
import subprocess

result = subprocess.run(
    ['ollama', 'pull', 'qwen2.5:7b'],
    capture_output=True, text=True
)
print(result.stdout[-300:])

# Verify
r = requests.get('http://localhost:11434/api/tags')
models = [m['name'] for m in r.json().get('models', [])]
print('Models available:', models)
```

#### Cell 4 — Install cloudflared

```python
import subprocess

subprocess.run([
    'wget', '-q',
    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
    '-O', '/usr/local/bin/cloudflared'
], check=True)
subprocess.run(['chmod', '+x', '/usr/local/bin/cloudflared'], check=True)
print('✓ cloudflared installed')
```

#### Cell 5 — Start Flask proxy on port 11435

Ollama blocks requests with foreign `Host` headers (from the tunnel). This proxy strips the header before forwarding to Ollama.

```python
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request

class OllamaProxy(BaseHTTPRequestHandler):
    def do_request(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length > 0 else None
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ('host', 'content-length')}
        if body:
            headers['Content-Length'] = str(len(body))
        try:
            req = urllib.request.Request(
                f'http://localhost:11434{self.path}',
                data=body, headers=headers, method=self.command
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() != 'transfer-encoding':
                        self.send_header(k, v)
                self.end_headers()
                while chunk := resp.read(4096):
                    self.wfile.write(chunk)
        except Exception as e:
            self.send_error(502, str(e))

    do_GET = do_POST = do_PUT = do_DELETE = do_request
    def log_message(self, *_): pass

server = HTTPServer(('0.0.0.0', 11435), OllamaProxy)
threading.Thread(target=server.serve_forever, daemon=True).start()
print('✓ Proxy on :11435')
```

#### Cell 6 — Start cloudflared tunnel

```python
import subprocess, threading, time, re

subprocess.run(['pkill', '-f', 'cloudflared'], capture_output=True)
time.sleep(2)

proc = subprocess.Popen(
    ['cloudflared', 'tunnel', '--url', 'http://localhost:11435'],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
)

tunnel_url = None

def read():
    global tunnel_url
    for line in proc.stdout:
        print(line, end='')
        if 'trycloudflare.com' in line and not tunnel_url:
            m = re.search(r'https://[a-z0-9\-]+\.trycloudflare\.com', line)
            if m:
                tunnel_url = m.group(0)
                print(f'\n✓ Tunnel URL: {tunnel_url}')

threading.Thread(target=read, daemon=False).start()
time.sleep(10)
print('Copy this URL into .env.local as OLLAMA_BASE_URL:', tunnel_url)
```

#### Cell 7 — Verify end-to-end

```python
import requests

# Local Ollama
r1 = requests.get('http://localhost:11434/api/tags', timeout=5)
print('✓ Ollama local:', r1.status_code)

# Via tunnel
r2 = requests.get(f'{tunnel_url}/api/tags', timeout=10)
print('✓ Tunnel:', r2.status_code)  # must be 200, not 403/530
```

#### Cell 8 — Keep-alive (run while using the app)

Colab disconnects after ~90 min of inactivity. Keep this cell running while using the chatbot.

```python
import time
print('Keep-alive running — interrupt to stop')
while True:
    time.sleep(60)
```

---

### Update `.env.local`

After Cell 6 prints the tunnel URL, update your local `.env.local`:

```env
OLLAMA_BASE_URL=https://<your-tunnel-subdomain>.trycloudflare.com
```

Then restart the dev server:

```bash
# Ctrl+C to stop, then:
npm run dev
```

**Note:** The tunnel URL changes every time you restart the Colab session. Update `.env.local` and restart the dev server each time.

---

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403` from tunnel | `OLLAMA_ORIGINS=*` not set on Ollama process | Re-run Cell 2 |
| `530` from Cloudflare | Proxy not running or erroring | Re-run Cell 5 |
| `502 Bad Gateway` | Ollama process died | Re-run Cell 2, then Cell 6 |
| Query times out locally | CPU too slow for 7b model | Use Colab GPU setup |
| New URL needed | Colab session restarted | Re-run Cell 6, update `.env.local` |

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
buildContextFromUserId()         ← resolves org, role, permissions from DB
    │
    ▼
streamQuery(message, ctx)
    │
    ├─ buildSystemPrompt()       ← injects org, role, rules
    ├─ getToolsForContext(ctx)   ← filters tools by RBAC permissions
    └─ createReactAgent()        ← LangGraph ReAct loop
           │
           ├─ LLM decides tool → tool executes DB query → result back to LLM
           ├─ LLM decides tool → ...  (up to 25 steps)
           └─ LLM writes final answer (grounded in tool results only)
    │
    ▼
NDJSON stream of events:
  { type: 'tool_call', name, args }
  { type: 'tool_result', name, result }
  { type: 'text_chunk', text }
  { type: 'done', steps, refusal }
```

## RBAC / ABAC

Permissions are resolved per user at request time. Tools are filtered so a user can only call tools their permissions allow:

| Permission | Tools unlocked |
|---|---|
| `READ_REVENUE` | `getRevenueReport`, `getRevenueBreakdown`, `listTransactions` |
| `READ_USERS` | `getUserDetails`, `listUsers` |

All tool queries are automatically scoped to the user's `orgId` — cross-org data is structurally inaccessible.
