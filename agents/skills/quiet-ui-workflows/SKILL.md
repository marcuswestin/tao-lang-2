---
name: quiet-ui-workflows
description: >-
  Preserve the Developer's focus during UI automation. Use before launching or controlling
  browsers, Studio, native apps, simulators, visual tests, or any computer-control session; also
  when choosing in-app, headless, hidden, background, or visible execution.
---

# Quiet UI Workflows

For driver selection, setup requirements, and the researched limits of each surface, consult
[interaction surfaces](references/interaction-surfaces.md) when those details are needed.

## Choose the surface

- Prefer the harness's in-app visual UI for interactive development review when it can perform the
  needed actions; showing content there does not require a separate desktop window. `browser-use`
  owns which browser. Use headless or hidden execution when it provides needed automation,
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

## Repository choices

Consult `./agent help` and the selected command's help for current arguments. These distinctions
matter when selecting a workflow:

| Need                               | Selection                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Run a development server           | Avoid target-opening options and interactive open shortcuts.                                                  |
| Start web Studio                   | Use its `--no-browser` option, then the in-app browser for interactive review.                                |
| Start native Studio                | Its `--no-browser` still opens the Welcome window; treat it as visible.                                       |
| Boot an iOS simulator              | Use `simulators boot`; `simulators run` and `simulators open` present an inactive viewer only when requested. |
| Verify browser behavior            | Existing headless verification lanes; `test-host` does not expose a `--headless` flag.                        |
| Inspect a build or install receipt | Keep it in the CLI; installation is not visual acceptance.                                                    |

Use the required named host workflow. A missing quiet operation is a tooling gap to report or fix
within the task's authority, never a reason to bypass its permission boundary with raw host tools.

## When a real window is necessary

- Before visible interaction, say which window must appear and which check requires it. Reuse
  existing authorization; do not add a confirmation round for an already authorized review.
- Reuse an existing automation-owned window or tab when possible. If a new one is required, choose
  a documented background or inactive launch option first, even when the window must be visible.
  Activate it only for a requested view or an interaction that genuinely needs keyboard focus.
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
