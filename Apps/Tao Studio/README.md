# Tao Studio

Studio's own browser client: an ordinary Tao app rather than a package, so its `.tao` source follows
the same conventions as any other `Apps/` entry. `packages/ides/studio/README.md` owns how to launch,
inspect, and recover Studio — the operational guide belongs there, since that package is what runs
it. `Docs/Spec/Tao Studio.md` owns what Studio _is_ as an implemented product contract.

```text
Apps/Tao Studio/
  TaoStudioClient.tao          the workbench view tree, panels, and state
  Project.tao                  this app's own project identity
  StudioServerDataProvider.ts  sibling stub the StudioServer datasource requires; re-exports the
                                implementation from packages/ides/studio, which stays there
  @code-editor/                the code editor as an app-local package
    CodeEditor.tao             the foreign view declaration
    CodeEditor.tsx             sibling stub; re-exports the state-wired surface from
                                packages/ides/studio/studio-src/product-host, which stays there
```

Every foreign view `TaoStudioClient.tao` declares outside `@code-editor` resolves by relative hop
into `packages/ides/studio/studio-src/`, where the TypeScript implementations live and where their
own `react`, `@shared`, and `@runtime` imports resolve through that package's `node_modules` —
`Apps/` has none of its own. The two files above are sibling stubs for the same reason: a
`provider … from ./X.ts` sidecar and a foreign view's own binding file must exist at the declared
path, so each is a thin re-export rather than a copy of the implementation.
