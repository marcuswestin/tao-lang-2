# Cloud setup

All three providers enter through `./bootstrap-tao-dev-env --install-nix` from the
repository root. It provisions the locked portable Linux tools noninteractively,
then calls `./agent setup`, the sole owner of repository dependencies and generated
adapters. `--install-nix` explicitly permits installation when Nix is missing.
For an image cache that needs tools alone, add `--tools-only`; run the full entry
after checking out the task's branch.

Fresh installation currently supports Linux x86_64 and pins Nix 2.35.2 with the
archive SHA-256 published in its official installer. Existing Nix installations
are reused. The disposable root-container path uses a single-user store without
a daemon; successful installation and portable verification still need a real
Linux run. An interrupted installation leaves a recovery marker: recreate the
disposable environment rather than treating its partial profile as a cache.

## Codex

Set **both Setup script and Maintenance script** in the cloud environment to:

```sh
./bootstrap-tao-dev-env --install-nix
```

Maintenance refreshes a cached environment after its task branch is checked out.
Setup shell exports do not persist into the agent phase; use `./agent`, `./dev`,
and `./tao`, which activate the checkout's profile on every invocation. Generated
local `.codex/hooks.json` is not the cloud setup contract.
[Cloud environment lifecycle](https://learn.chatgpt.com/docs/environments/cloud-environment).

## Claude Code

Use the same command as the cloud environment's setup script. The repository
SessionStart hook runs on starts and resumes. Every Linux session with
`CLAUDE_CODE_REMOTE=true` enters bootstrap, which checks the current locked tool
identity even when a cached profile exists, then calls `./agent setup`. Local
sessions retain ordinary setup without tool downloads.
When `CLAUDE_ENV_FILE` is supplied, the hook persists the profile PATH for later
tool commands. Multi-repository cloud sessions may not load repository hooks, so
configure the environment setup script explicitly.
[Cloud setup and hooks](https://code.claude.com/docs/en/cloud-environments).

## Cursor

The hand-maintained `.cursor/environment.json` runs the same bootstrap in
`install` to prepare each Build and in a one-shot `start` to refresh each session.
Feature branches overlay the active Build and may change its locked tools or
dependencies. Cursor documents session startup and branch checkout separately;
their ordering remains unproved. Until hosted proof establishes that `start`
sees the requested checkout, explicitly run `./bootstrap-tao-dev-env --install-nix`
after checking out or changing the task branch and before testing.

Builds retain disk state, not exported shell variables or processes; the
repository wrappers activate the profile as needed. No always-running server is
required. `.cursor/worktrees.json` remains the separate local worktree setup.
[Cloud environment setup](https://cursor.com/docs/cloud-agent/setup) and
[Build lifecycle and Git state](https://cursor.com/docs/cloud-agent/builds).

## Network and proof boundary

Provisioning needs access to the pinned installer, Nix sources and binary caches,
and the package registries used by `./agent setup`. Where a provider restricts
outbound traffic, configure its allowlist and proxy/CA trust for those downloads.
Do not disable certificate verification. In particular, Claude Code's GitHub
proxy can reject release assets from repositories not attached to the session.

The local Ubuntu runner also needs Docker Hub's token host `auth.docker.io`,
registry `registry-1.docker.io`, and documented blob host
`production.cloudfront.docker.com` ([Docker's allowlist](https://docs.docker.com/desktop/setup/allow-list/)).
Its amd64 base uses `archive.ubuntu.com` and `security.ubuntu.com` for APT, and the
pinned Nix archive comes directly from `releases.nixos.org`. GitHub, Nix's binary
cache, Cachix, and the package registry hosts are already in the canonical rules.
These are justified starting endpoints, not proof that every download or redirect
has been exercised. Add any further destination only from observed failure and
verified ownership; do not open general CDN wildcards or disable the proxy.

Named host execution and network access are separate: passing
`./agent unsandboxed capabilities` does not prove image downloads can pass the
session's network policy. After canonical policy edits, regenerate adapters with
`./agent setup`; protected adapter writes use the named
`./agent unsandboxed fix-agent-config` operation. A session that still rejects a
newly allowed domain must be restarted with the regenerated repository policy
before retrying, rather than bypassing its proxy.

If execution stops before cleanup reports, inspect only that run's base image
and containers with `./agent unsandboxed contributor-linux-test --inspect-run
YYYYMMDDTHHMMSSZ-PID`. It reports matching resources without starting or removing
them; shared images and builder caches are preserved. Inspection failure means
resource state is unknown. For exact owned containers still present, inspection also copies
workflow logs into its evidence directory without executing in or stopping the guest; missing
logs are reported separately. Guest repository lanes stream their existing verbose output.
Retained toolchain image ownership, once provisioned,
is recorded separately in the original run's `cache-ownership.txt`.

On an arm64 Docker daemon, `./agent unsandboxed contributor-linux-test --qemu-guest-base`
runs the same cold/cached sequence with the fixed, process-local
`QEMU_GUEST_BASE=0x800000000000` experiment from [Nix issue 16184](https://github.com/NixOS/nix/issues/16184).
The guest explicitly carries this setting through its clean environment; the tool-cache identity
is separate from the default run. It does not change Docker settings, emulator registration,
guest architecture, Nix version/checksum, or installation ownership. Default and hosted setup
remain unchanged. A passing experiment would establish this local workaround, not native amd64
or hosted acceptance; Nix derivation builders may clear environment variables again.

The separately authorized `./agent unsandboxed contributor-linux-test --qemu-compat`
adds process-local `NIX_CONFIG='filter-syscalls = false'` to that experiment. QEMU user mode
cannot load Nix's inner syscall filter; this option removes that inner restriction on builders
while retaining Docker's outer isolation, network policy, and default bootstrap settings. It
requires an arm64 daemon and uses another separate tool-cache identity. No host configuration,
additional capabilities, privileged container, or Rosetta change is made.

Actual fresh and cached hosted runs remain to be proved for each provider. Local
script tests establish dispatch and failure behavior; they do not prove provider
network access, Nix installation privileges, or a hosted verification run.
