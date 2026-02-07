#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
}

function latestOut(prefix, ext) {
  const outDir = path.resolve("./out");
  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? path.join(outDir, files[0].f) : null;
}

function main() {
  fs.mkdirSync(path.resolve("./out"), { recursive: true });

  console.log("[1/3] generating bundle (paper demo)");
  sh("node", ["scripts/paper-demo.mjs"]);
  const bundlePath = latestOut("paper-demo-", ".json");
  if (!bundlePath) throw new Error("bundle not found after paper demo");

  console.log("[2/3] anchoring bundleHash on Solana devnet (memo commit)");
  const anchorStdout = sh("node", ["scripts/anchor-devnet.mjs", "--bundle", bundlePath]);
  const lastLine = anchorStdout.trim().split("\n").at(-1);
  const anchor = JSON.parse(lastLine);

  console.log("[3/3] verifying on-chain memo matches local bundleHash");
  const verifyStdout = sh("node", [
    "scripts/verify-anchor.mjs",
    "--sig",
    anchor.sig,
    "--bundle",
    bundlePath
  ]);

  const verify = JSON.parse(verifyStdout);
  console.log(
    JSON.stringify(
      {
        ok: true,
        sig: anchor.sig,
        bundlePath: path.relative(process.cwd(), bundlePath),
        bundleHash: verify.bundleHash,
        commitHash: verify.commitHash,
        memoTs: verify.memoTs
      },
      null,
      2
    )
  );
}

main();
