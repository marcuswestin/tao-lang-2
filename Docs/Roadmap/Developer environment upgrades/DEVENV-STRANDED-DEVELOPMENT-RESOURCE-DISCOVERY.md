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
  fixed legacy output discovery under known project roots without adopting cleanup ownership,
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
its final report is `.artifacts/resource-hygiene-inventory-host-final.json`. These checks do not close the
deferred real Metro crash, mobile/native fault, focus, or human acceptance lanes.

The main layout migration surfaced previously ignored local `.tao/dev`, `typescript`, `sessions`
and bridge-check output in source scans and landing cleanliness checks. Narrow root compatibility
ignores preserve those legacy paths; current committed `.tao/store` remains visible. The resource
inventory reports fixed legacy locations under known project roots as unverified; presence alone
does not establish cleanup authority. One earlier failed controlled source fixture is retained pending
approval for its exact identity-fenced host cleanup operation.
The final inventory regressions passed 49 cases, followed by integrated typecheck. The read-only
host report found 275 fixed legacy locations across known checkouts, all classified unverified,
with no inspection warnings. Discovery reads metadata rather than legacy contents.
The Developer authorized committing and landing this source slice after its focused checks and
independent review. No dependency, machine setting, or broad asset cleanup is included. Live crash,
mobile/native, visible and human acceptance stays deferred.

## Controlled Firebase acceptance recovery — October 5, 2026

The task-owned loop19b718b0-3227-4048-89df-d2a2835128d8 stranded shutdown after a timed-out
worker control long poll. Source now uses bounded heartbeats/retry and abandoned-poll cleanup.
The stop-only controller recovery rechecks exact process, receipt, private control, and resource
custody before signalling and again before child cleanup; changed custody persists a durable
refusal. Independent review and36 recovery regressions passed. The live recovery stopped only
recorded services. A redundant Simulator shutdown initially retained its fence despite the exact
Simulator already being Shutdown. Authoritative exact-device inventory now proves closure;
41 source regressions cover successful closure and retained failures. The ordinary stop retry
proved cleanup and released that loop's Simulator.

A subsequent native Firebase attempt in loop645bfecb-f6bf-473c-b3e2-3e12dae7f557 retained
Appium server descendants after driver close. Its original runtime-marker failure preceded
Firebase interaction. Ordinary stop preserves the driver and target fences; recovery and
foreground diagnostics remain under investigation. This does not accept general mobile fault
cleanup or authorize removal of historical owner-unknown resources.

## Further bounded recovery evidence — October 5, 2026

The recorded645 driver retirement completed with a proved private audit and independent Simulator
Shutdown confirmation. A later e94a driver retirement likewise proved its recorded process/group
closure, listeners, three Appium port releases and target release. Both app journeys remain failed;
these recovery results supersede the investigation-only state above for those sessions alone.

A temporary exception for the exact before-driver3bae failure was independently reviewed and then
removed after TERM triggered that controller's ordinary cleanup. Its audit stays retained because
retirement observed a transient unreadable process; ordinary exit, target release and later normal
admission are separate evidence. No session-specific production exception remains.

The Appium close path now waits through a transient unreadable captured identity only in bounded
read-only observations after a signal. Capture, pre-signal, PID reuse, new group membership and
final-release checks remain strict. An actual iOS26.5 attempt then proved driver/server/resource
cleanup and ordinary stop without retirement. It still failed the application marker before Auth.
Historical owner-unknown resources and broad mobile fault acceptance remain outside this evidence.

The owned Firebase retry at 10:40UTC also closed its driver and server, but final process-group liveness publication returned `kill() failed: EPERM: Operation not permitted` for a recorded group, preserving reservations. Its initial retirement encountered a transient unreadable recorded Chrome child. Automatic approval review refused an immediate signaling retry; subsequent named read-only process queries established absence and the controller had disposed. The existing audited retry then proved closure, released all four reservations, and independently confirmed Simulator Shutdown. Preserve the original failed acceptance receipt separately from this recovery proof. This is not authority to ignore unreadable or permission-denied live identities, kill unrelated processes, or clear historical fences by directory matching.

## Directory registration follow-up — October 5, 2026

