# Deferred Navigation Syntax Explorations

Status: archived. Every example predates the WordFlower tranches and uses retired syntax; the surviving ideas are owned by the `DEF-NAV-*` entries in the live follow-ups.

Status: non-normative preservation. These deliberately incomplete examples retain the shape of ideas from the deleted `@ToBeDecided` sketches. Their linked `DEF-NAV-*` records own the decisions; none of this syntax is accepted until that decision is resolved.

## Target-Specific Declarations

Owned by `DEF-NAV-008`.

One logical value could have target-specific definitions while its callers remain platform-independent:

```tao
<platform is Desktop>
   let WorkspaceNav = DesktopWorkspaceNav
</platform>

<platform is iOS | Android>
   let WorkspaceNav = MobileWorkspaceNav
</platform>

present DocumentUi Document in WorkspaceNav
```

A declaration that has no active branch would be unavailable on that target and rejected before lowering:

```tao
<platform is Desktop>
   ui DesktopInspector { ... }
</platform>

present DesktopInspector // unavailable-declaration error on iOS and Android
```

## Values Across `ask`

Owned by `DEF-NAV-009`.

The three preserved strategies are snapshot before suspension, revalidate a live reference afterward, or carry only identity and query again:

```tao
// Snapshot
let BeforeAsk = snapshot Task
let Decision = ask ConfirmDelete Task.Id
log BeforeAsk.Title
```

```tao
// Revalidated live reference
let Decision = ask ConfirmDelete Task
guard Task when
   Available -> delete Task
   Missing -> present MissingTaskUi
```

```tao
// ID and re-query
let TaskId = Task.Id
let Decision = ask ConfirmDelete TaskId
query FreshTask { where Id = TaskId }
```

## Presentation Results Or Handles

Owned by `DEF-NAV-007`. Initial navigation operations return no public value; these are possible later surfaces.

```tao
// Immediate acceptance status
let Status = present DocumentUi Document
when Status is
   Presented -> log "opened"
   Failed Error -> present PresentationErrorUi Error
   FellBack Fallback -> log Fallback
```

```tao
// Restorable occurrence handle
let Presentation = present DocumentUi Document
dismiss Presentation
```

## Presentation Restoration And Migration

Owned by `DEF-NAV-002` and `DEF-NAV-013`.

```tao
state SavedPresentation = serialize presentation WordFlower

on app restore -> {
   let Restored = deserialize presentation SavedPresentation
   present Restored
}
```

```tao
migrate presentation 2 -> 3 {
   rename destination OldEditor to DocumentEditorUi
}
```

## Unsafe Native Boundaries

Owned by `DEF-NAV-010`.

```tao
unsafe ts FormatNativeTitle DocumentId Data.Document.Id -> text

Text FormatNativeTitle(Document.Id)
```

The intended constraint is that unsafe code receives only explicit values and cannot by itself prove restoration, targeting, or completion guarantees.
