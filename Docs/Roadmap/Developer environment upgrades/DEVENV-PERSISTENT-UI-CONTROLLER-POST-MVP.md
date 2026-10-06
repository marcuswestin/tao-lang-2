# DEVENV-PERSISTENT-UI-CONTROLLER-POST-MVP — Persistent UI controller after MVP

- **Status:** Planned
- **Section:** Deferred
- **Area:** Development review across browsers, mobile devices, and native desktop apps.
- **Impact:** Existing drivers provide separate attachment and lifecycle interfaces; switching
  surfaces requires workflow-specific coordination.
- **Evidence:** The 2026-10-01 workflow pass retains existing CDP, mobile Appium, semantic native
  host control, and Mac2 facilities. A unified persistent controller was explicitly deferred until
  after MVP.
  Managed app-loop start/status/logs/stop/restart/reload is an approved lifecycle improvement;
  it does not add the deferred cross-surface attachment or interaction service. Managed mobile
  attachment now delegates a revocable non-releasing `preheldTargetLease` view from the
  reservation holder, binds it to session/loop/target/resource generations and retains one release
  owner. This landed as `20bbeff06b95`; source proof and limited Android interaction do not complete
  the host matrix. Confirmed 2026-10-04: the unified persistent controller remains post-MVP, with
  no additional implementation in the cleanup/documentation follow-up.
  The 2026-10-06 review against main `c8a997842` recommends one controller with multiple adapters,
  retaining semantic/browser/mobile/physical evidence differences. Scoped cleanup custody, quiet
  CDP attachment, calendar timestamps and shared mobile adaptation are tracked in
  [UI interaction driver hardening](<../../Archive/Plans/Repository simplification 3/Plan.md>); they do not implement
  the deferred persistent interaction service.
- **Workaround:** Use existing named workflows and drivers, with scoped visibility permission and
  target-specific `--show-*` options for visible checks.
- **Proposed change:** After MVP, design one persistent session interface for attaching to owned
  targets, screenshots and interaction, isolated parallel use, lifecycle ownership, and cleanup.
  Preserve in-app review preference and quiet defaults. Settle its interface before implementation.
- **Dependencies:** MVP completion; no implementation in the current workflow pass.
- **Acceptance:** A later design settles supported surfaces and actions, attachment versus process
  ownership, concurrency, visibility permission, recovery, and bounded teardown before code work.
- **Source:** Developer-directed quiet development and testing workflow plan, 2026-10-01.
