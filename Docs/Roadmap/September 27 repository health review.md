# September 27 repository health review

## Boundary and method

Review window: the 41 first-parent landings after `e94c3e1a`, through
`0e3f6a9bc5d63042e2eb4a60d6c1be78986d12fe` (895 changed files). Three read-only specialist
reviews covered language/auth/data, Studio/native behavior, and developer tooling. The integration
owner independently checked surviving source findings before authorizing disjoint repairs.
Separate workers inventoried metadata and exclusively owned sequential isolation acceptance.
Later main changes require an explicit integration review; they do not silently move this boundary.

The Developer authorized repairs, justified deletion and product-semantic decisions, with questions
handled alongside independent work. Landing and publication remain separate. No dependent semantic
change is made before its decision. A source disposition does not claim host/device execution.

## Findings and repairs

| ID | Severity | Finding                                                                         | Disposition                                                                                                                                             |
| -- | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1 | P2       | One explicit retry releases every failed Reference write for a row.             | Repaired; explicit retry selects only the oldest failure and preserves later failures and queued work.                                                  |
| L2 | P2       | Enum defaults accepted by validation disappear from generated schemas.          | Repaired; compiler metadata assertions and a Tao journey cover default and explicit cases.                                                              |
| L3 | P2       | Authenticated local-only data reads an unconnected, sealed scoped store.        | Account-versus-device custody decision requested; unrelated repairs continue.                                                                           |
| L4 | P2       | Handled cancellation omits interruption of a suspended ask.                     | Repaired; shared cycle-safe invocation traversal and mounted nested-ask regression.                                                                     |
| L5 | P3       | Data spec denies the implemented native proof opt-in.                           | Spec corrected; default strict azp and no-Origin exception remain explicit.                                                                             |
| S1 | P2       | Feed drop reaches palette handler and shows a false malformed-palette error.    | Repaired; shared-target event regression preserves Feed success and malformed palette diagnostics.                                                      |
| S2 | P2       | Interrupted Studio startup retains Feed listeners/controller work.              | Repaired; shared acquisition lifetime, queued-request cancellation and late-result suppression, with mutation controls.                                 |
| T1 | P1       | Mutation failures can receive ordinary flake tolerance and contaminate history. | Repaired with an explicit mutation lane; raw verdict and unchanged ordinary history proven by fixture controls.                                         |
| T2 | P2       | Workflow reports borrow concurrent failures through shared latest summaries.    | Deleted timestamp/latest inference; controlled overlap reproduces the old defect and proves invocation-owned reports.                                   |
| I1 | P2       | Fresh vanilla acceptance passes scenarios but fails mandatory filesystem audit. | Repaired with owned runtime launchers and exact OS metadata exceptions; fresh vanilla and prepared-Xcode filesystem audits report no policy violations. |
| I2 | P2       | Collected guest scenario receipt remains running despite successful stdout.     | Guest sync and fail-closed terminal checks implemented; fresh vanilla and prepared-Xcode collections contain every terminal passing scenario.           |

## Landing dispositions

