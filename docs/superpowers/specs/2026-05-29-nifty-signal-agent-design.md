# NIFTY Weekly Options Signal Agent — Design Spec

**Date:** 2026-05-29  
**Status:** Approved  

---

## Overview

A live options signal agent that fetches NIFTY market data every second, scores market conditions across 8 factors per regime, fires high-confidence trade signals (score ≥75/100), and paper trades them automatically with entry/target/SL/time tracking and persistent metrics.

---

## Scope

- NIFTY weekly expiry only
- 1 lot per signal (75 units)
- Three regimes: BREAKOUT, BREAKDOWN, SIDEWAYS
- Paper trading only (no real order placement)
- Upstox API as data source

---

## Architecture

```
Upstox WebSocket/Quote API  →  Spot + Option LTPs     (every 1 second)
Upstox Option Chain REST    →  Full OI + Greeks        (every 60 seconds)
                                        │
                                 SnapshotStore          (rolling 20 snapshots)
                                        │
                                 RegimeDetector         (classifies: BREAKOUT / BREAKDOWN / SIDEWAYS / UNCLEAR)
                                        │
                                 ScoringEngine          (scores 8 factors, 0–100)
                                        │
                    ┌───────────────────┼───────────────────┐
                  <55                55–74               ≥75
                 silent            WATCH alert        SIGNAL fired
                                                           │
                                                     PaperTrader
                                                           │
                                                    MetricsEngine
```

**Constraint:** One active paper trade at a time. No overlapping positions. If signal fires while trade is open, it is logged but not taken.

**State persistence:** All trades and metrics written to `trades.json`. Survives restarts.

---

## Data Layer

### 1-Second Feed (Spot + LTP)
- Endpoint: `GET /v2/market-quote/ltp` for NIFTY spot + target option contracts
- Provides: live spot price, live option LTPs for open positions
- Used for: spot velocity calculation, live P&L on open trades, exit trigger monitoring

### 60-Second Snapshot (Full OI)
- Endpoint: `GET /v2/option/chain?instrument_key=NSE_INDEX|Nifty 50&expiry_date=YYYY-MM-DD`
- Provides: full OI per strike, greeks (delta/theta/vega/IV), prev_oi (for OI change)
- Used for: scoring all 8 factors, regime detection, call/put wall identification

---

## Regime Detection

Runs every second using latest snapshot + live spot.

| Regime | Primary Condition |
|--------|------------------|
| BREAKOUT | Spot within 50pts of top call wall AND trending up |
| BREAKDOWN | Spot within 50pts of top put wall AND trending down |
| SIDEWAYS | Spot within 150pts of max pain AND low velocity |
| UNCLEAR | None of the above — agent watches silently |

---

## Scoring Engine

### BREAKOUT (0–100)

| # | Factor | Points | Condition |
|---|--------|--------|-----------|
| 1 | Call wall dissolving | 20 | Top call OI dropped >30k since last OI snapshot |
| 2 | Spot velocity up | 20 | Spot rose >15pts in last 30 seconds |
| 3 | PCR rising | 15 | PCR increased across last 3 OI snapshots |
| 4 | Max pain above spot | 15 | Max pain >150pts above current spot |
| 5 | Call IV expanding | 10 | CE IV at resistance +1.5% vs 5 min ago |
| 6 | Put wall holding | 10 | Nearest support OI stable or building |
| 7 | Volume surge | 5 | CE volume at resistance >2× 5-snapshot average |
| 8 | Time filter | 5 | 09:30–11:30 or 13:30–14:30 IST |

**Signal threshold:** ≥75 → BUY CE at 1 strike above resistance

### BREAKDOWN (0–100)

Mirror of BREAKOUT with put-side factors:
- Put wall dissolving (20), Spot velocity down (20), PCR falling (15), Max pain below spot (15), PE IV expanding (10), Call wall holding (10), Volume surge on PE side (5), Time filter (5)

**Signal threshold:** ≥75 → BUY PE at 1 strike below support

### SIDEWAYS (0–100)

