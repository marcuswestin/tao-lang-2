---
name: studio-hybrid-client
description: >-
  Change the Tao Studio browser client: TaoStudioProductHost, TaoStudioClient.tao, anything under studio-src/client, React portals over the imperative shell, the mounted CodeMirror editor, or a Studio DOM selector a test asserts on.
---

# Studio Hybrid Client

Studio's browser client is two systems sharing one DOM. `TaoStudioProductHost.tsx` mounts the
imperative shell (`mountStudio` from `./client/StudioApp`) and then portals React trees into nodes
that shell owns. `studio-src/client/` is live code on the served bundle, not a retired client.

- Never clear a container React portals into. `.studio-files`, `.studio-editor`, `.studio-components`,
  `.studio-project-views`, `.studio-screens`, `.studio-design-values`, `.studio-drawer-content`,
  `.studio-search-results`, `.studio-scenario-inspector-content`, and `.studio-inspector-tao-context`
  are portal targets; `replaceChildren()` or `innerHTML =` on one detaches React's own children, and
  React's next portal update calls `removeChild` on a node that is no longer a child. `TaoErrorBoundary`
  catches the `NotFoundError` and tears the client down, so the symptom is a blank workbench rather
  than an error at the guilty line.
- The shell must not render into a portal target it no longer owns. If the only remaining use of a
  `view.*` element is emptying it, that call is vestigial: delete it and let React own the content.
- Portal targets are captured once in a `useEffect(..., [])`. Replacing one of those nodes later leaves
  React holding the detached original, so the shell must keep the node identity stable.
- One container, one owner of its children. `.studio-editor` was mounted by both React's `CodeEditor`
  and the shell's own CodeMirror, which produced two `.cm-editor` instances: React's visible one and a
  0x0 orphan that still received the palette drop listeners. Attach behavior to the editor Tao renders.
- Dispatch editor mutations through the live `EditorView`, not by rewriting whole content. A wholesale
  content replacement lands in the document but never joins CodeMirror's undo history, so the next
  undo silently does nothing.
- A class styled in `StudioClientAssets.ts` is not proof anything emits it. Both
  `.studio-scenario-inspector-label` and its stylesheet rules existed while nothing applied the class.
