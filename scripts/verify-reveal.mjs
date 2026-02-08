#!/usr/bin/env node
import fs from "node:fs";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

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

function main() {
  const revealPath = getArg("--reveal");
  if (!revealPath) throw new Error("--reveal <reveal-*.json> required");
  const reveal = JSON.parse(fs.readFileSync(revealPath, "utf8"));

  const bundle = reveal.bundle;
  if (!bundle) throw new Error("reveal.bundle missing");
  const bundleHash = reveal.bundleHash;

  const { bundleHash: _ignored, ...bundleNoHash } = bundle;
  const recalcedBundleHash = `sha256:${hashSha256Hex(canonicalJson(bundleNoHash))}`;
  if (recalcedBundleHash !== bundleHash) {
    throw new Error(`bundleHash mismatch: reveal=${bundleHash} recalced=${recalcedBundleHash}`);
  }

  const { revealHash: _rh, bundle: _b, ...revealNoBundle } = reveal;
  const recalcedRevealHash = `sha256:${hashSha256Hex(canonicalJson(revealNoBundle))}`;

  console.log(
    JSON.stringify(
      {
        ok: true,
        bundleHash,
        recalcedRevealHash,
        revealHash: reveal.revealHash ?? null,
        hasCommit: !!reveal.commit
      },
      null,
      2
    )
  );
}

main();
