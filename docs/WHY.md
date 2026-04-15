# Why Clawline Browser Agent

Code agents (Hermes, Claude Code, Cursor, etc.) are powerful at writing and reasoning about code — but blind to the browser. They can't see what the UI actually looks like, can't click a button, can't verify a visual bug.

**Clawline bridges this gap.**

It gives any code agent a pair of eyes and hands inside a real Chrome browser — via a single HTTP call. No Puppeteer, no Playwright, no headless browser setup. Just `POST /hook` with a natural language task, and a Claude-powered agent screenshots, reads, clicks, fills forms, and reports back.

## What This Enables

- **Verify your frontend changes** — code agent writes CSS, then asks Clawline "does the button look right?"
- **End-to-end testing in natural language** — "log in, navigate to settings, toggle dark mode, take a screenshot"
- **Debug visual issues** — "what does the error page show?" instead of guessing from HTML
- **Automate repetitive browser workflows** — form filling, data extraction, multi-step navigation
- **Human-in-the-loop QA** — agent tests in your real browser with your real cookies and auth state

## Key Differentiators

| vs. Headless browsers (Playwright/Puppeteer) | vs. Cloud browser APIs (Browserbase) |
|---|---|
| Runs in your real browser — same cookies, extensions, auth | No cloud dependency, no API keys (besides Anthropic) |
| No infrastructure to set up or maintain | Zero latency — localhost only |
| Natural language tasks, not CSS selectors | Your data never leaves your machine |
| Sees the page as a human does (screenshots + accessibility tree) | Works offline after setup |

## One-liner

> Clawline turns any code agent into a full-stack agent that can see and interact with the browser.
