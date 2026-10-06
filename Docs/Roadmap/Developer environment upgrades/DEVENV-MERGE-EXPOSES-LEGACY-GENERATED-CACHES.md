# DEVENV-MERGE-EXPOSES-LEGACY-GENERATED-CACHES — Merge exposes legacy generated caches

- **Status:** Candidate
- **Section:** External
- **Area:** Project-local state migration and repository verification.
- **Impact:** Integrating the new `.tao/store`, `.tao/local`, and `.tao/cache` layout can expose older generated files before local migration runs, blocking repository lint. Active loops or conflicting cache destinations can require retaining the older files.
- **Evidence:** Integrating main `e33f2d5ab` into `feat/firebase-validation-account-buttons` exposed `Apps/Hosted CRUD/.tao/connect-run/metro-events.cjs` and `Apps/Hosted Firebase/.tao/dev/runtime/*.cjs`. Full verification stopped in repo lint; receipt `.artifacts/logs/verify/2026-10-05T02-55-10-891Z-83352-8ebe0fbf/repo-lint.log`. `ProjectLocal.prepare` preserves conflicts, but captures retained ignore paths only when the older blanket ignore still exists; Git integration had already replaced that rule.
- **Workaround:** Root ignore compatibility rules cover the four recognized legacy generated layouts: `typescript/`, `bridge-check.tsconfig.json`, `connect-run/`, and `dev/runtime/` below `.tao`. Existing output and running loops are preserved; committed store files and unknown entries remain visible. Current generators use `.tao/cache`. One exact exclusion preserves the surviving `Apps/Hosted Firebase/.tao/project.json` identity beside the committed `.tao/store/project.json`; no identity file is moved or removed.
- **Proposed change:** Audit migration when Git has already updated ignore files, including retained conflicts and private local state. Preserve original privacy and active-loop paths without hiding authored store files or deleting unknown output. The cache compatibility rules address the observed lint failure, not the entire migration audit.
- **Dependencies:** None.
- **Acceptance:** A populated old checkout can integrate the new layout and verify while retaining conflicting generated output. Authored `.tao/store` files remain visible; private retained state remains ignored; no active loop is stopped or its paths moved without ownership evidence.
- **Source:** Hosted Firebase management follow-up main integration, 2026-10-05.
