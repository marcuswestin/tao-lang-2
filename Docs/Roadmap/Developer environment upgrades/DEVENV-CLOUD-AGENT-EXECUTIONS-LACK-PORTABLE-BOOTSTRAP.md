# DEVENV-CLOUD-AGENT-EXECUTIONS-LACK-PORTABLE-BOOTSTRAP — Cloud agent executions lack a portable bootstrap

- **Status:** Planned
- **Section:** Deferred
- **Area:** Agent workflow; cloud development environment
- **Impact:** A cloud agent container without zsh or the pinned Nix/devenv profile cannot start the repository's `./agent` workflow, so it cannot set up, test, or verify a checkout.
- **Evidence:** On 2026-09-25, a cloud execution reported that `./agent` required zsh and a Nix/devenv profile, neither of which was present in its container. This branch introduces an interactive local development shell but has not proven a cloud bootstrap.
- **Workaround:** Run the workflow on a prepared local Mac until a cloud environment is supported.
- **Proposed change:** After the standalone developer-shell branch lands, provide a portable cloud bootstrap or a declared cloud image with the pinned tools. Make `./agent` discover and use that environment without assuming zsh or a preexisting local Nix/devenv profile. Keep local and cloud tool versions aligned and report missing host-only capabilities explicitly.
- **Dependencies:** Land `feat/standalone-clean-machine-ship-pin` before changing the cloud entry path.
- **Acceptance:** In an actual fresh cloud container with no preinstalled zsh and no Nix/devenv profile, bootstrap the checkout, run `./agent help`, `./agent setup`, a focused test file, and a repository check successfully; document which macOS-only lanes are unavailable there.
- **Source:** Developer request, 2026-09-25.
