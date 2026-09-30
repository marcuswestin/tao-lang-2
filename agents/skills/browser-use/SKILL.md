---
name: browser-use
description: Choose the harness's in-app browser for interactive browsing, development review, and browser UI. Use an external interactive browser only when the Developer requests it. Repository-controlled headless development and verification runners use their configured Chrome.
---

# Browser Use

- Use the harness's in-app browser for interactive browsing and development review, as though the Developer had picked it for this request:
  1. Claude Code: the desktop app's built-in browser pane (`mcp__Claude_Browser__*` tools), the same as `@browser` being mentioned in every request. Not Claude in Chrome (`mcp__claude-in-chrome__*`), and not computer-use driving a browser app.
  2. Codex: the app's in-app browser, not a Chrome window.
  3. Any other harness: its built-in browser.
- Use Google Chrome (in Claude Code, Claude in Chrome) only when the Developer explicitly asks for Chrome, the Chrome extension, or their own browser. That request covers its task, not later ones.
- A page needing the Developer's signed-in session, a site the in-app browser cannot load, or an unavailable in-app browser is not permission to switch: say what blocked it and ask whether to use Chrome.
- Use Safari or another browser only when the Developer names it, such as to reproduce an engine-specific bug.
- Never open a URL through the operating system's default browser (`open <url>`), which may launch Safari or a new Chrome window.
- Repository-controlled headless development and verification runners use their configured Chrome; this does not select Chrome for interactive browsing. Inspect the served app URL in the in-app browser when appropriate. Its tab is a separate session from the runner's Chrome: attach a CDP-capable client to the printed DevTools URL to inspect that exact session. `quiet-ui-workflows` owns visibility. Reuse the task's tab where possible.
