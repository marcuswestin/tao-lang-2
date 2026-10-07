# DEVENV-SANDBOXED-LANES-CANNOT-REMOVE-ENV-FIXTURES — Sandboxed lanes cannot remove `.env` fixtures

- **Status:** Candidate
- **Section:** External
- **Area:** Sandbox
- **Impact:** `verify-changed` run from a sandboxed agent shell fails the `shared` suite whenever it
  selects the resource-inventory tests, which write `.env` files as fixtures: the tests themselves
  pass, then `TestCleanup` cannot delete the fixtures and fails the test. The lane stops there as a
  definite failure, so an agent never reaches the rest of its per-commit gate without the host.
- **Evidence:** 2026-10-06, `verify-changed` on `feat/verification-timing-weights`, run
  `2026-10-06T03-32-04-270Z-72412-f8bde571`, `shared_1.log`: three
  `resource inventory record safety` tests fail with
  `1 test directory cleanup operations failed: … .artifacts/scratch/resource-inventoryjjEVIv: EPERM:
  operation not permitted, rm`. The directories stay behind under `.artifacts/scratch/`; a direct
  `rm -rf` from the same shell stops at `Apps/Nested Project/.tao/typescript/.env: Operation not
  permitted`. The sandbox policy denies every `**/.env` path, including the fixtures a test writes in
  its own scratch directory. The unchanged tests pass unsandboxed. DEVENV-040 records the same
  denial for Expo's checked-in `.env` fixture under `node_modules`.
  A second report, `feat/landing-route-tooling` the same day (`.artifacts/logs/verify-changed/2026-10-06T03-37-45-442Z-55413-815de3e5/shared.log`), had no change under `packages/shared` and still failed the suite; `./agent test-file packages/shared/shared-tests/resource-inventory.test.ts` reproduced two of the three failures alone. It was filed separately and merged here by the 2026-10-07 repository pass.
- **Workaround:** Run the lane on the host, or run `./agent test-file` on the other changed
  suites and let hosted `Verify` prove `shared`. Remove the stranded scratch directories from an
  unsandboxed shell.
- **Proposed change:** Either name the fixtures something the policy does not match (`dot-env`,
  with the inventory reading the name from one constant) or carve `.artifacts/scratch/**/.env` out
  of the deny list in `.rulesync/permissions.jsonc`; the first keeps the policy simple.
- **Acceptance:** A sandboxed `./agent test-file packages/shared/shared-tests/resource-inventory.test.ts`
  passes and leaves nothing under `.artifacts/scratch/`.
- **Source:** 2026-10-06 verification-speed slice A landing.
