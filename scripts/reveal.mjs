#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

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

function latestFile(prefix, ext = ".json") {
  const files = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => ({ f, t: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? path.join(OUT_DIR, files[0].f) : null;
}

function main() {
  const bundlePath = getArg("--bundle", latestFile("paper-demo-"));
  if (!bundlePath) throw new Error("No bundle found. Run: npm run demo:paper");
  const anchorPath = getArg("--anchor", latestFile("anchor-"));

  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const bundleHash = bundle.bundleHash;
  if (!bundleHash) throw new Error("bundleHash missing in bundle JSON");

  let anchor = null;
  if (anchorPath && fs.existsSync(anchorPath)) {
    anchor = JSON.parse(fs.readFileSync(anchorPath, "utf8"));
  }

  const reveal = {
    kind: "poa-reveal-v0",
    ts: new Date().toISOString(),
    bundlePath: path.basename(bundlePath),
    bundleHash,
    commit: anchor
      ? {
          sig: anchor.sig,
          commitHash: anchor.commitHash,
          memoTs: anchor.commit?.ts ?? null
        }
      : null,
    bundle
  };

  // revealHash is for sharing a stable pointer to the reveal payload
  const { bundle: _b, ...revealNoBundle } = reveal;
  const revealHash = `sha256:${hashSha256Hex(canonicalJson(revealNoBundle))}`;

  const out = { ...reveal, revealHash };
  const outPath = path.join(OUT_DIR, `reveal-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        bundleHash,
        revealHash,
        commitSig: anchor?.sig ?? null,
        commitHash: anchor?.commitHash ?? null
      },
      null,
      2
    )
  );
}

main();
