#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_PATH="$HOME/.config/github/token-colosseum-proof-of-alpha"
if [ ! -f "$TOKEN_PATH" ]; then
  echo "Missing token file: $TOKEN_PATH" >&2
  exit 1
fi
TOKEN_FILE=$(mktemp)
ASKPASS=$(mktemp)
trap 'rm -f "$TOKEN_FILE" "$ASKPASS"' EXIT
chmod 600 "$TOKEN_FILE" "$ASKPASS"
cat "$TOKEN_PATH" > "$TOKEN_FILE"
cat > "$ASKPASS" <<'SH'
#!/usr/bin/env bash
prompt="$1"
if echo "$prompt" | grep -qi "username"; then
  echo "x-access-token"
  exit 0
fi
if echo "$prompt" | grep -qi "password"; then
  cat "$TOKEN_FILE"
  exit 0
fi
cat "$TOKEN_FILE"
SH
chmod 700 "$ASKPASS"
cd "$REPO_DIR"
GIT_TERMINAL_PROMPT=0 TOKEN_FILE="$TOKEN_FILE" GIT_ASKPASS="$ASKPASS" git push
