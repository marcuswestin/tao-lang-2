# Follow-ups - Declaration Model Spike

Live record of declaration-model work that is still unbuilt. The settled model lives in
`Implementation - Declaration model spike - Claude.md`; undecided language questions live in
`Open questions - Declaration model spike - Claude.md`. This file owns only what is decided but
unfinished.

The two build slices (`Now 1 Unified declaration slots`, `Now 2 Sidecar TypeScript implementations`)
landed together on `feat/declaration-model`. Everything below is what they did not finish.

## FOLLOW-DECL-001: Make the prelude the authority, not a mirror

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

**Blocks:** nothing today. Blocks any primitive gaining a slot without a compiler change — which is
the whole point of writing the prelude in Tao.

## FOLLOW-DECL-002: Filter defaulted slots in configurable completeness

`completeness-validator.ts` filters defaulted slots for visual declarations
(`parameter.defaultValue === undefined`) and for type declarations (`Type.propertyRequiresValue`),
but the configurable-declaration branch returns every configuration property unfiltered.

This is not a live defect: `ConfigurationPropertyDeclaration` is `name=ID type=ConfigurationPropertyType`
with no default field, so there is nothing to filter on and the correct fix today would be dead code.
It becomes a real bug the moment `is` defaults reach configuration blocks — which is likely, since
type blocks already have them.

**Blocks:** nothing. Pair it with whatever change gives configuration properties defaults.

## Not follow-ups

Recorded here so they are not rediscovered as defects:

- **`Datasource datasource is none` in the prelude.** Eight of the ten apps in the repository declare
  no datasource, so an app's `Datasource` slot is optional by necessity, not by preference.
- **`TypeSlotName: ID | 'implement'`.** A keyword workaround, but a working one. It is a symptom of
  `Open questions` Q11 rather than an independent problem, and should be revisited with that question
  rather than before it.
