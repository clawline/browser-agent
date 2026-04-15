# Why Clawline Browser Agent

Code agents (Hermes, Claude Code, Cursor, etc.) write and reason about code — but they're blind to the browser. They can't see the rendered UI, click a button, or verify a visual bug.

**Clawline bridges this gap.** One HTTP call gives any code agent eyes and hands inside a real Chrome browser.

## Technical Architecture

Clawline is built on three Chrome-native technologies that eliminate the overhead of traditional browser automation:

- **Chrome Debugger Protocol** — direct access to page rendering, DOM, and input injection. No WebDriver layer, no browser process spawning. This is the same protocol Chrome DevTools uses internally.
- **Chrome Native Messaging** — binary IPC (4-byte LE length-prefixed JSON over stdin/stdout) between the extension and a local Node.js host. Zero network overhead — no WebSocket, no HTTP polling.
- **Accessibility Tree extraction** — a custom content script generates a structured representation of page elements with ref IDs, giving the AI agent semantic understanding of the page without parsing raw HTML.

The HTTP Hook API (`localhost:4821`) is the only network boundary. Everything else is in-process or IPC.

## Why It's Fast

Traditional browser automation (Playwright, Selenium, cloud APIs) adds layers:

```
Your Agent → HTTP → Cloud/Local Server → WebDriver → Browser Process → Page
```

Clawline's path is shorter:

```
Your Agent → HTTP → Native Host (IPC) → Extension → Page
```

Key performance advantages:

| Factor | Traditional | Clawline |
|--------|-------------|----------|
| Browser launch | Cold start (1-3s) | Already running (0ms) |
| Page interaction | WebDriver protocol round-trips | Direct Debugger Protocol (in-process) |
| Screenshots | Pixel capture → encode → transfer | `chrome.debugger` capture (native, ~50ms) |
| Network hops | Agent → server → browser | Agent → localhost IPC only |
| Auth/cookies | Requires manual setup or injection | Uses your real browser session |

No browser process to spawn. No headless environment to configure. No proxy to route through. The extension lives inside Chrome — it's already there when you need it.

## What This Enables

- **Verify frontend changes** — code agent writes CSS, asks Clawline "does the button look right?"
- **E2E testing in natural language** — "log in, go to settings, toggle dark mode, screenshot"
- **Debug visual issues** — "what does the error page show?" instead of guessing from HTML
- **Browser automation** — form filling, data extraction, multi-step navigation
- **Real-session QA** — tests run in your actual browser with your cookies, extensions, and auth state

## vs. Alternatives

| | Playwright/Puppeteer | Cloud APIs (Browserbase) | Clawline |
|---|---|---|---|
| Latency | Medium (WebDriver) | High (network) | **Low (IPC)** |
| Setup | Install browser binary | API key + cloud dependency | **Load extension** |
| Auth state | Manual cookie injection | Separate login flow | **Your real session** |
| Screenshots | Headless render | Cloud render + transfer | **Native capture** |
| Data privacy | Local | Cloud | **Local** |
| Dependencies | Node + browser binary | Network + API | **Chrome only** |

## One-liner

> Clawline turns any code agent into a full-stack agent that can see and interact with the browser — at native speed.
