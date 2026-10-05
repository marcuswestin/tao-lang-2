# DEVENV-MERGE-WRITE-PROBE-REFUSES-READ-ONLY-SKETCHES — Merge write probe refuses read-only tracked sketches

- **Status:** Candidate
- **Section:** External
- **Area:** Feature integration preflight; Studio generated sketch permissions.
- **Impact:** Finalize and host-side merge-main refuse a valid integration that removes clean tracked Studio sketches because the probe opens each file for writing, although Git can unlink it through its writable parent directory.
- **Evidence:** On 2026-10-04, finalize and unsandboxed merge-main stopped before Git on clean tracked HNReader `@/studio/View1.tao`, `View3.tao`, and `View4.tao`, each mode 0444 with a writable parent. Logs: `.artifacts/logs/agent/finalize/2026-10-04T14-58-40-407Z-81302.log` and `.artifacts/logs/agent/merge-main/2026-10-04T14-59-39-524Z-88413.log`. After checking those exact paths had no diff from HEAD and adding owner-write permission, the same named merge reached ordinary content conflicts; log `.artifacts/logs/agent/merge-main/2026-10-04T15-02-02-915Z-2611.log`. This is a Unix permission false refusal, separate from the protected-path half-merges recorded in archived DEVENV-111.
- **Workaround:** Confirm each affected sketch is clean and task-owned, add owner-write permission to those exact files, and retry the named integration workflow. Preserve authored changes and unrelated read-only files.
- **Proposed change:** Make the probe distinguish a file replacement or deletion, which requires writable parent access, from an in-place content write. Retain the protected-path checks and report the actual permission needed without weakening the host boundary.
- **Dependencies:** None.
- **Acceptance:** A clean tracked 0444 file inside a writable directory can be replaced or removed by the named integration workflow; a genuinely unwritable parent or protected harness path still refuses before mutation. Probe cleanup remains intact.
- **Source:** Studio preview speed integration on `feat/studio-preview-speed`, 2026-10-04.
