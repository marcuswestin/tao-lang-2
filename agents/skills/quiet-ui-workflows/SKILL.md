---
name: quiet-ui-workflows
description: >-
  Keep the Developer's desktop undisturbed when launching or controlling browsers, Studio,
  native apps, simulators, or visual tests. Use before any UI launch or computer-control
  session, and when choosing hidden, headless, in-app, background, or visible execution.
---

# Quiet UI Workflows

## Choose the surface

- Always use an available hidden or headless path when it can establish the required behavior.
  Prefer a harness-provided in-app browser to an external browser, with its visibility disabled
  where supported. Use connectors and non-UI tooling when they provide the needed evidence.
- Starting a server or producing an app does not call for opening its UI. Leave a review artifact
  and its launch instructions; present it when the Developer requests review.
- For browser automation, use the repository's existing headless runner or the available in-app
  browser. Read the tool's current API before selecting visibility; never invent a launch flag.
- For simulators, distinguish booting the device from opening its desktop viewer. Use the named
  CLI-only operation when sufficient. Booting without a viewer does not establish that a complete
  native driver journey stays invisible, especially when a viewer is already open.
- For native Mac apps, background launch, hidden application, minimized window, and headless
  execution are different. Background launch may still create a visible window. Computer-control
  tools may activate or restore it. Do not promise hidden testing without observing that behavior.

## Repository choices

Consult `./agent help` and the selected command's help for current arguments. These distinctions
matter when selecting a workflow:

| Need                               | Selection                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Run a development server           | Avoid target-opening options and interactive open shortcuts.                                                    |
| Start web Studio                   | Use its `--no-browser` option, then a hidden browser if needed.                                                 |
| Start native Studio                | Its `--no-browser` still opens the Welcome window; treat it as visible.                                         |
| Boot an iOS simulator              | Use `simulators boot`; `simulators run` also presents its viewer, and `simulators open` explicitly presents it. |
| Verify browser behavior            | Existing headless verification lanes; `test-host` does not expose a `--headless` flag.                          |
| Inspect a build or install receipt | Keep it in the CLI; installation is not visual acceptance.                                                      |

Use the required named host workflow. A missing quiet operation is a tooling gap to report or fix
within the task's authority, never a reason to bypass its permission boundary with raw host tools.

## When a real window is necessary

- Before visible interaction, say which window must appear and which check requires it. Reuse
  existing authorization; do not add a confirmation round for an already authorized review.
- Keep the window in normal windowed mode. Do not enter fullscreen, maximize across a display,
  switch workspaces, or change the Developer's window-manager settings for convenience. Exercise
  those modes only when explicitly requested for the current check, and restore the prior state.
- Do not substitute a web preview for native menus, window sizing, gestures, keyboard focus, or
  physical-device acceptance. Give the heads-up above and proceed under existing authorization
  when those checks need a real window. If current instructions or available tools prevent visible
  interaction, finish independent work and record the precise outstanding review.
- Minimize/Hide is not a reliable isolation strategy under a window manager that reverses it.
  AeroSpace's `automatically-unhide-macos-hidden-apps` affects application hiding; it does not make
  a headless process visible. Leave host configuration unchanged unless its change is authorized.
- Never minimize, hide, close, or rearrange unrelated user windows. Restore only task-owned UI
  state, and do not loop against the window manager if it brings a window back.
