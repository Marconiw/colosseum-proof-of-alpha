#!/usr/bin/env bash
set -euo pipefail
CREDS="$HOME/.config/colosseum/credentials.json"
API_KEY=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.config/colosseum/credentials.json','utf8')).apiKey)")
export COLOSSEUM_API_KEY="$API_KEY"
