# Tao Presentation And Navigation

Status: authoritative implemented MVP.

Tao applications select either one root view or one app-owned stack. The stack is the MVP navigation container: it has one initial destination that requires no supplied arguments, a closed set of typed destination views, ordered presentation history, state-preserving covered entries, and deterministic back behavior.

## Declaring a stack

```tao
project stack MainNavigation {
   initial WorkspaceList
   destination WorkspaceList
   destination WorkspaceDetail
   destination DocumentEditor
}

app WordFlower {
   datasource WordFlowerData through Local
   stack MainNavigation
}
```

Each `destination` references a `view`. The destination inherits that view's parameter signature, including entity types and typed defaults, so the view declaration is the single source of truth for its inputs:

```tao
project view WorkspaceList {
   render Text("Workspaces")
}

project view WorkspaceDetail Workspace is WordFlowerData.Workspace {
   render Text(Workspace.Name)
}
```

A stack declares each destination once. Its `initial` name must match one declared destination, and the initial destination must declare no required parameters. All-defaulted parameters are allowed and use their view defaults when the runtime mounts the argument-free initial entry. An `app` contains exactly one `view` or `stack` root; datasource bindings may precede that root.

## Presenting a destination

Presentation is an action statement:

```tao
action OpenWorkspace Workspace is WordFlowerData.Workspace {
   present MainNavigation.WorkspaceDetail(.Workspace Workspace)
}
```

Parentheses are mandatory, including for an argument-free destination: `present MainNavigation.Settings()`. Presentation arguments use the same typed binding as render and action invocations. `.Parameter Value` explicitly selects a parameter and is required to override a defaulted destination parameter; unnamed values bind only when the remaining required parameter match is unambiguous.

A successful presentation pushes a new occurrence onto that stack. Presenting the same destination and semantic value again still creates a distinct history entry. Generated code contains destination descriptors and delegates history changes to `TR.Navigation`; application-specific routing logic is not injected by hand.

Entity-valued destination arguments remain live. The navigation host subscribes to data revisions, so a destination reading `Document.Title` or `Document.Workspace.Name` rerenders after that row or relationship changes.

## Covered entries and back

Every presented entry receives a stable occurrence identity. Covered entries remain mounted but are hidden visually and from accessibility traversal, preserving their local React/Tao state. Popping the top entry therefore reveals the exact prior destination instance rather than reconstructing it.

At depth greater than one, the stack host supplies an accessible `Back` control. Platform hardware back, the automatic control, and explicit Tao back actions all use the same reducer:

```tao
action ReturnToPrevious {
   back MainNavigation
}
```

`back Stack` pops one entry. Back at the initial entry is a safe no-op; a hardware event is consumed only when an entry was popped.

Tao behavior checks may use the test-only `back` step to invoke the currently mounted stack's same root-safe reducer. Cached stack descriptors reset to their initial entry before every check, so checks do not share history.

## Presentation boundary

Views remain presentable UI; a `stack` is an app root and cannot be rendered as an ordinary child view. The layout system continues to own visual layout within each destination. Root destination views receive the same app-shell layout props as a direct app root.

Rendering, action invocation, function invocation, and presentation all delimit arguments with parentheses. A render layout clause remains outside the argument list:

```tao
render WorkspaceCard(.Workspace Workspace) [fill, gap 8] {
   Text(Workspace.Name)
}
```

## Diagnostics

Validation reports:

- duplicate destinations;
- a missing initial destination or one with required parameters;
- presentation of an undeclared destination;
- missing, extra, ambiguous, duplicated, or incorrectly typed destination arguments;
- invalid app root count or root statements.

Accepted navigation syntax formats deterministically.

## Deliberate deferrals

The MVP does not include tabs or selection navigation, split views, slots, overlays, modals, windows, toasts, target paths, replacement, restoration across app launches, deep links, public routes, animation policy, navigation results, guards, or lifecycle hooks. These remain future design work and should not be inferred from the implemented stack.
