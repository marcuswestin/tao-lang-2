# DEVENV-STANDALONE-RUNTIME-SHIMS-ESCAPE-OWNED-STORAGE — Standalone runtime shims escape owned storage

- **Status:** In progress
- **Section:** External
- **Area:** Installed CLI; clean-machine filesystem acceptance.
- **Impact:** Installed host commands create Bun runtime shims outside Tao-owned storage, failing the mandatory filesystem audit and sharing a mutable per-runtime-version path with other processes.
- **Evidence:** Frozen source `0e3f6a9b`, vanilla run `tao-acceptance-1790524937-48051`, passed all 17 CLI/browser scenarios but failed filesystem acceptance. `/private/tmp/bun-node-744846f84/{bun,node}` were newly created symlinks to this run's installed `home/.tao/versions/0.0.0/tao`. The directory was mode 0700 and uid 501. Bun 1.4.2 uses a hardcoded shim root when forced with `--bun` or when lifecycle execution cannot find Node; changing `TMPDIR` alone cannot relocate it. Original snapshots and failures remain under `.artifacts/standalone-vm/tao-acceptance-1790524937-48051/logs/`.
- **Workaround:** None that establishes clean-machine acceptance. Do not allow all `bun-node-*` paths or remove a shared version root after a command.
- **Proposed change:** On `feat/repository-health-2026-09-27`, keep installed runtime launchers under owned storage and avoid the global shim creation path while retaining supported Expo and Jest behavior. Treat unrelated OS metadata through exact audited shapes separately.
- **Dependencies:** Bun's compiled-runtime dispatch and managed Node bootstrap; no dependency update approved.
- **Acceptance:** Fresh vanilla and prepared-Xcode clones complete installed CLI/browser scenarios and mandatory filesystem audits without escaped runtime shims. Focused launch/install regressions exercise cold setup, runtime argument semantics and supported child processes. Preserve failed evidence and account for retained resources.
- **Source:** September 27 repository health pass.
