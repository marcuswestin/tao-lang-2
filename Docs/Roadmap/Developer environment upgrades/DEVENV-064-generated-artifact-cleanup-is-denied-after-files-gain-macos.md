# DEVENV-064 — Generated-artifact cleanup is denied after files gain macOS provenance

- **Status:** In progress
- **Area:** Generated artifacts
- **Impact:** Repository gates cannot clean generated IDE, runtime, or Studio-test directories, and a
  parser-generation attempt can empty `_gen_tao-parser/module` before its replacement fails. The
  resulting `EPERM` or `EFAULT` turns cleanup into broad, unrelated test failures.
- **Evidence:** During the 2026-09-16 verification-foundation work, `verify-changed` and
  `verify --complete` failed recursively removing generated IDE, runtime-toolchain, and Studio
  scratch trees; the required unsandboxed retry failed identically. `ls -l@` showed inherited
  `com.apple.provenance` metadata throughout copied `@tao` trees. An earlier parser-generation
  attempt had already emptied its live output before the same cleanup denial surfaced. A focused
  probe then established the narrower host rule: file unlink and replacement work inside the
  checkout, while directory rename and removal fail; host-temporary directories remain removable.
  The same boundary left an old `.studio-device-trust.lock` directory undeletable, while a
  monotonic-versus-epoch age comparison prevented Studio from recognizing it as stale. On
  2026-09-17 an ordinary unsandboxed desktop shell on the same machine removed that directory with
  a plain `rmdir`, so the denial belongs to the managed task namespace, not to the checkout or its
  provenance alone.
- **Workaround:** For an emptied persistent generated tree, restore matching output from a checkout
  at the same source revision and verify that its generator reports `up to date`. Focused tests that
  do not copy and recursively remove provenance-marked trees remain usable. Keep disposable runtime
  and test roots in the host temporary directory; publish persistent generated output with
  transactional file replacement instead of checkout-directory replacement.
- **Proposed change:** The September remediation branch moves disposable runtime-test roots to host
  temp and makes parser and IDE generated-file publication rollback-capable without renaming or
  removing checkout directories. The Studio preview runtime is the exception and stays under
  `.artifacts/dev/studio-preview`: `expo start` requires `typescript` to resolve from the project
  root, and only a root inside the repository reaches its hoisted `node_modules` (a host-temp root
  failed every `./dev studio` launch). Preserve those boundaries, and separately identify why that
  task namespace prevents directory lifecycle operations.
- **Dependencies:** None.
- **Acceptance:** `verify-changed` and `verify --complete` can recursively clean the IDE, runtime,
  and Studio scratch trees; a forced generator cleanup denial leaves persistent output byte-for-byte
  intact and reports one actionable failure.
- **Source:** 2026-09-16 September remediation Wave 1 and acceptance remediation.
