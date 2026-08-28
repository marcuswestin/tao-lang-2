# Design - Canonical Descriptor Identity

Draft for review. Extracted from the reviewed navigation foundation plan before its planning worktree
was archived. `FOLLOW-NAV-003` still owns restoration, and this is the settled identity design that
work depends on. Nothing here is implemented.

The project-ID contract that the same plan settled is **not** repeated here — `FOLLOW-NAV-003` in
`Follow-ups - Add navigation and routing MVP.md` already states it, and states it more completely
(it adds `tao create <id>`, the missing-ID diagnostic, and the clone/fork rules).

## Declaration identity, version 1

A declaration's identity is the compact canonical JSON serialization, encoded as UTF-8, of:

```text
["tao.declaration", 1, projectId, packageId, modulePath, declarationKind, declarationName]
```

- A declaration in the workspace root uses package ID `@workspace`. A package declaration uses the
  identity by which its package is imported, independent of its resolved revision.
- `modulePath` is extensionless, slash-normalized, and relative to the workspace or package root. It
  never contains an absolute checkout path.
- Declaration kind and declaration name are explicit components, so unrelated declaration namespaces
  cannot collide.
- Clone location, filesystem separators, Git remote, branch, and revision never participate.
- This version number is separate from presentation-state schema versions and from descriptor hash
  versions. The three version independently.

## Canonical descriptor values

A configured UI or nav value lowers to a canonical descriptor holding its declaration ID and its
fully materialized public properties. Canonical values use recursive tagged arrays so host-object key
order cannot affect equality.

- `none`, text, number, and boolean use distinct primitive tags. Numbers use one canonical finite
  decimal representation, with negative zero normalized to zero.
- Lists retain source value order and canonicalize each element.
- Item values hold owner-qualified property identity/value pairs sorted by property identity.
- Nested configured values hold their complete canonical descriptor.
- Entity references hold an opaque, provider-supplied stable reference token. A provider cannot
  inject an unresolved ambient object into a descriptor.

Defaults and optionals are materialized _before_ canonicalization. Every property list is sorted by
owner-qualified slot identity. Canonical encoders reject unsupported or cyclic host values rather
than falling back on JavaScript object identity or incidental serialization order.

## Two equalities

- **Full descriptor equality** compares the complete canonical structure. It is what resolves a
  configured-nav target.
- **Semantic identity** compares the declaration plus semantic properties only.

User-defined UI and nav properties are semantic by default. Runtime declaration metadata may mark a
property non-semantic without removing it from full equality. No user-facing syntax for changing that
classification is proposed.

## Hashing is an index optimization, never an identity

Use a separately versioned FNV-1a hash over the canonical UTF-8, and pin its internal representation
with fixed golden vectors. The hash is never persisted and never public. A hash hit is always
confirmed by structural equality, so a collision can cost performance but can never affect identity
or target resolution.

## Restorability validation

A configured descriptor may contain only canonical primitives, `none`, lists, items, nested
descriptors, and entity-reference tokens. Validation rejects actions, functions, closures,
components, native handles, and any other non-restorable value in a UI or nav public property.

Keyed canonicalization and persistence I/O are out of scope here and remain deferred.

## Not carried over from the source plan

- The `DEC-NAV-001..033` decision inventory and its traceability table. `main` records navigation
  deferrals as `DEF-NAV-001..018`; importing the other numbering would create dangling IDs with no
  resolvable source.
- The seven implementation slices, acceptance matrix, and compatibility-removal criteria. Navigation
  shipped, so those describe work already done or already recorded as follow-ups.
