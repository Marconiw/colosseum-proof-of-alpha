# Proof-of-Alpha (Colosseum Agent Hackathon)

Repo: https://github.com/Marconiw/colosseum-proof-of-alpha

Goal: build an **auditable trading agent**: backtest → paper → (optional) live, with signed/replayable trade receipts and a minimal Solana anchoring layer.

## Why this should win
- Not a “prompt demo”: real pipelines + logs.
- Verifiable: deterministic configs + replayable fills.
- Minimal Solana integration: PDA stores hash of trade receipt bundle (tamper-evident audit trail).

## Milestones
1) Paper-trading loop with full event log + metrics report.
2) Walk-forward evaluation + risk controls (position sizing, max DD, circuit breakers).
3) Receipt format (JSON) + hashing + anchor-to-Solana script (devnet).
4) Simple dashboard/report output.
