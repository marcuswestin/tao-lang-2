# DEVENV-PACKAGE-DISCOVERY-FIXTURES-INHERIT-PROJECT — Package discovery fixtures inherit the worktree project

- **Status:** Resolved
- **Area:** Package-discovery test isolation after project/module migration.
- **Impact:** Package and sidecar ownership tests fail when an unmarked scratch fixture inherits the repository's `.tao/` project root, blocking verification of otherwise valid source changes. Compiler and build fixtures likewise require unmarked host directories; build snapshots also inherited the marker.
- **Evidence:** On `feat/hosted-provider-acceptance-evidence`, integrated main `854427134` failed nine package-discovery tests in verify-changed on 2026-10-04. The nearest-ancestor `.tao/` ownership rule is correct; the fixtures omitted their intended project roots.
- **Workaround:** Declare the intended fixture root explicitly.
- **Proposed change:** Add `.tao/.gitkeep` markers to nine fixture roots and place the outside-Git fixture in a host temporary directory. Place deliberately unmarked sidecar, publication, and build host fixtures outside the repository as well. For actual builds with external sidecars, create the snapshot in host temporary storage with all post-allocation work covered by finally cleanup; keep ordinary snapshots in worktree scratch. Preserve every assertion and production resolver behavior.
- **Dependencies:** Main's project/module migration.
- **Acceptance:** `./agent test-file packages/language/ast-utils/ast-utils-tests/packages.test.ts` passes all 19 tests after the repair. `./agent test-file packages/compiler/compiler-tests/sidecar-source-graph.test.ts` passes all seven tests. `publication-compile.test.ts` passes all 11 tests, and `build-project-dependencies.test.ts` passes both tests after reproducing the production snapshot failure. The no-project check and nearest-marker fixtures also use host roots (30 and six tests pass). Connect fixtures explicitly mark their intended projects (20 tests pass), preventing writes at a containing project root. Hosted generator fixtures now use literal app identities and initialized project markers; their five hosted-provider and one Firebase checks pass with security assertions intact. Each fixture retains its `finally` cleanup.
- **Source:** Integrated verify-changed report `2026-10-04T16-24-14-915Z-2325-597b2369` and its `language_ast-utils.log`.
- **Archived:** 2026-10-04
