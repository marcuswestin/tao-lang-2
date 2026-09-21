# Studio Hybrid Client

Studio's browser client is two systems sharing one DOM. `TaoStudioProductHost.tsx` mounts the
imperative shell (`mountStudio` from `./client/StudioApp`) and then portals React trees into nodes
that shell owns; the root product tree is itself portaled into `#tao-studio-viewport`.
`studio-src/client/` is live code on the served bundle, not a retired client.

- Never clear a container React portals into: `#tao-studio-viewport`, `.studio-files`,
  `.studio-editor`, `.studio-components`, `.studio-project-views`, `.studio-screens`,
  `.studio-design-values`, `.studio-data`, `.studio-drawer-content`, `.studio-search-results`,
  `.studio-scenario-inspector-content`, `.studio-inspector-tao-context`, and
  `.studio-inspector-tao-environment` are portal targets. `replaceChildren()` or `innerHTML =` on one
  detaches React's own children, and React's next portal update calls `removeChild` on a node that is
  no longer a child; `TaoErrorBoundary` then tears the client down to a blank workbench rather than
  showing an error at the guilty line.
- The shell must not render into a portal target it no longer owns; if the only remaining use of a
  `view.*` element is emptying it, delete that call and let React own the content.
- Portal targets are captured once in a `useEffect(..., [])`. Replacing one of those nodes later
  leaves React holding the detached original, so the shell must keep the node identity stable.
- One container, one owner of its children — attach editor behavior to the CodeMirror instance Tao
  renders, not a second one the shell mounts itself.
- Dispatch editor mutations through the live `EditorView`, not by rewriting whole content: a
  wholesale content replacement lands in the document but never joins CodeMirror's undo history, so
  the next undo silently does nothing.
- Tao-owned buttons, segmented controls, choices, and inspector actions own their accessible state
  and dispatch. The imperative shell supplies stable portal targets and the workbench controller; it
  must not install a second handler or mutate panel state behind React. Route host effects through
  `StudioHostActions` and `StudioProductHostProtocol`, and cover a control through its real action
  adapter rather than treating rendered markup as behavioral proof.
- A class styled in `StudioClientAssets.ts` is not proof anything emits it; check the live DOM.
