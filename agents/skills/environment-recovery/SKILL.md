---
name: environment-recovery
description: >-
  Recover a Tao worktree whose tooling is wrong rather than whose code is wrong: a missing devenv profile, a tool shell without `.devenv/profile/bin` on PATH, a `bun install` the sandbox denied, a sandbox denial you cannot tell from a missing host tool, headless Chrome the host blocks, or a stray process and the port it is holding. Use when a repository command fails for a reason that is not the branch, when `which bun` looks wrong, when an install reports EEXIST or PermissionDenied, or when choosing between a sandboxed and an unsandboxed shell.
---

# Environment Recovery

Every failure here is the toolchain, not the branch. Read what the failing command printed
first: `./agent` and `./agent doctor` name the denied operation and the recovery for the cases
below, and following their output is faster and more current than this file. Come here when the
output is not enough, or when you need the reasoning behind it.

## The devenv profile

- `./agent setup` is the one setup entry, and every harness reaches it: Worktrunk's blocking
  pre-start hook, the session-start hooks the harnesses generate from `.rulesync/hooks.jsonc`,
  and Cursor's worktree setup. It bootstraps dependencies and the CLI build on every `./agent`
  call, so a stale worktree repairs itself by being used.
- In a linked worktree `./agent` reuses the primary checkout's pinned profile. If it reports no
  profile it prints the fallback itself: `direnv allow && direnv exec . ./agent setup`.
- The session-start hook puts `.devenv/profile/bin` on each tool shell's PATH, so call `bun`,
  `bunx`, `dprint`, `just`, and `node` directly, with no `export PATH=…` or `direnv exec .`
  prefix.
- If `which bun` shows a tool shell without the profile, run `./agent setup`. Exports do not
  persist between tool calls, so until a refreshed session supplies the PATH, prefix each
  affected invocation with `$PWD/.devenv/profile/bin/` rather than trying to fix the shell.
- `direnv exec .` works in an unsandboxed shell and fails in a sandboxed one: it re-resolves the
  devenv lock through `.devenv/bootstrap`, which needs the nix daemon socket the sandbox denies.
  That surfaces as `cannot connect to socket at '/nix/var/nix/daemon-socket/socket'` or,
  misleadingly, as `Failed to get attribute 'config.cachix.enable'`. Neither means the lock is
  broken.

## Denied installs

- A few npm packages ship `.idea/` and `.gitmodules`, which an agent sandbox protects inside the
  working directory and no setting exempts. A sandboxed install that must write one of them fails
  from either side: `PermissionDenied: …` when the write is refused outright, or
  `EEXIST: failed to link package` when the existing copy cannot be replaced.
- `./agent` distinguishes both from a denied temporary directory and prints the matching
  recovery. Only the tempdir case is resumable; for either protected-path failure, start an
  unsandboxed session with `just session-unsandboxed` and run `./agent setup` there.
- Never name a Bun install backend to work around this. `--backend=copyfile` writes every packaged
  file through its own path, which makes `bun install` unrunnable sandboxed rather than fixing it.

## Sandbox or host

- `./agent capabilities` distinguishes a sandbox denial from a missing host tool. Reach for it
  before concluding the host lacks something.
- Opt-in permission profiles are launched as harness sessions: `just session-review` for read-only
  work, `just session-native` for native build directories, `just session-local-services` only for
  the Docker-backed InstantDB stack, `just session-release` only for release artifacts, and
  `just session-unsandboxed` when the sandbox itself is the obstacle. Codex reads the same profiles
  as `tao-review`, `tao-native`, `tao-local-services`, and `tao-release`, defaulting to
  `tao-workspace`.
- On a sandbox violation, retry the command unsandboxed rather than abandoning the task. Never
  widen the policy to route around one, and never auto-approve a repository script as a host
  escape.
- The browser and native UI lanes cannot run inside the managed Bash sandbox. Run them through
  `./agent studio-smoke` or `./agent studio-proof-real-app`; if the host blocks Chrome there,
  rerun only with explicit review, and never reuse an existing browser profile.

## Processes and ports

- Inspect all processes with the fixed read-only shape `ps -axo pid=,ppid=,lstart=,command=`, one
  process's start time with `ps -o lstart= -p <pid>`, and one listening port with
  `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`. Every signal stays under review, because a wildcard
  command rule cannot validate a PID argument. Any other `ps` shape is denied by the sandbox rather
  than reviewed, so it fails with `operation not permitted`; add it to `.rulesync/permissions.jsonc`
  if it is genuinely needed.
- Repository code reads process facts through `ProcessTree`, never through `ps`. On macOS it uses
  libproc with no subprocess, so a sandbox denial cannot silently degrade it — which is exactly what
  happened to a liveness check that shelled out instead and lost its PID-reuse protection.
- After review, confirm the PID belongs to the intended task. Send `kill -TERM <pid>` first and
  use `kill -KILL <pid>` only when the process survives graceful shutdown.
- Studio has its own lifecycle commands — `./dev studio-ps`, `./dev studio-stop`,
  `./dev studio-doctor` — and they are the right tool for a stray Studio process.
