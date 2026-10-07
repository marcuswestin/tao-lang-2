# On-demand QA register

QA records observations and unresolved findings against the five cumulative public release phases.
It runs only when requested. It does not publish, repair products, format source, schedule recurring
work, or add a merge gate. The [initial pilot](pilot.md) explains the first observations and limits.

## Commands

Run from the repository root:

```sh
./dev qa inventory --phase 1
./dev qa run --phase 1 --scope changed
./dev qa run --phase 1 --scope all
./dev qa run --phase 1 --scope changed --resume RUN-ID
./dev qa record --file .artifacts/qa/observation.json
./dev qa finding --file .artifacts/qa/finding.json
./dev qa report --phase 1
```

Use phases 1 through 5 to generate each release packet. `inventory.json` inventories active authored
documents from tracked and unignored files, including hidden canonical instructions, Markdown, MDX,
RST, text, AsciiDoc, and named extensionless documents. It records reasons for archive, generated,
vendor, alias and evidence exclusions. Generated harness copies (`.agents`, `.claude`, `.codex`,
`.cursor`) and the starters' copies of the packaged Tao skills defer to their canonical sources.
Missing tracked documents are explicit exclusions. Secret namespaces are never read.

The generated [capability table](capabilities.md) maps each shared capability to its release
availability and acceptance requirements; eligibility alone never proves behavior.

The inventory preserves every ID and additive A/P/D tag from the 49-story release QA plan. Every
story can receive agent evidence; P additionally needs human judgment, and D specifically needs
the Developer. A Developer review satisfies P on a P/D row; DOC1 retains its explicit outside,
uncoached-reader requirement in addition to the creator pass. Agent evidence satisfies neither. Channel scope follows the staged release
decision: Studio starts in 3, physical Companion/private CloudKit in 4, and author shipping in 5.
Android and the original hosted-data clause remain deferred. APP3 retains its original hosted-data identity and stays deferred. Separate
`acceptance:cloudkit-private-sync` records the private same-person CloudKit journey. Earlier channels remain required as phases accumulate.

The inventory has five kinds of surface. A _story_ is a row of the 49-story plan. A _release
requirement_ (`acceptance:` IDs) is acceptance the staged release plan adds beyond those stories,
such as HTTP data or CloudKit sync; stories and release requirements together decide a packet's
verdict. A _document_ is one authored file awaiting editorial review. A _screenshot set_
(`visual:` IDs) names the captured cells that show one app's views, and a _dev check_ (`source:`
IDs) is a development-source journey; both are scoped development evidence and never stand in for
a story or release requirement.

`run` freezes source, renderer/dependency and release-profile hashes and saves an immutable manifest
under `.artifacts/qa/runs/RUN-ID/`. It executes local inline link existence checks and the existing
tutorial source test when DOC1 is selected. Check results are bounded, scoped evidence: they never
produce editorial, visual, installed-artifact or human acceptance. External links, anchors and
reference links remain explicit review work. Every other declared journey is dispatched as a
selected surface for observation; none silently passes. Capture through
`./dev qa-capture PROJECT --app APP --output .artifacts/qa/CAPTURE-ID` produces images
for later inspection. Its `source-snapshot.json` copies every cell's status from the review
manifest and is `complete` only when every cell was captured; otherwise it is `partial`. A capture
failure blocks that visual assessment, and capture success alone does not judge a picture. A cell
whose own preview logged a console error or uncaught exception is `failed`, even if its picture
looks right; the message stays out of the artifacts, so reproduce it in a dev session to read it.

### Discover and capture scenario apps

Adding authored `.tao` app and scenario declarations under `Apps/` automatically adds screenshot
coverage on the next inventory, run, or report. Discovery uses the project's parser and compiler
manifest, including view scenarios reachable from each app. Tests, ignored files, generated trees,
platform output and credential namespaces are excluded. Invalid or missing scenario sources, and
symbolic links that do not lead to another authored source, appear as discovery failures in the
inventory and report; they never silently count as covered. An app whose project declares scenarios
but gives it none has no coverage; it is listed as `uncoveredApps` in a batch's `coverage.json`
without failing the batch, since some apps are deliberately uncaptured. Apps in projects with no
scenarios at all are not listed.

Capture all discovered apps from the repository root:

```sh
./dev qa-capture --output .artifacts/qa/scenario-round --timeout 300
```

