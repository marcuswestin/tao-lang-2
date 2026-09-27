# Plan - UI screenshot archive

An ongoing, append-only archive of screenshots that records how Tao's user interfaces change over
time: Studio, the companion app, reference apps such as WordFlower, and eventually the websites. It
is a history, not a gate: nothing fails because a screenshot changed.

## Decisions

- **Storage**: a separate private Git repository, tracked here as a submodule.
- **Cadence**: captured only when someone invokes it, for now; no capture on landing or on a schedule.
- **Sizes**: one width per device preset — `phone` 390×844, `tablet` 768×1024, `laptop` 1440×900,
  the scenario presets in `packages/compiler/compiler-src/studio-preview-manifest.ts`. No extra
  breakpoint widths.
- **Appearance**: light and dark at every size, for scenarios that do not author an appearance. A
  scenario's `appearance` clause outranks the cell's scheme in the preview runtime
  (`packages/apps/expo-host/expo-host-src/runtime.ts:679`), and Studio's own scheme control is
  read-only for the same reason, so an authored scenario is captured only in its own appearance.
  Nearly every reference-app scenario authors one.
- **Native platforms**: iOS simulator captures at milestones only; Android later. Web captures are
  the routine ones.
- **Websites**: deferred; no website source is in this checkout.
- **Comparison**: by content hash, as `tao review --against` already does. A pixel-threshold
  comparison would need a new dependency and is not planned.

## Matrix

Layout changes only with width. The runtime has one adaptive container, `Panes()`, which sits its
children side by side when each gets at least 320 logical px
(`packages/apps/runtime/TaoRuntime-src/TR-views.tsx:96`), and Studio has CSS breakpoints at 1400px
and 760px (`packages/ides/studio/studio-src/StudioClientStylesheet.ts:857`). The runtime has no
hinge or posture awareness, so a foldable is only another width. Platform changes fonts, native
controls, and safe areas, not arrangement.

| Product                                | Web (routine)                       | iOS simulator (milestone) | Android | Other                   |
| -------------------------------------- | ----------------------------------- | ------------------------- | ------- | ----------------------- |
| WordFlower, HNReader, Pantry, Notebook | phone, tablet, laptop × light, dark | phone                     | later   | —                       |
| Studio                                 | laptop × light, dark                | —                         | —       | native shell, milestone |
| Companion app                          | —                                   | phone                     | later   | —                       |
| Websites                               | deferred                            | —                         | —       | —                       |

One width per device misses Studio's two narrower layouts. For the Tao apps it happens to cover
WordFlower's one flip, since `phone` stacks its panes and `tablet` sets them side by side.

Native Studio loads the same web client inside a native shell
(`packages/ides/studio-tooling/studio-tooling-src/StudioNative.ts:59`), so its captures record only
the window chrome.

## Shape

- **Shot list**: a Tao app's `scenarios` blocks are its shot list. Each scenario is captured at
  every device width, overriding its declared device through Studio's session-only cell
  reconfigure route, so the Tao source is untouched. Studio and the companion app get a small
  declarative list of stable keys naming how to reach each state.
- **Capture**: `tao _preview qa <project> --screenshot --dest <store>` drives `tao review`'s cell
  capture (`packages/ides/studio-tooling/studio-tooling-src/QaScreenshots.ts`); `_preview` holds
  commands under development until one graduates to a released name. Agents run it as
  `./agent unsandboxed storage qa <project> [--note …]`, since Studio needs the host's Watchman;
  `storage sync` and `storage push` handle the archive's remote. Each capture hides everything on
  the Studio page but the cell, so Studio's own chrome stays out of the shot. Studio's CDP capture
  and Appium are the planned adapters for Studio itself and native targets. No new dependency.
- **Store**: `storage/qa/`. Each run writes only its own directory, `runs/<UTC time>/`, holding
  `qa-run.json` (scenario identities, hashes, change since the previous capture of each name,
  renderer fingerprint, source commit and subject, optional note) and `screenshots/`, so two
  concurrent runs never edit the same file. A screenshot is named
  `<App>_<Subject>_<group>-<entry>_<device>-<appearance>.png`, the subject left out when it is the
  app itself and the source file appended only when two files declare the same group and entry.
  Git stores identical PNGs once, so an unchanged screen adds no bytes to the repository.
- **Commits**: one per run, summarised by what changed —
  `QA <App>: 2 changed, 1 failed of 14 screenshots`, then bullets for the run, its source commit,
  the changed, new, and failed names, and the note.
- **Timeline**: a generated, ignored `index.html` with one filmstrip per screenshot name, showing
  only the runs where the pixels changed or the capture failed, each labelled with its commit
  subject and note. A renderer-fingerprint change is labelled as such rather than as a design
  change. Every capture and `storage sync` regenerate it; `tao _preview qa --timeline --dest <store>`
  does so alone.

## Submodule rules

The archive is a submodule for discoverability, but this repository runs many worktrees and
branches at once, and a submodule's gitlink would conflict on nearly every merge if captures bumped
it. So:

- The gitlink is set once and bumped only deliberately. `.gitmodules` sets `ignore = all`, so
  captured commits inside the archive never make a worktree look dirty to `finalize` or `land`.
- The submodule, at `storage`, is not initialised by default. `storage sync` initialises it in
  the worktree that captures as a blobless partial clone (`--filter=blob:none`): every commit and
  tree arrives, and a screenshot downloads only when checked out. A shallow clone would save less,
  since the screenshots are the weight, and makes rebasing onto the archive's `main` fragile.
- Sync puts the submodule on the archive's `main` at `origin/main` before any capture writes.
- A capture commits inside the archive and pushes to the archive's own `main`, rebasing and
  retrying on a non-fast-forward. Per-run manifests make that rebase conflict-free.
- Repository scans, formatting, and lint exclude the submodule path.

## Slices

1. **Proof of concept** (done): the submodule and store, WordFlower captured on web across the size
   × appearance matrix, and the timeline page. Two consecutive runs reproduced every image
   byte for byte. Known noise: Studio's review capture occasionally reports "The preview changed
   between two consecutive settled captures", most often for `states/novel`; the timeline shows such
   a shot as a flagged failure.
2. The other Tao apps, then Studio on web.
3. Milestone native captures: iOS for the reference apps and the companion app, and the native
   Studio shell.
4. Android, and the websites once their source or URL is named.
