# Clawline Browser Agent — Code Agent Integration

## Architecture

```
Code Agent (Hermes / Claude Code / scripts)
    │
    │  HTTP (localhost:4821)
    ▼
Native Messaging Host (Node.js)
    │
    │  Chrome Native Messaging (stdin/stdout)
    ▼
Service Worker (background)
    │
    │  chrome.runtime port
    ▼
Side Panel (Claude-powered browser automation)
    │
    │  Chrome Debugger Protocol
    ▼
Target Web Page
```

## How It Works

1. **Native Messaging Host** (`native-host/index.js`) runs as a Node.js process launched by Chrome. It serves an HTTP API on `127.0.0.1:4821` and bridges requests to the extension via Chrome's native messaging protocol (4-byte LE length-prefixed JSON over stdin/stdout).

2. **Service Worker** (`service-worker.js`) maintains a registry of connected side panel instances (keyed by `windowId`). When a task arrives from the native host, it routes to the correct side panel — by `windowId`, `tabId`, or the most recently focused window.

3. **Side Panel** (`sidepanel.js`) receives the task, runs a Claude agent loop (screenshot → reason → act), and streams the `hook_response` back through the same chain.

## Setup

### Prerequisites
- Chrome 120+
- Node.js 18+
- Anthropic API key

### Steps

```bash
# 1. Load the extension
#    chrome://extensions → Developer mode → Load unpacked → select this directory
#    Copy the Extension ID

# 2. Install native messaging host (macOS)
cd native-host && ./install.sh <EXTENSION_ID>

# 3. Open side panel
#    Click extension icon or Cmd+Shift+E
#    Set API key in side panel settings

# 4. Verify
curl http://127.0.0.1:4821/
# → {"name":"clawline-hook","chromeConnected":true,...}
```

## API Quick Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/sessions` | GET | List windows with active side panels |
| `/hook` | POST | Send a task (blocking, up to 10min) |
| `/status/:taskId` | GET | Check task status |
| `/stop/:taskId` | POST | Abort a running task |

### POST /hook

```json
{
  "task": "Navigate to example.com and click the Login button",
  "windowId": 1,
  "conversationId": "conv_xxx",
  "model": "claude-sonnet-4-6",
  "include_screenshot": true,
  "include_tools": true
}
```

Only `task` is required. Use `conversationId` to continue multi-step workflows.

### Response

```json
{
  "type": "hook_response",
  "taskId": "task_xxx",
  "status": "completed",
  "result": "Navigated to example.com and clicked Login. The page now shows...",
  "conversationId": "conv_xxx",
  "tabId": 12345,
  "screenshot": { "data": "base64...", "media_type": "image/png" },
  "tools": [
    {"type": "call", "name": "computer", "input": {"action": "screenshot"}},
    {"type": "result", "tool_use_id": "xxx", "is_error": false, "texts": ["Done"]}
  ]
}
```

## Integration Pattern

```bash
# 1. Check sessions
curl -s http://127.0.0.1:4821/sessions

# 2. Send task
RESULT=$(curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d '{"task": "Go to localhost:3000 and describe the page", "include_screenshot": true}')

# 3. Continue with context
CONV=$(echo $RESULT | jq -r '.conversationId')
curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d "{\"task\": \"Click the Submit button\", \"conversationId\": \"$CONV\"}"
```

## Error Handling

| Status | Meaning |
|--------|---------|
| `completed` | Task finished successfully |
| `error` | Task failed — check `error` field |
| `timeout` | Exceeded 10-minute limit |
| `stop_requested` | Aborted via `/stop` |

Common errors:
- `Chrome extension not connected` — native host not running
- `No sidepanel available` — open side panel first
- `Agent is busy with another task` — one task per window at a time

## Notes

- Tasks are **blocking** — the HTTP call waits for completion
- **Parallel execution** works across different windows, not within one
- The agent can: screenshot, click, type, navigate, run JS, read accessibility tree, manage tabs, upload files, read console/network
- Port is configurable via `CLAWLINE_HOOK_PORT` env var (default: 4821)
