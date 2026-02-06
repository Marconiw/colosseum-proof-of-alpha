#!/usr/bin/env node
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import fs from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const WRITE_MD = args.has("--write-md");

const OUT_DIR = path.resolve("./out");
fs.mkdirSync(OUT_DIR, { recursive: true });

function iso(tsMs) {
  return new Date(tsMs).toISOString();
}

function ema(values, period) {
  const k = 2 / (period + 1);
  let out = [];
  let prev;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (prev === undefined) prev = v;
    else prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

async function fetchBinanceKlines({ symbol = "BTCUSDT", interval = "15m", limit = 500 } = {}) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const data = await res.json();
  // [ openTime, open, high, low, close, volume, closeTime, ...]
  return data.map((k) => ({
    openTime: Number(k[0]),
    closeTime: Number(k[6]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5])
  }));
}

async function fetchKrakenOHLC({ pair = "XBTUSD", intervalMin = 15, limit = 500 } = {}) {
  // Kraken returns: [time, open, high, low, close, vwap, volume, count]
  const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${intervalMin}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const json = await res.json();
  if (json.error && json.error.length) throw new Error(`Kraken error: ${json.error.join(",")}`);
  const result = json.result;
  const key = Object.keys(result).find((k) => k !== "last");
  const rows = result[key] || [];
  const candles = rows.map((r) => {
    const openTime = Number(r[0]) * 1000;
    const closeTime = openTime + intervalMin * 60 * 1000;
    return {
      openTime,
      closeTime,
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[6])
    };
  });
  return candles.slice(-limit);
}

function canonicalJson(obj) {
  // stable key order stringify
  const seen = new WeakSet();
  const sorter = (value) => {
    if (value && typeof value === "object") {
      if (seen.has(value)) throw new Error("circular");
      seen.add(value);
      if (Array.isArray(value)) return value.map(sorter);
      const keys = Object.keys(value).sort();
      const out = {};
      for (const k of keys) out[k] = sorter(value[k]);
      return out;
    }
    return value;
  };
  return JSON.stringify(sorter(obj));
}

function hashSha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  return bytesToHex(sha256(bytes));
}

function paperTrade({ candles, feeBps = 4, slippageBps = 2, qtyBtc = 0.01 }) {
  const closes = candles.map((c) => c.close);
  const emaFast = ema(closes, 20);
  const emaSlow = ema(closes, 50);

  let cash = 10000; // USDT
  let pos = 0; // BTC
  let equity = cash;
  let peak = cash;
  let maxDD = 0;

  const receipts = [];

  const strategyId = "poa-btcusdt-15m-ema20x50-v0";

  for (let i = 60; i < candles.length; i++) {
    const c = candles[i];
    const px = c.close;
    const fast = emaFast[i];
    const slow = emaSlow[i];

    // simple crossover
    const prevFast = emaFast[i - 1];
    const prevSlow = emaSlow[i - 1];
    const crossUp = prevFast <= prevSlow && fast > slow;
    const crossDn = prevFast >= prevSlow && fast < slow;

    let action = null;
    if (crossUp && pos === 0) action = "enter_long";
    if (crossDn && pos > 0) action = "exit_long";

    if (action) {
      const side = action === "enter_long" ? "buy" : "sell";
      const slip = (slippageBps / 10000) * px;
      const fillPx = side === "buy" ? px + slip : px - slip;
      const notional = fillPx * qtyBtc;
      const fee = (feeBps / 10000) * notional;

      if (side === "buy") {
        if (cash >= notional + fee) {
          cash -= notional + fee;
          pos += qtyBtc;
        } else {
          // insufficient cash: skip
          continue;
        }
      } else {
        // sell
        pos -= qtyBtc;
        cash += notional - fee;
        if (pos < 1e-12) pos = 0;
      }

      const receipt = {
        ts: iso(c.closeTime),
        market: "BTCUSDT",
        venue: "binance",
        signal: {
          type: action,
          strength: 1,
          features: {
            emaFast: Number(fast.toFixed(2)),
            emaSlow: Number(slow.toFixed(2))
          }
        },
        order: {
          mode: "paper",
          side,
          qty: qtyBtc,
          slippageBps,
          feeBps
        },
        fill: {
          status: "filled",
          avgPx: Number(fillPx.toFixed(2)),
          fee: Number(fee.toFixed(4))
        }
      };
      receipts.push(receipt);
    }

    equity = cash + pos * px;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const finalPx = candles.at(-1).close;
  const finalEquity = cash + pos * finalPx;
  const ret = (finalEquity - 10000) / 10000;

  return {
    strategyId,
    start: iso(candles[0].openTime),
    end: iso(candles.at(-1).closeTime),
    trades: receipts.length,
    final: {
      cash: Number(cash.toFixed(2)),
      posBtc: Number(pos.toFixed(6)),
      equity: Number(finalEquity.toFixed(2))
    },
    returnPct: Number((ret * 100).toFixed(3)),
    maxDrawdownPct: Number((maxDD * 100).toFixed(3)),
    receipts
  };
}

async function main() {
  let candles;
  try {
    candles = await fetchBinanceKlines({ symbol: "BTCUSDT", interval: "15m", limit: 500 });
  } catch (e) {
    // Binance is often geo-blocked (HTTP 451) from some regions/VMs.
    candles = await fetchKrakenOHLC({ pair: "XBTUSD", intervalMin: 15, limit: 500 });
  }

  const runId = iso(Date.now());
  const config = {
    symbol: "BTCUSDT",
    interval: "15m",
    limit: 500,
    strategy: "ema20x50",
    feeBps: 4,
    slippageBps: 2,
    qtyBtc: 0.01,
    initialCash: 10000
  };
  const configHash = `sha256:${hashSha256Hex(canonicalJson(config))}`;

  const result = paperTrade({ candles, feeBps: 4, slippageBps: 2, qtyBtc: 0.01 });

  const bundle = {
    bundleVersion: 0,
    strategyId: result.strategyId,
    runId,
    config,
    configHash,
    receipts: result.receipts,
    metrics: {
      trades: result.trades,
      returnPct: result.returnPct,
      maxDrawdownPct: result.maxDrawdownPct,
      finalEquity: result.final.equity
    }
  };

  const bundleHash = `sha256:${hashSha256Hex(canonicalJson(bundle))}`;
  const outJson = {
    ...bundle,
    bundleHash
  };

  const outPath = path.join(OUT_DIR, `paper-demo-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(outJson, null, 2));

  console.log("paper demo ok");
  console.log(JSON.stringify({ outPath, bundleHash, metrics: outJson.metrics }, null, 2));

  if (WRITE_MD) {
    const md = `# Proof-of-Alpha — Paper Demo\n\n- runId: ${runId}\n- strategyId: ${outJson.strategyId}\n- configHash: ${configHash}\n- bundleHash: ${bundleHash}\n\n## Metrics\n- trades: ${outJson.metrics.trades}\n- returnPct: ${outJson.metrics.returnPct}%\n- maxDrawdownPct: ${outJson.metrics.maxDrawdownPct}%\n- finalEquity: ${outJson.metrics.finalEquity}\n\nJSON output: ${path.basename(outPath)}\n`;
    const mdPath = path.join(OUT_DIR, `paper-demo-${Date.now()}.md`);
    fs.writeFileSync(mdPath, md);
    console.log(`wrote ${mdPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
