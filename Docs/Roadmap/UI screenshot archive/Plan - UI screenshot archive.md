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
- **Appearance**: light and dark at every size, for every scenario. A scenario's `appearance`
  clause outranks the cell's scheme in the preview runtime, except for a cell reconfigured to an
  explicit preference (`packages/apps/expo-host/expo-host-src/runtime.ts`, `studioCellRuntime`).
  Studio's own scheme control stays read-only for an authored scenario, so only a session-only
  override such as the capture's appearance pass sets one. Every reference app and generated
  starter declares a dark palette through `when Scheme is Dark` colors.
- **Native platforms**: iOS simulator captures at milestones only; Android later. Web captures are
  the routine ones.
- **Websites**: deferred; no website source is in this checkout.
- **Comparison**: by content hash, as `tao review --against` already does. A pixel-threshold
  comparison would need a new dependency and is not planned.
- **Unchanged runs**: committed like any other, since a run whose screens all held is still history.
- **Tests**: Tao behavior tests take no screenshots; scenarios are the shot list.
- **Checkout size**: the blobless clone is enough for now; a sparse checkout and a before/after
  comparison page wait until the archive is large enough to need them.

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
| Studio                                 | laptop × previews light, dark       | —                         | —       | native shell, milestone |
| Companion app                          | —                                   | phone                     | later   | —                       |
| Websites                               | deferred                            | —                         | —       | —                       |

One width per device misses Studio's two narrower layouts. For the Tao apps it happens to cover
WordFlower's one flip, since `phone` stacks its panes and `tablet` sets them side by side.

Studio's chrome is dark-only (`packages/ides/studio/studio-src/StudioClientStylesheet.ts` sets
`color-scheme: dark` and has no light theme), so its light and dark shots differ only in the preview
cells, whose scheme the appearance pass sets.

Native Studio loads the same web client inside a native shell
(`packages/ides/studio-tooling/studio-tooling-src/StudioNative.ts:59`), so its captures record only
the window chrome.

## Shape

- **Shot list**: a Tao app's `scenarios` blocks are its shot list. Each scenario is captured at
  every device width, overriding its declared device through Studio's session-only cell
  reconfigure route, so the Tao source is untouched. Studio and the companion app get a small
  declarative list of stable keys naming how to reach each state. Studio's list, `studioStates` in
  `QaScreenshots.ts`, is its four layout presets (run, design, code, draw), each reached from a
  freshly loaded session page with the canvas reset to 100 % at its top left and the agent panel
  minimized, and captured as the whole 1440×900 window once the on-screen previews settle, with the
  previews at their authored sizes. Studio remembers its layout, so the capture restores the one the
  session opened in before the cell captures that follow.
- **Capture**: `tao _preview qa <project> --screenshot --dest <store>` drives `tao review`'s cell
  capture (`packages/ides/studio-tooling/studio-tooling-src/QaScreenshots.ts`); `_preview` holds
  commands under development until one graduates to a released name; `--studio` adds Studio's own
  shots. Agents run it as `./agent unsandboxed storage qa <project>… [--studio] [--note …]`, since
  Studio needs the host's Watchman; each project is its own run, `--studio` rides on the first, and
  the runs of one invocation archive as one commit. `storage sync` and `storage push` handle the
  archive's remote. Each capture hides everything on the Studio page but the cell, and the
  runtime's floating dev menu inside it, so tooling stays out of the shot. Studio's CDP capture is
  the adapter for Studio itself, and Appium the planned one for native targets. No new dependency.
  A capture removes what it leaves in ignored folders: its work directory once the run is written,
  and the session records its Studio launches add under the project's `.tao/sessions/`.
- **Apps**: Studio previews one app per session, so a run launches Studio once per app. The first
  launch opens Studio's default app and captures its own scenarios and every view scenario. Every
  app whose source reaches a view lists its scenarios, so capturing them once avoids a duplicate per
  app, and the harness apps that mount no design would fail them. The
  other apps are parsed without a launch, and only those that some selected scenario runs as its
  subject, such as `WordFlowerDark`, are launched after it. `--app` names the apps instead, the
  first one taking the view scenarios.
