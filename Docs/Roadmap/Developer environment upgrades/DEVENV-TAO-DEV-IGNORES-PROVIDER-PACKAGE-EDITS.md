# DEVENV-TAO-DEV-IGNORES-PROVIDER-PACKAGE-EDITS — A running `tao dev` ignores provider package edits

- **Status:** Candidate
- **Section:** External
- **Area:** `tao dev`, Metro, `packages/providers/**`.
- **Impact:** A provider fix appears not to work in the running app, costing a debugging round before the loop is restarted.
- **Evidence:** On 2026-09-27 an InstantDB provider edit under `packages/providers/instantdb/` never reached the running app: the dev loop recompiles on runtime and app files only, and Metro kept serving the old provider module even after `touch`. Restarting `./agent unsandboxed app-dev` picked it up.
- **Workaround:** Restart the dev loop after editing a provider package.
- **Proposed change:** Watch the providers the app declares, and invalidate Metro's copy when one changes.
- **Dependencies:** None.
- **Acceptance:** Editing a declared provider's source while `tao dev` runs reloads the app with the new code.
- **Source:** Provider pairing and InstantDB auth, `feat/provider-bridges`, 2026-09-27.
