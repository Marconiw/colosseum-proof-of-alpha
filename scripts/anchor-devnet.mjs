#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction
} from "@solana/web3.js";

const args = process.argv.slice(2);
function getArg(name, def = null) {
  const idx = args.indexOf(name);
  if (idx === -1) return def;
  return args[idx + 1] ?? def;
}

const OUT_DIR = path.resolve("./out");
fs.mkdirSync(OUT_DIR, { recursive: true });

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

function latestFile(globPrefix) {
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.startsWith(globPrefix) && f.endsWith(".json"))
    .map((f) => ({ f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0]?.f ? path.join(OUT_DIR, files[0].f) : null;
}

async function airdropIfNeeded(conn, pubkey, minSol = 0.5) {
  const wantLamports = minSol * LAMPORTS_PER_SOL;
  try {
    const bal = await conn.getBalance(pubkey, "confirmed");
    if (bal >= wantLamports) return { ok: true, bal };
  } catch {
    // ignore balance errors on flaky RPCs
  }

  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const sig = await conn.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL);
      // prefer new confirmTransaction signature
      const bh = await conn.getLatestBlockhash("confirmed");
      await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      const bal2 = await conn.getBalance(pubkey, "confirmed");
      return { ok: true, bal: bal2, airdropSig: sig };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function memoIx(memoText) {
  // Official Solana Memo program id
  const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(memoText, "utf8")
  });
}

async function main() {
  const rpc = getArg("--rpc", "https://api.devnet.solana.com");
  const bundlePath = getArg("--bundle", latestFile("paper-demo-"));
  if (!bundlePath) throw new Error("No bundle found. Run: npm run demo:paper");

  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const bundleHash = bundle.bundleHash;
  if (!bundleHash) throw new Error("bundleHash missing in bundle JSON");

  // commit step: write memo containing commitment
  const commit = {
    kind: "poa-commit-v0",
    ts: new Date().toISOString(),
    bundleHash,
    strategyId: bundle.strategyId,
    runId: bundle.runId
  };
  const commitHash = `sha256:${hashSha256Hex(canonicalJson(commit))}`;

  const conn = new Connection(rpc, "confirmed");

  // Use a persistent devnet keypair so faucet funding is one-time.
  const kpPath = process.env.POA_DEVNET_KEYPAIR || `${process.env.HOME}/.config/proof-of-alpha/devnet-keypair.json`;
  let payer;
  if (fs.existsSync(kpPath)) {
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, "utf8")));
    payer = Keypair.fromSecretKey(secret);
  } else {
    payer = Keypair.generate();
    fs.mkdirSync(path.dirname(kpPath), { recursive: true });
    fs.writeFileSync(kpPath, JSON.stringify(Array.from(payer.secretKey)));
    fs.chmodSync(kpPath, 0o600);
  }

  const pre = await airdropIfNeeded(conn, payer.publicKey);

  const memo = canonicalJson({ ...commit, commitHash });
  const tx = new Transaction().add(memoIx(memo));
  tx.feePayer = payer.publicKey;

  const sig = await sendAndConfirmTransaction(conn, tx, [payer], {
    commitment: "confirmed"
  });

  const out = {
    rpc,
    payer: payer.publicKey.toBase58(),
    airdropSig: pre.airdropSig ?? null,
    sig,
    bundlePath: path.relative(process.cwd(), bundlePath),
    bundleHash,
    commit,
    commitHash,
    memo
  };

  const outPath = path.join(OUT_DIR, `anchor-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(JSON.stringify({ sig, commitHash, bundleHash, outPath }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
