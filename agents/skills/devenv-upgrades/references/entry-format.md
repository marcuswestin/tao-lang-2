# Entry format

One entry is one file under `Developer environment upgrades/` (or, once addressed,
`Developer environment upgrades/Archive/`). Both index pages are rendered from the entry files by
`./agent ledger-index`; never hand-edit either index.

## Naming

- A new entry is a new file named after its own title: take the title's distinguishing words, put
  them in capitals, and join them with dashes, as `DEVENV-NAME-WORDS-ETC.md`. Four to eight words is
  usually enough to be unmistakable; drop articles and prepositions rather than truncating the
  meaning. Give the file a `# DEVENV-NAME-WORDS-ETC — Title` heading — the generator prints that
  heading text verbatim as the index line's link text, so keep it exactly what the entry is about.
- **Do not number a new entry.** Numbered entries predate this scheme and keep their numbers, which
  are quoted from other documents and from commit messages; nothing renumbers them. The number was
  itself the collision this scheme replaced: every open branch read the same highest id and chose the
  same successor, so the ledger renumbered on nearly every merge. A name taken from the title collides
  only when two branches record genuinely the same finding — a duplicate worth catching, resolved by
  merging the two entries rather than by renaming one.
- Never reuse an id, numbered or named. The next free numbered id is one past the highest that exists
  on `main` across both halves.

## Fields

Record, in order: **Status**, **Section**, **Area**, **Impact**, **Evidence**, **Workaround**,
**Proposed change**, **Dependencies**, **Acceptance**, and **Source**. Use `None` when there is
genuinely no workaround or dependency.

- **Status** is one of `Candidate`, `Planned`, `In progress`, `Incoming`, or `Blocked` while the entry
  is open; `Resolved` or `Closed` is what moves it to the archive. `Incoming` means another unmerged
  branch owns the fix; re-verify it after that branch lands before resolving it, never reimplement it.
- **Section** is `Deferred` or `External`, naming the generated open-index heading the entry prints
  under: `Deferred` for "Deferred project — begin after the large branches land" (work intentionally
  held until larger branches land), `External` for "External and observational findings" (everything
  else). It is required on every entry that lives in the open directory, regardless of status, because
  the generator needs it to place the entry even for one about to be archived; an archived entry (its
  file already moved into `Archive/`) does not need it, since the archive index has no sections.

## Before adding one

Search by name, symptom, command, and area before adding an entry. Update the existing entry instead
of appending a duplicate. Record only observed problems or credible improvements with concrete
evidence; ordinary product failures do not belong here. The owning agent consolidates updates once
after delegated findings return; subagents do not edit this backlog independently.

A task that adds or materially updates an entry links the open or archive index once in its handoff.
A task that changes nothing here says nothing about developer-environment feedback.
