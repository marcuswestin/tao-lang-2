# Native device capability findings

## What shipped

The existing sidecar bridge already supports parameterized action fields end to end: parser, validator, compiler, and `TR.Do` all preserve and invoke action parameters. This tranche therefore required no language change.

- `Haptic` exposes one semantic `Play(HapticKind)` action with `Selection`, `Light`, `Medium`, `Heavy`, `Success`, `Warning`, and `Error`. Its thin sidecar passes the compiled declaration's exact case identities into TR, which translates them to Expo at the runtime boundary and safely does nothing when haptics are unavailable.
- `Clipboard` exposes `Copy(text)`, `Read()`, and a reactive optional `Value`. Native access stays lazy, and `Value` remains absent until a read completes.
- `Share` exposes the portable `Open(text)` action. Share outcomes were deliberately cut from this tranche because shared-versus-dismissed belongs to the future action-outcome shape; a reactive field would be a temporal surrogate for that language feature.

The runtime now owns a small lazy native-module kernel, cache, friendly required-module errors, and the shared reactive-source primitive used by clipboard state and existing runtime units.

## Existing machinery repaired

- Optional scalar values can now be interpolated because every member of a scalar-or-`none` union is already supported by interpolation.
- Referencing an imported enum case now retains the owning enum import during source organization.

Both repairs enforce existing language behavior; neither adds syntax or semantics.

## Deferred guidance

- Outcome-bearing actions should eventually feed exact declaration-owned cases into `when do`; Haptic proves a declaration-owning sidecar can supply its compiled cases to TR, but does not settle how an action delivers one. Manufacturing lookalike cases in the runtime would break identity-based matching.
- Permissions should be declared at the app or capability boundary and remain provider-neutral. Location, camera, and similar capabilities need explicit denied, unavailable, and failure behavior rather than boolean shortcuts.
- Native Jest coverage proves the adapter contracts but does not replace an iOS and Android device smoke test for module linking, permission configuration, and platform behavior.
