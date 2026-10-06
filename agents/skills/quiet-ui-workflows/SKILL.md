---
name: quiet-ui-workflows
description: >-
  Preserve the Developer's focus during UI automation and choose the browser. Use before
  launching or controlling browsers, Studio, native apps, simulators, visual tests, or any
  computer-control session, and before interactive browsing or development review; also when
  choosing which browser, in-app, headless, hidden, background, or visible execution, or
  managing a development loop's lifetime.
---

# Quiet UI Workflows

For driver selection, setup requirements, and the researched limits of each surface, consult
[interaction surfaces](references/interaction-surfaces.md) when those details are needed.

## Choose the surface

- Prefer the harness's in-app visual UI for interactive development review when it can perform the
  needed actions; showing content there does not require a separate desktop window. **Which
  browser**, below, owns the browser choice. Use headless or hidden execution when it provides needed automation,
  isolation, or repeatability, or when the in-app UI cannot operate the target. Bring screenshots
  into the agent app for visual inspection when the tool supports it.
- Starting a server or producing an app alone does not call for opening its UI. When visual review
  is part of the task, use an in-app view or artifact before opening a separate desktop window.
- For browser checks, use the in-app browser for interactive inspection or the repository's
  headless runner for repeatable automation. Read the tool's API before selecting visibility.
- For simulators, distinguish booting the device from opening its desktop viewer. Use the named
  CLI-only operation when sufficient. Booting without a viewer does not establish that a complete
  native driver journey stays invisible, especially when a viewer is already open.
- For parallel agent dev loops, use `./agent unsandboxed app-dev ... --ios`: it reserves one
  shut-down iPhone per run, reuses existing devices before creating one, and shuts down only a
  device that run booted automatically.
  Add `--show-simulator` only when the Developer requests a viewer. Use `--simulator <udid>` only
  when a specific device is needed; the command reserves it and leaves that device running.
- Use `./agent unsandboxed app-dev ... --android` for an agent Android dev loop: it reserves a
  reusable AVD, opens no emulator window, and stops only its own emulator. Add `--show-emulator`
  only for a requested window, or `--emulator <serial>` for a specific already-booted device.
- Agent web dev loops use isolated headless Google Chrome and print a DevTools URL. A CDP-capable
  client must attach to that instance before it can click or capture screenshots. Add
  `--show-browser` only when the Developer requests a visible Chrome window.
- For native Mac apps, background launch, hidden application, minimized window, and headless
  execution are different. Background launch may still create a visible window. Computer-control
  tools may activate or restore it. Do not promise hidden testing without observing that behavior.

## Which browser

- Use the harness's in-app browser for interactive browsing and development review, as though the
  Developer had picked it for this request: in Claude Code, the desktop app's built-in browser pane
  (`mcp__Claude_Browser__*`), not Claude in Chrome (`mcp__claude-in-chrome__*`) or computer-use
  driving a browser app; in Codex, the app's in-app browser, not a Chrome window; in any other
  harness, its built-in browser.
- Use Google Chrome (in Claude Code, Claude in Chrome) only when the Developer explicitly asks for
  Chrome, the Chrome extension, or their own browser; the request covers its task, not later ones.
  Use Safari or another browser only when the Developer names it.
- A page needing the Developer's signed-in session, a site the in-app browser cannot load, or an
  unavailable in-app browser is not permission to switch: say what blocked it and ask whether to
  use Chrome. Never open a URL through the operating system's default browser (`open <url>`).
- Repository headless runners keep their configured Chrome; that does not select Chrome for
  interactive browsing. Their tab and the in-app browser are separate sessions: attach a
  CDP-capable client to the printed DevTools URL to inspect the runner's own. Reuse the task's tab
  where possible.

## Managed development loops

- Use `./agent unsandboxed dev-loop start ...` for a background app loop. Inspect its recorded
  session with `status` and `logs`, and use `stop`, `restart`, or `reload` with `--session <id>`.
  `app-dev` remains the foreground workflow; consult command help for the supported targets.
- Decide when keeping a loop running helps the assigned work and when stopping it frees useful
  resources. There is no default runtime timer. Stop sessions no longer useful to the task and
  confirm cleanup; identify sessions left running and their exact stop commands at handoff.
- A start receipt proves the controller exists. Wait for `status` to report readiness before
  interacting; target dispatch still needs a behavior or screenshot check to prove its UI.
- Restart preserves the recorded app, targets, and visibility choices. Pause or revocation of
  visible-UI permission requires stopping the affected session before another visible launch.
- Refused or incomplete cleanup is unresolved ownership. Preserve its receipt and retained
  resources, use the supported recovery operation, and report uncertain ownership explicitly.

## Repository choices

Consult `./agent help` and the selected command's help for current arguments. These distinctions
matter when selecting a workflow:

| Need                               | Selection                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Run a development server           | Avoid target-opening options and interactive open shortcuts.                                                  |
| Start web Studio                   | Use its `--no-browser` option, then the in-app browser for interactive review.                                |
| Start native Studio                | Electrobun opens the Welcome window; `--no-browser` does not hide it. Treat development launches as visible.  |
| Run quiet native probes            | The native canary keeps windows hidden; run it without a visibility flag.                                     |
| Run visible native checks          | Host-control, Mac2, and manual checks require authorized `--show-studio`; otherwise defer before launch.      |
| Boot an iOS simulator              | Use `simulators boot`; `simulators run` and `simulators open` present an inactive viewer only when requested. |
| Verify browser behavior            | Existing headless verification lanes; `test-host` does not expose a `--headless` flag.                        |
| Inspect a build or install receipt | Keep it in the CLI; installation is not visual acceptance.                                                    |

Use the required named host workflow. A missing quiet operation is a tooling gap to report or fix
within the task's authority, never a reason to bypass its permission boundary with raw host tools.

## When a real window is necessary

- Before a separate desktop window appears or an interaction takes focus, obtain the Developer's
  authorization once for that scope in this thread. Name the window, the check, and any required
  focus. An explicit request to show that UI authorizes its scope; reuse that authorization for
  scoped launches, interactions, and retries without asking again.
- Authorization lasts until the Developer revokes or pauses it. New surfaces or checks outside its
  scope need their own authorization. After revocation or pause, continue quiet independent work
  and report the exact visible acceptance still deferred.
- Before an authorized visible interaction, give a brief heads-up naming the window and check.
- Reuse an existing automation-owned window or tab when possible. If a new one is required, choose
  a documented background or inactive launch option first, even when the window must be visible.
  Activate it only for a requested view or an interaction that genuinely needs keyboard focus.
- Keep the window in normal windowed mode. Do not enter fullscreen, maximize across a display,
  switch workspaces, or change the Developer's window-manager settings for convenience. Exercise
  those modes only when explicitly requested for the current check, and restore the prior state.
- Native menus, window sizing, gestures, keyboard focus, and physical-device acceptance require
  their actual surface. When authorization or tools are unavailable, finish quiet independent work
  and record the precise outstanding review.
- Minimize/Hide is not a reliable isolation strategy under a window manager that reverses it.
  AeroSpace's `automatically-unhide-macos-hidden-apps` affects application hiding; it does not make
  a headless process visible. Leave host configuration unchanged unless its change is authorized.
- Never minimize, hide, close, or rearrange unrelated user windows. Restore only task-owned UI
  state, and do not loop against the window manager if it brings a window back.
