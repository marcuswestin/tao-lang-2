# Interaction surfaces and quiet development review

Researched and cross-checked against Tao on 2026-09-30. This reference explains capabilities and
evidence boundaries; the parent skill owns visibility policy and browser choice.
Consult live command help and tool documentation for arguments rather than copying host commands
from vendor examples around Tao's named permission boundary.

## Skill discovery

Codex sees a skill's name and description first, then loads its body when the request matches or
the user invokes it. Claude Code similarly uses descriptions for automatic selection, with the
body loaded on invocation. This is model selection, not a guaranteed hook before every window
opens. This skill's YAML description owns its before-launch and computer-control activation
conditions; the root guide only points to the owner. The Developer need not repeat its name in
each request, but discovery still depends on the harness exposing and selecting the skill.
[OpenAI skills](https://developers.openai.com/plugins/concepts/skills),
[Claude Code skills](https://code.claude.com/docs/en/skills).

Avoid adding the same launch policy to every testing skill or stacking all reference documents
into every task. A short root router, one visibility owner, and a distinct browser-choice owner
make the instruction easier to follow. OpenAI's current guidance specifically calls out ambiguous
triggers, overlapping skills, and oversized instruction sets as causes of misrouting.
[Skills and prompts](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra).

## Browsers

Interactive development review belongs in the harness's in-app browser when its available tool
can perform the needed actions. Read that tool's documentation first; its capabilities are not
implied by the presence of a browser pane. A localhost page can be inspected there while the
repository runs the server independently. Reuse the task-owned tab. Do not use the Developer's
signed-in tab or launch the OS default browser as a fallback.

For repeatable Chrome-specific automation, use the repository's owned headless runner. Modern
Chrome headless uses Chrome's browser implementation without displaying its windows; it supports
screenshots and remote debugging. An isolated user-data directory keeps state separate from the
Developer's browser, and port zero chooses an available debug port.
[Chrome headless](https://developer.chrome.com/docs/automation-and-testing/headless),
[headless debugging](https://developer.chrome.com/docs/automation-and-testing/debug-headless).

`app-dev --web` prints two different addresses: the app URL and the Chrome DevTools endpoint.
Opening the app URL in the in-app browser creates a separate browser session. To click or capture
the exact headless Chrome session, a compatible client must attach to its DevTools endpoint.
The printed endpoint alone does not connect Codex or Claude browser tools. Existing
`StudioCdp.attach()` provides a repository CDP client for owned sessions; it does not automatically
install a harness tool. Playwright can also connect over CDP, but its documentation warns that this
has lower fidelity than its own protocol and some advanced behavior depends on launch arguments.
[Playwright CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).

Requirements: installed Google Chrome or the documented executable override; a local dev server;
loopback HTTP/WebSocket connectivity; and a CDP-capable client for that session. Use a bounded
connection timeout. Keep the debug endpoint local. Normal exit and failed startup must stop the
owned process before deleting its profile. Disconnecting a borrowed CDP client must not terminate
the browser it borrowed. A visible Chrome window is requested with `--show-browser`; that flag
does not guarantee a minimized window, separate Dock icon, or preserved focus.

Tao sources: `AgentChrome.ts`, `run-targets.ts`, and `StudioCdp.ts`. Chrome launch/exit was observed
in the earlier host smoke; attaching, clicking, and screenshot capture through this new dev-loop
endpoint still need an end-to-end check. Existing Studio smoke evidence is a different session.

## iOS simulators

Use a leased device per concurrent mutation session; reuse it for subsequent work in that session.
Two agents installing apps, navigating, or resetting state on one device can interfere even when
their source checkouts differ. Keep explicitly borrowed Developer devices running. Shut down only
an automatically selected device that the current loop booted.

Apple documents `simctl` for boot, shutdown, install, launch, screenshots, and cloning. Its guidance
also shows an already-open Simulator app automatically attaching to a newly booted device. Thus
booting through a CLI without opening a viewer is useful, but does not prove that an existing
viewer remains unchanged. Apple's reference is from 2019; the installed Xcode command's help is
the authority for current syntax. Do not infer an invisible touch-automation driver from these
lifecycle commands.
[Apple Simulator automation](https://developer.apple.com/videos/play/wwdc2019/418/).

Tao's `app-dev --ios` owns selection and lifecycle; `--show-simulator` requests inactive viewer
presentation. The existing named simulator operations cover lifecycle and installation. They do
not currently offer a general screenshot/touch workflow in agent help. Use the implemented Tao
native journey driver for behavior it covers, and distinguish app-semantic interactions from real
native gestures, keyboard focus, and accessibility acceptance.

Requirements: selected Xcode, an available compatible runtime, a usable CoreSimulator service,
and the named host operation. Existing viewer behavior and native driver focus need separate host
evidence. No new macOS permission grants or simulator cleanup were performed in this audit.

## Android emulators

Android officially documents `-no-window`: the emulator remains controllable through ADB and its
console. ADB supports installation, activity launch, screenshots, and explicit device selection
with `-s <serial>`. Target the leased serial on every command; an unqualified ADB command is unsafe
for parallel sessions. Screenshots can be displayed in the agent app without showing the emulator.
[Android emulator](https://developer.android.com/studio/run/emulator-commandline),
[ADB](https://developer.android.com/tools/adb).

Tao's `app-dev --android` leases one of four reusable AVD slots and starts it without a window or
audio. `--show-emulator` requests a viewer; `--emulator <serial>` borrows an already-running device.
The worktree profile sets both `ANDROID_USER_HOME` and `ANDROID_AVD_HOME`, so creation and launch
look in the same location. Normal cleanup targets only the owned emulator. Retaining shut-down
AVDs avoids repeatedly creating devices; their disk state persists, so journeys must establish
their required app state rather than assume a clean install.

Requirements: SDK platform tools and emulator, compatible system image, available hardware
virtualization, writable AVD directory, and the named host operation. Physical devices may require
the user's USB-debugging consent. Tao's named Android help currently exposes diagnostics and boot,
not a general screenshot/input operation. Do not bypass it with raw host commands.

Earlier smoke evidence reached Android boot completion, but the tool connection failed before
complete app-dev startup and teardown could be observed. Stale lease records are not proof that
an emulator is still alive. Full launch, screenshot/input, parallel isolation, and owned teardown
remain host acceptance checks.

## Native desktop apps

Ordinary native Tao Studio development launches use Electrobun and open the Welcome window;
`--no-browser` does not hide it. Native canary and simulated-user probes explicitly request hidden
windows and run without a visibility flag. `StudioElectrobunAppSource.ts` implements that probe
mode with `hidden: forceHidden || !showWindows`; it is separate from the visible development
default. Host-control, Mac2, and manual checks require `--show-studio` and otherwise defer before
launch. The parent skill owns scoped authorization for windows and focus. The semantic host driver
and external Appium Mac2 driver prove different things; Mac2 can activate the application and
deliver physical input. Use the existing machine-wide desktop lease for those checks.

Requirements: prepared Electrobun app and Hutch environment, plus Xcode/XCTest, the installed
Mac2 driver, Xcode Helper Accessibility permission, and native automation consent for the external
lane. Driver installation and
TCC grants are separate from repository command allowlists; never silently grant or bypass them.
[Appium Mac2 requirements](https://appium.github.io/appium-mac2-driver/latest/getting-started/).

Electron documentation offers `BrowserWindow({show:false})` and `showInactive()`; Playwright's
Electron API can automate and screenshot Electron windows. Those capabilities are not evidence
that Electrobun supports the same options. Even a hidden native window can throttle rendering or
be activated by a driver; a web preview cannot prove native menus, focus, or window behavior.
[Electron windows](https://www.electronjs.org/docs/latest/api/browser-window),
[Playwright Electron](https://playwright.dev/docs/api/class-electron).

The exact named native smoke examples are discoverable in `./agent help`. They cover simulated
user behavior, semantic host control, and external accessibility/physical input separately.
Hidden probe configuration is source evidence; it does not establish that every native driver
journey preserves focus. No native app was launched during this audit.

## Repository cross-check

| Finding                                                                      | Resolution or remaining evidence                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quiet UI activation was duplicated in the root guide                         | Made the YAML description the activation owner; kept only a root ownership pointer.                                                                                                                                       |
| Quiet skill's hidden-first wording conflicted with in-app browser preference | In-app review now comes first; headless execution remains for needed automation, isolation, and repeatability.                                                                                                            |
| Browser skill exempted verification but left headless dev loops ambiguous    | Explicitly exempted repository-controlled headless development runners and explained the two sessions.                                                                                                                    |
| Help implied a DevTools endpoint alone provided automation                   | Help now requires a CDP client and identifies the separate in-app app URL.                                                                                                                                                |
| Chrome failed-start cleanup lacked normal shutdown escalation                | Shared one bounded termination/profile cleanup path for startup failure and normal exit.                                                                                                                                  |
| Native proof lanes existed but were hard to discover                         | Added exact named smoke examples and the visible/native consent boundary to help.                                                                                                                                         |
| Agent role/default configuration named an older Sol release                  | Selection policy now uses newest available GPT-6 Sol; concrete canonical defaults refreshed to the current catalog ID. Generated defaults now match canonical sources; configuration freshness and generation tests pass. |
| Simulator screenshot/input discoverability and full lifecycle proof          | Remain follow-up work; boot/install success is not UI acceptance.                                                                                                                                                         |

`.rulesync/permissions.jsonc` already admits named app-dev, Studio smoke, simulator lifecycle, and
Android diagnostics/boot operations. This pass adds no host-operation name, network exception,
dependency, or native permission grant. Installed harness browser tools and native automation
consent cannot be established by a repository configuration file alone. Earlier setup attempts
reported protected Codex outputs unwritable. The current generated defaults subsequently matched
their canonical sources, and configuration freshness and generation tests passed; those checks
establish repository configuration consistency, not host UI permissions.
