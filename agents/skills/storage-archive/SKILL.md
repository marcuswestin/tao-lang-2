---
name: storage-archive
description: >-
  Capture Tao UI screenshots into the `storage` archive submodule, publish them, and point this repository at them. Use when the Developer asks to take, review, archive, push, or land QA screenshots, run `storage sync`, `storage qa`, `storage push`, or `storage pin`, bump or fix the storage submodule pointer, or clean up after screenshot captures.
---

# Storage Archive

`Docs/Roadmap/UI screenshot archive/Plan - UI screenshot archive.md` owns what the archive records
and why: the device and appearance matrix, file names, the per-run manifest, and the submodule rules.
This skill owns the order of operations and what an agent must not do to the archive's history.

## The round, in order

1. **Iterate outside the archive.** Capture into scratch until the shots are right:
   `./agent tao _preview qa <project> --screenshot --dest .artifacts/qa-dev`, narrowed with
   `--scenario`, `--device`, `--appearance`, or `--studio`. A finished run lands in
   `.artifacts/qa-dev/runs/<stamp>/screenshots/`. Studio needs the host's Watchman, so run it
   unsandboxed as `storage qa` is.
2. **Show the Developer the scratch shots** before anything touches `storage`, and say where they
   are. Nothing is written to the archive until they are satisfied.
3. **Capture once into the archive**: `./agent unsandboxed storage qa <project>… [--studio] [--note …]`.
   It syncs `storage` to the archive's `main` first and commits every project's run as one archive
   commit. Check its summary line for failures before going on.
4. **Publish**: `./agent unsandboxed storage push`. Pushing is irreversible and the archive is
   append-only, so push only a run the Developer asked to keep.
5. **Point this repository at it**, on a fresh branch: `./agent start-branch feat/<name>`, then
   `./dev storage pin`, which commits only the pointer, refuses an unpublished or dirty archive head
   and anything already staged, and drafts the merge message when the branch has none.
6. **Land** with `./agent unsandboxed land`, under the Developer's landing authorization as for any
   slice.

`pin` is a plain `./dev` command because it writes only this worktree's Git data; the other three are
named `./agent unsandboxed` operations. Pinning is occasional — a routine capture ends at step 4.

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
  `.tao/sessions/`; a record left there is from an interrupted run and may go.
