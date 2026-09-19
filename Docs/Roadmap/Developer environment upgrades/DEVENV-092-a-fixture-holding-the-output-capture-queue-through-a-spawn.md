# DEVENV-092 — A fixture holding the output-capture queue through a spawn stalls its whole shard

- **Status:** Candidate
- **Area:** Test execution
- **Impact:** `withCapturedOutput` serializes process-wide by design, so a test that spawns child
  processes inside the capture holds every other capturing test in its shard behind it. The cost is
  paid by tests that did nothing wrong, it grows with machine load rather than with the work being
  tested, and it reads as a timeout in whichever test happened to be queued behind the slow one.
- **Evidence:** On 2026-09-18 `environment-fingerprint.test.ts` took 60.5 seconds for nine tests and
  was killed at the 60-second bound inside a `verify --complete` lane, while the same file ran in
  256ms focused. Two of its tests called `environmentFingerprintOf()` inside `withCapturedOutput`,
  which spawns a dozen short commands to ask the host about itself. Moving the gather outside the
  capture and sharing one reading between the two tests took the file to 395ms — a 150x difference
  with no change to what is asserted. The same shape is still live in two of `main`'s own fixtures:
  `test-runner.test.ts > an exact-file subset does not teach the full-suite timing estimate` runs a
  nested `TestRunner.runTestRequest` inside the capture and timed out at 60s twice including its
  isolated retry, and `gate-runner.test.ts` captures around `runGates`.
- **Workaround:** Run the file focused, where nothing else is contending for the queue.
- **Proposed change:** Do the expensive half before the capture and capture only the printing, which
  usually means splitting a command's gather from its write — `RepositoryDoctorCommand.writeFingerprint`
  is the worked example, a pure printer the test feeds an already-gathered value. Where a fixture
  genuinely must capture around a spawn, hold one shared result for the file rather than repeating
  it per test.
- **Dependencies:** Distinct from DEVENV-073, which is about assertions that read the real machine,
  and from DEVENV-079, whose load-scaled deadlines soften this symptom without removing the stall.
- **Acceptance:** No fixture spawns a child process inside `withCapturedOutput`, and the `dev` suite's
  wall time stops tracking how many capturing tests share a shard.
- **Source:** 2026-09-18 `feat/mvp-feedback-intake-doctor-134afd`, found and fixed in that branch's
  own test while gating it.
