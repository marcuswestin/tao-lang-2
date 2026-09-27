# DEVENV-DEV-CLI-SHELL-TESTS-CANNOT-COPY-ZSHRC-IN-THE-SANDBOX — dev-cli shell tests cannot copy a zshrc inside the agent sandbox

- **Status:** Candidate
- **Section:** External
- **Area:** Verification in the agent sandbox
- **Impact:** 22 `cli/dev-cli` tests fail in any sandboxed agent lane that selects the suite, whatever
  the branch changed, so `verify-changed` reads as red for a docs-and-stdlib branch. The agent
  sandbox refuses writes to shell startup files by name, and the fixture copies
  `packages/cli/dev-cli/dev-cli-src/shell/.zshrc` into a scratch checkout.
- **Evidence:** 2026-09-27, `feat/layer-view` at `227a8f07`, `./agent verify-changed`:
  `EPERM: operation not permitted, copyfile '…/dev-cli-src/shell/.zshrc' -> '…/.artifacts/scratch/tao-dev-shell-XKbN3A/checkout with spaces/…/.zshrc'`
  from `prepareFixture` (`packages/cli/dev-cli/dev-cli-tests/enter-tao-dev-env.test.ts:15`). Log:
  `.artifacts/logs/verify-changed/2026-09-27T05-02-26-287Z-7742-35c7afc7/cli_dev-cli.log`.
- **Workaround:** None inside the sandbox; the suite passes only on the host, which
  `./agent unsandboxed finalize` and `land` run.
- **Proposed change:** Have the fixture store the startup file under a neutral name and link or
  rename it only where the shell reads it, or mark these tests host-only so sandboxed lanes skip
  them with a stated reason instead of failing.
