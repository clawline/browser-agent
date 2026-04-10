#!/bin/bash
# Clawline Native Host Launcher
# Chrome doesn't inherit user's shell PATH (nvm, fnm, etc.), so we find node ourselves.

DIR="$(cd "$(dirname "$0")" && pwd)"

# Source nvm if available
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  source "$HOME/.nvm/nvm.sh" 2>/dev/null
fi

# Source fnm if available
if command -v fnm &>/dev/null; then
  eval "$(fnm env)" 2>/dev/null
fi

# Fallback: check common node locations
if ! command -v node &>/dev/null; then
  for p in /usr/local/bin/node /opt/homebrew/bin/node; do
    if [ -x "$p" ]; then
      export PATH="$(dirname "$p"):$PATH"
      break
    fi
  done
fi

exec node "$DIR/index.js"
