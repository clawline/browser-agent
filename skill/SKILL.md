---
name: browser-agent
version: 4.1.0
description: |
  Clawline Browser Agent — control Chrome tabs via HTTP Hook API.
  Navigate, click, fill forms, take screenshots, extract content,
  emulate mobile devices, batch form operations.
  Multi-host discovery: scan all running instances across Chrome profiles.
  Per-task API/key/model override. Reliable multi-sidepanel parallel routing.
  Use when asked to "test in browser", "open page", "check the site",
  "browser test", "integration test", "e2e test", or "use browser agent".
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Clawline Browser Agent — Hook API Skill

You have access to a browser automation agent (Clawline) running as a Chrome extension. It is a powerful test agent that can independently operate the browser — navigate, click, fill forms, take screenshots, read content, check console errors, emulate mobile devices, and more.

## Core Principle

**Delegate complete test flows, don't micromanage.**

The browser agent is intelligent. Send it a full test scenario in one task and let it execute the entire flow independently. You only need to read the result.

The agent's system prompt now contains an explicit "one-shot execution" rule: when given a complete spec with numbered steps, URLs, and an output format, it MUST execute directly without re-planning, re-explaining, or re-confirming. Your tasks SHOULD use that contract — front-load all instructions and expected output. Detailed task specs measurably finish faster (W15 benchmark: 99s → 39s, -60% RTT, after rule was introduced).

**Bad** (micromanaging — 4 separate calls):
```
Call 1: "Navigate to the page"
Call 2: "Click the button"
Call 3: "Type hello"
Call 4: "Check if message appeared"
```

**Good** (one complete task):
```
"Navigate to http://localhost:4026/chats/fires/main. Send a message 'hello'.
Wait for AI reply. Then refresh the page (Cmd+R), wait for reload, scroll to
bottom. Report: is the message 'hello' and AI reply still visible after refresh?
Answer PASS or FAIL with details."
```

## API

**Base URL:** `http://127.0.0.1:4821` (default — but multiple instances may run on `4821`-`4830`. ALWAYS run discovery first, see "Pre-flight Check" below.)

> **Why ports vary:** Each Chrome profile that has the extension loaded spawns its own native host process. The first host binds 4821, the second 4822, etc. Two profiles → two ports. The bridge panel inside each sidepanel UI also displays its current host port (so the user can verify which port belongs to which profile).

### POST /hook — Send a task

```bash
curl -s -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d '{"task": "...", "windowId": 420599606}'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | string | Yes | Complete test scenario in natural language |
| `windowId` | number | No | Target window. **Always pass when more than one sidepanel is registered** — without it, routing falls back to focused window and parallel tasks may collide. Get from `discover.mjs --json`. |
| `tabId` | number | No | Target tab (overrides windowId). chrome://newtab/ tabs are honored as explicit lock targets. |
| `conversationId` | string | No | Continue previous conversation context |
| `model` | string | No | Per-task model override: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001` |
| `apiUrl` | string | No | Per-task API base URL override (A/B test endpoints without touching sidepanel settings). NOT persisted. |
| `apiKey` | string | No | Per-task API key override. NOT persisted — sidepanel restores its own key after the task. Avoid sending empty string; only set when you want to override. |
| `include_tools` | boolean | No | Return full tool-call records for analysis |
| `include_screenshot` | boolean | No | Return final screenshot as base64 |

**Response:** `{ "status": "completed", "result": "...", "conversationId": "...", "tabId": 12345 }`

### GET /sessions — List browser windows

```bash
curl -s http://127.0.0.1:4821/sessions
```

### GET / — Health check

```bash
curl -s http://127.0.0.1:4821/
```

### POST /stop/:taskId — Stop a running task

```bash
curl -s -X POST http://127.0.0.1:4821/stop/task_xxx
```

## Available Tools (what the agent can do)

### Page Interaction (`computer` tool)

| Action | Description |
|--------|-------------|
| `screenshot` | Capture viewport (auto-optimized quality) |
| `left_click` | Click (by ref_ID or coordinates) |
| `right_click` / `double_click` / `triple_click` | Click variants |
| `type` | Type text |
| `key` | Keypress (supports cmd/ctrl/shift/alt combos) |
| `scroll` | Scroll (up/down/left/right) |
| `scroll_to` | Scroll element into view (by ref_ID) |
| `hover` | Hover over element |
| `left_click_drag` | Drag and drop |
| `wait` | Wait up to 10 seconds |
| `zoom` | Zoom into a region for inspection (2x) |

