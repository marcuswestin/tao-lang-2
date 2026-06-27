# Follow-up - Reviewer Context Automation

**IMPORTANT** Ro note: Currently the tooling code for agents is some of the most complext in the repo (e.g the code review code). This should probably be simplified and/or use existing tools for.

Also, the dev-src/commands list is seeming to have a bunch of `agent` specific pass-through duplication. This really should be made simpler. Is there a library for this sort of thing? Or an agent-maker library?

## Purpose

Generate narrower context for review subagents without making the main agent carry every review checklist and workflow detail.

This is intentionally separate from the first agent-context reorganization. The first pass should make ownership clear; this follow-up can then automate how the right excerpts are assembled.

## Target Shape

`./agent review plan` can generate one `context.md` per reviewer containing only:

- scope summary
- changed files
- relevant root and nested AGENTS snippets
- relevant skill excerpt
- reviewer lens and checklist
- read-only/git safety constraints

## Why Separate

- It is a real automation project, not just instruction editing.
- It depends on stable instruction ownership after the reorg.
- It should be validated by running actual review agents and comparing context quality, not only by checking markdown.

## Acceptance Criteria

- Generated reviewer context is smaller than loading all review skills directly.
- Each reviewer receives the safety rules and local code rules needed for its scope.
- The generated context is reproducible from repo files and changed-file lists.
- The automation is covered by targeted dev tests and final `./agent just verify`.
