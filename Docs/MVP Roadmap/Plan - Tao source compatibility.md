# Plan — Tao source compatibility

Status: future work requested on 2026-10-01. Establish the public compatibility promise before
MVP release; implement this workstream later, separately from the current package and generated
TypeScript migration. The architecture below is a recommendation, not an implemented contract.

## Intent and release boundary

Newer Tao tools should be able to read supported older Tao source and bring it forward without
scattering historical syntax and semantics through the current language implementation. This is
backward compatibility in the compiler and forward migration for authored code; it does not promise
that an older compiler understands newer source.

Before MVP, migrate all repository apps to the current language. Retaining their old dialects is
not a requirement. The existing invitation-stage 0.x notice in Developer MVP Roadmap R3 still
warns of breaking changes. Before public MVP release, decide which released source versions become
supported inputs, the support window, and the migration guarantees. Do not retroactively promise
support for every internal or prerelease grammar.

Distinguish a source-language version from an app or published package's release version and the
installed toolchain version. Apps own runnable distribution and their dependencies; package
declarations describe published importable code and can coexist in one folder. Source-version
selection therefore cannot assume that each directory is owned by exactly one package. Settle
its metadata location and source membership before implementation, including shared source used
by multiple apps or publications. Do not guess a dialect by trying parsers until one accepts the
source. Independently versioned dependency packages may have different source versions.

## Recommended architecture

Use an isolated compatibility front end:

```text
source + declared source version
    → parser for that supported source version
    → version-owned syntax tree with source spans and trivia
    → explicit conversion steps between supported source versions
    → current canonical AST
    → ordinary current linking, validation, and compilation
```

Keep historical parsing and conversion modules in one language-compatibility package, grouped by
supported source version. Its public boundary accepts source, version, and origin information and
returns current-language input, source mappings, and positioned migration diagnostics. Current
parser, validator, compiler, and runtime packages must not import individual historical adapters
or contain version tests for retired syntax. CLI, Studio, and the extension consume the same entry
point.

Freeze a parser and its syntax-tree contract when a supported source version changes. A grammar
snapshot alone is insufficient: tokenization, parser behavior, generated node shapes, and defaults
can also change. Avoid importing historical AST nodes as current parser types or carrying historical
Langium service containers through the compiler. Reconstruct current AST nodes and references at
the compatibility boundary.

Give each conversion step an explicit input/output contract. Prefer sequential steps where they
make preservation easy to prove; the chain follows supported source-language revisions, not every
toolchain patch release. Migrations requiring symbol information get an explicit version-owned
analysis pass. Merely renaming AST fields cannot preserve changes to resolution, defaults, or
runtime meaning. A behavior change that cannot be preserved must produce a migration diagnostic
and request an authored decision rather than silently choosing a new interpretation.

Preserve an origin map through every step: original file URI, source range, and declaration owner.
Report errors against authored source and route editor navigation there. Preserve stable package
and declaration identities unless an explicit migration changes them. Syntax support alone does
not promise persisted-data, restore-state, sidecar API, or native-host compatibility; those need
their own versioned contracts and tests.

## Compilation, source rewriting, and distribution

Normal checking, compiling, and watching convert supported older source in memory. They must not
rewrite authored files or source-version metadata as a side effect. An explicit migration action
previews source edits, preserves comments and formatting where possible, checks the complete
affected package, and updates its declared source version only after successful migration. Decide
whether that action belongs to `tao fix` or a dedicated command before implementation.

Start by bundling the minimal parser/adapters needed for the promised support window. This gives
offline, reproducible behavior. Do not bundle complete historical compilers merely to parse old
source. Downloadable adapters are a later distribution option if measured size or maintenance
cost warrants them: pin an adapter's identity and integrity, define its host API and cache policy,
and make a missing adapter an actionable error. Keep source processing local; do not send authored
code to a migration service.

Toolchain pins remain useful for reproducing builds. Selecting an older installed compiler is
different from bringing older source into the current compiler and must not be presented as the
same guarantee.

## Ordered work and proof

1. Before MVP release, settle and publish the supported source-version floor/window, semantic
   preservation promise, deprecation policy, source-version metadata, and explicit migration UX.
   Amend the release promise in R3 and the package specification when these decisions are made.
2. Establish the first supported grammar/tree baseline and a corpus of released apps, handwritten
   sidecars, diagnostics, and observable behavior. There is no need to retain pre-MVP dialects for
   the current repository-wide rewrite.
3. Before the first supported breaking language change, implement one adapter and the common
   entry point. Prove the seam with an actual change, rather than inventing several historical
   versions solely to exercise infrastructure.
4. Prove chained conversions, mixed-version dependencies, source navigation, stable identity,
   explicit rewrites, and offline behavior. Verify CLI and extension observe the same results.
5. Require every subsequent supported language change to ship its adapter, migration notes, and
   corpus coverage alongside the current implementation. Removing a supported adapter requires the
   announced support policy, not an incidental cleanup.

Acceptance includes equivalent observable app behavior for migrations claimed to preserve it;
positioned errors for unsupported or unconvertible constructs; preserved comments and locations;
idempotent explicit migration; unchanged authored files during ordinary checks/watch; and useful
failure for a source version newer than the tool understands. Measure conversion cost and bundled
size before deciding whether adapter downloads or optimized conversion paths are needed.

## Decisions reserved for the later workstream

- The supported release floor, duration, and definition of a supported source-language revision.
- Source-version metadata spelling and the explicit migration command.
- Which semantic changes can be translated, which require manual edits, and which need preserved
  runtime behavior rather than an AST conversion.
- Whether measured distribution costs justify downloadable adapters.

No compatibility adapters or source-version syntax are implemented by this plan.
