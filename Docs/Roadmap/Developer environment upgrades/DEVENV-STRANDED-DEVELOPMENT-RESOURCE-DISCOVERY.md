# DEVENV-STRANDED-DEVELOPMENT-RESOURCE-DISCOVERY — Stranded development resource discovery

- **Status:** In progress
- **Section:** External
- **Area:** Development-loop lifecycle, command startup, and post-landing resource review.
- **Impact:** Detached Expo children can survive a forced controller exit, and abandoned output can
  remain undiscovered after landing. Process age or parentlessness alone cannot authorize cleanup.
- **Evidence:** The October 4 scoped cleanup found old HNReader and preview Metro listeners.
  Their exact original invocations and interruption causes remain unproved. Source inspection also
  found foreground Expo's second-signal exit could interrupt its first cleanup, and no unified
  startup/post-landing inventory or structured external-directory registration.
- **Workaround:** Read ownership receipts and inspect exact process identities before explicit
  stop/recovery. Preserve quarantined assets where the original owner cannot prove shutdown.
- **Proposed change:** Add one read-only resource inventory, lightweight startup advisories,
  post-landing reports, durable detached-launch discovery records, task directory registrations,
  and draining INT/TERM/HUP shutdown. Require a concrete cleanup offer after landing.
- **Dependencies:** Existing process kernel identities, managed-loop receipts, and machine-lane
  ownership records. No dependency installation, default runtime timer, or automatic cleanup.
- **Acceptance:** Focused source checks must cover dead-owner/live-child detection, PID reuse,
  failed inspection, retained ownership, directory identity drift, symlink/malformed-record refusal,
  JSON-safe advisories, repeated signals, and descendant shutdown. Run a read-only host inventory.
  Deliberate real Metro/controller crash acceptance and visible/native/mobile fault checks remain
  deferred; no source test substitutes for those measurements. Unpublished launches and historical
  owner-unknown resources remain unverified rather than adopted.
- **Source:** Developer request in the managed-loop follow-up on October 4, 2026.

## Implementation evidence — October 4, 2026

Implemented in the shared `dev/ro` checkout after merging main `f27f8bb0e715`. The common
inventory is available through Tao and repository commands; `./agent unsandboxed resources --json`
provides full read-only host process visibility. Its host route accepts only the report forms,
not directory registration, arbitrary process selectors, or cleanup. Canonical configuration
regenerated both harness adapters.

Launch intentions are recorded before allocation. A fixed embedded shell launcher waits on a
private fourth descriptor until its kernel identity is durably published, then uses `exec` to
preserve that identity and the requested argv/standard streams. This avoids the short-lived
executable race; failed publication never executes the requested command. Failed publication
drains identity-fenced rollback before returning failure, and shutdown persists captured descendants before signaling.
INT/TERM/HUP coalesce on one draining teardown; no default runtime timer was added. Unreadable,
unpublished, or incomplete ownership remains unverified. Completed landing records an inventory;
the owning workflow requires a concrete task-resource cleanup offer before any removal.

Focused source regressions cover publication failure, stopped-launcher rollback at the caller
boundary, escaped descendants, unrelated-process preservation, signal coalescing, receipt
uncertainty, linked-to-primary discovery, and read-only host argument refusal. Integrated typecheck
and dead-export checks passed. The full host inventory completed without inspection warnings;
its report is `.artifacts/resource-hygiene-inventory-host.json`. These checks do not close the
deferred real Metro crash, mobile/native fault, focus, or human acceptance lanes.

The main layout migration surfaced previously ignored local `.tao/dev`, `typescript`, `sessions`
and bridge-check output in source scans and landing cleanliness checks. Narrow root compatibility
ignores preserve those legacy paths; current committed `.tao/store` remains visible. The resource
inventory still reports the legacy locations. One earlier failed controlled source fixture is retained pending
approval for its exact identity-fenced host cleanup operation.
The Developer authorized committing and landing this source slice after its focused checks and
independent review. No dependency, machine setting, or broad asset cleanup is included. Live crash,
mobile/native, visible and human acceptance stays deferred.