| # | Factor | Points | Condition |
|---|--------|--------|-----------|
| 1 | Spot near max pain | 25 | Within ±100pts of max pain |
| 2 | Both walls building | 20 | Call AND put OI increasing in last 2 snapshots |
| 3 | PCR balanced | 15 | PCR between 0.85 and 1.25 |
| 4 | IV contracting | 15 | ATM IV falling vs 5 min ago |
| 5 | Low spot velocity | 10 | <10pt move in last 60 seconds |
| 6 | DTE ≥ 2 | 10 | At least 2 days to expiry |
| 7 | No event filter | 5 | Not Monday 09:15–09:30 or expiry day open |

**Signal threshold:** ≥75 → SELL ATM straddle (sell CE + sell PE at nearest strike to spot)

---

## Signal Output Format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔺 BREAKOUT SIGNAL  |  10:47:32  |  Score: 82/100
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Spot     : 23,810  breaking through 23,800 CE wall
Strategy : BUY 23,800 CE
Entry    : ₹82.50   (live LTP at signal time)
Target   : ₹123.75  (+50%)
SL       : ₹49.50   (−40%)
Max P&L  : +₹3,093 / −₹2,475  (1 lot)
Exit by  : 14:45 today (hard time stop)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Factors  : call_wall −42k | velocity +22pts/30s
           PCR 1.31↑ | max_pain +280pts above
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Paper Trader

### Entry
- Records entry price as live LTP at exact signal timestamp
- Opens position: `{strategy, strike, direction, entry_price, target, sl, entry_time}`

### Live Tracking (every 1 second)
- Fetches current LTP for the traded option
- Computes live P&L = (current_ltp − entry_price) × 75 × direction_multiplier
- Checks exit conditions every second

### Exit Triggers (first to fire wins)
| Trigger | Condition |
|---------|-----------|
| TARGET | Current LTP ≥ entry × 1.50 (CE/PE buy) OR premium decayed 40% (straddle) |
| STOP LOSS | Current LTP ≤ entry × 0.60 (CE/PE buy) OR premium expanded 80% (straddle) |
| TIME STOP | 14:45 IST hard exit — no exceptions |
| MANUAL | User types `exit` in terminal |

### Exit Card
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ TRADE CLOSED  |  TARGET HIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUY 23,800 CE  |  Entry 10:47 → Exit 11:21
Entry  : ₹82.50
Exit   : ₹124.10
P&L    : +₹3,120  (1 lot, 34 min hold)
Score  : 82/100
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Metrics Engine

Printed every 30 min and on every trade exit.

### Today
- Signals fired, trades taken, win/loss count, win rate
- Avg profit on wins, avg loss on losses, net P&L
- Best trade, worst trade
- Avg signal score of winners vs losers
- Avg hold time

### All-Time
- Total trades, overall win rate, total net P&L
- Best/worst regime (BREAKOUT / BREAKDOWN / SIDEWAYS)
- Score-to-outcome correlation (do higher scores actually win more?)

---

## Persistence — trades.json

```json
{
  "trades": [
    {
      "id": "T001",
      "timestamp": "2026-05-29T10:47:32",
      "regime": "BREAKOUT",
      "strategy": "BUY_CE",
      "strike": 23800,
      "entry_price": 82.50,
      "exit_price": 124.10,
      "exit_reason": "TARGET",
      "hold_minutes": 34,
      "pnl_rs": 3120,
      "score": 82,
      "factors_fired": ["call_wall_dissolve", "velocity_up", "pcr_rising", "max_pain_above"]
    }
  ]
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `scripts/nifty_agent.py` | Main agent entry point + loop |
| `scripts/agent/data.py` | Upstox 1s + 60s fetch, SnapshotStore |
| `scripts/agent/regime.py` | RegimeDetector |
| `scripts/agent/scoring.py` | ScoringEngine (all 3 regimes) |
| `scripts/agent/paper_trade.py` | PaperTrader + exit logic |
| `scripts/agent/metrics.py` | MetricsEngine + trades.json I/O |

---

## Configuration (CLI flags)

```bash
python nifty_agent.py \
  --token  "YOUR_UPSTOX_TOKEN" \
  --expiry "2026-06-05" \
  --threshold 75          # signal score minimum (default 75)
  --check   1             # OI refresh seconds (default 60, min 10)
```

---

## Out of Scope

- Real order placement
- Multiple lots
- BankNifty / FinNifty
- Backtesting on historical data
- Telegram / email alerts (can add later)
