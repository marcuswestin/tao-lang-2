# DEVENV-054 — A forced `Bun.serve` stop strands another test's in-process WebSocket dial

- **Status:** Resolved
- **Area:** Package tests
- **Impact:** Under the dev suite's `--concurrent` flag, a test that stops a `Bun.serve` with
  `stop(true)` while another test's same-process `WebSocket` client is mid-dial to a different
  server leaves that dial without an `open`, `error`, or `close` event, so the second test hangs to
  its timeout. The lane reports it as a test assertion, not contention, and it reproduces only with
  several server tests in one file.
- **Evidence:** `bun test --concurrent packages/dev/dev-tests/dev-data.test.ts` on bun 1.3.13 hung the
  sync and conformance tests 12 of 12 runs until the client bounded its dials; a socket trace showed
  the dial coinciding with another test's `close 1006 Connection ended`. The server-backed cases now
  acquire a file-local serial turn through their completed teardown while retaining concurrency
  inside the two-authority and independent-process assertions; ten consecutive ordinary
  `--concurrent` runs passed, including an eight-cycle server/WebSocket ownership stress case.
- **Workaround:** None required after the fix. Server-backed tests in this file register through the
  local ownership helper so one case's forced stop cannot overlap another case's dial.
- **Proposed change:** Implemented with an explicit serial registration queue around only the
  in-process server/WebSocket cases; bootstrap-only cases remain ordinarily concurrent.
- **Dependencies:** None.
- **Acceptance:** Met: the normal `--concurrent` file command passes repeatedly without a test-host
  dial timeout, while the independent-process CAS/auth coverage remains intact.
- **Source:** 2026-09-05 Dev datasource implementation.
