# DEVENV-LAND-FIX-PUSHES-UNGATED-PRE-SQUASH-COMMITS — `land-fix` pushes ungated pre-squash commits

- **Status:** Resolved
- **Section:** External
- **Area:** `./agent unsandboxed land-fix`, `LandFixCommand.ts`
- **Impact:** `land-fix` exists for a complement failure found after GitHub merged the squash: it
  merges the branch into fetched `origin/main` and pushes without a verification. Two things make
  that wider than its purpose. It merges the branch's whole history, so `main` receives the
  pre-squash commits and every merge commit the branch made, and it runs no gate at all, so a fix
  that does not compile reaches `main` and every landing behind it goes red until someone fixes
  forward.
- **Evidence:** 2026-10-06, 19:3xZ: a `land-fix` from another checkout pushed `24d3f72f4`
  ("Fix after #59") with the branch's merge commits. `main`'s run 37520987700 failed `_typecheck`
  (`TS2345` at `studio-server.test.ts:221`); a pull request in flight failed hosted typecheck on
  that base and had to push again; `b20493e59` and `f578fafc3` repaired `main`. The project's
  review found the cause of the extra commits at `LandFixCommand.ts:98` and `:179`: after a merge
  of `main` into the branch, the range the command lands includes `main`'s own commits.
- **Workaround:** None needed; see Progress.
- **Proposed change:** `land-fix` squashes the branch's commits beyond the merge base onto fetched
  `origin/main` (one commit, the reviewed message plus the fix), and runs the cheap sandbox gates
  (`typecheck`, `lint`, the changed files' tests) before pushing, refusing on a failure. The
  alternative the review raised is a ruleset change: require `Verify (host)` on `main`, so the
  complement must be green before GitHub merges and `land-fix` is rarely needed. Both change an
  unsandboxed operation or a repository setting and need the Developer's approval.
- **Progress:** The October 7 repository pass made `land-fix` land one commit: it lists the fix
  commits after the fetch (`<mergedHead>..<fixHead> ^<mainBefore>`, merges excluded) and refuses
  when there are none, builds the tree with `merge-tree --merge-base=<mergedHead>`, and commits it
  with `main` as the only parent. The October 7 afternoon pass, on the Developer's choice of the first shape, added the gate half:
  before pushing, `land-fix` runs `./dev gates _parser-gen _compile-word-flower-app _repo-lint
  _typecheck _test-changed --lane land-fix` on the branch, prints the gates' output, and refuses with
  nothing pushed when they fail (`LandFixCommand.ts`, `land-fix.test.ts`). The ruleset alternative was
  not taken.
- **Dependencies:** None.
- **Acceptance:** A `land-fix` of a branch that merged `main` lands one commit on `main`, and a
  fix with a type error is refused before the push, with the error quoted.
- **Source:** Red `main` incident and the CI completion review, 2026-10-06.
- **Archived:** 2026-10-07
