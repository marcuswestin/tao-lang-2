# Tao now: a two-week walkthrough

This is a linear tour of the user-visible work landed from 2026-08-23 through 2026-09-06. It is
for an experienced developer who already has this repository checked out. **Verified** means the
step was exercised in Studio or a running Tao app while this guide was written; **not verified here**
means the implementation and tests exist, but this host lacked the required service, credential,
device, or browser capability.

## What landed

- **A usable Studio workbench:** project/app sessions, Design/Code/Run/Draw layouts, semantic source
  lenses, scenario cells, Problems/Tests/Data/Logs/Compile drawers, element selection, focused-view
  editing, an inspector, and isolated per-project state.
- **Visual authoring and review:** draw rough views on a freehand canvas, snap them into Tao layout,
  edit the resulting structure, and capture authored scenarios into a local `tao review` bundle for
  comparison and annotation.
- **An agent and a real-device canvas:** Studio can discuss the project or a scenario, propose edits,
  and share its Metro session with a paired Tao Companion on an iPhone, iPad, or iOS Simulator.
- **More complete apps:** HTTP-backed HNReader, focused-writing sessions in WordFlower, native control
  and device kits, native navigation chrome/restoration, and keyboard-first command discovery.
- **A broader data boundary:** provider-neutral connections now cover InstantDB, a machine-local Dev
  datasource, whole-snapshot iCloud storage, and granular CloudKit records.
- **A developer-to-release path:** `tao create`, local visual review, Studio beta shipping, App Store
  dry runs/releases, over-the-air updates and rollback, plus substantially stronger verification and
  diagnostic automation.

Several commits in the period were plans, internal simplifications, or verification infrastructure;
they are useful groundwork but are not presented below as already usable product behavior.

## 1. Prepare the checkout

From the repository root:

```sh
./agent setup
./agent doctor
```

In a fresh linked worktree, setup can currently leave the generated parser absent. If the first
`./dev` or `./tao` command reports `Cannot find module './_gen_tao-parser/module'`, run:

```sh
just _parser-gen
```

## 2. Learn the Studio workbench — verified

Start with the deterministic HNReader variant so that the tour does not depend on the network:

```sh
./dev studio Apps/HNReader --app HNReaderStub
```

![Annotated overview of the Tao Studio workbench](<Images/Tao Studio overview.png>)

1. Use the **Project** and **app** selectors at the top to change the open project or app variant.
2. Use the left rail for **Files**, **Components**, **Screens**, **Design tokens**, **Data**,
   **Search**, and **Agent**. Components exposes both native primitives and project views; Data shows
   the selected scenario's tables and can capture a fixture from a live cell.
3. In the source pane, switch among **All**, **Compose**, **Style**, **Trace**, **Data**, and
   **Outline**, then narrow further with the Structure/Layout/Behavior/Data/Wiring/Tests/Comments
   facets. These are semantic lenses over the same Tao source, not generated copies.
4. Select the `devices` or `rows` scenario above the canvas. Open **Problems**, **Tests**, **Data**,
   **Logs**, or **Compile** in the bottom drawer when a cell or compile behaves unexpectedly.
5. Leave **Mode: Edit** enabled and click a rendered story. Studio outlines the owning element and
   offers **Focus StoryRow**; use it to edit that view in isolation, then **Back to app**. Switch to
   **Mode: Run** when clicks should go to the app rather than select source.
6. Widen the Studio window beyond 1400 px to reveal the right inspector. Its sections can set text or
   bindings, change layout/style/data/action properties, wrap the selection in Row/Col/Stack, or
   remove it. Make source-changing edits only in a scratch project or disposable branch; use
   **Undo visual edit** to reverse the last one.
7. Use **Design**, **Code**, **Run**, and **Draw** as workspace presets. Run hides authoring chrome
   and the drawing canvas so only the live preview remains; Draw shows an empty canvas; Design
   restores the full workbench.

The element-selection, focused-view, data-panel, scenario, layout, and Device-popover paths above
were exercised. Freehand drawing lives on the Draw tab: in a scratch project, open **Draw**, drag
empty canvas space to create a view, draw rectangles inside it, then use **Snap**, **Toggle
direction**, **Insert separator**, and the spacer-ratio control to turn the sketch into Tao structure.

## 3. Run the app outside Studio — verified

```sh
./tao dev Apps/HNReader --app HNReaderStub
```

Press `w` in the dev loop to open web. In the app:

- Press `/` to see the shortcuts allocated to the currently active region.
- Press `Command-K` on macOS (`primary+k` in Tao source) for the command palette; use arrows and
  Enter to activate a command.
- Press Escape to unwind the active interaction layer. From the overview, press the displayed app
  key to return.

The stub rendered its two fixture stories and both keyboard overlays. To exercise the new
query-driven HTTP datasource, switch to `HNReader` with `s` in the dev loop or relaunch with
`--app HNReader`; its Studio canvas loaded live Algolia stories during this pass.

## 4. Exercise the new app features

### Focused writing — verified

```sh
./tao dev "Apps/WordFlower/1 - Current" --app WordFlower
```

Create or open a workspace and document, choose **Focus for 5 min** or **Focus for 25 min**, navigate
away and back, then pause, resume, or stop the persistent focus bar. The session is stored as local
data, survives relaunch, and resumes from the remaining duration rather than charging paused time.
This pass verified the bar across navigation, confirmed that pause freezes the countdown, and
restarted the app to confirm that an active session returns with elapsed time accounted for.

For the synced variant, run `just start-local-instantdb`, launch `WordFlowerInstantDB` as documented
in `Apps/WordFlower/README.md`, and finish with `just stop-local-instantdb`.

