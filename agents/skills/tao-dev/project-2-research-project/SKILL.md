---
name: project-2-research-project
description: >-
  Researches a selected Tao project by resolving open decisions with Ro and recording conclusions in the roadmap task folder.
---

# Project 2: Research Project

Turn a selected roadmap task into enough settled context to plan.

## Rules

- Read `Roadmap.md`, the task folder under `Roadmap/<Task>/`, linked local docs, and relevant source before asking questions.
- Use the `old-repo-porting` skill when checking comparable behavior under `~/code/tao-lang`.
- Ensure `Roadmap/<Task>/` exists.
- Keep research in the existing task doc when that is enough; create `Roadmap/<Task>/Research - <Task>.md` only when separate notes are useful.
- If research determines intended syntax or functionality should change, record examples and decisions in the task research doc.
- When research identifies a new test-app surface, define or update the app's entry in `Apps/Test Apps/README.md` with the app's purpose, appropriate functionality scope, edit triggers, and any planned behavior-test notes.
- Do not add speculative code to `Apps/Kitchen Sink/Kitchen Sink.tao` during research; the executable Kitchen Sink changes only when functionality is implemented.
- Ask Ro one focused question at a time when local repo context cannot answer it.
- Use web search when relevant.
- Stop when the remaining decisions are clear enough for an implementation plan.

## Output

- Task doc path.
- Decisions made.
- Remaining unresolved questions, if any.
