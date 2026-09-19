---
name: removing-code
description: >-
  Delete or retire anything in Tao: dead exports, unused recipes or modules, legacy branches, generated artifacts, or a surface an audit called unreferenced. Covers proving reachability, stale references, and lifecycle for generated trees.
---

# Removing Code

- Prove reachability before deleting; never infer it from a finding. Write the argument down, delete in layers, and keep the package typechecking and its tests passing after each layer so the compiler surfaces the next one.
- Zero code references does not mean dead for a human-facing surface. A `Justfile` recipe, a CLI command, and a documented workflow are discovered by a person reading `just --list` or `--help`, so judge them by whether a human would want them.
- Re-verify every "zero references" and every `file:line` claim against the current tree before acting. Findings drift; where a plan and the tree disagree, the tree wins — fix the plan line and continue.
- An unused export is usually a de-export, not a deletion. Keep the code, drop the `export`, and check no consumer in the same package needs it.
- `just dead-exports` fails on a finding rather than listing it, and runs in `verify` and `verify-full`. Raw Knip cannot see symbols bound from `.tao` sources, reached through a namespace facade, or republished by an import-type query — the repository's wrapper reconstructs all three, which is most of what it exists for. A surviving finding is usually a de-export rather than a deletion; an export something outside the TypeScript import graph really reaches is re-exported instead from a file in the declaring package named for which consumer reaches it — `packages/tao-cli/cli-src/subprocess-test-api.ts` is the only one today — and named in that package's `config/knip.json` entry points, never with a per-symbol suppression comment. One file per reason, so a record never becomes a list of exports nobody can account for. Its remaining limit is that it counts test-only usage as usage, so it cannot judge a symbol only its own tests reach.
- Sweep for stale references in the same change: docs, spec pages, generated-config entry lists, lint allowlists, and skills. A deleted bundle entrypoint or allowlisted file left behind breaks an unrelated gate later.
- Every generated tree needs a deleter. Give run roots a lifecycle that discards on success, keeps the newest failure to debug against, prunes on startup, and leaves roots a concurrent run may own; add the path to `just clean` in the same change.
- Do not leave a file a generator does not expect inside its output directory, and exclude generated symlinks from `tsconfig` includes, which follow them.
- Stamp expensive generation on the content of its inputs rather than regenerating per gate process.
- A configuration copy nothing generates will drift. Prefer generating it; otherwise add a parity check that fails when the source and the copy disagree.
- Prefer a ratchet to a flag day when a convention has many existing violations: gate the rule with a per-file allowlist, and report an allowlist entry that no longer violates so exemptions cannot outlive their reason.
