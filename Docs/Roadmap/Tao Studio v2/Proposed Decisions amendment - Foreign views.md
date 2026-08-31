# Proposed Decisions amendment - Foreign views

Status: proposed wording for Ro to incorporate into
`Docs/Roadmap/Tao Revolution/Decisions.md`. Foreign views and transitive sidecars are implemented, but
this document does not replace the authoritative Decisions file.

## Typed foreign views

A view may declare a named TypeScript implementation in its head:

```tao
view CodeEditor(Content text, Change action(text)) accepts content slots @toolbar from ./CodeEditor.tsx
```

- The sidecar provides the named export matching the view declaration.
- Tao owns the public parameter, response, caller-content, and named-slot contract.
- Evaluated values cross as plain JavaScript values. Action parameters cross as invokable action
  values.
- The component receives `Layout` and `Tag`, one `Slots` record keyed by the declared `@slot` names,
  and `children` only when the head declares `accepts content`.
- The component owns its native root, honors Layout and Tag, and renders every accepted content
  channel exactly once.
- `responds T` remains available on the foreign view head.
- `render inject` remains supported for an occurrence-level native implementation and is not replaced
  by this declaration form.

The concrete `accepts content slots @name` spelling and the single `Slots` record prop are the proposed
resolution for the named-slot detail that the Studio v2 project brief did not spell exactly.

## Transitive sidecar graph

The compiler follows static imports, dynamic imports, and re-exports whose specifiers are relative. It
copies TypeScript, TSX, JavaScript, JSX, and JSON dependencies while preserving graph topology, and
rewrites sibling `.tao` type imports to generated declaration paths. Installed-package imports stay
external and remain the application package manager's responsibility.

## Implemented integration boundary

The parser, validator, formatter, compiler, runtime bridge, generated declarations, and transitive sidecar
copying are implemented and focused tests execute imported foreign views. `@tao/code-editor` supplies the
reusable CodeMirror 6 foreign view and can attach the existing JSON-over-WebSocket LSP transport.

The production Studio browser client still constructs CodeMirror directly. `TaoStudioClient.tao` is an
executable Files-panel strangler, but it does not yet mount the editor package or replace the TypeScript
shell, canvas, inspector, or file-tree controller. Those are product migrations, not missing foreign-view
language semantics.
