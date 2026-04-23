#!/bin/bash
# View Clawline Native Host Logs (Unix/Linux/macOS)
# This script helps you view the error log file

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ERROR_LOG="$DIR/error.log"

echo "Clawline Native Host Log Viewer"
echo "================================"
echo ""
echo "Log file location: $ERROR_LOG"
echo ""

if [ ! -f "$ERROR_LOG" ]; then
    echo "No log file found. The native host hasn't logged any errors yet."
    echo ""
    echo "Note: The native host logs to stderr and to error.log"
    echo "  - stderr may be visible in Chrome's native host output"
    echo "  - error.log persists errors for debugging"
    echo ""
    exit 0
fi

echo "Current log contents:"
echo "--------------------"
cat "$ERROR_LOG"
echo "--------------------"
echo ""
echo "To monitor logs in real-time, use: tail -f $ERROR_LOG"
