# DEVENV-064 — Generated-artifact cleanup is denied after files gain macOS provenance

- **Status:** Resolved
- **Area:** Generated artifacts
- **Impact:** Repository gates cannot clean generated IDE, runtime, or Studio-test directories, and a
  parser-generation attempt can empty `_gen_tao-parser/module` before its replacement fails. The
  resulting `EPERM` or `EFAULT` turns cleanup into broad, unrelated test failures. The Tao test
  compiled store still moves directories inside the worktree, so app behavior tests and tutorial
  tests fail before execution in this managed namespace.
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
  provenance alone. On 2026-09-22, `./agent verify`, `./agent test-file
  packages/cli/tao-cli/cli-tests/tutorials.test.ts`, and `./tao test Apps/HNReader` failed with
  `EPERM` renaming a generated directory into
  `packages/apps/expo-host/_gen_tao-app-test/tao-test-command/.compiled`. An empty-directory rename
  failed both inside `.artifacts` and this generated tree, including through a reviewed unsandboxed
  command; the same operation succeeded under `/private/tmp`. File creation and rename still worked.
  After moving the Tao test store to host temp and teaching Jest the runtime package's module path,
  `./tao test Apps/HNReader` passed 8/8 journeys, WordFlower passed 29/29, the tutorial CLI test
  passed, and the focused runtime Jest checkbox test passed.
- **Workaround:** For an emptied persistent generated tree, restore matching output from a checkout
  at the same source revision and verify that its generator reports `up to date`. Focused tests that
  do not copy and recursively remove provenance-marked trees remain usable. Keep disposable runtime
  and test roots in the host temporary directory; publish persistent generated output with
  transactional file replacement instead of checkout-directory replacement.
- **Proposed change:** Done: disposable runtime-test roots live in host temp, while persistent app
  and IDE outputs are staged there and published with one rollback-capable, file-only transaction.
  The Studio preview runtime is the exception and stays under
  `.artifacts/dev/studio-preview`: `expo start` requires `typescript` to resolve from the project
  root, and only a root inside the repository reaches its hoisted `node_modules` (a host-temp root
  failed every `./dev studio` launch). Preserve those boundaries, and separately identify why that
  task namespace prevents directory lifecycle operations. The Tao test command and default runtime
  test workers now use a stable host-temporary compiled store keyed by runtime package; explicit
  fixture runtime roots keep their isolated output location. Jest resolves workspace packages from
  the runtime package's installed links even when the generated app lives outside its ancestor path.
- **Change made:** `FS.synchronizeDirectoryFileSets` publishes multiple generated roots under one lock,
  retains host-temporary backups until every move and stale-file removal succeeds, and restores the
  prior file set on failure. Runtime app generation and IDE bundle-plus-syntax publication now stage
  outside the checkout before using that transaction. Forced `EPERM` and `EFAULT` tests compare the
  entire prior output graph byte-for-byte after failure; focused shared, runtime-toolchain, and IDE
  suites pass 79, 22, and 15 tests respectively. The 2026-09-22 Tao test recovery adds an external
  generated-root option to `TestRunRoot`, selects host temp for default runtime test workers and the
  Tao test CLI, and supplies Jest with the runtime package's `node_modules` path.
- **Dependencies:** None.
- **Acceptance:** Met for the repository-owned publication boundary: forced cleanup denial leaves all
  persistent runtime and IDE outputs byte-for-byte intact and reports one failure, while successful
  publication removes stale files across both IDE roots as one transaction. The managed task
  namespace now completes ordinary HNReader and WordFlower `tao test` runs without generated
  directory-rename or directory-removal denial; `./agent verify` also passed its shared preparation
  and both Tao app shards.
- **Source:** 2026-09-16 September remediation Wave 1 and acceptance remediation.
- **Archived:** 2026-09-22
