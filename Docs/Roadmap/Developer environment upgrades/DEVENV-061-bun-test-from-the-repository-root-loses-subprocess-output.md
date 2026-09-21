# DEVENV-061 — `bun test` from the repository root loses subprocess output

- **Status:** Candidate
- **Section:** External
- **Area:** Test execution
- **Impact:** An agent debugging with a direct `bun test <path>` from the repository root sees tests
  that assert on captured command output fail, while the same tests pass through the repository's own
  lanes. The failures look like a red tree and invite a hunt for a regression that is not there.
- **Evidence:** 2026-09-17, `bun test packages/dev/dev-tests` from the root reported 610 pass / 41
  fail; `just verify-changed` ran the same suite through `./dev test` in the same checkout and
  reported 651 pass / 0 fail, as did `sh -c 'cd packages/dev && bun test dev-tests/green-tree.test.ts'`
  and `./dev test-file`. A probe inside a root-cwd `bun test` shows `spawn('git', …)` with a piped
  stdout delivering no `data` event before `close`, so `CLI.run` returns an empty `stdout`; the same
  probe under `bun run` captures normally. Sandboxed and unsandboxed runs behave identically, and no
  `bunfig.toml` or `.env` file is involved. The claim is narrower than first written: it holds for tests
  that assert on captured subprocess output, not for a root-cwd `bun test` generally. On 2026-09-17
  `bun test packages/dev/dev-tests/merge-with-main.test.ts` from the root gave complete output including
  subprocess stack traces, and was the only way to see a failure while `./dev` itself was mid-edit and
  broken; `bun test --cwd packages/<name> <relative-path>` was reliable throughout.
- **Workaround:** Prefer `./dev test-file <path>` or `just test <pattern>`. When those are unavailable —
  a broken `./dev`, or a shared module mid-edit (DEVENV-068) — `bun test --cwd packages/<name>
  <relative-test-path>` resolves `@shared/test` correctly and reports the real stack, and a root-cwd
  `bun test <file>` is usable for a file that does not assert on captured subprocess output. Do not
  trust a root-cwd `bun test` for the suites that do.
- **Proposed change:** Find what the root working directory changes about Bun's test runtime, then
  either fix the capture path in `Platform.spawn` or make a root-cwd `bun test` refuse and name the
  supported entry points.
- **Dependencies:** None.
- **Acceptance:** `bun test packages/dev/dev-tests` from the repository root agrees with `./dev test`,
  or says why it cannot and points at the command that does; the documented fallbacks stay usable when
  `./dev` is broken.
- **Source:** 2026-09-17 verification deduplication; 2026-09-17 branch-wide agent findings.