- **Selection**: `--scenario` picks scenarios and repeats, spelled
  `[<file>.tao:]<name>[/<name>[/<name>]]`: one name is a subject or a group, two a group and entry
  or a subject and group, three subject, group, and entry, and the file prefix narrows any of them.
  Names match exactly, and a selector that matches nothing fails the run. `--device` and
  `--appearance` narrow the matrix; each flag repeats, or takes a comma-separated list.
- **Store**: `storage/qa/`. Each run writes only its own directory, `runs/<UTC time>/`, holding
  `qa-run.json` (scenario identities, hashes, change since the previous capture of each name,
  renderer fingerprint, source commit and subject, optional note) and `screenshots/`, so two
  concurrent runs never edit the same file. A screenshot is named
  `<App>_<Subject>_<group>-<entry>_<device>-<appearance>.png`, the subject left out when it is the
  app itself and the source file appended only when two files declare the same group and entry.
  Git stores identical PNGs once, so an unchanged screen adds no bytes to the repository.
- **Commits**: one per invocation, summarised by what changed —
  `QA WordFlower, WordFlowerDark, Studio: 2 changed, 1 failed of 14 screenshots`, then bullets for
  each run and its selection, the source commit, the changed, new, and failed names, and the note.
  A Studio shot is named `Studio_<App>_<state>_laptop-<appearance>.png` after the app Studio opened.
- **Timeline**: a generated, ignored `index.html` with one filmstrip per screenshot name, showing
  only the runs where the pixels changed or the capture failed, each labelled with its commit
  subject and note. A renderer-fingerprint change is labelled as such rather than as a design
  change. Every capture and `storage sync` regenerate it; `tao _preview qa --timeline --dest <store>`
  does so alone.

## Submodule rules

The archive is a submodule for discoverability, but this repository runs many worktrees and
branches at once, and a submodule's gitlink would conflict on nearly every merge if captures bumped
it. So:

- The gitlink is set once and bumped only deliberately: `./dev storage pin`, on a feature branch,
  points it at the archive's published head in a commit of its own and drafts the merge message, so
  `./agent unsandboxed land` is the one step left. `.gitmodules` sets `ignore = all`, so captured
  commits inside the archive never make a worktree look dirty to `finalize` or `land`.
- The submodule, at `storage`, is not initialised by default. `storage sync` initialises it in
  the worktree that captures as a blobless partial clone (`--filter=blob:none`): every commit and
  tree arrives, and a screenshot downloads only when checked out. A shallow clone would save less,
  since the screenshots are the weight, and makes rebasing onto the archive's `main` fragile.
- Sync puts the submodule on the archive's `main` at `origin/main` before any capture writes.
- A capture commits inside the archive; `storage push` publishes to the archive's own `main`,
  rebasing and retrying on a non-fast-forward. Per-run manifests make that rebase conflict-free.
- Repository scans, formatting, and lint exclude the submodule path.

## Slices

1. **Proof of concept** (done): the submodule and store, WordFlower captured on web across the size
   × appearance matrix, and the timeline page. Two consecutive runs reproduced every image
   byte for byte. Studio's review capture once flagged one shot in fifteen as changing between two
   consecutive settled captures; it now captures in a window that holds every cell and repeats until
   two consecutive captures agree, keeping `unstable-<name>` beside a shot that never does.
2. **The other Tao apps and Studio on web** (done). HNReader, Pantry, and Notebook capture without a
   failure. Getting there fixed two Studio defects that also stalled `tao review`: a capture now
   scrolls its cell into view while it settles, since Chrome pauses animation frames in an offscreen
   preview frame, and a cell without steps stays ready across a re-render of the revision its frame
   already applied, where it used to fall back to pending and wait for an acknowledgement the frame
   sends only once. The in-frame wait before an element capture is also bounded now, since the same
   paused frames left it waiting forever. Studio's own four layouts are captured with `--studio`,
   the agent panel minimized. Capturing dark exposed that a focused view scenario always resolved its
   design light, because Studio's subject host dropped the scheme the app shell stamps; it now
   forwards it. The first archived run, 152 shots, is pinned. It left these open: the tablet dark
   pseudolocale and right-to-left shots, WordFlower's second pane clipped at tablet width, its
   library card wider than the hero at laptop width, and the capture sharing the canvas position
   Studio stores for the Developer. The `storage-archive` skill owns the capture round.
3. Milestone native captures: iOS for the reference apps and the companion app, and the native
   Studio shell.
4. Android, and the websites once their source or URL is named.
