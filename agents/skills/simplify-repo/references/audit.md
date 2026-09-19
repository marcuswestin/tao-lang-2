# What `./agent simplify-audit` measures

`packages/dev/dev-src/simplify-audit/` owns it. Source counts cover tracked package TypeScript and
exclude tests, declaration files, and generated `_gen_*` trees.

1. Source lines per package, and every file over 800 lines.
2. `Switch` calls, native `switch` statements, and chains of three or more branches over one
   `.kind`, `.type`, or `.$type`, with `file:line` for each chain. `repo-lint` gates the chains
   through `KIND_CHAIN_ALLOWLIST`, which only shrinks.
3. `if` conditions holding two or more logical operators on one line. A review list, not a gate.
4. `repo-lint` allowlist entries per convention rule.
5. Module-scope constants declared with one name and one literal in several files.
6. Cross-package import counts, as a `from → to (n)` graph.
7. Lines per instruction file, marked where over budget.
8. `Docs/` Markdown lines and file counts per subtree.

What it cannot measure, so a read-only scout finds it and the plan lists it:

- Rules stated in more than one instruction file, and prose restating an existing gate.
- Near-duplicate functions under different names, and families that differ by one parameter.
- Roadmap documents whose work has landed.

Name-level duplication was largely spent by the first runs. Expect the remaining savings inside
large files and across the Studio–runtime seam, which items 1, 2, and 6 point at.