The batch runs one headless app capture at a time, each in an isolated source snapshot, with a
parent-enforced deadline in seconds. Each scenario is activated through Studio's existing control
before the capture waits for its preview to settle. A timed-out child and its descendants are
stopped before the next app runs. `coverage.json` records every expected app and cell before the first launch and is
updated after each app, so an interrupted run retains missing coverage. It reports `captured`,
`missing`, and `failed` cells, launch failures, discovery failures, and unexpected cells. Missing,
empty or changed screenshots cannot count as captured. A partial batch exits unsuccessfully and
keeps its per-app logs and snapshots for diagnosis; it never records a visual pass.

Screenshot surfaces use stable `visual:PROJECT/APP` IDs. Their channels are JSON arrays of
`[source, group, label]`, where source is project-relative. The same group/label in another file or
another project cannot supply that channel's evidence. Scenarios keep their authored device and
appearance; this command does not invent an additional device matrix or design rules.

Interrupted runs resume only with their original phase, scope and unchanged inputs. Completed
checks remain immutable; an interrupted individual check can execute again. Unique run/result IDs
and file mutation locks prevent concurrent writers from replacing receipts. Evidence stays in
this checkout. Keep full logs and captures in `.artifacts`; copy selected compact receipts and
inspected images to `Docs/QA/evidence` for durable review.

## Recording observations

An observation names exactly one surface, dimension, channel and reviewer. Example:

```json
{
  "runId": "RUN-ID",
  "surfaceId": "visual:reading-list",
  "dimension": "visual",
  "outcome": "friction",
  "channel": "phone-light",
  "reviewer": "agent",
  "evidence": ["Docs/QA/evidence/pilot/reading-list-phone.png"],
  "notes": "Inspected initial phone view: Library and About read as one joined label.",
  "historical": true,
  "observedAt": "2026-09-26T22:52:29.463Z",
  "commit": "d5bdeaefd037",
  "executionProfile": "development"
}
```

Outcomes are `not-run`, `pass`, `friction`, `fail`, or `blocked`, independently from freshness.
Reviewers are `agent`, `human`, and `developer`; record the actual reviewer. Every reviewed outcome
requires existing, nonempty repository-relative evidence and notes. A visual pass additionally
requires an image. An agent's visual pass must also cite the capture's `complete`
`source-snapshot.json`; every cited image must be the screenshot of a `captured` cell there, by file
name and SHA-256, and a screenshot-set channel must cite the source/group/label cell the inventory names.
The snapshot must record the project and app the surface names, so a capture of
another project cannot stand in, and an agent cannot pass a channel for which the inventory declares
no capture cell; today that leaves every story's visual channels to a person. A person may cite a
screenshot alone. No visual pass may cite a
`partial` or `blocked` capture snapshot. Recording rejects source changes since the frozen run. `historical: true` with original `observedAt` and `commit`
imports earlier observations honestly: they always need recheck against the current candidate.

The `source:hnreader-browser` and `source:tutorial-replay` dev checks retain the pilot's limited
claims. The pilot's former `visual:reading-list`, `visual:notebook` and `visual:hnreader` records
remain historical; current screenshot sets are discovered from authored apps, and old observations
are not transferred to new identities. The tutorial's generated scratch app is outside this
repository-app discovery; its source journey and release story still need their own evidence.
`./dev qa-capture` stages its project at `.artifacts/qa/tutorial-review` from the committed
`evidence/tutorial-first-hour/capture-source.tao.txt` when asked to capture that path, so a clean
checkout needs no hand-made directory; a visual pass cites a capture of exactly that project.
Story IDs use `story:DOC1`, etc.; document
IDs use `doc:README.md`, etc. Source tests and browser previews may supplement stories, but cannot
fill their installed CLI, marketplace, native, device, public download or TestFlight cells.
Different visual scenarios are distinct channels. Never mark a failed dark capture passed because
another phone image looked good, or mark unchanged screenshots passed without inspecting them.

