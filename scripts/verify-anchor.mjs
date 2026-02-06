#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { Connection, PublicKey } from "@solana/web3.js";

const args = process.argv.slice(2);
function getArg(name, def = null) {
  const idx = args.indexOf(name);
  if (idx === -1) return def;
  return args[idx + 1] ?? def;
}

function canonicalJson(obj) {
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

async function main() {
  const rpc = getArg("--rpc", "https://api.devnet.solana.com");
  const sig = getArg("--sig");
  const bundlePath = getArg("--bundle");
  if (!sig) throw new Error("--sig <txSignature> required");
  if (!bundlePath) throw new Error("--bundle <paper-demo-*.json> required");

  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const bundleHash = bundle.bundleHash;
  if (!bundleHash) throw new Error("bundleHash missing in bundle");

  // re-hash the bundle deterministically (excluding any transient fields if needed)
  const recalced = `sha256:${hashSha256Hex(canonicalJson(bundle))}`;
  if (recalced !== bundleHash) {
    throw new Error(`Bundle hash mismatch: recalced=${recalced} file=${bundleHash}`);
  }

  const conn = new Connection(rpc, "confirmed");
  const tx = await conn.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0
  });
  if (!tx) throw new Error("Transaction not found (yet). Try again.");

  // find memo instruction
  const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  const ixes = tx.transaction.message.instructions;
  let memoText = null;
  for (const ix of ixes) {
    const programId = tx.transaction.message.staticAccountKeys[ix.programIdIndex];
    if (programId.equals(MEMO_PROGRAM_ID)) {
      memoText = Buffer.from(ix.data).toString("utf8");
      break;
    }
  }
  if (!memoText) throw new Error("Memo instruction not found in tx");

  const memo = JSON.parse(memoText);
  if (memo.bundleHash !== bundleHash) {
    throw new Error(`Memo bundleHash mismatch: memo=${memo.bundleHash} bundle=${bundleHash}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        sig,
        rpc,
        bundleHash,
        commitHash: memo.commitHash,
        memoTs: memo.ts,
        bundlePath: path.resolve(bundlePath)
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
