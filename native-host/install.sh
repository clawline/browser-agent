#!/bin/bash
# Clawline Native Messaging Host — macOS Installer
#
# Usage:
#   ./install.sh [EXTENSION_ID]
#
# If EXTENSION_ID is not provided, you must edit the manifest manually.

set -e

HOST_NAME="com.clawline.agent"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/launcher.sh"
TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

EXT_ID="${1:-EXTENSION_ID_HERE}"

echo "Installing Clawline Native Messaging Host..."
echo "  Host name:  $HOST_NAME"
echo "  Host path:  $HOST_PATH"
echo "  Target dir: $TARGET_DIR"
echo "  Extension:  $EXT_ID"

mkdir -p "$TARGET_DIR"

cat > "$TARGET_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "Clawline Browser Agent Hook — Native Messaging Host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

chmod +x "$HOST_PATH"

echo ""
echo "Done! Manifest installed to:"
echo "  $TARGET_DIR/$HOST_NAME.json"

if [ "$EXT_ID" = "EXTENSION_ID_HERE" ]; then
  echo ""
  echo "WARNING: You need to replace EXTENSION_ID_HERE with your actual extension ID."
  echo "  1. Go to chrome://extensions"
  echo "  2. Find Clawline Browser Agent and copy the ID"
  echo "  3. Re-run: ./install.sh YOUR_EXTENSION_ID"
  echo "  Or edit: $TARGET_DIR/$HOST_NAME.json"
fi
