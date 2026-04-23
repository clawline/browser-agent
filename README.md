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
- Check the "Bridge" indicator in the side panel (should show "Bridge" when connected)

## Troubleshooting

### Connection Issues (Bridge Disconnected)

If you see repeated "Bridge disconnected/connected" messages:

1. **Check Native Host Logs:**
   - Windows: Run `native-host\view-logs.bat`
   - macOS/Linux: Run `./native-host/view-logs.sh` or `tail -f native-host/error.log`

2. **Check Chrome DevTools:**
   - Service Worker: `chrome://serviceworker-internals/` → Find "Clawline Browser Agent" → Click "Inspect"
   - Check console for connection errors and reconnection attempts

3. **Verify Installation:**
   - Ensure the native host manifest is installed correctly
   - Windows: Check `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\com.clawline.agent.json`
   - macOS: Check `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.clawline.agent.json`
   - Linux: Check `~/.config/google-chrome/NativeMessagingHosts/com.clawline.agent.json`

4. **Connection Recovery:**
   - The extension automatically attempts to reconnect with exponential backoff
   - The native host logs all connection events to stderr and error.log
   - A heartbeat mechanism monitors connection health every 10 seconds

### No Logs Visible

The native host logs to:
- **stderr**: Visible in Chrome's native messaging output (if available)
- **error.log**: Persistent file in the `native-host/` directory (max 5MB, auto-rotates)

To view logs:
- Use the provided log viewer scripts (`view-logs.bat` or `view-logs.sh`)
- Or directly view: `native-host/error.log`

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
│   ├── launcher.bat       # Node.js launcher (Windows)
│   ├── view-logs.sh       # Log viewer (macOS/Linux)
│   └── view-logs.bat      # Log viewer (Windows)
└── docs/
    └── HOOK_API.md        # Hook API reference for code agents
```

## Requirements

- Chrome 120+
- Node.js 18+
- Anthropic API key (set in side panel settings)
