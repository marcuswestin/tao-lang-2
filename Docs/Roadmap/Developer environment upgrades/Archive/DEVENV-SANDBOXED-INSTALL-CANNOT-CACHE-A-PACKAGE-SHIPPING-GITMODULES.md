# DEVENV-SANDBOXED-INSTALL-CANNOT-CACHE-A-PACKAGE-SHIPPING-GITMODULES — Sandboxed install cannot cache a package shipping .gitmodules

- **Status:** Resolved
- **Area:** Dependency installation
- **Impact:** A lockfile change that adds a package shipping `.gitmodules` (or `.idea/`) makes every
  sandboxed `./agent` call fail its install: the agent sandbox refuses to write that file into Bun's
  cache, and Bun reports the refusal as a failed download. The printed recovery,
  `just clean-scratch, then ./enter-tao-dev-env`, addresses a different failure, and the documented
  recovery for the neighbouring protected-path failures handed the Developer a terminal step.
- **Evidence:** 2026-10-04, after merging `main` at 883ea9ee into `feat/tao-install-offer`: a sandboxed
  `./agent ledger-index` printed `error: failed to download url-template@2.0.8: EPERM` and
  `Recover with: just clean-scratch, then ./enter-tao-dev-env`. The cached package holds a
  `.gitmodules` file. `./agent setup` outside the sandbox installed it in 3.3s.
- **Change made:** `feat/land-message-confirm-and-gitmodules`. `ensure-dependencies.zsh` names the
  package and the cause for `failed to download <package>: EPERM`, and every protected-path install
  failure now recovers with `./agent unsandboxed setup`, a new named host operation running the same
  entry the SessionStart hook already runs on the host. `environment-recovery`, `./agent doctor`, and
  the Studio README say the same. DEVENV-084 covers the forced-relink variant.
- **Acceptance:** A sandboxed install that hits the cache refusal prints the package and
  `Recover with: ./agent unsandboxed setup`, and that command installs it.
- **Source:** Landing `feat/tao-install-offer`, 2026-10-04.
- **Archived:** 2026-10-04
