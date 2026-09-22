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
    CodeEditor.tao             the foreign view declaration, naming TaoStudioProductHost.tsx
```

Every foreign view this app declares, `@code-editor`'s included, resolves by relative hop into
`packages/ides/studio/studio-src/`, where the TypeScript implementations live and where their own
`react`, `@shared`, and `@runtime` imports resolve through that package's `node_modules` — `Apps/`
has none of its own. `StudioServerDataProvider.ts` is a sibling stub because a
`provider … from ./X.ts` sidecar must exist at the declared path; the editor needs no such stub,
and must not have one: naming `TaoStudioProductHost.tsx` directly, as the client's other views do,
is what keeps the editor and the host on one copy of the product-host module graph, and so on one
instance of the revisioned host state they share.
