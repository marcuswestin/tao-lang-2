# UI interaction driver hardening

Reviewed against main `c8a997842` on 2026-10-06. The Developer approved four scoped changes,
including focused regression tests, then resumed implementation and required a review/fix loop.
The persistent cross-surface controller remains post-MVP.

## Decisions and waves

One implementation owner handles these waves sequentially; one independent read-only reviewer
checks the integrated result at medium effort. No package moves, dependencies or permission
changes are needed.

1. Standalone Appium cleanup keeps the target fenced until driver deletion and owned server
   shutdown are proved. Startup cleanup evidence survives a thrown startup without a returned
   handle. Logging and uninstall failures remain separate diagnostics.
2. CDP attachment preserves viewport and focus by default. Explicit attachment options request
   viewport emulation or activation. Managed acceptance requests its existing 1440x900 capture
   dimensions. Disconnect never terminates borrowed Chrome.
3. iOS and Android observation timestamps use an injectable calendar clock, with an actual
   calendar default. Monotonic duration clocks and historical evidence remain unchanged.
4. Mobile clients share element wrapping and common session forwarding. Element bindings belong
   to their creating session, including when another session reuses the same remote ID. Platform
   gestures, alert handling, deep links and Android Back remain distinct.

Keep authenticated control, runtime identity, generation fencing, target-specific visibility and
borrowed resources. `preheldTargetLease` remains a consumed, non-releasing attachment view; the
reservation holder remains the only target-release owner. Preserve Mac2 registration and the
stopped-port hold through lease release. Shared public contracts must describe differing semantic,
browser, mobile and physical input honestly; no backend replacement is part of this pass.

## Concurrent fences

At implementation start, other active work covers scenario QA discovery (`qa/`, `StudioReview`),
the first-hour tutorial (`Apps`, tutorial/QA evidence), preview speed, test process termination
(`CLI`, `Platform`, runner lifecycle), and journey shard selection (verification runner). This pass
does not edit those areas. Reinspect overlapping changes before later integration.

## Verification and ledger

Host-free controls cover cleanup, calendar clocks and mobile adaptation; Studio tooling tests cover
quiet CDP configuration and disconnect ownership. Managed attachment tests retain the existing
generation, revocation and non-releasing lease proofs. Mutation checks must reject unsafe target
release, automatic attachment activation and monotonic observation dates. Typecheck and changed
repository verification follow the integrated self-review and independent review.

The initial simplification audit measured the repository, not driver duplication. This pass removes
one repeated mobile element/session adapter body and addresses three concrete defects. Counts and
test outcomes belong to the final source diff and verification reports rather than a projected size
claim. Real device, native focus/consent/coexistence and Mac2 physical acceptance remain deferred.
The Developer subsequently authorized continuing through merge. Landing uses the repository's
hosted route and quiet complement; visible native/device acceptance remains deferred.

Measured scoped ledger: the eight touched non-test source files contain 4,886 lines at the base
and 4,966 after this pass (+80). Standing instruction lines and permission allowlist entries are
unchanged. One repeated mobile adapter body was removed; three defects were fixed (unsafe target
release, attachment side effects and monotonic calendar labels). Shared wrapper identity also
rejects foreign-session scoped elements with reused remote IDs.

Self-review and one independent read-only review found no actionable issues. Focused evidence:
22 CDP checks, 156 managed mobile checks, 9 Firebase acceptance checks and 72 managed-loop checks
passed; typecheck passed. Host controls initially passed all 184 checks. The restored-code run
passed 182, including every changed driver check, with timeouts in the two unchanged cold-build
fixtures under heavy machine load. Retain that failed receipt and recheck after integration.
Deliberate regressions failed the quiet attachment test and eight native cleanup, timestamp and
scope checks. All five mutated source files were restored byte-for-byte before review.

The opt-in host effect lint has 19 existing findings, reproduced from the base commit. Its open
ledger entry records the boundary repair separately. The native timestamp entry is resolved and
archived; real native/device acceptance and the persistent controller remain open.
