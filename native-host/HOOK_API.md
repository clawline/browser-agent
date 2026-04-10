# Clawline Browser Agent — Hook API Skill

You have access to a browser automation agent (Clawline) running as a Chrome extension. You can send tasks to it via HTTP to control browser tabs — navigate, click, fill forms, take screenshots, extract content, etc. Use this to perform automated browser testing with a verify-and-act loop.

## API Base URL

```
http://127.0.0.1:4821
```

## Endpoints

### POST /hook — Send a task

Send a natural language task to the browser agent. The agent executes it using browser automation tools and returns the result.

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | string | Yes | Natural language task description |
| `windowId` | number | No | Target a specific browser window. Get from `GET /sessions` |
| `tabId` | number | No | Target a specific tab. Overrides window-based tab selection |
| `conversationId` | string | No | Continue an existing conversation (preserves context) |
| `model` | string | No | Override model: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001` |
| `include_screenshot` | boolean | No | Return the last screenshot as base64 in the response |
| `include_tools` | boolean | No | Return all tool call/result records from this task |

**Response:**

```json
{
  "type": "hook_response",
  "taskId": "task_xxx",
  "status": "completed",
  "result": "Agent's text description of what it did and saw",
  "conversationId": "conv_xxx",
  "tabId": 12345,
  "screenshot": {                          // only if include_screenshot: true
    "data": "base64-encoded-image...",
    "media_type": "image/png"
  },
  "tools": [                               // only if include_tools: true
    {"type": "call", "name": "computer", "input": {"action": "screenshot"}},
    {"type": "result", "tool_use_id": "xxx", "is_error": false, "texts": ["Done"], "hasImage": true},
    {"type": "call", "name": "computer", "input": {"action": "left_click", "coordinate": [100, 200]}},
    {"type": "result", "tool_use_id": "xxx", "is_error": false, "texts": ["Clicked button"], "hasImage": false}
  ]
}
```

### GET /sessions — List active browser windows

Returns all browser windows with the Clawline sidepanel open.

```bash
curl -s http://127.0.0.1:4821/sessions
```

### GET /status/:taskId — Check task status

```bash
curl -s http://127.0.0.1:4821/status/task_xxx
```

### POST /stop/:taskId — Stop a running task

```bash
curl -s -X POST http://127.0.0.1:4821/stop/task_xxx
```

### GET / — Health check

```bash
curl -s http://127.0.0.1:4821/
```

## Testing Loop Pattern

Use the hook API to build automated test-verify-act loops:

```
1. GET /sessions → pick a windowId
2. POST /hook with task + include_screenshot: true
3. Analyze the result text and screenshot
4. If not done → POST /hook with follow-up task + same conversationId
5. Repeat until test passes or fails
```

**Example — full test cycle:**

```bash
# Step 1: Navigate and verify page loaded
RESULT=$(curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d '{
    "task": "Navigate to http://localhost:3000/login. Take a screenshot and describe the page.",
    "include_screenshot": true
  }')
# → Parse result text and screenshot to verify login page loaded

# Step 2: Fill form and submit (continue conversation)
CONV_ID=$(echo $RESULT | jq -r '.conversationId')
RESULT=$(curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d "{
    \"task\": \"Enter username 'admin' and password 'test123', then click the Login button. Take a screenshot after.\",
    \"conversationId\": \"$CONV_ID\",
    \"include_screenshot\": true
  }")
# → Parse result to check if login succeeded or show error

# Step 3: Verify post-login state
RESULT=$(curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d "{
    \"task\": \"Read the current page content. Are we on the dashboard? What does the page show?\",
    \"conversationId\": \"$CONV_ID\",
    \"include_screenshot\": true
  }")
# → Analyze to confirm test passed
```

## Usage Guidelines

1. **Always check sessions first.** If empty, the Chrome sidepanel is not open.

2. **Specify windowId** for multi-window scenarios to ensure deterministic routing.

3. **Use conversationId** for multi-step workflows. The agent retains page state and element references within a conversation.

4. **Use include_screenshot: true** when you need to visually verify page state. The screenshot is the last one captured during the task.

5. **Use include_tools: true** when you need to audit exactly what actions the agent took (clicks, navigations, JS executions, etc.).

6. **Tasks are blocking** — the HTTP request waits until completion (up to 10 minutes).

7. **Parallel execution** works across different windows. Do NOT send two tasks to the same window simultaneously.

8. **The agent can:** take screenshots, click elements, fill forms, navigate URLs, execute JavaScript, read page content/accessibility tree, create tabs, upload files, read console logs and network requests.

9. **Task descriptions should be specific.** Good: "Click the blue Submit button at the bottom of the form". Bad: "Submit it".

10. **Error handling:** `status: "error"` means the task failed. Common errors:
    - `"Agent is busy with another task"` — wait and retry
    - `"No sidepanel available"` — open the Chrome sidepanel
    - `"No browser tab found"` — ensure the window has a webpage tab
