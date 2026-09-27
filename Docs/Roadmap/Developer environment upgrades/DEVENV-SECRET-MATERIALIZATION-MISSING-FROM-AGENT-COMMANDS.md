# DEVENV-SECRET-MATERIALIZATION-MISSING-FROM-AGENT-COMMANDS — Secret materialization is missing from agent commands

- **Status:** Candidate
- **Section:** External
- **Area:** Fresh worktrees, encrypted secrets, live acceptance commands.
- **Impact:** A fresh worktree cannot start an otherwise configured Clerk review through the approved command surface until the Developer manually materializes its credentials.
- **Evidence:** On 2026-09-26 at revision `586b3861`, `./agent unsandboxed clerk-review --no-browser` stopped while loading development configuration. The encrypted store and machine identity existed, but the worktree-local decrypted files did not. `SecretsFile.readDecryptedSecrets()` reads only those local files; `AgentCommands.ts` and the named host allowlist expose no `secrets` operation. No secret contents were inspected.
- **Workaround:** In a regular terminal, run `just secrets` from the new worktree and approve the secure-hardware prompt, then retry the review. The helper writes owner-only credentials without printing values.
- **Proposed change:** Provide a narrowly scoped, documented materialization operation through the agent front door, preserving interactive consent and avoiding credential values in output or inherited environments.
- **Dependencies:** Approval for any new host operation; the existing encrypted-secret helper and machine identity.
- **Acceptance:** A fresh worktree with existing encrypted credentials can materialize them through the documented operation, with required consent, owner-only output permissions, no printed values, and no modification of the encrypted store. Cancellation fails clearly without exposing credentials.
- **Source:** Clerk and physical-device acceptance continuation, `feat/clerk-device-acceptance`, 2026-09-26.
