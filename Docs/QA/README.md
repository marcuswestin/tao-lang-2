# On-demand QA register

QA records observations and unresolved findings against the five cumulative public release phases.
It runs only when requested. It does not publish, repair products, format source, schedule recurring
work, or add a merge gate. The [initial pilot](pilot.md) explains the first observations and limits.

## Commands

Run from the repository root:

```sh
./agent qa inventory --phase 1
./agent qa run --phase 1 --scope changed
./agent qa run --phase 1 --scope all
./agent qa run --phase 1 --scope changed --resume RUN-ID
./agent qa record --file .artifacts/qa/observation.json
./agent qa finding --file .artifacts/qa/finding.json
./agent qa report --phase 1
```

Use phases 1 through 5 to generate each release packet. `inventory.json` inventories active authored
documents from tracked and unignored files, including hidden canonical instructions, Markdown, MDX,
RST, text, AsciiDoc, and named extensionless documents. It records reasons for archive, generated,
vendor, alias and evidence exclusions. Generated harness copies (`.agents`, `.claude`, `.codex`,
`.cursor`) and the starters' copies of the packaged Tao skills defer to their canonical sources.
Missing tracked documents are explicit exclusions. Secret namespaces are never read.

The generated [capability table](capabilities.md) maps each shared capability to its release
availability and acceptance obligations; eligibility alone never proves behavior.

The inventory preserves every ID and additive A/P/D tag from the 49-story release QA plan. Every
story can receive agent evidence; P additionally needs human judgment, and D specifically needs
the Developer. A Developer review satisfies P on a P/D row; DOC1 retains its explicit outside,
uncoached-reader requirement in addition to the creator pass. Agent evidence satisfies neither. Channel scope follows the staged release
decision: Studio starts in 3, physical Companion/private CloudKit in 4, and author shipping in 5.
Android and the original hosted-data clause remain deferred. APP3 retains its original hosted-data identity and stays deferred. Separate
`acceptance:cloudkit-private-sync` records the private same-person CloudKit journey. Earlier channels remain required as phases accumulate.

`run` freezes source, renderer/dependency and release-profile hashes and saves an immutable manifest
under `.artifacts/qa/runs/RUN-ID/`. It executes local inline link existence checks and the existing
tutorial source test when DOC1 is selected. Check results are bounded, scoped evidence: they never
produce editorial, visual, installed-artifact or human acceptance. External links, anchors and
reference links remain explicit review work. Every other declared journey is dispatched as a
selected surface for observation; none silently passes. Capture through
`./agent unsandboxed qa-capture PROJECT --app APP --output .artifacts/qa/CAPTURE-ID` produces images
for later inspection. Its `source-snapshot.json` copies every cell's status from the review
manifest and is `complete` only when every cell was captured; otherwise it is `partial`. A capture
failure blocks that visual assessment, and capture success alone does not judge a picture.

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
requires an image. An agent's visual pass must also cite the review manifest, and every cited image
must match a `captured` cell there by SHA-256; a person may cite a screenshot alone. No visual pass
may cite a `partial` or `blocked` capture snapshot. Recording rejects source changes since the frozen run. `historical: true` with original `observedAt` and `commit`
imports earlier observations honestly: they always need recheck against the current candidate.

Dedicated `source:hnreader-browser`, `source:tutorial-replay`, `visual:reading-list`, and
`visual:notebook`, and `visual:hnreader` probes retain the pilot's limited claims. Story IDs use `story:DOC1`, etc.; document
IDs use `doc:README.md`, etc. Source tests and browser previews may supplement stories, but cannot
fill their installed CLI, marketplace, native, device, public download or TestFlight cells.
Different visual scenarios are distinct channels. Never mark a failed dark capture passed because
another phone image looked good, or mark unchanged screenshots passed without inspecting them.

Immutable observations live in `results/`, with source commit, observed and recorded times,
requested phase, execution profile, host/runtime descriptor, source hashes, and a durable dependency
snapshot under `inputs/`. Historical records explicitly label those snapshot fields as import-time,
mark original dependencies unknown, and link original capture/run metadata through evidence. Release story passes outside documentation require `executionProfile`
to match the requested phase and an `artifact` containing `version`, `digest`, and `sourceCommit`.
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
Accepted limitations require rationale in notes; duplicates require duplicateOf. Original creation
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
source/profile/evidence judged against its own phase. Findings pin their evidence hashes, and the
proof may not cite any bytes an earlier event of that finding cited. A fix, a missing screenshot, an
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
Reviewer, channel, related-story and phase obligations cannot be weakened by a later transition.