During native bridge validation, registering a task-owned Xcode result bundle through
`./agent resources --register-directory` failed while writing
`~/.cache/tao/resource-inventory/*.tmp` with `EPERM`. The named host route intentionally
accepts only read-only report forms and refuses registration flags. The bundle's
canonical `/private/var/...` path was verified first; `/var/...` is rejected by the
registry's existing symlink guard. Retained task-local directory notes preserve
ownership and cleanup conditions, but they do not constitute a successful registry
write. A future decision can add a narrowly scoped registration route or a writable
registration location; do not expand the current host report permission implicitly.

## Natural-exit records — October 6, 2026

The October 6 repository pass found 263 of 308 records in `~/.cache/tao/resource-inventory`
marked uncertain, about 200 of them `hutch` test launches and the rest `/bin/sh` and `bunx`. A
root that exited without a stop never captured its group, so `retireRegistration` marked it
uncertain and `retireProcess` then refused it forever; every Tao command printed the
needs-inspection banner. `StudioProcessTree` now captures the surviving group on a natural exit:
an empty group retires the record, survivors keep it until they are gone. A descendant that left
the group (`setsid`) and outlives a naturally exited root is no longer visible; before, it showed
only as one more uncertain record among hundreds. The existing uncertain records stay: no command
retires them, and a prune rule (for example, root and every recorded identity gone, group empty,
older than a week) is a cleanup-authority decision for the Developer, not adopted here.

## Parent-linked lifetimes and the startup sweep — October 7, 2026

The review of how Studio's children should end when Studio itself ends, by any exit including
SIGKILL, settled on two mechanisms built on the exact identities above, now implemented.

1. **A per-child death link.** `packages/shared/shared-src/ProcessLifetime.ts` grows the admission
   wrapper `StudioProcessTree` already used: the `/bin/sh` launcher reads the admission token on
   descriptor 3, then backgrounds a watcher that closes its standard descriptors and blocks reading
   the same channel, and `exec`s the requested command with descriptor 3 closed. The parent keeps
   its end open for the child's life and writes `release` when the child exits on its own. Any other
   end of the channel, which is the kernel closing it because the parent died, makes the watcher
   send SIGTERM and, three seconds later, SIGKILL to its own process group (`kill 0`), so no
   remembered PID is ever signalled and a reused PID cannot be hit. The link is the opt-in
   `lifetime: 'dies-with-parent'` on `CLI.start` and `CLI.run`; it implies `detached` and needs the
   three standard descriptors. `StudioProcessTree` now delegates to it, so Metro, Expo and the Studio
   test runner die with Studio. A `unref: true` child must carry
   `lifetime: { outlivesParent: '<reason>' }`, which records the survivor as a decision; the
   dev-loop controller launch moved from a bare `Platform.spawn` to `CLI.start` with that reason, and
   the agents server, the Android emulator, and the managed-loop fault fixtures carry theirs. A new
   repo-lint convention, `directSpawn`, refuses `Bun.spawn` and `Platform.spawn` outside the
   wrappers, with `WorkGraph.ts` and the spawn-wrapper tests on its allowlist.
   `packages/shared/shared-tests/process-lifetime.test.ts` proves the SIGKILL case (the linked
   sleeper is gone, the plain sibling is not), that the child inherits no end of the link, exit-code
   and argv preservation, release on natural exit, and the `unref` contract. Windows is left out: the
   link needs a `/bin/sh` process group, and the Job Object design that replaces it needs a Windows
   host to prove.
2. **A startup sweep.** `ResourceInventory.sweepStrandedProcesses` runs ahead of the startup
   advisory. For a process record with complete provenance whose owner's exact identity is gone and
   whose children still match their recorded identities, it sends SIGTERM and then SIGKILL through
   `ProcessTree.signalTracked`, which re-reads every identity from the kernel before signalling, and
   retires the record when every child is gone. Uncertain records, unreadable identities and children
   that survive both signals are left for the advisory, which is unchanged. The one new line is
   `Tao resources: stopped N stale process(es) left by an earlier session.` Tests cover the stop and
   retire path against a real sleeper, a live PID at a mismatched recorded identity that is never
   signalled, uncertain provenance and a live owner left alone, and a child that outlives both signals.

What the link does not cover is unchanged from the review: a whole group killed from outside with
the watcher in it, a tool that re-daemonizes with `setsid`, and power loss all fall through to the
sweep; externally owned resources (Watchman, simulators, the Android emulator) stay reported, never
killed.
