# Syntax2 B — rendering and slots

Own rendering/slots under [the program](<Implement Syntax2.md>), [Decisions](../Tao%20Revolution/Decisions.md),
and [ownership](<Syntax2 ownership.md>). Start in your own worktree from main containing the landed
render foundation and this brief; record the exact base. Run ./agent help and applicable instructions.
The first foundation already implements bare zero-argument views and quoted Text; preserve its
rename, private-binding and reserved guard/when payload regressions.

## First slice B1

Implement occurrence accessibility labels: `#heading accessible label "Library"` or
`accessible label "Library"` followed by a view render/quotation. A contiguous metadata cluster
attaches to the next visual occurrence within its block. Preserve the tag even when a label
prefix intervenes. Canonical formatting places the tag first and collapses the cluster onto one
line when that preserves attachment. Accept a11y as the selected input shorthand. Labels may be
reactive; explicit occurrence metadata follows the existing caller-prop precedence into the
actual native root. It must not create visible text or a wrapper. Keep this slice to occurrence
labels; declaration defaults, additional properties and full slots follow later.

Exclusive source paths (including explicit coordinator transfers for this slice):

- packages/language/parser/parser-grammar/views.langium and blocks.langium, prefix grammar only
- packages/language/parser/parser-src/ast-structure.ts, shared prefix attachment helpers only
- packages/language/validator/validator-src/validators/views-validator.ts
- packages/language/formatter/formatter-src/formatters/ViewsFormatter.ts
- packages/compiler/compiler-src/codegen/react-native/app/TaoPropsCompiler.ts
- packages/compiler/compiler-src/codegen/react-native/app/StatementsCompiler.ts, prefix setup/no-op only
- packages/apps/runtime/TaoRuntime-src/TR-TaoProps.ts
- packages/apps/runtime/TaoRuntime-src/TR-views.tsx
- Feature-specific validation messages beside the owned validator, if required.

Exclusive new tests: render-prefixes.test.ts in parser/validator/formatter/compiler test directories,
and packages/apps/runtime/TR-tests/TR-render-prefixes.test.ts. Submit additional exact path requests
before editing. First present the minimal parser/attachment shape to the coordinator, then implement
the vertical slice; do not invent a second tag/attachment algorithm. If a new statement needs shared
Compile/registration/scoping exports, send the minimal requested patch for coordinator integration.

A owns type/binding; D owns effects/action codegen. Neither needs B1's parser semantics. Preserve
their APIs and all other edits. No capabilities, nominal types, effect inference, native factory,
app source, dependencies or lockfile edits belong to B1. You are not alone in the repository.

## Acceptance and next slices

Prove same-line and multiline clusters, reversed input order, quoted/custom-view targets, reactive
labels, canonical stability, and no attachment leakage to later siblings or nested content.
Reject dangling/misplaced prefixes in this supported subset. Preserve existing tags, outlines,
control labels and public-name behavior. Use mounted native-prop assertions alongside generated
source checks; parsing alone does not establish accessibility. Run each owned test through
./agent test-file, then ./agent verify-changed.

Return exact APIs/paths, evidence and remaining gaps in at most 700 words. Commit reviewed task
paths on a named feature branch; wait for coordinator release before landing. Obtain the next
ownership amendment for parameterized/repeated slots/defaults/replacement/exact forwarding,
bare-value ui dispatch/empty suppression, and remaining prefix properties/defaults. Those depend
on A's callable/capability contracts. Extend the shared binder; never create a slot-specific rival.