| Commit     | Landing                                                                | Review disposition                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8cccdaed` | Add git-bug adoption and GitHub Issues sync to the MVP roadmap         | Planned issue-tracker adoption; no implementation or publication claim.                                                                                                                                                                |
| `1bbe15e2` | Keep test Git fixtures out of the real repository                      | Git fixture ownership, initialization failure and repository-ceiling guards reviewed; no additional finding.                                                                                                                           |
| `b04d4b63` | Record selected post-MVP product targets                               | Post-MVP target selection preserves unresolved design and priority decisions.                                                                                                                                                          |
| `aacd3f0c` | Protect and report worktrees attached to local agent tasks             | Task-protecting reclaim behavior reviewed; no deletion eligible in current inventory.                                                                                                                                                  |
| `0882eeaf` | Run pull-request workflows only when a pull request opens              | Opened-only workflow trigger is intentional; landing remains the repository gate.                                                                                                                                                      |
| `08156b44` | Plan initial MVP release QA                                            | Release QA plan separates public artifacts and device/channel acceptance.                                                                                                                                                              |
| `c85bcec5` | Review September 25 repository landings and repair two regressions     | Prior search and installed-host repairs retained; this pass starts after its recorded boundary.                                                                                                                                        |
| `fb8d9745` | Prevent promise assertions from losing Git child completion            | Earlier process completion defect later repaired by 7e31891e.                                                                                                                                                                          |
| `b1934571` | Temporarily quarantine unstable host and compiler cleanup tests        | Temporary quarantine later removed by 7e31891e; no outstanding quarantine claim.                                                                                                                                                       |
| `9ba5058d` | Ship first standalone macOS Tao CLI slice                              | Portable packaging reviewed; current vanilla acceptance exposed I1 filesystem audit failure.                                                                                                                                           |
| `7e31891e` | Repair subprocess completion and restore quarantined tests             | Process completion repair and restored tests reviewed.                                                                                                                                                                                 |
| `96c67a2b` | Run standalone VM acceptance through Tart exec                         | Tart exec and ownership reviewed; current isolated acceptance recorded separately.                                                                                                                                                     |
| `82393b8c` | Reserve Expo ports across wildcard and loopback addresses              | Wildcard/loopback reservations, partial-release and accepted-client teardown reviewed.                                                                                                                                                 |
| `3b092036` | Expand standalone VM scenarios and qualify prepared bases              | Prepared-base/audit behavior reviewed; I1 found by new vanilla run.                                                                                                                                                                    |
| `f9b68349` | Add background app command RPC                                         | App opt-in, scalar commands, metadata, receipts and account-generation fences reviewed; desktop endpoint identity, capability, Origin, deadlines and unknown-outcome/no-retry transport behavior also reviewed; no additional finding. |
| `0a4c8150` | Add scoped authentication and authoritative account data               | L1, L2, L3; auth/data repair candidates.                                                                                                                                                                                               |
| `880aec55` | Require exact commands in developer action requests                    | Exact-command response instruction reviewed; no code behavior change.                                                                                                                                                                  |
| `dfae273a` | Require explicit singular and plural data imports                      | Singular/plural imports, aliases, declaration-context relation lookup and source-action migrations reviewed; no additional finding.                                                                                                    |
| `aa32fd88` | Clean up successful agent acceptance WebKit profiles                   | Unique profile identity and process-identity checks precede deletion; failed proofs retain evidence.                                                                                                                                   |
| `17f6ceeb` | Fix Studio gestures and keep dev shell caches out of source            | Studio held-Space iframe barrier and teardown reviewed; wheel changes reconciled with later preview ownership. Shell caches remain isolated.                                                                                           |
| `b07e97ed` | Add Clerk authentication through Tao's existing auth interface         | Clerk rendezvous, cancellation, durable logout, refresh deadlines, proof verification and auth-database mode fences reviewed; later fixes retained.                                                                                    |
| `782bf66f` | Give overlays the confirmation backdrop                                | Overlay confirmation backdrop inspected; no additional finding.                                                                                                                                                                        |
| `7d686fb9` | Complete Studio navigation, inline text editing and lifecycle commands | Studio viewport persistence, text geometry, editing, zoom, undo and key transport reviewed; no additional finding.                                                                                                                     |
| `1f2710f2` | Repair native navigation and establish mobile acceptance evidence      | L4; asked-view cancellation repair candidate. Native review included.                                                                                                                                                                  |
| `f6cb6a19` | Add isolated Mac Catalyst trials and quiet UI workflow guidance        | Catalyst style/tab adaptation reviewed; host trial evidence remains a separate boundary.                                                                                                                                               |
| `d5bdeaef` | Finish developer tooling and provision pinned native verification      | Watchman named-operation boundary and native provisioning reviewed; no host toolchain rebuild claimed.                                                                                                                                 |
| `59b4ea80` | Preserve subprocess output and prove cache process lifecycle           | T1; existing mutation-verdict defect confirmed. Process/cache repair retained.                                                                                                                                                         |
| `86cccd63` | Lower verification priority and stabilize CPU-accounting tests         | Verification-only priority lowering and controlled CPU-accounting evidence reviewed; no additional finding.                                                                                                                            |
| `f0d36ded` | Record deferred macOS startup confirmation                             | Restart confirmation remains a separate human observation; no reboot in this pass.                                                                                                                                                     |
| `563f7d17` | Complete Clerk setup, native review and automated acceptance           | L5; native auth spec corrected to the implemented strict-default opt-in.                                                                                                                                                               |
| `898f5f97` | Repair iPad navigation layout and Catalyst appearance                  | iPad inset/title handling, Catalyst appearance and scheme runtime reviewed; physical layout acceptance remains separate.                                                                                                               |
| `b0f939bc` | Offer automatic direnv activation for Tao development worktrees        | Consent records, shared configuration, worktree identity and generated shell completion reuse reviewed; no additional finding.                                                                                                         |
| `d24c760d` | Keep tasks visible until manually archived                             | Manual task archival rule reviewed; no automatic archival requested.                                                                                                                                                                   |
| `47fa4dc9` | Complete Studio Feed, sketch review and preview navigation             | S1, S2; Feed drop dispatch and interrupted mount cleanup repair candidates.                                                                                                                                                            |
| `cf026539` | Bootstrap portable contributor and cloud development environments      | Portable bootstrap reviewed; native ARM, amd64 and hosted evidence remain separate.                                                                                                                                                    |
| `38c980bf` | Generate native bindings from Expo and React Native declarations       | Public-export extraction, unsupported-shape rejection, enum/record conversion and subscription rollback reviewed. Nullable-record narrowing remains documented.                                                                        |
| `76fda72b` | Launch Clerk phone review and test its real setup on iOS               | Device launch, pairing, abort and review-launch seams reviewed; physical acceptance was not repeated.                                                                                                                                  |
| `227a8f07` | Record Device Hub approval success and unresolved inspection           | Approval success and failed inspection explicitly distinguished; no consent bypass.                                                                                                                                                    |
| `4b463ad4` | Repair Hutch HTTPS proxy downloads and isolate doctor assertions       | Pinned source build, private proxy patch, origin TLS test and isolated doctor repair reviewed; no host rebuild claimed.                                                                                                                |
| `0d24eec7` | Prepare opted-in worktree shells before directory entry                | Automatic shell entry and bounded prewarming retain a single setup owner; no additional finding.                                                                                                                                       |
| `0e3f6a9b` | Record physical iPhone Clerk sign-in acceptance                        | Physical password sign-in/relaunch/logout evidence does not claim profile, registration or distribution.                                                                                                                               |

## Health inventory

The 2026-09-27 metadata inventory found 31 registered worktrees: 29 protected/live, two unclassified,
and none reclaimable. A separate unregistered `db77` directory still has a broken Git pointer and
unknown ownership; preserve it. No machine-wide deletion was justified. Prior large roots and
legacy Jest cache trees are absent; those are observations of earlier cleanup, not deletions here.

| Root class                      | Allocated GiB | Files   | Oldest file mtime, days | Comparison                          |
| ------------------------------- | ------------- | ------- | ----------------------- | ----------------------------------- |
| Primary task worktree parent    | 10.119        | 770546  | 1683.16                 | -39.38 GiB from September 25        |
| Alternate Tao worktree parent   | 14.075        | 1218261 | 121.94                  | +4.98 GiB                           |
| In-repository worktree parent   | 6.512         | 482864  | 1683.16                 | -17.59 GiB                          |
| Current v2 Jest cache roots     | 1.129         | 95042   | 1.65                    | Essentially unchanged from 1.13 GiB |
| Retained test runs              | 1.020         | 186164  | 1.96                    | +0.37 GiB                           |
| Selected Tao OS temporary roots | 0.161         | 12028   | 1.66                    | Prior 5.54 GiB / 396241 files       |

Snapshot completed at 16:07 UTC. Old file modification times can come from copied dependencies;
they are not creation ages. Measurements are not atomic: a later directory-size scan observed
12.16 GiB for the first worktree parent. Live task attachments and shared-cache readers prevent
inferring disposability from age or size. Other projects retain their own cleanup owners.

`./agent model-audit` found no routing mismatch. Official availability, precedence and separate
input/cache-read/cache-write/output rates were inspected; this checkout's delegation report lacks
completed-task usage records. No measured cost saving or routing change is claimed.

The [dependency advisory register](<Dependency advisory follow-up.md>) now records two moderate
package audit records and the unchanged Nixpkgs patch follow-up. Installed callers do not demonstrate
the affected uuid or stream-json API paths. The patch comparison is not Linux closure exposure.
No dependency version or lockfile changed.

## Acceptance and remaining work

The baseline vanilla run used the frozen source, completed all 17 installed CLI/browser scenarios,
and failed its mandatory filesystem audit on nine paths. This is an overall failed lane, not a
qualified installation. The first repair candidate includes owned runtime launchers, exact OS metadata audit exceptions, guest sync and terminal-receipt enforcement. Independent source challenge accepted these repairs; subsequent fresh acceptance will replace this status.

The first integration run exposed fixture-only lint errors. Native Haptics/Clipboard tests timed out under concurrent suite load and passed the runner's isolated retry; no product regression is inferred from those initial timeouts.

Task-local detailed evidence is under `.artifacts/repository-health/`; tracked findings above retain
meaning without that worktree. Initial repairs are committed as `84e7da1b` after focused regressions, independent challenge and integration verification. Optional-field repairs and Tao regression journeys are ready for integration. Linux acceptance, final verification and finalization remain in progress.

### Repaired candidate evidence

Fresh vanilla acceptance on `84e7da1b94ac6ddc95f19f5a13013b7e621ece84` completed in 163 seconds. The mandatory filesystem audit found no disallowed changes; the previously leaked global Bun executables are absent, and the collected scenario receipt is complete. The owned clone, lease and mount marker were removed. The image was `ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bfe1f076e27786c5d92b89187a05b1d109b5071eb2dcdf02d596e34640`, run `tao-acceptance-1790526812-24052`. Timing: 20 seconds to guest RPC, 117 seconds acceptance, 10 seconds collection; these are contended-host observations, not a speed claim. The metadata scanner retained 165 before/164 after unreadable OS paths; policy acceptance is not a complete all-content disk proof. Prepared-Xcode evidence follows below; Linux remains pending.

The existing headless HNReader host journey exercised real Feed dragging, Discard, Keep, Undo Keep, full Studio reopen, compile/edit/undo and Metro refresh. Product source bytes match the committed candidate; the run began before the commit and is recorded as working-tree acceptance. Only a concurrent test-fixture lint correction changed during it. The external project, Chrome profiles, processes and port lease were removed. Interrupted-startup behavior has separate deterministic lifecycle and mutation evidence.

Fresh prepared-Xcode acceptance used the same committed source, separately rebuilt, on `ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:71d9dc1d6c4614b7ecbb328753124912b43425fc8cf1c4085d7f352026df6601`, run `tao-acceptance-1790526987-26371`. It completed in 173 seconds (24 seconds to RPC, 79 seconds acceptance, 34 seconds collection), with every scenario terminal passed and no filesystem policy violations. The scan retained 186 before/179 after unreadable OS paths under existing rules; no acceptance-owned or forbidden Bun paths were unobservable. The owned clone, lease and mount/run markers are absent. This qualifies installed CLI behavior on the prepared base, not native builds or simulator launches.
