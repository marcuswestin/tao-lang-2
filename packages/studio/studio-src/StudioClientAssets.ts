import { FS } from '@shared'

export type StudioClientConfig = {
  previewUrl?: string
}

let clientBundle: Promise<string> | undefined
let clientModuleInputs: readonly string[] = []

/** StudioClientAssets builds and serves the browser Studio shell from its typed source. */
export const StudioClientAssets = {
  bundle,
  html,
  testing: {
    moduleInputs,
  },
} as const

async function bundle(): Promise<string> {
  clientBundle ??= buildClientBundle()
  return await clientBundle
}

async function moduleInputs(): Promise<readonly string[]> {
  await bundle()
  return clientModuleInputs
}

function html(config: StudioClientConfig): string {
  const serializedConfig = JSON.stringify(config).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>Tao Studio</title>
  <style>${clientCss}</style>
</head>
<body>
  <main id="tao-studio-root" aria-label="Tao Studio"></main>
  <script>window.TaoStudioConfig = ${serializedConfig}</script>
  <script type="module" src="/studio.js"></script>
</body>
</html>
`
}

async function buildClientBundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [FS.resolvePath('StudioClient.ts', import.meta.dir)],
    metafile: true,
    minify: false,
    sourcemap: 'inline',
    target: 'browser',
  })
  if (!result.success) {
    const messages = result.logs.map(log => log.message).join('\n')
    throw new Error(`Could not build the Tao Studio browser client.\n${messages}`)
  }
  clientModuleInputs = Object.keys(result.metafile?.inputs ?? {})
  const output = result.outputs[0]
  if (output === undefined) {
    throw new Error('Tao Studio browser build produced no JavaScript output.')
  }
  return await output.text()
}

const clientCss = `
:root {
  color: #e8e7e3;
  background: #171918;
  font: 13px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
html, body, #tao-studio-root { width: 100%; height: 100%; margin: 0; }
button { color: inherit; font: inherit; }
.studio-shell { display: grid; grid-template-rows: 44px minmax(0, 1fr); height: 100%; }
.studio-toolbar {
  align-items: center; background: #202321; border-bottom: 1px solid #353936; display: flex;
  gap: 12px; padding: 0 14px;
}
.studio-wordmark { font-weight: 700; letter-spacing: .02em; }
.studio-project { color: #aeb5ae; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-reload { background: #2b302c; border: 1px solid #444b45; border-radius: 5px; cursor: pointer; padding: 5px 9px; }
.studio-reload:hover { background: #363c37; }
.studio-status { color: #9ba59c; margin-left: auto; }
.studio-status[data-state="error"] { color: #ff9c8c; }
.studio-status[data-state="compiled"] { color: #8fdaa2; }
.studio-status-diagnostic {
  background: transparent; border: 0; color: inherit; cursor: pointer; max-width: min(720px, 55vw); overflow: hidden;
  padding: 0; text-align: left; text-decoration: underline; text-decoration-color: currentColor; text-decoration-thickness: 1px;
  text-overflow: ellipsis; text-underline-offset: 3px; white-space: nowrap;
}
.studio-status-diagnostic:hover { color: #ffc0b5; }
.studio-main {
  display: grid; grid-template-columns: 210px minmax(320px, 1fr) minmax(320px, 1fr) 230px; min-height: 0;
}
.studio-sidebar { border-right: 1px solid #353936; min-height: 0; overflow: auto; }
.studio-files { padding: 8px; }
.studio-file {
  background: transparent; border: 0; border-radius: 5px; cursor: pointer; display: block;
  padding: 7px 8px; text-align: left; width: 100%;
}
.studio-file:hover, .studio-file[aria-current="true"] { background: #303531; }
.studio-palette { border-top: 1px solid #353936; padding: 10px 8px 14px; }
.studio-palette h2, .studio-inspector h2 {
  color: #aeb5ae; font-size: 11px; letter-spacing: .08em; margin: 8px 0; text-transform: uppercase;
}
.studio-components, .studio-project-views, .studio-inspector-controls {
  display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr));
}
.studio-palette-button, .studio-inspector-button, .studio-interaction-mode {
  background: #292e2a; border: 1px solid #424843; border-radius: 5px; cursor: pointer; padding: 6px 7px;
}
.studio-palette-button:hover, .studio-inspector-button:hover:not(:disabled), .studio-interaction-mode:hover {
  background: #343a35;
}
.studio-interaction-mode[data-mode="edit"] { border-color: #5b85b8; color: #d9eaff; }
.studio-interaction-mode[data-mode="run"] { border-color: #487555; color: #dcebe0; }
.studio-palette-button:disabled, .studio-inspector-button:disabled { cursor: default; opacity: .45; }
.studio-palette-empty, .studio-inspector-empty { color: #7f8981; font-size: 12px; }
.studio-editor { min-height: 0; overflow: hidden; }
.studio-editor .cm-editor { height: 100%; }
.studio-editor .cm-scroller { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.studio-preview { background: #fff; border-left: 1px solid #353936; min-height: 0; position: relative; }
.studio-preview iframe { border: 0; display: block; height: 100%; width: 100%; }
.studio-preview-grid {
  align-content: start; background: #101210; display: grid; gap: 18px; height: 100%;
  overflow: auto; padding: 16px;
}
.studio-preview-cell { display: grid; gap: 8px; justify-items: start; min-width: 0; }
.studio-preview-cell-label {
  align-items: baseline; color: #e1e5df; display: flex; font-size: 12px; font-weight: 650; gap: 8px;
  justify-content: space-between; letter-spacing: .03em; width: 100%;
}
.studio-preview-cell-details { color: #89928b; font-size: 10px; font-weight: 400; }
.studio-preview-cell-disclosure { width: 100%; }
.studio-preview-cell-disclosure-summary {
  background: #191c1a; border: 1px solid #353b36; border-radius: 7px; color: #aeb5ae; cursor: pointer;
  font-size: 10px; font-weight: 700; letter-spacing: .08em; padding: 7px 9px; text-transform: uppercase;
}
.studio-preview-cell-disclosure-summary:hover { background: #202421; }
.studio-preview-cell-disclosure[open] > .studio-preview-cell-disclosure-summary { border-radius: 7px 7px 0 0; }
.studio-preview-cell-controls {
  background: #191c1a; border: 1px solid #353b36; border-radius: 0 0 7px 7px; border-top: 0; display: grid; gap: 7px;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); padding: 8px; width: 100%;
}
.studio-preview-control-group { border: 0; margin: 0; min-width: 0; padding: 0; }
.studio-preview-control-group legend {
  color: #9da69f; font-size: 9px; font-weight: 700; letter-spacing: .08em; padding: 0 0 4px;
  text-transform: uppercase;
}
.studio-preview-control-fields { display: grid; gap: 4px; }
.studio-preview-control-field {
  align-items: center; color: #8e9890; display: grid; font-size: 10px; gap: 5px;
  grid-template-columns: minmax(50px, .75fr) minmax(70px, 1.25fr); min-width: 0;
}
.studio-preview-control-input { display: flex; min-width: 0; }
.studio-preview-control-input input:not([type="checkbox"]),
.studio-preview-control-input select,
.studio-preview-control-input textarea {
  background: #242824; border: 1px solid #424943; border-radius: 4px; color: #e2e6e1; font: inherit;
  min-width: 0; padding: 3px 5px; width: 100%;
}
.studio-preview-control-input textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
.studio-preview-control-input select:disabled { cursor: not-allowed; opacity: .5; }
.studio-preview-control-note { color: #8b948d; font-size: 10px; line-height: 1.3; }
.studio-preview-cell-actions { align-items: center; display: flex; gap: 7px; grid-column: 1 / -1; }
.studio-preview-cell-apply {
  background: #2c4935; border: 1px solid #487555; border-radius: 5px; color: #dcebe0; cursor: pointer;
  font-size: 11px; padding: 4px 7px;
}
.studio-preview-cell-promote {
  background: #292e2a; border: 1px solid #485049; border-radius: 5px; color: #dce3dd; cursor: pointer;
  font-size: 11px; padding: 4px 7px;
}
.studio-preview-cell-apply:disabled, .studio-preview-cell-promote:disabled { cursor: wait; opacity: .55; }
.studio-preview-cell-status { color: #91a096; font-size: 10px; overflow-wrap: anywhere; }
.studio-preview-cell-status[data-state="error"] { color: #ff9c8c; }
.studio-preview-cell-viewport {
  background: #fff; border: 1px solid #3c423d; border-radius: 7px; box-shadow: 0 8px 24px #0007;
  flex: none; overflow: hidden;
}
.studio-inspector { border-left: 1px solid #353936; min-height: 0; overflow: auto; padding: 8px 10px; }
.studio-inspector-summary { display: grid; grid-template-columns: 56px minmax(0, 1fr); margin: 10px 0 14px; }
.studio-inspector-summary dt { color: #89928b; }
.studio-inspector-summary dd { margin: 0; overflow-wrap: anywhere; }
.studio-inspector-controls { grid-template-columns: 1fr; }
.studio-undo { margin-bottom: 6px; width: 100%; }
.studio-empty { color: #8f9790; display: grid; height: 100%; padding: 24px; place-items: center; text-align: center; }
@media (max-width: 1100px) {
  .studio-main { grid-template-columns: 170px minmax(280px, 1fr) minmax(280px, 1fr); }
  .studio-inspector { display: none; }
}
`
