# DEVENV-051 — `sips` exits 13 inside a sandboxed agent shell

- **Status:** Candidate
- **Section:** External
- **Area:** Sandbox
- **Impact:** Any workflow that shells out to the system image tool — `tao create` reading a palette
  from an image, or an agent converting a screenshot — silently yields nothing in a sandboxed shell.
- **Evidence:** `sips -s format bmp -Z 48 <png> --out $TMPDIR/x.bmp` exits 13 with no output in the
  sandbox and exits 0 with a valid 24-bit BMP unsandboxed (found during the `tao create` review, 2026-09-04).
  `tao create` now reports the exit code and stderr instead of "no palette could be read".
- **Workaround:** Run image-reading smoke tests unsandboxed.
- **Proposed change:** Record `sips` as a host tool the sandbox blocks in `./agent capabilities`, so
  the denial is named rather than inferred.
- **Dependencies:** None.
- **Acceptance:** `./agent capabilities` reports whether `sips` can run in the current shell.
- **Source:** 2026-09-04 `tao create` review.
