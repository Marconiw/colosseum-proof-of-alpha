#!/usr/bin/env node
import fs from "node:fs";

const credsPath = `${process.env.HOME}/.config/colosseum/credentials.json`;
const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
const apiKey = creds.apiKey;

const body = {
  additionalInfo:
    "Repo updated with runnable paper trading demo. Run: `npm i && npm run demo:paper` (writes out/paper-demo-*.json with bundleHash). Next: Solana PDA anchor script + commit-reveal timing proof.",
  technicalDemoLink: "https://github.com/Marconiw/colosseum-proof-of-alpha"
};

const res = await fetch("https://agents.colosseum.com/api/my-project", {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(body)
});

if (!res.ok) {
  const t = await res.text();
  throw new Error(`HTTP ${res.status}: ${t}`);
}
console.log(await res.text());
