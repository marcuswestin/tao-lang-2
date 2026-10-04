---
name: storage-archive
description: >-
  Capture and publish Tao QA screenshots through the storage archive. Use when asked to capture,
  review, archive, publish, or land QA screenshots; run storage sync, qa, push, or pin; fix the
  storage submodule pointer; or clean up screenshot captures.
---

# Storage Archive

`Docs/Roadmap/UI screenshot archive/Plan - UI screenshot archive.md` owns what the archive records
and why: the device and appearance matrix, file names, the per-run manifest, and the submodule rules.
This skill owns the order of operations and what an agent must not do to the archive's history.

## The round, in order

1. **Capture**: `./agent unsandboxed storage qa`. With no paths it captures the reference apps and
   starters plus Studio's own layouts, and commits them as one archive commit; name project paths,
   `--studio`, or `--note` to change that. Check its summary line for failures.
2. **Show the Developer the shots**, in `storage/qa/runs/<stamp>/screenshots/`, and wait until they
   are satisfied. A run they reject is reset away before it is pushed (below).
3. **Publish**: `./agent unsandboxed storage push`. Pushing is irreversible and the archive is
   append-only, so push only a run the Developer asked to keep.
4. **Pin**, from any clean checkout: `./dev storage pin`. Off a feature branch it starts
   `feat/storage-pin-<commit>` from `origin/main`, commits only the pointer, and records the merge
   message so the landing asks nothing more.
5. **Land**: `./agent unsandboxed land`, under the Developer's landing authorization as for any
   slice.

Pinning is occasional; a routine capture can stop after step 3. When changing the capture tooling
itself, iterate with `./agent tao _preview qa <project> --screenshot --dest .artifacts/qa-dev`
(unsandboxed, since Studio needs the host's Watchman) so trial runs never reach `storage`.

## The archive's history

- Never commit iteration runs into `storage`. A run that is wrong, a duplicate of the day's run, or
  in a format since changed stays in scratch; if one was committed locally and not pushed, reset the
  submodule to `origin/main` with the Developer's agreement.
- Never rewrite pushed archive history. `main` records a commit inside it, and removing that commit
  breaks `git submodule update` for every fresh checkout. If it happens anyway, `storage pin` on a
  branch and a landing repair the pointer.
- The pointer moves only through `pin`. `.gitmodules` sets `ignore = all`, so `git add storage` stages
  nothing and `git status` never shows the submodule as changed; read the recorded commit with
  `git ls-tree HEAD storage` instead.

## Reviewing a capture

- Compare a dark shot against its light twin: every surface, header, and label should change. A
  dark shot that renders light, or text left at the default black, means a scheme is not reaching
  that element.
- Studio's shots show the canvas at 100 % from its top left with the agent panel minimized. Studio
  remembers its layout and canvas position across sessions — the canvas under
  `.artifacts/user/studio/`, shared with the Developer's own Studio — so a capture resets both and
  restores the layout it found.
- A run reports its failed shots in its summary and commit; `unstable-<name>` beside a shot means two
  consecutive captures never agreed.

## Around a capture

- Run no gate, test lane, or other Studio launch while a capture runs: gates rewrite generated app
  trees under the running Studio, and machine load pushes cells past their settle timeouts.
- Clean up afterwards: delete `.artifacts/qa-dev`, `.artifacts/qa-screenshots`, and
  `.artifacts/scratch/tao-studio-chrome-*`. In zsh write the glob as
  `.artifacts/scratch/tao-studio-chrome-*(N)`, since an unmatched glob aborts the whole command line,
  deletions included. A capture removes its own Studio session records from the project's
  `.tao/local/sessions/`; a record left there is from an interrupted run and may go.