### Form Operations

| Tool | Description |
|------|-------------|
| `form_input` | Set a single form field value by ref_ID |
| `batch_form_input` | Set multiple form fields at once + optional click_after for submit. Much faster than repeated form_input calls |

### Page Reading

| Tool | Description |
|------|-------------|
| `read_page` | Get accessibility tree with ref_IDs (filter: interactive/all) |
| `find` | Natural language element search |
| `get_page_text` | Extract plain text content |

### Navigation & Tabs

| Tool | Description |
|------|-------------|
| `navigate` | Go to URL, or "back"/"forward" |
| `tabs_create` | Create new tab |
| `tabs_context` | List all open tabs |

### Device Emulation

| Tool | Description |
|------|-------------|
| `emulate_device` | Emulate mobile/tablet device or reset to desktop |
| `resize_window` | Resize browser window |

**Device presets:** iPhone 14, iPhone 14 Pro Max, iPhone SE, iPad, iPad Pro, Pixel 7, Galaxy S23, desktop (reset)

Emulation includes: viewport size, device pixel ratio, mobile User Agent, touch event support.

### Debugging

| Tool | Description |
|------|-------------|
| `read_console_messages` | Read console.log/error/warn |
| `read_network_requests` | Read XHR/Fetch network requests |
| `javascript_tool` | Execute JavaScript in page context (bypasses CSP) |

### Other

| Tool | Description |
|------|-------------|
| `file_upload` | Upload files to file input elements |

## Skill Modes

The agent supports different behavior modes (configurable in sidepanel toolbar):

| Mode | Behavior |
|------|----------|
| **General** | Default — autonomous problem solving, can debug and investigate |
| **QA Test** | Strict step execution, reports PASS/FAIL only, no investigation |
| **Scraper** | Data extraction focus, auto-pagination, resilient retry |
| **Custom** | User-defined behavior instructions |

## How to Write Test Tasks

### 1. Include the full scenario in one task

Write the complete test flow: setup -> action -> verification -> expected result format.

```
"Navigate to http://localhost:4026/chats/fires/main. Wait for messages to load.
Type 'test-message-123' in the input and press Enter. Wait 8 seconds for AI reply.
Then hard-refresh the page (Cmd+R). Wait for it to reload fully. If you see a
login page, click Get Started, login with test_all_apps / Test@2026, then navigate
back to the same chat URL.
Scroll to the bottom and check: is 'test-message-123' and the AI reply still visible?
Also check the browser console for any red errors.
Report as: PASS or FAIL, with details for each check."
```

### 2. Include login recovery in every test

The dev environment may lose auth on refresh. Always include this fallback:
```
"If you see a login/onboarding page at any point, click Get Started,
login with username test_all_apps and password Test@2026, wait for
redirect, then continue with the test."
```

### 3. Ask for structured results

End every task with a clear output format:
```
"Report results as:
- Test name: PASS/FAIL
- Details: what you observed
- Console errors: count and description"
```

### 4. Mobile device testing

Include device emulation in your test task:
```
"First, emulate iPhone 14. Then navigate to http://localhost:3002/
and verify the page is responsive — check that the navigation collapses
to a hamburger menu and content fits the mobile viewport.
Take a screenshot. Then reset to desktop mode.
Report: PASS or FAIL with screenshots."
```

### 5. Multi-window tests

For tests requiring two windows, send one task per window in **parallel** using `&`:

```bash
curl -s -X POST http://127.0.0.1:4821/hook \
  -d '{"task": "...", "windowId": WIN1}' &
curl -s -X POST http://127.0.0.1:4821/hook \
  -d '{"task": "...", "windowId": WIN2}' &
wait
```

## Pre-flight Check (REQUIRED)

**Before any test, run discovery to find all running instances.** Multiple Chrome profiles each get their own host on a different port (4821, 4822, ...). The discovery script tells you which port maps to which window/tab so you target the right one.

### Recommended: discover.mjs

The browser-agent project ships a discovery script at `~/Projects/clawline/browser-agent/perf/discover.mjs`. Always use the JSON form for programmatic targeting:

```bash
node ~/Projects/clawline/browser-agent/perf/discover.mjs --json
```

Returns:

