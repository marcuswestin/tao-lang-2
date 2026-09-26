# DEVENV-PARSER-STAGING-USES-WORKTREE-DIRECTORIES — Parser staging uses worktree directories

- **Status:** Resolved
- **Section:** External
- **Area:** Parser generation, test fixtures, managed filesystem lifecycle
- **Impact:** Every focused test requiring parser generation can fail before its tests execute;
  directory cleanup fails in managed worktree scratch even when individual file writes work.
- **Evidence:** On 2026-09-26, parser-gen failed removing `tao-parser-publish-ykoRLZ` under
  `.artifacts/scratch` and its generation directory. ParserGenerate's documented system-temp
  staging contract had been replaced with Repo.mkScratchDir at both creation sites. Returning
  both to FS.mkTmpDir made the same generator pass. The parser test fixtures also require
  location:host because their cases exercise directory removal, swaps and rollback. Focused tests
  passed after updating that boundary. A mutation restoring worktree staging failed the external
  staging and no-leftover-directory checks; production code was restored afterward.
- **Workaround:** A normal Terminal can run the old generator, but repeated manual runs are not
  needed after restoring its isolated staging contract. The live output transaction stays file-only.
- **Proposed change:** Use owned system-temp roots for parser generation and publication backups;
  keep repository output boundary checks, rollback, input-stamp validation and cleanup unchanged.
  Use the existing host-fixture option only in tests that exercise this filesystem lifecycle.
- **Dependencies:** Existing FS.mkTmpDir and mkTestDir location:host contracts. No new package.
- **Acceptance:** Generator and focused parser-generator suite pass in a managed shell; reverting
  the staging boundary makes the regression checks fail. A failed publication preserves the prior
  output, and owned disposable roots are removed by existing cleanup paths.
- **Resolution:** Restored the isolated staging contract on feat/auth-account-data. The
  focused parser-generation suite passes and the worktree-staging mutation fails.
- **Source:** Auth implementation recovery on 2026-09-26; relates to the earlier generated-output
  lifecycle findings in archived DEVENV-064, with this regression scoped to parser staging.
- **Archived:** 2026-09-26
