// The state wiring and the CodeMirror component it drives both stay in `packages/ides/studio`,
// beside every other product-host view; this app-local binding only names the export the foreign
// view declaration in `CodeEditor.tao` requires. A relative export, not a bare package import, so a
// plain module loader resolves it without a workspace `node_modules` entry for `Apps/`.
export {
  StudioEditorSurface as CodeEditor,
} from '../../../packages/ides/studio/studio-src/product-host/StudioEditorSurface'
