---
name: environment-recovery
description: >-
  Recover a Tao worktree whose tooling is wrong rather than whose code is wrong: a missing devenv profile, a tool shell without `.devenv/profile/bin` on PATH, a `bun install` the sandbox denied, a sandbox denial you cannot tell from a missing host tool, headless Chrome the host blocks, or a stray process and the port it is holding. Use when a repository command fails for a reason that is not the branch, when `which bun` looks wrong, when an install reports EEXIST or PermissionDenied, or when choosing between a sandboxed and an unsandboxed shell.
---

# Environment Recovery

Every failure here is the toolchain, not the branch; root `AGENTS.md` covers reading a failing
command's own output first. Come here when that is not enough, or when you need the reasoning
behind it.

## The worktree's own path

- Create a worktree at a real path, never one reached through a symlink. `/tmp` resolves to
  `/private/tmp` on macOS and the sandbox sets `$TMPDIR` to the symlink form, so a checkout made
  there is reached by two paths at once: TypeScript resolves imports through both, treats the
  results as different declarations, and `./agent typecheck` fails with types that are not
  assignable to themselves (`Type 'AdvanceStep' is not assignable to type 'AdvanceStep'`) naming no cause.
- `./agent doctor`'s `worktree path` check names it. `git worktree move <given> <real>` fixes it,
  but has no named host operation: report the exact move and ask the Developer before adding one.
  The rule is the symlink, not the location — worktrees under
  `/private/tmp` are fine, and a symlinked home or network mount hits the same failure.

## The devenv profile

- `./agent setup` bootstraps dependencies and the CLI build on every `./agent` call, so a stale
  worktree repairs itself by being used; `dev-automation` owns how each harness reaches it.
- In a linked worktree `./agent` reuses the primary checkout's pinned profile, or prints the
  fallback itself (`./enter-tao-dev-env`) when it finds none.
- The session-start hook puts `.devenv/profile/bin` on each tool shell's PATH — call `bun`,
  `bunx`, `dprint`, `just`, and `node` directly for inspection when needed; repository workflows
  still enter through `./agent`. Exports do not persist between tool calls, so if a diagnostic
  shell lacks the profile, use its explicit `.devenv/profile/bin/` path.
- Build a missing profile through `./enter-tao-dev-env` in a regular terminal. A sandbox denial
  from Nix's daemon socket does not mean the pinned lock is broken.

## Denied installs

- A few npm packages ship `.idea/` and `.gitmodules`, which an agent sandbox protects inside the
  working directory and no setting exempts. A sandboxed install that must write one fails as
  `PermissionDenied: …` or `EEXIST: failed to link package`. `./agent` distinguishes both from a
  denied temporary directory and prints the matching recovery; `./agent doctor` reports the broken
  install and the same remediation. Only the tempdir case is resumable. For either protected-path
  failure, report the denied path and exact `./agent setup` retry for the Developer to run from a
  normal terminal. Do not start `just session-unsandboxed` on your own.
- Never name a Bun install backend to work around this. `--backend=copyfile` writes every packaged
  file through its own path, making `bun install` unrunnable sandboxed rather than fixing it.

## Sandbox or host

- `./agent unsandboxed capabilities` distinguishes a sandbox denial from a missing host tool. Reach for it
  before concluding the host lacks something.
- Opt-in permission profiles launch as harness sessions — see `just --list`'s Sessions group.
  Codex reads the same profiles as `tao-review`, `tao-native`, `tao-local-services`, and
  `tao-release`, defaulting to `tao-workspace`.
- On a sandbox violation, use the failed command's report and `./agent unsandboxed capabilities` to distinguish
  a host requirement from a broken command. If a write needs host access, tell the Developer the exact
  operation and why, then pause until the Developer explicitly approves it in the conversation. Tool-level
  auto-review is not the Developer's approval. Do not try alternate spellings, a host session, or a policy
  change to route around the denial. `.rulesync/permissions.jsonc` grants only the named
  `./agent unsandboxed` host commands in default sessions; landing still needs authorization for the named slice.
- No agent sandbox reaches Watchman's socket, and only the opt-in `tao-local-services` profile
  reaches Docker's, by design: both sockets live under a developer's home directory, which a tracked
  config cannot name. Run file-watching dev loops with
  `./agent unsandboxed app-dev`, `test-watch`, `studio`, or `studio-native`, and the local InstantDB stack with
  `./agent unsandboxed local-instantdb start` or `stop`. A denied Watchman socket in a sandbox is
  expected; sandboxed tests and builds crawl the tree without it.
- The browser and native UI lanes cannot run inside the managed Bash sandbox. Use
  `./agent unsandboxed studio-smoke` or `./agent unsandboxed studio-proof-real-app`; if the host
  blocks Chrome there, rerun only with explicit review, and never reuse an existing browser profile.

## Processes and ports

- Inspect all processes with `./agent unsandboxed processes list`, one process's start time with
  `./agent unsandboxed processes started <pid>`, and one listening port with sandboxed
  `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`. Other process probes need the Developer's
  approval, and every signal stays under review since a prefix cannot validate a PID.
- Repository code reads process facts through `ProcessTree`, never through `ps`. On macOS it uses
  libproc with no subprocess, so a sandbox denial cannot silently degrade its PID-reuse protection.
- After review, confirm the PID belongs to the intended task. Send `kill -TERM <pid>` first and
  use `kill -KILL <pid>` only when the process survives graceful shutdown.
- Studio has its own lifecycle commands — `./dev studio-ps`, `./dev studio-stop`,
  `./dev studio-doctor` — and they are the right tool for a stray Studio process.
