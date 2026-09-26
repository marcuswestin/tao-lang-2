# DEVENV-111 — `finalize`'s integration merge half-applies `main` in the sandbox and names no conflicting path

- **Status:** Resolved
- **Section:** External
- **Partly addressed, 2026-09-20:** `Finalize.ts` now asks `git merge-tree --write-tree --name-only`
  what would conflict _before_ attempting the merge, and separates the two failures. A merge that
  recorded unmerged entries still says to resolve it by hand and names them. A merge that failed
  without recording any says so in those words, quotes Git's stderr, names what `merge-tree` says
  would conflict — it answers read-only, so it works where the merge itself could not — and points at
  running `git merge main` as a top-level command. The empty conflict list is gone. **What remains**
  is the half-written tree itself: the merge is still attempted inside the sandbox, so it can still
  stop partway and leave modifications the reader did not make. That needs the sandbox-inheritance
  fix under Dependencies, not another change here.
- **Partly addressed, 2026-09-21:** the half-written tree is gone. `Finalize.ts` now probes before
  merging: it takes the directories `main` would write, creates and removes a file in each, and
  refuses with those directories named if any write is denied — so the merge is never attempted
  where it cannot finish, and the worktree is untouched rather than half-written. The probe is an
  actual write rather than a list of protected prefixes, because that list is the harness's: it is
  in neither `.rulesync/permissions.jsonc` nor the generated settings, and a copy kept here would
  rot silently. **What remains** is that finalize still cannot perform the merge itself in that
  case; it hands off to a top-level `git merge`. Excluding `./agent finalize` from the sandbox the
  way `eabe05bc` excluded the landing would fix that, but finalize runs every test suite, which is a
  different order of blast radius from a landing a person has already approved.
- **Correction, 2026-09-21:** the Dependencies note below is wrong about what a general fix would
  look like. A Seatbelt profile is inherited and can only be narrowed by a descendant, never widened,
  so no harness change can lift a nested `git` out of the sandbox its parent runs in. There is no
  general fix waiting to be written; the only lever is which top-level commands are named approval
  boundaries and excluded, which is what `eabe05bc` did for the landing.
- **Follow-up, 2026-09-21:** on `feat/tao-skills`, the new write probe itself failed while removing
  its temporary directory in `Docs/Roadmap` (`EFAULT` from `FS.remove`). Finalize wrapped that as
  `UnexpectedBehaviorError: Something went wrong.` and never reached its blocked-directory report.
  A top-level `git merge main` then succeeded without conflicts. The probe cleanup needs to report
  its path and recovery when removal is denied; the current workaround is the top-level merge.
- **Also, 2026-09-24:** the same half-write follows an ordinary branch start. A landing leaves its
  worktree detached at the archived tip; `git switch -c feat/<next> main` from a sandboxed shell then
  moved `HEAD` and every writable file but printed `unable to unlink old` for `.claude/settings.json`
  and eight `agents/skills/**` files, leaving them at the previous tip. Nothing reports it as a
  failure — the switch says `Switched to a new branch` — yet `repo-lint` then calls the settings
  stale and two `agent-cli` tests fail on its old host-command rules, so `verify-changed` and
  `finalize` stay red until a host-side restore. `merge-main` below covers merging; starting a branch
  still has no named `./agent unsandboxed` operation. Seen on `feat/wordflower-check`.
- **Partly addressed, 2026-09-25:** the hand-off is now a named approval boundary rather than a raw
  `git merge`. `./agent merge-main` runs finalize's integration alone, with no lane and no message,
  and `./agent unsandboxed merge-main` runs it on the host, so both finalize's and merge-main's
  refusals name that one command. Proven by merging five `main` commits that wrote `agents/skills`
  and `.claude/settings.json` into a branch: the sandboxed form refused untouched, the unsandboxed
  form merged cleanly. The probe also missed a protected file inside a writable directory, which is
  how `.claude/settings.json` is protected; it now opens every existing incoming file in append
  mode, which writes nothing, and refuses on a denial. **What remains** is the 2026-09-21 follow-up:
  a probe directory the sandbox will not let finalize remove still ends in an unexplained error.
- **Area:** Verification and landing
- **Impact:** `./agent finalize` run from a sandboxed agent shell leaves the worktree in a state no
  Git command describes. Its integration merge is denied partway on the paths the sandbox
  write-protects, so the tree ends up holding `main`'s content for every writable file and the
  branch's content for `agents/skills/**` and `.claude/settings.json`, with no `MERGE_HEAD`, no
  unmerged index entries, and `HEAD` unmoved. The report says `Integrating main conflicted; resolve
  it by hand and finalize again. Conflicting paths:` and then lists nothing, so the one instruction
  it gives cannot be followed. An agent reading `git status` sees fifty-odd modifications and
  deletions it did not make and cannot tell a real conflict from a denied write; the obvious recovery,
  `git checkout -f`, is itself denied in the sandbox and reads to a permission classifier as
  discarding work.