Immutable observations live in `results/`, with source commit, observed and recorded times,
requested phase, execution profile, host/runtime descriptor, and source hashes; git holds the
inputs themselves at that commit, so no separate dependency list is stored. Historical records
explicitly label their snapshot fields as import-time, mark original dependencies unknown, and link
original capture/run metadata through evidence. Release story passes outside documentation require `executionProfile`
to match the requested phase and an `artifact` containing `version`, `digest`, and `sourceCommit`;
`public-site` stories (the published front door and repository) are exempt, since nothing is built
for them, while WEB2's download half stays on `installed-cli`. Instead, a `public-site` pass must
name the `https` page it read as `reviewedUrl` and cite a screenshot of that page.
A run that inventoried uncommitted inputs cannot record an artifact, because nothing was built from
its candidate commit. Development profiles cannot satisfy installed public-artifact acceptance. Reports re-hash evidence and compare source, shared
dependencies, renderer and profile. A missing or changed evidence file is `needs-recheck`.
Changes to app/compiler/runtime dependencies, the devenv toolchain, `.config/`, and the root
`tao`, `agent` and `dev` scripts conservatively invalidate app evidence. Story hashes include
public-facing documents but not roadmaps, QA outputs or agent instructions. Register
outputs and evidence are excluded from their own source hashes. `changed` selects unfinished,
failed, blocked and stale cells as well as modified sources; it does not discard open findings.

## Findings and closure

`findings.json` retains the pilot's open baseline findings. Lifecycle states are `open`, `triaged`, `fixed-awaiting-qa`, `verified-closed`,
`accepted-limitation`, and `duplicate`. Confidence is `confirmed`, `suspected`, or
`design-judgment`. Optional notes, repro, owner and existingIssue fields carry triage context.
Accepted limitations require rationale in notes. A duplicate's duplicateOf must name a different,
unresolved finding on the same surface, dimension and channel, at the same or an earlier phase, with
the same required reviewer; an original cannot itself become a duplicate. A duplicate stays in the
report's open list until the original it names is proved closed. Original creation
time is retained and each event records its own updatedAt. Later events append under
`findings/QA-STABLE-SLUG/`; they never overwrite history. Supply these fields to `qa finding`:

```json
{
  "id": "QA-EXAMPLE-ISSUE",
  "surfaceId": "doc:README.md",
  "dimension": "text",
  "channel": "source",
  "phase": 1,
  "severity": "major",
  "confidence": "confirmed",
  "title": "Concrete observed problem",
  "observed": "The exact visible result",
  "impact": "The concrete reader or user consequence",
  "location": "README.md:12",
  "evidence": ["Docs/QA/pilot.md"],
  "expected": "Observable intended result",
  "recheck": "Repeatable check of the corrected experience",
  "status": "open"
}
```

To close, submit the same finding with `status: "verified-closed"` and `passingResultId`. The linked result
must be newer than the open finding, pass the same surface and dimension, and still have current
source/profile/evidence judged against its own phase, which may not be earlier than the finding's.
Opening or reopening a finding pins its evidence hashes; later events carry those forward, so a
`fixed-awaiting-qa` event may cite the fix. The proof may not cite pinned bytes, nor any evidence path
of a seeded `findings.json` entry, which predates pinning. A fix, a missing screenshot, an
unchanged digest, or an unrelated passing test cannot close it. Reopening appends a new open event under the same stable ID.

## Release packets

`qa report --phase N` refreshes `dashboard.md` and `release-N.md`. Counts distinguish reviewed
from current passed cells, stale evidence, not-run cells, failures, friction and blocks by phase
and dimension. Packets list every applicable gap, open finding and document exclusion. Later phase
rows stay visible without being called phase-1 failures. Candidate identity, outside-user and
Developer gaps, publication prerequisites and channel evidence remain part of the release call.
The Developer decides readiness; an empty finding list or a passing source command cannot do so.
Each phase reads only observations recorded for that phase. The header names the candidate commit,
states when the inventory saw uncommitted inputs, and prints a tree digest; stories deferred beyond
release 5 are listed so they cannot vanish from the packet.

**Known limitation:** the register checks evidence bytes, not who produced them. `reviewer`,
`executionProfile` and an `artifact` digest are declared by whoever records the observation; the
register cannot tell an agent from a person or verify a digest against a published release. Treat
human and Developer cells as trustworthy only when that person recorded or confirmed them, and
compare artifact digests with the release receipt before a publication decision.

Closed findings remain historical events. If their linked proof becomes stale, reports show
`closure-needs-recheck`; changed runs include those surfaces and every unresolved finding.
A later transition cannot weaken a finding's reviewer, channel, related stories or phase.