### Native controls, device APIs, and navigation — verified representative paths

Run each command, press `i` in its dev loop, and quit with `q` before starting the next:

```sh
./tao dev "Apps/Test Apps/Native Components" --app NativeComponents
./tao dev "Apps/Test Apps/Device Kit" --app DeviceKit
./tao dev "Apps/Test Apps/Navigation" --app NavigationMVPApp
```

The first app covers button, switch, slider, picker, segmented control, date picker, and spinner.
The second covers haptics, clipboard read/write, and sharing. The third covers typed destinations,
dialogues, back behavior, full-bleed/chromeless screens, and restoration. On an iPhone 17 Simulator,
this pass changed button and switch state, invoked the haptic action, round-tripped clipboard text,
and exercised a typed detail destination, its dialogue, native back, and a full-bleed destination.
The remaining controls rendered, but their individual interactions, the share sheet, chromeless
navigation, and restoration were not all exercised.

### Dev, iCloud, and CloudKit data — code/test-backed; not UI-verified here

`Datasource Dev { }` synchronizes development builds through the machine running Studio or
`tao dev`, persisting under `.artifacts/user/dev-data/`; it is intentionally rejected by
`tao ship`. `ICloud` stores full snapshots in the user's private iCloud container, while `CloudKit`
maps rows to records for granular writes and queries. There is not yet a small showcase app for
these providers, and native entitlement-backed behavior was not exercised here; use
`Docs/Spec/Tao Data.md` as the configuration contract.

## 5. Pair a Studio canvas or use the Studio agent

Install the companion once, then run Studio normally:

```sh
just studio-companion-simulator simulator="iPhone 17"
# or: just studio-companion-install device="roPhone"
```

Open **Device** in Studio, choose **Open** (or copy/show its URL), then **Pair a device**. Confirm only
when the same six-digit code appears on both sides; later launches reconnect from stored trust. The
simulator installation, matching code, trust, connected status, applied revision, fixture rendering,
and live scenario switching were all verified. Use an ordinary terminal for a physical device when
its CoreDevice connection is outside the agent sandbox.

Open **Agent**, choose project chat or the current scenario, ask a question, then review any proposed
source change before applying it. During this pass, Studio reached `claude-sonnet-5` and attempted an
answer, but Anthropic rejected the configured API key as invalid. Correct the secret with
`just secrets`, restart Studio, and retry; do not print or expose the decrypted secret while
diagnosing it.

## 6. Create, review, and rehearse shipping

Create a disposable project without requiring an AI provider:

```sh
repo="$PWD"
scratch="$(mktemp -d)"
(cd "$scratch" && "$repo/tao" create "a pantry tracker with items and quantities" \
  --id pantry-demo --ai none --yes)
```

This path was verified: it generated the app, data, chrome, design, item view, scenarios, and behavior
test. Launch it with `"$repo/tao" dev "$scratch/pantry-demo"`, then use it for the source-changing
Studio and sketch exercises above.

Capture a local visual-review bundle:

```sh
review_output=".artifacts/reviews/hnreader-walkthrough-$(date -u +%Y%m%dT%H%M%SZ)"
./tao review Apps/HNReader --app HNReaderStub \
  --output "$review_output"
open "$review_output/index.html"
```

The timestamp matters because review output is immutable. Compare captures with blink/opacity
overlays, record per-cell decisions and comments, and export/import `annotations.json`. This pass
captured both HNReaderStub cells into the bundle. A preview reload initially invalidated Chrome's
execution context during capture; the review harness now retries that narrow transient failure.

Finally, rehearse the real release plan without mutating App Store state:

```sh
./tao ship Apps/HNReader --app HNReader --dry-run
```

The dry run completed and listed the source-version write, atomic lock update, release compile,
Studio-marker check, iOS prebuild, archive/sign, upload, version attachment, and submission actions.
It did not mutate source, lock, Git index, refs, App Store state, or the network. A non-dry ship may
write source and `.tao-project/lock.jsonc`, but it never stages, commits, tags, or pushes; committing
those files remains the developer's action. Studio's orange **Beta ship** button
is not another preview: it performs a beta ship with confirmation bypassed, so use it only when a real
TestFlight upload is intended. `tao ship --update` and `--rollback` are the corresponding OTA paths;
they were not run because they change release state.

## Verification boundary

- **Walkthrough evidence at the time:** Studio launch and HNReader live/stub canvases; app switching; project panels,
  lenses, scenarios, data, drawers, selection/focus, workspace modes, and device pairing;
  standalone HNReaderStub plus keyboard hints/palette; WordFlower focus pause/resume/relaunch;
  representative native component, Device Kit, and navigation paths; Companion pairing, rendering,
  and scenario switching; `tao create --ai none`; `tao review`; `tao ship --dry-run`; and the slow
  Studio browser-smoke lane. This dated walkthrough is not final simulated-user acceptance: that
  journey is currently quarantined from `full-verify` pending ten consecutive reliable browser runs.
- **Present but not end-to-end verified:** freehand persistence/snap, every native control interaction,
  sharing, chromeless navigation/restoration, a successful Studio agent answer, and Dev/iCloud/CloudKit
  native behavior.
- **Attempted and externally blocked:** Studio agent generation reached Anthropic, which rejected the
  configured API key as invalid.
- **Modest recovery performed:** repository setup and parser generation restored Studio/CLI startup;
  the standalone Expo app then ran with the pinned Watchman on `PATH` and offline dependency checking;
  the visual-review harness gained a bounded retry and regression test for live-preview execution-context
  replacement. The remaining limitation is external credential validity, not missing product wiring.
