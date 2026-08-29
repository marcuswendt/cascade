#!/usr/bin/env bash
# Symlinks the built `cascade` CLI onto ~/.local/bin so it's runnable from
# any directory — same convention this machine already uses for the
# project CLIs installed outside npm. Run `npm run build` first.
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_CLI="$SERVER_DIR/dist/cli.js"
BIN_DIR="$HOME/.local/bin"
LINK_PATH="$BIN_DIR/cascade"

if [ ! -f "$DIST_CLI" ]; then
  echo "error: $DIST_CLI not found — run 'npm run build' in server/ first." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
chmod +x "$DIST_CLI"
ln -sf "$DIST_CLI" "$LINK_PATH"
echo "linked: $LINK_PATH -> $DIST_CLI"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo "note: $BIN_DIR isn't on your PATH — add it to your shell profile to run 'cascade' from anywhere."
fi
