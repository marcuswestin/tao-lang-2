# DEVENV-072 — Shared devenv profile makes its coreutils vanish mid-command in every worktree

- **Status:** Candidate
- **Area:** Worktrees and shell environment
- **Impact:** A tool shell resolves `dirname`, `basename`, and the other profile-provided coreutils
  through `.devenv/profile`, which every linked worktree symlinks to the primary checkout's single
  profile. While another worktree or the primary checkout re-resolves that profile, those binaries
  stop resolving everywhere at once. In a shell pipeline the failure is per-invocation
  `command not found` rather than a nonzero exit, so the surrounding loop keeps running and reports
  a confidently wrong result instead of failing.
- **Evidence:** On 2026-09-17, with `./agent verify-changed` running in this worktree, a
  `while read` loop checking bridge paths emitted `(eval):2: command not found: dirname` once per
  iteration and reported all 160 repository `from` bridges as missing. `sed` and `awk`, which
  resolve from `/usr/bin`, were unaffected throughout. Re-running the identical pipeline after the
  lane finished resolved `dirname` from
  `.devenv/profile/bin/dirname` and reported 1 missing of 160. `ls -la .devenv/` shows
  `profile -> /Users/ro/code/tao-lang-2/.devenv/profile`, so the profile is shared mutable state
  rather than per-worktree.
- **Workaround:** Do not build repository checks out of shell pipelines over profile coreutils while
  a lane runs. Write the check as a `bun` script using `node:path` and `node:fs`, which depends only
  on the already-resolved `bun` binary; that is how the bridge-path check was finally run.
- **Proposed change:** Establish whether a linked worktree can hold its own profile symlink
  generation, or whether profile re-resolution can publish atomically so the old generation stays
  readable until the new one is complete. Failing both, have `./agent` expose the hazard: a
  `command not found` for a profile-provided binary should be a named, actionable diagnostic rather
  than an ordinary shell miss.
- **Dependencies:** None.
- **Acceptance:** A profile re-resolution in one worktree leaves every other worktree's tool shell
  resolving profile coreutils continuously, or a shell that loses them says so with a diagnostic
  naming the profile.
- **Source:** 2026-09-17 bridged-sidecar file-reference validation.
