# Test Apps

Each test app has a specific purpose. Keep every app in its own folder:

```text
Apps/Test Apps/<App Name>/
  <App Name>.tao
  Purpose.md
```

`Purpose.md` is the contract for the app. Use these sections:

- `Purpose`: the language/runtime behavior this app exists to exercise.
- `Belongs Here`: functionality that should be added to this app.
- `Does Not Belong Here`: nearby functionality that should get another app or package test instead.
- `Edit When`: specific triggers for updating this app or its purpose.
- `Behavior Test Notes`: planned or existing automated behavior checks. Keep this section even when it only says behavior automation is not wired yet.

When adding functionality to a test app, update `Purpose.md` first if the new behavior changes the app's scope.
