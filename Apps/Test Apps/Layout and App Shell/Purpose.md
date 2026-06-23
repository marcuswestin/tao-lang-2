# Layout and App Shell

## Purpose

This app verifies bracketed layout clauses and the default app-shell baseline. `Layout and App Shell.tao` is the executable regression app.

## Belongs Here

- Bracketed layout clauses on render sites, including `content`, `gap`, `pad`, `margin`, numeric and `fill` `width`/`height`, `fill`, `hug`, `compress`, `rigid`, `aligned`, and `centered`.
- App-root content that should render inside the safe default Tao app shell.
- Rendered text used by behavior-test assertions for the layout/app-shell smoke path.

## Does Not Belong Here

- Visual style clauses such as `<background ...>`.
- `frame`, `@@content`, named render slots, render IDs, or render elision.
- State, actions, forms, data, navigation, or scroll-container behavior beyond app-shell basics.

## Edit When

- The layout clause vocabulary changes in `Spec/Tao Layout and UI.md`.
- The app-shell baseline changes in the runtime.
- The executable app drifts from the layout/app-shell behavior this fixture is meant to cover.

## Behavior Test Notes

Runtime behavior tests compile the executable app and assert rendered text for the layout/app-shell smoke content. Style-specific behavior is covered in runtime tests for `TR.Layout` and `TR.AppShell`.
