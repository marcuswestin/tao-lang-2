# DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP — Cloud agent executions lack a portable bootstrap

- **Status:** In progress
- **Section:** Deferred
- **Area:** Agent workflow; cloud development environment
- **Impact:** A cloud agent container without zsh or the pinned Nix/devenv profile cannot start the repository's `./agent` workflow, so it cannot set up, test, or verify a checkout.
- **Evidence:** On 2026-09-25, a cloud execution reported that `./agent` required zsh and a Nix/devenv profile, neither of which was present in its container. The interactive local shell has landed. The contributor bootstrap is in progress on `feat/cloud-contributor-bootstrap`; focused shell and lifecycle tests pass, but Linux installation and hosted runs remain unproved.
- **Workaround:** Run the workflow on a prepared local Mac until a cloud environment is supported.
- **Proposed change:** After the standalone developer-shell branch lands, provide a portable cloud bootstrap or a declared cloud image with the pinned tools. Make `./agent` discover and use that environment without assuming zsh or a preexisting local Nix/devenv profile. Keep local and cloud tool versions aligned and report missing host-only capabilities explicitly. Cover every supported cloud harness, including the editor-based cloud workflow.
- **Dependencies:** The standalone developer-shell work has landed. Complete this task before closing the broader standalone development effort. The Linux Nix 2.35.2 bootstrap dependency is approved and its archive checksum is pinned from the official installer. The container test needs a host session that loads the new named permission.
- **Acceptance:** Reproduce contributor setup locally in an isolated Ubuntu environment, then prove the workflow in an actual fresh cloud session for each supported harness. Bootstrap a checkout without preinstalled zsh or a Nix/devenv profile; run `./agent help`, `./agent setup`, a focused test, and the portable check/test/verify lanes. Record per-harness evidence and explicitly identify unavailable macOS-only lanes. Local success alone does not close the task.
- **Source:** Developer request, 2026-09-25.

## Local reproduction and cloud proof

Current implementation separates the portable tools from Android/CocoaPods while sharing their
existing lockfile pins. `bootstrap-tao-dev-env` is the explicit noninteractive entry; it publishes
a profile and calls the existing `./agent setup`. Root launchers select the profile's zsh through
POSIX shell. The dedicated `./agent unsandboxed contributor-linux-test` command snapshots committed
source into cold and cached Ubuntu guests. Its focused tests do not constitute a Linux run.
The first host probe was refused because the current session had not loaded that new permission.
The Developer's Terminal probe passed on 2026-09-26: Docker Desktop 4.88.1, Engine 29.7.2,
`linux/arm64`, using the containerd overlayfs snapshotter. The planned `linux/amd64` guest requires
emulation. This establishes host access, not a guest bootstrap or verification run.
The proposed 30 GiB disk allowance remains a measured budget, not an enforced container quota.
Provider setup instructions live in `.claude/cloud-setup.md`; actual hosted proof remains open.

- [ ] Verify each supported cloud harness's current OS, architecture, setup hooks, caching, and
      network constraints before choosing the final image. Compare the published
      [reference container](https://github.com/openai/codex-universal) and
      [cloud environment documentation](https://code.claude.com/docs/en/cloud-environments);
      do not treat a reference image as the exact hosted environment.
- [ ] Start with the proposed Ubuntu 24.04 `linux/amd64` environment, approximately four CPUs,
      16 GiB RAM, and a 30 GiB disk budget. Choose a container inside a Linux VM on macOS or a
      dedicated VM according to the required isolation. Measure architecture-emulation cost on
      Apple Silicon separately from repository performance, and verify disk-limit enforcement.
- [ ] Cache pinned Linux tool installation in a reusable image layer, but create a fresh checkout
      and writable environment per run. Apply the selected local revision/patch explicitly;
      never borrow the host checkout's dependencies, generated files, or developer profile.
- [ ] Exercise both cold bootstrap and cached-image setup, including worktree/session initialization,
      dependency installation, and portable repository verification. Retain logs, tool versions,
      image identity, resource limits, and cleanup ownership for failures.
- [ ] Run actual cloud smoke tests for every supported harness to cover hosted proxy, permissions,
      credentials, and setup-hook differences that the local Ubuntu environment cannot prove.
