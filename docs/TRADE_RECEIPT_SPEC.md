# Trade Receipt Spec (v0)

Purpose: a **replayable, verifiable** record of a strategy decision and its (paper/live) execution.

## Receipt bundle
A bundle groups all receipts for a run interval (e.g., 15m candle close).

```json
{
  "bundleVersion": 0,
  "strategyId": "poa-btc-15m-v0",
  "runId": "2026-02-06T02:00:00Z",
  "configHash": "sha256:...",
  "receipts": [ ... ],
  "metrics": {
    "equity": 1000.0,
    "drawdown": 0.02,
    "position": 0.1
  }
}
```

## Individual receipt
```json
{
  "ts": "2026-02-06T02:00:01.123Z",
  "market": "BTCUSDT",
  "venue": "binance",
  "signal": {
    "type": "enter_long",
    "strength": 0.72,
    "features": {
      "emaFast": 43123.1,
      "emaSlow": 42990.4,
      "atr": 210.3
    }
  },
  "order": {
    "mode": "paper",
    "side": "buy",
    "qty": 0.01,
    "limit": 43120.0,
    "slippageModel": "spread+impact-v0"
  },
  "fill": {
    "status": "filled",
    "avgPx": 43125.2,
    "fee": 0.05
  }
}
```

## Hashing
- Canonicalize JSON (stable key order) then `sha256`.
- Store `bundleHash` on Solana PDA.

## Solana anchoring (minimal)
- Program owns PDA keyed by `(strategyId, runId)`.
- PDA stores `bundleHash` + timestamp.

This is intentionally minimal: it proves **integrity**, not strategy secrecy.
