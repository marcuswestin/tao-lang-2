---
name: test-quality
description: >-
  Assess and improve Tao test quality. Use when writing, reviewing, consolidating, or deleting
  tests, or assessing parity coverage, vacuous assertions, shared helpers, global state, captured
  output, test naming, or claims that behavior journeys do not prove.
---

# Test Quality

- Test Tao-owned behavior at the smallest boundary that can credibly prove it: syntax in the parser, source diagnostics in the validator, canonical output in the formatter, and distinct generated or executing behavior in the compiler and runtime. A broader test earns its cost by proving an additional integration or user-visible contract.
- Trust a dependency's documented contract. Test its own functionality only for an identified bug affecting Tao, documenting the affected versions and the condition for retiring that regression. Our invocation, configuration, encoding, mapping, state changes, and failure handling remain our responsibility.
- Mock external dependencies with small explicit fixtures from documented or sanitized output; keep the Tao implementation under test real. Retain real integration coverage when our actual invocation or effects are the contract. Search the shared helpers before building another mock framework.
- Validate uncertain data at its owning boundary. Remove downstream rechecks only while that guarantee remains valid; preserve external, user, and mutable-state validation, local invariants, necessary type narrowing, and fixture checks that make the behavior assertion meaningful.
- Name a test after the Tao behavior it protects. Before removing a check, identify the contract's owner and source, name the surviving proof of every distinct Tao behavior, and have an independent reviewer recheck the proposed removal against the current tree. Retain ambiguous checks and report the uncertainty; ownership is a judgment, not a semantic lint rule.
- Assert against a selector, symbol, or path that exists. An assertion naming something absent passes forever and proves nothing; check the target exists before trusting a green test.
- Never build an expectation from the same source the assertion verifies. Pin a literal instead, or the test only proves the code agrees with itself.
- A test that calls a subject without asserting on it is a smoke test at best. Give it a real assertion or delete it.
- Before claiming parity from a clean diff, confirm the corpus exercises the paths that changed. A check with no coverage makes the evidence vacuous exactly where the risk is; write a probe against the pre-change code and compare.
- Mutation-test a new test before trusting it: break the behavior it covers and confirm it fails. This is required for concurrency, ordering, and lifecycle tests, where a passing test is often passing for the wrong reason.
- Protect incremental performance with deterministic work counts, object identity, and cold-result parity in the owning package tests. These run under ordinary verification and can catch repeated work even on a busy host. A synthetic test of a benchmark reporter proves reporting policy, not product speed; pair numerical ceilings with a real measured workload in the periodic performance lane owned by `verification-lanes`.
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
