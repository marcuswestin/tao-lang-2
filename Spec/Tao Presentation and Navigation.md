# Tao Presentation And Navigation

Status: implemented MVP.

Tao applications may select either one root view or one app-owned stack. The stack is the MVP navigation container: it has one argument-free initial destination, a closed set of destination views, ordered presentation history, typed destination arguments, and deterministic back behavior.

## Declaring A Stack

```tao
project stack MainNavigation {
   initial WorkspaceList
   destination WorkspaceList
   destination WorkspaceDetail
}

app Still {
   stack MainNavigation
}
```

Each `destination` references a `view`. The destination inherits that view's parameter signature, so the view declaration is the single source of truth for its typed inputs:

```tao
project view WorkspaceList {
   render Text("Workspaces")
}

project view WorkspaceDetail WorkspaceId is text {
   render Text(WorkspaceId)
}
```

A stack must declare each destination once. Its `initial` name must match one declared destination, and that initial destination must not require parameters. An app block contains exactly one `view` or `stack` root.

## Presenting A Destination

Navigation is action-owned and non-blocking:

```tao
action OpenWorkspace WorkspaceId is text {
   present MainNavigation.WorkspaceDetail .WorkspaceId WorkspaceId
}
```

`present Stack.Destination arguments` validates arguments against the destination view exactly like a render invocation. Named arguments are recommended when destinations accept repeated primitive types. A successful presentation pushes a new occurrence onto the named stack; presenting the same destination and semantic value again still creates a distinct history entry.

The runtime owns the ordered stack state. Generated code contains destination descriptors and delegates history changes to `TR.Navigation`; app-specific routing logic is not generated or injected by hand.

## Back

```tao
action ReturnToList {
   back MainNavigation
}
```

`back Stack` pops one presented entry. Back at the initial entry is a safe no-op. On React Native, a hardware back event dispatches the same operation and is consumed only when an entry was popped.

Tao checks drive navigation through user-visible controls and rendered assertions. Cached stack descriptors reset to their initial entry before every check, so checks do not share navigation history.

## Presentation Boundary

Views remain presentable UI; a `stack` is an app root and is not renderable as an ordinary child view. The existing layout system continues to own visual layout within each destination. Root destination views receive the same app-shell layout props as a direct app root.

## Diagnostics

Validation reports:

- duplicate destinations;
- missing or parameterized initial destinations;
- presentation of an undeclared destination;
- missing, extra, ambiguous, duplicated, or incorrectly typed destination arguments;
- invalid app root count or root statements.

Accepted navigation syntax formats deterministically.

## Deliberate Deferrals

The MVP does not include tabs or selection navigation, split views, slots, overlays, modals, windows, toasts, target paths, replacement, restoration, deep links, public routes, animation policy, navigation results, guards, or lifecycle hooks. These require a forcing application beyond Still before they should expand the semantic model.
