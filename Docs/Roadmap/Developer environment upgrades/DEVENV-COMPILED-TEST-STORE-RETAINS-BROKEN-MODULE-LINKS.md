# DEVENV-COMPILED-TEST-STORE-RETAINS-BROKEN-MODULE-LINKS — Compiled test store retains broken module links

- **Status:** Candidate
- **Section:** External
- **Area:** Tao app test compilation cache
- **Impact:** A complete verification run can fail every Tao app shard when a retained compiled `App.tsx` links to a module tree that no longer exists, even though the source and generated parser are healthy.
- **Evidence:** On 2026-09-24, `./agent unsandboxed finalize` failed all 17 `tao-apps` shards with `Cannot find module './modules/Design.tao'` from a retained host-temp `.compiled/.../App.tsx`. That entry's `modules` symlink pointed to a missing sibling content-hash directory. `./agent doctor` passed, including dependencies and parser artifacts. `./agent test-retry` then passed `tao-apps`, and the next complete `finalize` verification passed all test suites. The first failure is in `.artifacts/logs/verify/2026-09-24T22-19-39-903Z-91790-204cb65e/tao-apps_1.log`; the recovery is in `.artifacts/logs/dev-test/2026-09-24T22-21-34-454Z-97997-1c70706e/tao-apps.log`.
- **Workaround:** Use `./agent test-retry` to rebuild the unsettled Tao app suite, then rerun the complete gate. This did not require deleting shared temporary state. Preserve the original failed-gate evidence.
- **Proposed change:** Audit the compiled store's cache reuse and pruning so a retained app entry and every linked module tree have the same lifetime. Reject or regenerate a cached app whose module symlink target is absent before launching Jest.
- **Dependencies:** Main subsequently moved retained test state outside OS temp (`f10e7429`) and test scratch into worktrees (`e94c3e1a`). Reproduce against those current locations as well as preserving the original host-temp evidence; moving storage alone does not prove linked module lifetimes are correct.
- **Acceptance:** Repeated complete verification from both fresh and retained host-temp compiled stores never reuses a dangling module link; a focused test that removes a module tree causes regeneration or a precise cache error rather than failing every app journey.
- **Source:** Additive release QA tag correction on `feat/mvp-release-qa-plan`.
