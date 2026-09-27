# DEVENV-TEST-FILE-TAKES-NO-TAO-FILE-OR-TEST-NAME — `test-file` takes no Tao test file or test name

- **Status:** Candidate
- **Section:** External
- **Area:** `./agent test-file`, Tao tests, focused iteration.
- **Impact:** The front door's focused-test command covers only TypeScript tests with no name filter, so agents fall back to `./agent tao test <dir>` or raw `bun test`, which the guidance steers them away from.
- **Evidence:** On 2026-09-27 `./agent test-file` refused a `.tao` path, and refused a second argument naming a test (both parsed as Justfile recipes). `./agent tao test "Apps/Test Apps/Auth Review"` ran the Tao tests instead.
- **Workaround:** `./agent tao test <directory>` for Tao tests; run the whole TypeScript file.
- **Proposed change:** Accept a `.tao` path by delegating to `tao test`, and a `--name` filter passed through to the runner.
- **Dependencies:** None.
- **Acceptance:** `./agent test-file <file.tao>` and `./agent test-file <file.ts> --name <pattern>` each run just that selection.
- **Source:** Provider pairing and InstantDB auth, `feat/provider-bridges`, 2026-09-27.
