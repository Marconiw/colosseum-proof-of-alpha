#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/colosseum-env.sh"

curl -s -H "Authorization: Bearer $COLOSSEUM_API_KEY" \
  https://agents.colosseum.com/api/agents/status
