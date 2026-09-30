---
name: test-quality
description: >-
  Assess and improve Tao test quality. Use when writing, reviewing, consolidating, or deleting
  tests, or assessing parity coverage, vacuous assertions, shared helpers, global state, captured
  output, test naming, or claims that behavior journeys do not prove.
---

# Test Quality

- Assert against a selector, symbol, or path that exists. An assertion naming something absent passes forever and proves nothing; check the target exists before trusting a green test.
- Never build an expectation from the same source the assertion verifies. Pin a literal instead, or the test only proves the code agrees with itself.
- A test that calls a subject without asserting on it is a smoke test at best. Give it a real assertion or delete it.
- Before claiming parity from a clean diff, confirm the corpus exercises the paths that changed. A check with no coverage makes the evidence vacuous exactly where the risk is; write a probe against the pre-change code and compare.
- Mutation-test a new test before trusting it: break the behavior it covers and confirm it fails. This is required for concurrency, ordering, and lifecycle tests, where a passing test is often passing for the wrong reason.
- Before deleting one implementation in favour of an existing fallback, run both over the corpus and diff their results. A fallback reached only on a rare branch is under-exercised by construction, so its bugs are invisible until it becomes the only path.
- Search `@shared/test` before writing a helper. Deferred promises, settle and until waiters, fake terminals, captured output, module mocks, React Native stubs, clock control, and temporary directories already exist there.
- A test helper that replaces process-wide state must be correct when two uses overlap rather than nest. "Restore only what I installed" fixes nesting and still leaks under overlap: the first restore no-ops and the second reinstates the first's value permanently. Use the install stack in `@shared/test` (`testOverrideSlot`, mirrored for the runtime in `TR-test-override.ts`). Serialize instead only where the state accumulates and must not interleave at all, as captured process output does.
- Capture output a test provokes. A fixture diagnostic naming a real repository path reads as a genuine problem and sends readers chasing it.
- Name test files so the repository runner collects them and other runners' default globs do not. The runner collects `*.test.ts`; a compile-only fixture must sit outside every test glob.
- Keep every distinct behavior provable. When consolidating, name the surviving proof and verify it still exists; when it is gone, keep the test.
- Do not claim in a README or spec what the journey does not exercise. Either add the step or trim the claim and say where the behavior is actually proved.
- A test no recipe runs is not a test. Before trusting or extending a lane, confirm something invokes it (`git log -S <file> -- Justfile`); assertions added to an unreachable lane were never true, and land as a cascade of failures the day the lane first runs.
- A stubbed harness dependency can make a test's own assertions unreachable. A smoke that stubs the compile lane never publishes a preview manifest, so no scenario UI can render and every assertion about it fails on missing data, not a wrong selector. Check what the harness stubs before blaming the assertion.
- Read the live DOM before calling a selector stale. Source grep proves nothing about what renders: a class can be emitted through an import chain, and React's camelCase `onDragStart` never matches a lowercase `dragstart` grep. Dump the rendered tree, then decide.
