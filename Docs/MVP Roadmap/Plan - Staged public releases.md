# Plan — staged public releases

## Decided scope, 2026-09-26

Tao reaches outside developers through five cumulative releases. This plan owns public scope and
sequencing wherever an older active roadmap promises an all-at-once launch. It records a decision,
not implementation completion, QA readiness, or publication authorization.

Aim for roughly **three to four days between releases after release 1 is ready**. These are planning
intervals, conditional on the evidence for each candidate; they are not dates, scheduled QA runs, or
an obligation to publish a failing candidate. Each release retains the earlier supported surface.

| Release                                       | Added public scope                                                                                                                                                                                                                                                                                                                                                           | Acceptance needed before claiming it                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — First app**                             | Signed and notarized macOS Apple Silicon standalone CLI through the install script; extension in both VS Code Marketplace and Open VSX; polished reading-list tutorial. Local data, queries, writes, reactivity, actions, navigation, adaptive panes, basic colors/styles, and Tao behavior tests. Scenario syntax belongs here. Browser is the first app execution surface. | Clean supported Mac install from the distributed artifact; both actual marketplace installs; complete the tutorial, edit its app, run a passing and deliberately failing test, and verify local persistence and recovery. Review every promoted release-1 claim and instruction.                                                                            |
| **2 — Simulator and remote data**             | iOS Simulator; HTTP through typed adapters, multiple datasources, and cross-source references.                                                                                                                                                                                                                                                                               | Installed CLI and published compatible simulator host; real simulator interaction and relaunch; exercise adapter success/error/retry, datasource identity and writes, and references across sources. Keep source and browser evidence separate from simulator proof.                                                                                        |
| **3 — Native Studio and advanced design**     | Downloadable native macOS Studio; advanced design families, derived values, element defaults; interactive scenario review.                                                                                                                                                                                                                                                   | Signed/notarized download and native first launch, editing/recovery/windows, and installed update when claimed; inspect scenario state/identity and design behavior in the actual native workbench. Existing scenario syntax remains part of release 1.                                                                                                     |
| **4 — Invitation Companion and private sync** | Invitation-beta Companion; CloudKit private same-person synchronization across Apple devices.                                                                                                                                                                                                                                                                                | Genuine invitation and distributed physical-device install; pairing/revocation/reconnect; actual two-device synchronization for the same person, offline edits and reconciliation, relaunch persistence, and account-switch isolation. Browser simulation, a single device, source tests, or earlier InstantDB evidence cannot satisfy CloudKit acceptance. |
| **5 — Ship a beta**                           | `tao ship` to TestFlight for a developer's Tao-built app.                                                                                                                                                                                                                                                                                                                    | Real identity/signing/build/upload flow, TestFlight processing/invitation, tester install, primary action and relaunch, and feedback traceable to the app/build/version. An upload or dry run alone is insufficient.                                                                                                                                        |

Release 4's Companion invitation may itself use TestFlight; release 5 adds the public author-facing
ship flow for the developer's own app. Those are different distribution journeys.

**Beyond release 5:** auth, access rules, account-backed offline app data, app-command automation,
Android, Linux/Windows/Intel Mac hosts, Homebrew/npm and other distribution channels, App Store
submission, and public OTA claims. CloudKit's release-4 account-switch and offline acceptance is
required for its private same-person sync; it does not pull the deferred general auth/account-data
program into these releases. Existing implementations and future designs remain available to
develop internally without becoming promises of these releases. `tao review` in the standalone
binary remains deferred unless separately decided; release 3's interactive review is in Studio.

**Decided 2026-09-29 for entry points added after this plan:** `tao build --visionos` and
`--watchos` are deferred beyond release 5 alongside Android. `tao bindings generate` with an explicit package (native API binding
generation) and `tao secrets` (encrypted project secrets) are deferred from every public phase until a
pre-MVP decision gives each a phase and public acceptance; `tao instantdb push` follows the deferred
hosted-data scope. The capability catalog classifies every CLI command and option explicitly, and a
public build hides any entry point nobody classified, so a new surface cannot reach a release by
default.

**Decided 2026-10-02, to implement on a branch after the staged-release QA work lands:**

- `tao ship` requires a mode: `--internal` (the team's internal testers), `--beta` (external
  TestFlight testers), or `--app-store`. `--internal` and `--beta` are release 5; `--app-store`
  stays behind the deferred external-distribution capability. Release 5's acceptance includes one
  external tester through Beta App Review.
- Tao creates one TestFlight group by default, **Beta testers**, in place of the current `Tao
  Internal` and `Tao External` groups.
- `--add <email>` names one tester per flag and repeats. `--beta --add` with a team member adds them
  to Beta testers without telling them about internal builds.
- `--internal --add` with someone outside the team invites them to the App Store Connect team as
  Marketing, limited to this app. Tao first warns what that role can and cannot do and that they must
  accept and set up their account before they can receive internal builds, asks for each invitee's
  first and last name, and needs an interactive yes even with `--yes`. The build still ships to
  existing internal testers; the output lists pending invitees, and a later `--internal` ship adds
  them once accepted.
- Only Account Holders and Admins can ship, because shipping needs an Admin team API key; setup
  guidance says so plainly.
- AI assistance — `tao create --ai` and Studio's Agent panel — becomes a deferred `ai-assist`
  capability. Public builds create without it and hide both until a phase proves them.

A malformed `.tao/store/lock.jsonc` keeps refusing editors and Studio; its message names the file,
the parse problem, and the recovery paths and what each would lose (decided and implemented
2026-10-02).

## Quality workflow

Use [the durable QA register](../QA/README.md) for on-demand, incremental reviews and evidence,
and [the 49-story journey plan](<Plan - Initial release QA.md>) for the newcomer flow. Each run names
its release, frozen candidate and dimensions. Preserve prior observations and mark affected evidence
**needs recheck** when its source, artifact, environment or public claim changes. Record **pass /
friction / fail / blocked / not run** independently from freshness and scope. Preserve additive
**A / P / D** responsibilities: an agent proof never fills a required human or Developer proof.

Review findings are report-only; fixing them is separately scoped work. QA runs only when requested,
with no scheduler, recurring automation, or new merge gate. The Developer judges release readiness
from current applicable evidence and disclosed limitations. Existing repository verification and
landing requirements continue independently.

Inventory and progressively review **all non-archive documentation**, prioritizing the release-1
public front door, install/listings, reading-list tutorial, examples, and relevant specs. Mark later
or deferred claims clearly while retaining their planned scope. Reviewing a roadmap does not prove
the feature it describes. Do not rewrite frozen archives to make them match a later decision.

## Prerequisites and evidence boundaries

The [Developer roadmap](<Developer MVP Roadmap.md>) release checklist still applies before public
publication: app-safe licensing, credential revocation/history scan, publication hygiene, and the
public identifiers required by the released surface. This staged plan waives none of those
prerequisites. The first CLI must be signed and notarized; the earlier unsigned `0.4.0` publication
decision is superseded. Native Studio and invitation Companion move from the old first-release
promise to releases 3 and 4 respectively.

Record source checks, browser execution, simulator use, native Studio, physical devices, public
downloads, signing/notarization, each marketplace, and TestFlight as separate evidence dimensions.
Published artifacts must identify the candidate source/version. Credential-dependent and
physical-device checks remain near-release acceptance for the release that introduces their surface,
not new branch or landing gates. Missing access or artifacts are **blocked** for that dimension;
later-release scope is not a release-1 failure.
