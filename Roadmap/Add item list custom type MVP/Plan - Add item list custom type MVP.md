# Add Item/List/Custom Type MVP

## Summary

Implement compile-time Tao type declarations, list literals, typed constructors, type-fixing with `as`, item member access, and type-based render/property binding against the current `view`/`layout` syntax.

## Public Language Changes

- Add `type` declarations for primitive, list, and item shapes.
- Add list literals, item literals inside typed constructors, typed primitive/list/item construction, `as` type-fixing, and member access.
- Use spec parameter syntax: primitive parameters require aliases such as `text as Label`; named type parameters may omit aliases such as `Person`.
- Resolve render arguments and item constructor fields by exact type first, then by unambiguous nominal lineage.

## Implementation Steps

1. Extend parser grammar, AST, and scoping for type declarations, type references, list/item literals, constructors, casts, member access, and spec-form parameters.
2. Extend the validator type model with nominal custom types, `item`, and `list`; keep type declarations compile-time-only.
3. Share the type-based binding helper between render invocation validation and item constructor validation.
4. Compile type declarations and casts away; lower constructors, lists, objects, member access, and resolved JSX props to runtime `TR.Value` shapes.
5. Format the new syntax and migrate stdlib, fixtures, tests, Kitchen Sink, and Type System Tests to the supported syntax.

## Validation

- Parser, validator, compiler, formatter, CLI, IDE, workspace, runtime, and app fixture tests cover the implemented syntax.
- `Apps/Test Apps/Type System Tests/Type System Tests.tao` is the executable acceptance fixture.
- `Apps/Test Apps/Type System Tests/Item List Custom Type MVP.tao-next` remains as the non-executable acceptance sketch that mirrors the implemented examples.
- Final handoff validation is `./agent just prep`.

## Deferrals

- List element typing, `list T`, union inference, optional fields, `has`, item extension/overlays, boolean/action/view value types, match, operators, interpolation, state, and alias/state shorthand remain future roadmap slices.
