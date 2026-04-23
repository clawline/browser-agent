# Clawline Browser Agent

Chrome extension — AI browser automation via Claude. Supports manual use (side panel) and programmatic control (HTTP Hook API).

## Install

### 1. Load Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this directory
4. Copy the Extension ID

### 2. Install Native Messaging Host

**macOS/Linux:**
```bash
cd native-host
npm install  # if needed
./install.sh <EXTENSION_ID>
```

**Windows:**
```cmd
cd native-host
npm install
install.bat <EXTENSION_ID>
```

### 3. Verify

- Click the extension icon or press `Cmd+Shift+E` to open the side panel
- Health check: `curl http://127.0.0.1:4821/`

## Usage

### Side Panel (Manual)

Open with `Cmd+Shift+E` (Mac) / `Ctrl+Shift+E` (Win/Linux). Type tasks in natural language — the agent screenshots, reads the page, clicks, fills forms, etc.

### Hook API (Programmatic)

External agents (Hermes, Claude Code, scripts) control the browser via HTTP. See [docs/HOOK_API.md](docs/HOOK_API.md) for the full API reference.

Quick example:

```bash
# Send a task
curl -X POST http://127.0.0.1:4821/hook \
  -H 'Content-Type: application/json' \
  -d '{"task": "Navigate to github.com and take a screenshot", "include_screenshot": true}'
```

## Structure

```
├── manifest.json          # Chrome extension manifest (MV3)
├── service-worker.js      # Background: debugger, tab management, API routing
├── sidepanel.{js,html,css}# Side panel UI
├── content-script.js      # Accessibility tree generator (injected)
├── native-host/           # Native Messaging Host + HTTP server
│   ├── index.js           # Hook API server (port 4821)
│   ├── install.sh         # macOS/Linux installer
│   ├── install.bat        # Windows installer
│   ├── launcher.sh        # Node.js launcher (macOS/Linux)
│   └── launcher.bat       # Node.js launcher (Windows)
└── docs/
    └── HOOK_API.md        # Hook API reference for code agents
```

## Requirements

- Chrome 120+
- Node.js 18+
- Anthropic API key (set in side panel settings)
