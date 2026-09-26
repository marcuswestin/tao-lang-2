# DEVENV-COLD-VM-CHROME-STARTUP — Cold VM Chrome startup

- **Status:** Resolved
- **Area:** Standalone CLI clean-machine browser acceptance.
- **Impact:** The browser gate failed before Chrome initialized even though the installed CLI workflows passed.
- **Evidence:** In the vanilla Tahoe guest, copying Chrome through VirtioFS reported `Too many levels of symbolic links` for framework links. Host-side archiving and guest-side extraction preserve those links. A subsequent process sample remained at `_dyld_start +0`; the guest's `syspolicyd` log showed launch assessment still running near the original 20-second deadline. With a guest-specific 120-second budget, Chrome connected in 29.4 seconds and the counter click passed in `.artifacts/standalone-vm/tao-acceptance-1790401944-92561/logs/steps/browser-click.log` on `feat/standalone-clean-machine-ship-pin`.
- **Workaround:** None needed after the driver change; do not disable macOS launch assessment.
- **Proposed change:** Archive the signed browser bundle without host extended attributes, extract it before the guest audit baseline, and allow bounded first-launch assessment in the guest driver. Keep the normal host startup budget unchanged and retain startup stderr on failure.
- **Dependencies:** The host's installed Chrome remains the browser fixture; a version-pinned browser distribution is a future reproducibility improvement.
- **Acceptance:** The installed CLI's dev page renders the counter, accepts Increment, and updates without browser errors. The guest startup budget stays inside the outer browser-driver timeout. The VM and transfer archive are disposable.
- **Source:** Clean-machine acceptance and guest process/assessment diagnostics, 2026-09-26.
- **Archived:** 2026-09-26
