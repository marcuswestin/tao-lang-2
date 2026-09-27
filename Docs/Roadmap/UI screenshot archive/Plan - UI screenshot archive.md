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
- **Appearance**: light and dark at every size.
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

- **Shot list**: a Tao app's `scenarios` blocks are its shot list. Each scenario is captured across
  the size × appearance matrix, overriding its declared device and appearance. Studio and the
  companion app get a small declarative list of stable keys naming how to reach each state.
- **Capture**: one command, with an adapter per surface over machinery that already exists — `tao
  review` for Tao apps (`packages/ides/studio-tooling/studio-tooling-src/StudioReview.ts`), Studio's
  CDP capture for Studio itself, and Appium for native targets. No new dependency.
- **Store**: PNGs stored once each, named by sha256, so an unchanged screen adds no bytes. Each
  capture run writes its own manifest — keys, hashes, renderer fingerprint, source commit and
  subject, optional note — so two concurrent captures never edit the same file.
- **Timeline**: a generated static page with one filmstrip per key, showing only the runs where the
  hash changed, each labelled with its commit subject and note. A renderer-fingerprint change is
  labelled as such rather than as a design change.

## Submodule rules

The archive is a submodule for discoverability, but this repository runs many worktrees and
branches at once, and a submodule's gitlink would conflict on nearly every merge if captures bumped
it. So:

- The gitlink is set once and bumped only deliberately. `.gitmodules` sets `ignore = all`, so
  captured commits inside the archive never make a worktree look dirty to `finalize` or `land`.
- The submodule is not initialised by default; the capture command initialises it in the worktree
  that captures, and fetches the archive's `main` before writing.
- A capture commits inside the archive and pushes to the archive's own `main`, rebasing and
  retrying on a non-fast-forward. Per-run manifests make that rebase conflict-free.
- Repository scans, formatting, and lint exclude the submodule path.

## Slices

1. **Proof of concept**: the submodule and store, WordFlower captured on web across the full size ×
   appearance matrix, and the timeline page.
2. The other Tao apps, then Studio on web.
3. Milestone native captures: iOS for the reference apps and the companion app, and the native
   Studio shell.
4. Android, and the websites once their source or URL is named.