```json
{
  "hosts": [
    {
      "port": 4821,
      "ok": true,
      "pid": 34095,
      "hostStartedAt": "2026-04-25T03:26:44.457Z",
      "chromeConnected": true,
      "pendingTasks": 0,
      "extensionName": "Clawline Browser Agent",
      "extensionVersion": "0.1.0",
      "windows": [
        {
          "windowId": 420611949,
          "focused": false,
          "tabCount": 2,
          "incognito": false,
          "activeTab": {
            "id": 420611846,
            "title": "Hacker News",
            "url": "https://news.ycombinator.com/"
          }
        }
      ]
    },
    { "port": 4822, ... }
  ]
}
```

### Picking the right host

When multiple hosts are running, choose by intent:

- **By URL**: pick the host whose `windows[].activeTab.url` matches the site under test
- **By window focus**: pick the host with `windows[].focused: true`
- **By extension version**: when running multiple branches in parallel, version disambiguates them
- **Explicit user request**: ask the user "which port?" and quote `windows[].activeTab.title` for each

### Fallback (no discover.mjs available)

If the project's discover script isn't on disk, fall back to a port scan:

```bash
for port in $(seq 4821 4830); do
  result=$(curl -s --connect-timeout 1 http://127.0.0.1:$port/ 2>/dev/null)
  if [ -n "$result" ]; then echo "Port $port: $result"; fi
done
```

`GET /` on each host returns the same `windows` array as discover.mjs.

### When no hosts are running

Exit code 1 from `discover.mjs` means nothing is reachable. Tell the user to:

1. Open Chrome (any profile that has the extension loaded)
2. Open the side panel (click the extension icon, or `Cmd+Shift+E` / `Ctrl+Shift+E`)
3. Verify the bridge panel inside the side panel shows `Hook Bridge: Connected` and `Host Port: 4821` (or similar)

The bridge panel inside the sidepanel is the source of truth for "this sidepanel is talking to which port".

## Test Account

- Username: `test_all_apps`
- Password: `Test@2026`
- Login URL: Logto at `logto.dr.restry.cn` (Chinese UI)

## Error Handling

| Error | Meaning |
|-------|---------|
| `"Agent is busy with another task"` | Wait for current task to finish |
| `"No sidepanel available"` | User needs to open Chrome sidepanel |
| `"No browser tab found"` | Window has no webpage tab |
| `"Tool X timed out after 60s"` | Tool execution hung — likely debugger detached |
| `"CDP timeout: Method"` | Chrome debugger command timed out (30s) |

## Concurrency Model

The architecture supports two layers of parallelism:

### 1. Multi-host parallelism (across Chrome profiles)

Each Chrome profile that has the extension loaded spawns its own native host on its own port. Tasks sent to **different ports run in fully independent processes** — no shared state, no contention. You can fan out tasks across hosts at full speed:

```bash
# 4821 and 4822 run completely independently
curl -s -X POST http://127.0.0.1:4821/hook -d '{"task":"test prod site"}' &
curl -s -X POST http://127.0.0.1:4822/hook -d '{"task":"test staging site"}' &
wait
```

Verified: two parallel tasks against two hosts complete with independent task counters and no interference.

### 2. Multi-sidepanel parallelism (within one host)

A single host can have multiple sidepanels registered — one per Chrome window. Each sidepanel maintains its own `isRunning` flag, conversation, locked tabId, and abort controller. Tasks routed to **different windows on the same host** run in parallel.

To target a specific sidepanel within a host, pass `windowId` (or `tabId`, which gets resolved to its parent window):

```bash
curl -s -X POST http://127.0.0.1:4821/hook \
  -d '{"task":"...","windowId":420611949}' &
curl -s -X POST http://127.0.0.1:4821/hook \
  -d '{"task":"...","windowId":420611950}' &
wait
```

### What does NOT run in parallel

- **Two tasks to the same windowId on the same host** — the second gets `"Agent is busy with another task"`. One sidepanel = one task at a time.
- **Targeting a host without specifying windowId** when multiple windows are registered: routing falls back to the focused window, so two such tasks may race for the same sidepanel.

**Rule of thumb**: always pass an explicit `windowId` (from `discover.mjs`) when a host has more than one window. The discovery output makes this trivial.

## Tips

- **Timeout**: Each task blocks up to 10 minutes
- **Always run discover.mjs first** — port may not be 4821 if other profiles are also running
- **The bridge panel inside each sidepanel UI shows its host port** — quickest way to confirm which port a sidepanel is talking to
- **The agent remembers context within a conversationId** — use it for multi-step flows that MUST share state
- **For independent tests, don't use conversationId** — each test should be self-contained
- **batch_form_input** — always prefer this over repeated form_input for filling forms (saves API roundtrips)
- **emulate_device** — use for responsive/mobile testing, reset with preset "desktop"
