# Follow-ups - Declaration Model Spike

Live record of declaration-model work that is still unbuilt. The settled model lives in
`Implementation - Declaration model spike.md`; undecided language questions live in
`Open questions - Declaration model spike.md`. This file owns only what is decided but
unfinished.

The two build slices (`Now 1 Unified declaration slots`, `Now 2 Sidecar TypeScript implementations`)
landed together on `feat/declaration-model`. Everything below is what they did not finish.

## FOLLOW-DECL-001: Make the prelude the authority, not a mirror — resolved

`packages/stdlib/tao/Prelude.tao` exists as real parsed, validated Tao, and drift between it and the
compiler is caught. But the direction of authority is backwards from the intent:
`prelude-validator.ts` checks the prelude _against_ a hardcoded `expectedPrimitives` list, with
hardcoded slot expectations for `nav`, `datasource`, and `app`. Nothing reads slot contracts _from_
the prelude to drive validation elsewhere.

So the prelude is currently a pinned mirror of the compiler's beliefs rather than the source of them,
and adding a slot to a primitive still means editing TypeScript. The work is to invert that: have the
app, nav, and datasource validators resolve their slot contracts from the parsed prelude, and reduce
`prelude-validator.ts` to checking that the file exists, parses, and declares the closed set of
primitive names.

**Resolved by the host-read view slots and native nav kit tranche.** Validators now resolve
primitive slot contracts and refinement inheritance from the parsed prelude. Adding defaulted
`Title` and `Toolbar` to primitive `scene` required no parallel hardcoded expected-slot edit, and
`nav is scene is view` sees them through the same effective-slot traversal. `prelude-validator.ts` retains
only the closed primitive-name/family integrity checks needed to bootstrap the language.

The unified view tranche shrank the pinned set — `visual`, `presentable`, `ui`, `layout`, and
`frame` collapsed into the one `view` primitive, and `nav` now refines `view` — by editing the same
hardcoded lists this follow-up wants derived from the prelude (`prelude-validator.ts`,
`TypeSystemHelpers.primitiveTypes`, `Type.ts`'s parent map). The hardcoding was not deepened, and
the collapse makes the eventual inversion smaller.

## FOLLOW-DECL-002: Filter defaulted slots in configurable completeness — resolved

`completeness-validator.ts` filters defaulted slots for visual declarations
(`parameter.defaultValue === undefined`) and for type declarations (`Type.propertyRequiresValue`),
but the configurable-declaration branch returns every configuration property unfiltered.

**Resolved by the host-read view slots and native nav kit tranche.** Completeness now asks the
declaration model whether an effective supplied slot requires a value instead of treating every
configuration member as required. Primitive defaults therefore remain optional through refinement
and transparent configurable-type aliases. `Title` and `Toolbar` prove the path: a scene may omit
them generally, while a StackNav scene placement independently requires `Title` and reports that
usage error at the placement. A plain view has neither slot and receives Back-only chrome.

## Not follow-ups

Recorded here so they are not rediscovered as defects:

- **`Datasource datasource is none` in the prelude.** Eight of the ten apps in the repository declare
  no datasource, so an app's `Datasource` slot is optional by necessity, not by preference.
- **`TypeSlotName: ID | 'implement'`.** A keyword workaround, but a working one. Tranche 4 resolved
  Q11 by retaining `implement inject nav|provider` as the explicit protocol-binding clause that fills
  this primitive requirement; it is not an independent cleanup item.