- **Evidence:** 2026-09-20, `feat/misc-followups-66ff38` against `main` at `8c88d071`. `./agent
  finalize` exited 1 with the empty conflict list above. Afterwards `git status --porcelain` counted
  17 `M`, 37 `D` and 3 `??`; `git diff --name-only --diff-filter=U` was empty; `git rev-parse
  MERGE_HEAD` printed `fatal: Needed a single revision`; `git rev-parse HEAD` was still the branch
  tip. Hashing the protected files showed them at the branch's blobs while the rest of the tree held
  `main`'s. A read-only `git merge-tree --write-tree HEAD origin/main` named the two paths that
  genuinely conflicted — `agents/skills/delegation/SKILL.md` and
  `agents/skills/parallel-implementation/SKILL.md` — which the command never printed. Re-running the
  same integration as a top-level `git merge origin/main`, which
  `.rulesync/permissions.jsonc` excludes from the sandbox, reported both conflicts correctly and
  produced a tree that verified green. Independently reproduced the same day on
  `feat/agent-context-optimization-421aa5` against the same `main`: the same empty conflict list, 61
  dirty tracked paths of which 60 were byte-identical to `main`, 5 untracked paths all present in
  `main`, no `MERGE_HEAD`, and a plain `git merge main` afterwards that named the one real conflict.
  A different branch and a different conflicting path, so this is the command and not one branch.
  On 2026-09-25, a disposable worktree at `48519139` reproduced the branch-start half-write with
  `.claude` made unwritable: `git switch -c feat/devenv-111-denied-repro origin/main` exited 0 and
  printed both `unable to unlink old '.claude/settings.json': Permission denied` and `Switched to a
  new branch`. HEAD moved to `e878db96`, but `.claude/settings.json` still had the old tip's blob
  `2ffffc31`; `git status` reported it modified. The disposable worktree was restored and removed.
  In a second disposable worktree at `3d05b7e4`, the guarded `./agent start-branch
  feat/devenv-111-guard-proof` faced the same directory denial and exited 1, named `.claude`, and
  pointed to its unsandboxed form; `git status` remained clean and detached at `3d05b7e4`.
  The forced `EFAULT` cleanup test failed before the report change and passed afterward, asserting
  the leftover path and a normal-Terminal `rmdir` instruction. The branch-start tests exercise a
  protected existing file, a writable switch, dirty/existing/invalid-name refusals, and a pathname
  containing a newline.
  The 2026-09-25 normal-Terminal `./agent unsandboxed start-branch
  feat/devenv-111-guard-proof` then started a clean branch at `e355b5b1f509` after the artificial
  directory denial was removed. `git status --short --branch` named only the new branch, and HEAD
  exactly equalled fetched `origin/main` at `e355b5b1f50980acae28ed71609044bb0e6f7b1a`.
  The disposable worktree and branch were removed after the proof.
- **Workaround:** Only needed for a tree an older finalize already half-wrote. Set the debris aside
  with `git stash push -u -m '<unique-tag>'` rather than `git checkout -f`, which is both
  sandbox-denied and classifier-denied — confirmed 2026-09-21 on
  `feat/ripgrep-replace-flag-issue-970ab2`, where `checkout -f`, `git merge` and even a
  path-scoped `git restore` were all refused as irreversible local destruction, and the tagged stash
  was not; then run `./agent unsandboxed merge-main` and resolve any conflict by hand. `git
  merge-tree --write-tree HEAD origin/main` is a read-only way to learn what actually conflicts
  before touching anything.
- **Proposed change:** Done for integration: `merge-main` probes incoming directories and files before
  merging, refuses with blocked paths named, and has a named unsandboxed form. A failed probe cleanup
  reports the leftover path and removal step. For branch starts, `start-branch feat/<name>` requires a
  clean worktree, fetches `origin/main`, checks the paths a checkout would write, and refuses before
  switching when any probe is denied. Its named unsandboxed form performs the same switch. Detached
  checkout guidance points to this operation.
- **Dependencies:** A nested Git process inherits its parent's sandbox. The only host boundary is a
  named `./agent unsandboxed <operation>` in `.rulesync/permissions.jsonc` and the agent command
  implementation; no inherited sandbox setting can widen it.
- **Acceptance:** A forced `EFAULT` on probe cleanup reports the leftover path and tells the operator
  to remove the empty directory from a normal Terminal; no merge starts. A clean, detached checkout
  with a protected path changed between HEAD and fetched `origin/main` makes sandboxed `start-branch`
  name that path and leave HEAD, index, and worktree untouched. With host access the named operation
  starts a clean `feat/*` branch at the fetched SHA, without tracking or inheriting the old feature
  branch's commits. Dirty worktrees and existing or invalid names refuse before fetching. The
  detached-HEAD warning, landing's closing line, and `git-workflow` skill point to the operation.
  `./agent unsandboxed finalize` passes, the merge message is reviewed, and landing succeeds.
- **Source:** 2026-09-20 landing of `feat/misc-followups-66ff38`.
- **Archived:** 2026-09-25
