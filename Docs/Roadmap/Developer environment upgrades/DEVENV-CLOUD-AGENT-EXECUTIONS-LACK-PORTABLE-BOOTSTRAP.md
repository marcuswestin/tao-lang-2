# DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP — Cloud agent executions lack a portable bootstrap

- **Status:** Planned
- **Section:** Deferred
- **Area:** Agent workflow; cloud development environment
- **Impact:** A cloud agent container without zsh or the pinned Nix/devenv profile cannot start the repository's `./agent` workflow, so it cannot set up, test, or verify a checkout.
- **Evidence:** On 2026-09-25, a cloud execution reported that `./agent` required zsh and a Nix/devenv profile, neither of which was present in its container. This branch introduces an interactive local development shell but has not proven a cloud bootstrap.
- **Workaround:** Run the workflow on a prepared local Mac until a cloud environment is supported.
- **Proposed change:** After the standalone developer-shell branch lands, provide a portable cloud bootstrap or a declared cloud image with the pinned tools. Make `./agent` discover and use that environment without assuming zsh or a preexisting local Nix/devenv profile. Keep local and cloud tool versions aligned and report missing host-only capabilities explicitly. Cover every supported cloud harness, including the editor-based cloud workflow.
- **Dependencies:** Land `feat/standalone-clean-machine-ship-pin` before changing the cloud entry path. Complete this task before closing the broader standalone development effort; it is not a blocker for that intermediate landing.
- **Acceptance:** Reproduce contributor setup locally in an isolated Ubuntu environment, then prove the workflow in an actual fresh cloud session for each supported harness. Bootstrap a checkout without preinstalled zsh or a Nix/devenv profile; run `./agent help`, `./agent setup`, a focused test, and the portable check/test/verify lanes. Record per-harness evidence and explicitly identify unavailable macOS-only lanes. Local success alone does not close the task.
- **Source:** Developer request, 2026-09-25.

## Local reproduction and cloud proof

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
