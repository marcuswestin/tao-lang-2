---
name: devenv-upgrades
description: >-
  Choose which reported developer-environment issues to fix next, work them, and archive what was addressed. Use when the Developer asks to work on devenv issues, fix the developer environment, clear the DEVENV backlog, pick the next DEVENV entries, or archive the addressed ones.
---

# Developer Environment Upgrades

The open backlog is `Docs/Roadmap/Developer environment upgrades.md`; the closed record is
`Docs/Roadmap/Developer environment upgrades archive.md`. **Both are generated** by
`./agent ledger-index` from the entry files under `Developer environment upgrades/` (and its
`Archive/`) — never hand-edit either index. This skill owns which entries to take next and how a
task leaves both halves.

## Entry format

Field-by-field format, naming, and status/section meanings live in
[`references/entry-format.md`](references/entry-format.md) — read it before adding or editing an
entry. In short: name a new entry after its own title, never a number, and record `**Section:**` —
`Deferred` or `External` — right after `**Status:**`.

## Selecting the next set

- Read the open index first, then only the entry files a filter leaves. The index is the point of the
  layout: never page the whole backlog to find one entry.
- Drop from consideration: `Incoming`, which another unmerged branch already fixes — re-verify it
  after that branch lands, never reimplement it; `Blocked` whose dependency is unmet; and
  `In progress` owned by another branch. `./agent board` and `git branch -a` say what is live before
  you claim one.
- Score each remaining entry from its own fields:
  - **Cost** — the size of its **Proposed change** and the evidence its **Acceptance** demands: a
    clause, a flag, or a declared input is cheap; a new lease protocol, a host lane, or a native
    toolchain is not.
  - **Importance** — how often the **Impact** is paid and what it costs: highest is a confidently
    wrong result (an untested-but-green gate, output an agent would quote as fact, a memo proving the
    wrong tree), then what every agent pays daily, then entries whose **Workaround** actually works.
  - **Reach** — how many other entries the fix settles or unblocks; an **Area** an entry shares with
    others, and its **Dependencies**, name them.
- Take cheap, important, wide-reach entries first. An entry with a reliable workaround and a large
  proposed change is a poor trade however real it is; say so and leave it.
- Prefer a batch that is genuinely parallel: group entries so no two groups write the same files, and
  hand each group a path list it owns exclusively, per `delegation`'s
  `references/parallel-implementation.md`. `packages/cli/dev-cli/` and `packages/cli/agent-cli/`
  internals, the `./tao` CLI, `.rulesync/` permission sources, and `AGENTS.md` with the skills
  rarely collide; entries touching the same file are one group.
- Propose a batch of more than two entries to the Developer before implementing — the name, the one-line cost,
  and why it is in this batch.

## Working an entry

- Reproduce the **Evidence** before changing anything. An entry that no longer reproduces is archived
  as `Resolved` with the reproduction attempt as its evidence, never silently deleted.
- Implement the **Proposed change** unless the reproduction shows a better fix; if it does, update
  that field in the same change so the record says what was done.
- Satisfy the **Acceptance** field literally, with a test or a command whose output you can quote. An
  environment fix with no repeatable check is not addressed; say which part rests on observation.
- A fix to harness configuration is generated: edit `.rulesync/*.jsonc` and run `./agent setup`, never
  the generated files. `agent-instructions` and `dev-automation` own those seams.
- Several of these entries are about the verification machinery you are running. Read
  `verification-lanes` before concluding that a lane's behavior is the bug.

## Archiving — in the same change, every time

- Setting an entry to `Resolved` or `Closed` is what moves it. In one change: set the status,
  `git mv` the file into `Developer environment upgrades/Archive/`, and append
  `- **Archived:** <YYYY-MM-DD>` as the last field. Never touch either index by hand — the next
  `_fix-ledger-index` run (in `verify`) renders the move; `_repo-lint` enforces placement and id
  uniqueness, so do not work around it by leaving the status stale. Archive `Incoming` only once the
  branch that owns the fix lands and is re-verified here.
- Name the branch or commit that settled it in **Evidence** or **Dependencies**, and never reuse an
  id: a regressed entry returns to the open backlog under its original id, `git mv`'d back with a
  **Section** restored and the new evidence appended, not as a second entry.
- Sweep before finishing: archive any addressed entry another task left in the open index, and say in
  the handoff which entries you moved that were not yours.

## Reporting

- Name the entries addressed and archived, with the evidence behind each; link both indexes once.
- An entry you selected and then abandoned goes back to `Candidate` with what you learned added to its
  **Evidence**, so the next task does not repeat the attempt.
