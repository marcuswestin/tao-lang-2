# What `./agent simplify-audit` measures

All counts exclude tests, generated `_gen_*` trees, `.artifacts/`, and `node_modules/`.

1. Source lines per package, and every file over 800 lines.
2. `Switch.*` uses, raw `switch` statements, and if/else-if chains over one `.kind`, `.type`, or
   `.$type` discriminant, per package with `file:line` for each chain.
3. `if` conditions holding two or more logical operators, per package. A review list, not a gate.
4. `repo-lint` allowlist entries per rule.
5. Identifiers declared at module scope in two or more files, and constants with identical values.
6. Cross-package import counts, as a `from → to (n)` graph.
7. Instruction lines: each `AGENTS.md`, each `SKILL.md` and reference file, each subagent profile,
   against the budgets.
8. `Docs/` Markdown lines and file counts per subtree, and live roadmap documents untouched for 60
   days.
9. Rules stated in more than one instruction file are not measurable by count; find them with a
   read-only scout and list them in the plan.

Name-level duplication was largely spent by the first runs. Expect the remaining savings inside
large files and across the Studio–runtime seam, which items 1, 2, and 6 point at.
