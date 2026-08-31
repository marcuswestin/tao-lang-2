import Runtime from '@runtime-toolchain'
import { FS } from '@shared'
import { existsSync } from 'node:fs'

export type StudioClientConfig = {
  previewUrl?: string
}

export type StudioClientBundleMode = 'development' | 'release'

const clientBundles = new Map<StudioClientBundleMode, Promise<string>>()
let prebuiltClientBundle: string | undefined
const clientModuleInputs = new Map<StudioClientBundleMode, readonly string[]>()

/** StudioClientAssets builds and serves the browser Studio shell from its typed source. */
export const StudioClientAssets = {
  bundle,
  html,
  usePrebuiltBundle,
  testing: {
    moduleInputs,
    resetBundle,
  },
} as const

async function bundle(options: { validationMode?: StudioClientBundleMode } = {}): Promise<string> {
  if (prebuiltClientBundle !== undefined) {
    return prebuiltClientBundle
  }
  const validationMode = options.validationMode ?? 'development'
  let clientBundle = clientBundles.get(validationMode)
  if (clientBundle === undefined) {
    clientBundle = buildClientBundle(validationMode)
    clientBundles.set(validationMode, clientBundle)
  }
  return await clientBundle
}

async function moduleInputs(validationMode: StudioClientBundleMode = 'development'): Promise<readonly string[]> {
  await bundle({ validationMode })
  return clientModuleInputs.get(validationMode) ?? []
}

/** usePrebuiltBundle installs the browser artifact shipped by a packaged Studio application. */
function usePrebuiltBundle(source: string): void {
  if (source.trim() === '') {
    throw new Error('The packaged Tao Studio browser bundle is empty.')
  }
  prebuiltClientBundle = source
  clientModuleInputs.clear()
}

function resetBundle(): void {
  prebuiltClientBundle = undefined
  clientBundles.clear()
  clientModuleInputs.clear()
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

async function buildClientBundle(validationMode: StudioClientBundleMode): Promise<string> {
  const generatedRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-browser-', FS.tmpdir()))
  let generated: Awaited<ReturnType<typeof Runtime.generateApp>>
  try {
    generated = await Runtime.generateApp(FS.resolvePath('TaoStudioClient.tao', import.meta.dir), {
      appName: 'TaoStudioFiles',
      runtimePackageRoot: generatedRoot,
      validationMode,
    })
  } catch (error) {
    await FS.remove(generatedRoot)
    if (validationMode === 'release') {
      throw new Error('Could not compile the release Tao Studio browser client.', { cause: error })
    }
    console.error('Tao Studio client compilation failed; using the direct TypeScript development fallback.', error)
    return await buildDirectClientBundle()
  }
  try {
    const result = await Bun.build({
      entrypoints: [FS.resolvePath('TaoStudioBrowser.tsx', import.meta.dir)],
      metafile: true,
      minify: validationMode === 'release',
      plugins: [taoStudioBrowserPlugin(generated.outputPath)],
      sourcemap: validationMode === 'development' ? 'inline' : 'none',
      target: 'browser',
    })
    return await completedBundle(result, 'Tao-authored', validationMode)
  } finally {
    await FS.remove(generatedRoot)
  }
}

async function buildDirectClientBundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [FS.resolvePath('StudioClient.ts', import.meta.dir)],
    metafile: true,
    minify: false,
    sourcemap: 'inline',
    target: 'browser',
  })
  return await completedBundle(result, 'direct TypeScript', 'development')
}

async function completedBundle(
  result: Awaited<ReturnType<typeof Bun.build>>,
  label: string,
  validationMode: StudioClientBundleMode,
): Promise<string> {
  if (!result.success) {
    const messages = result.logs.map(log => log.message).join('\n')
    throw new Error(`Could not build the ${label} Tao Studio browser client.\n${messages}`)
  }
  clientModuleInputs.set(validationMode, Object.keys(result.metafile?.inputs ?? {}))
  const output = result.outputs[0]
  if (output === undefined) {
    throw new Error('Tao Studio browser build produced no JavaScript output.')
  }
  return await output.text()
}

function taoStudioBrowserPlugin(generatedAppPath: string): Bun.BunPlugin {
  const dependencyBase = FS.resolvePath('../../runtime-toolchain', import.meta.dir)
  const studioBase = FS.resolvePath('..', import.meta.dir)
  const generatedRoot = FS.dirname(generatedAppPath)
  const optionalNativeModules = new Set([
    '@expo/vector-icons/FontAwesome6',
    '@react-native-community/datetimepicker',
    '@react-native-community/slider',
    '@react-native-picker/picker',
    '@react-native-segmented-control/segmented-control',
    'expo-clipboard',
    'expo-haptics',
    'react-native-screens',
  ])
  const workspaceDependencies = new Set(['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'])
  return {
    name: 'tao-studio-browser',
    setup(build) {
      build.onResolve({ filter: /^tao-studio-generated-app$/ }, () => ({ path: generatedAppPath }))
      build.onResolve({ filter: /^[^./]/ }, args => {
        if (args.path.startsWith('node:')) {
          return undefined
        }
        if (optionalNativeModules.has(args.path)) {
          return { namespace: 'tao-studio-empty-native', path: args.path }
        }
        if (args.path === 'react-native-safe-area-context') {
          return { namespace: 'tao-studio-safe-area', path: args.path }
        }
        if (args.path === 'react-native') {
          return { path: resolveBrowserDependency('react-native-web') }
        }
        if (args.path === '@runtime/TR' || workspaceDependencies.has(args.path)) {
          return { path: resolveBrowserDependency(args.path) }
        }
        return (args.importer.startsWith(generatedRoot) || args.importer.includes('/_gen_tao-app/'))
          ? { path: resolveBrowserDependency(args.path) }
          : undefined
      })
      build.onLoad({ filter: /.*/, namespace: 'tao-studio-empty-native' }, () => ({
        contents: 'module.exports = {}',
        loader: 'js',
      }))
      build.onLoad({ filter: /.*/, namespace: 'tao-studio-safe-area' }, () => ({
        contents: `
          import React from 'react'
          export function SafeAreaProvider(props) { return React.createElement(React.Fragment, null, props.children) }
          export function useSafeAreaInsets() { return { bottom: 0, left: 0, right: 0, top: 0 } }
        `,
        loader: 'js',
      }))
    },
  }

  function resolveBrowserDependency(name: string): string {
    try {
      const resolved = Bun.resolveSync(name, studioBase)
      if (existsSync(resolved)) {
        return resolved
      }
    } catch {
      // The workspace install can lag a just-added explicit Studio dependency; use the pinned toolchain copy.
    }
    return Bun.resolveSync(name, dependencyBase)
  }
}

const clientCss = `
:root {
  color: #e8e7e3;
  background: #171918;
  font: 13px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body, #tao-studio-root { width: 100%; height: 100%; margin: 0; }
.tao-studio-product-host { height: 100%; min-height: 0; min-width: 0; width: 100%; }
button { color: inherit; font: inherit; }
.studio-shell { display: grid; grid-template-rows: 48px minmax(0, 1fr); height: 100%; }
.studio-toolbar {
  align-items: center; background: #202321; border-bottom: 1px solid #353936; display: flex;
  gap: 8px; min-width: 0; padding: 0 12px;
}
.studio-wordmark { font-weight: 700; letter-spacing: .02em; }
.studio-picker, .studio-command-palette, .studio-layout-presets button, .studio-drawer-tabs button,
.studio-inspector-tabs button, .studio-editor-tab, .studio-pane-header button, .studio-rail-button {
  background: transparent; border: 0; cursor: pointer;
}
.studio-picker { color: #aeb5ae; max-width: 260px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-app-picker { background: #202321; border: 0; max-width: 180px; }
.studio-layout-presets { background: #171918; border: 1px solid #353936; border-radius: 6px; display: flex; padding: 2px; }
.studio-layout-presets button { border-radius: 4px; color: #9da69f; padding: 3px 8px; }
.studio-layout-presets button[aria-current="true"] { background: #343a35; color: #f0f2ef; }
.studio-command-palette { border: 1px solid #444b45; border-radius: 5px; color: #bac1bb; padding: 4px 8px; }
.studio-command-overlay {
  background: #202321; border: 1px solid #4c534d; border-radius: 9px; box-shadow: 0 18px 60px #000b;
  left: 50%; max-width: 620px; padding: 12px; position: fixed; top: 72px; transform: translateX(-50%); width: calc(100% - 32px);
  z-index: 20;
}
.studio-command-overlay label { display: grid; gap: 6px; }
.studio-command-overlay label span { color: #929a93; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.studio-command-overlay input {
  background: #171918; border: 1px solid #444b45; border-radius: 6px; color: #e8e7e3; font: inherit; padding: 9px 10px;
}
.studio-command-results { display: grid; gap: 3px; margin-top: 8px; max-height: min(65vh, 520px); overflow: auto; }
.studio-command-result {
  background: transparent; border: 0; border-radius: 5px; color: #e8e7e3; cursor: pointer; display: grid; gap: 2px;
  padding: 7px 9px; text-align: left;
}
.studio-command-result:hover, .studio-command-result:focus { background: #303531; outline: none; }
.studio-command-result span { color: #7f8981; font-size: 11px; }
.studio-reload { background: #2b302c; border: 1px solid #444b45; border-radius: 5px; cursor: pointer; padding: 5px 9px; }
.studio-reload:hover { background: #363c37; }
.studio-status { color: #9ba59c; margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-status[data-state="error"] { color: #ff9c8c; }
.studio-status[data-state="compiled"] { color: #8fdaa2; }
.studio-status-diagnostic {
  background: transparent; border: 0; color: inherit; cursor: pointer; max-width: min(720px, 55vw); overflow: hidden;
  padding: 0; text-align: left; text-decoration: underline; text-decoration-color: currentColor; text-decoration-thickness: 1px;
  text-overflow: ellipsis; text-underline-offset: 3px; white-space: nowrap;
}
.studio-status-diagnostic:hover { color: #ffc0b5; }
.studio-body {
  --studio-left-size: 260px; --studio-right-size: 280px;
  display: grid; grid-template-columns: 48px var(--studio-left-size) 5px minmax(420px, 1fr) 5px var(--studio-right-size);
  min-height: 0;
}
.studio-rail { align-items: center; background: #181a19; border-right: 1px solid #353936; display: flex; flex-direction: column; gap: 6px; padding: 8px 5px; }
.studio-rail-button { border-radius: 6px; color: #89928b; font-weight: 700; height: 36px; width: 36px; }
.studio-rail-button:hover, .studio-rail-button[aria-current="true"] { background: #303531; color: #e8e7e3; }
.studio-sidebar { background: #1d201e; min-height: 0; overflow: auto; }
.studio-pane-header { align-items: center; border-bottom: 1px solid #353936; display: flex; height: 35px; justify-content: space-between; padding: 0 8px 0 12px; }
.studio-pane-header strong { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.studio-pane-header button { border-radius: 4px; color: #9ba59c; font-size: 20px; line-height: 24px; width: 28px; }
.studio-pane-header button:hover { background: #303531; }
.studio-divider { background: #252826; position: relative; z-index: 2; }
.studio-divider::after { content: ""; inset: -3px; position: absolute; }
.studio-divider-left, .studio-divider-right { cursor: col-resize; }
.studio-divider-bottom { cursor: row-resize; }
.studio-center { --studio-bottom-size: 180px; display: grid; grid-template-rows: minmax(240px, 1fr) 5px var(--studio-bottom-size); min-height: 0; }
.studio-workbench { display: grid; grid-template-columns: minmax(300px, .85fr) minmax(320px, 1.15fr); min-height: 0; }
.studio-editor-pane { display: grid; grid-template-rows: 34px 28px minmax(0, 1fr); min-height: 0; min-width: 0; }
.studio-editor-tabs { align-items: end; background: #202321; border-bottom: 1px solid #353936; display: flex; overflow-x: auto; padding-left: 8px; }
.studio-editor-tab-item { align-items: center; border: 1px solid #353936; border-bottom: 0; border-radius: 5px 5px 0 0; display: flex; flex: 0 0 auto; max-width: 240px; }
.studio-editor-tab-item[aria-current="page"] { background: #171918; }
.studio-editor-tab { background: transparent; max-width: 200px; overflow: hidden; padding: 6px 5px 6px 10px; text-overflow: ellipsis; white-space: nowrap; }
.studio-editor-tab-close { background: transparent; border: 0; color: #818a83; cursor: pointer; padding: 5px 8px 5px 3px; }
.studio-editor-tab-close:hover { color: #f2b4aa; }
.studio-breadcrumbs { align-items: center; background: #171918; border-bottom: 1px solid #2e322f; color: #929a93; display: flex; font-size: 11px; gap: 6px; overflow: hidden; padding: 0 12px; white-space: nowrap; }
.studio-breadcrumb-separator { color: #59605b; }
.studio-drawer { background: #191b1a; min-height: 0; overflow: auto; }
.studio-drawer-tabs, .studio-inspector-tabs { align-items: center; border-bottom: 1px solid #353936; display: flex; gap: 4px; min-height: 34px; padding: 0 8px; }
.studio-drawer-tabs button, .studio-inspector-tabs button { color: #929a93; font-size: 11px; padding: 5px 7px; }
.studio-drawer-tabs button[aria-current="true"], .studio-inspector-tabs button[aria-current="true"] { color: #e8e7e3; }
.studio-drawer-content { color: #9ba59c; padding: 10px 12px; }
.studio-drawer-content dl { display: grid; grid-template-columns: max-content 1fr; margin: 0; }
.studio-drawer-content dt, .studio-drawer-content dd { border-bottom: 1px solid #292d2a; margin: 0; padding: 4px 8px; }
.studio-drawer-row { background: transparent; border: 0; color: #e5aca2; cursor: pointer; display: block; padding: 6px; text-align: left; width: 100%; }
.studio-drawer-row:hover:not(:disabled) { background: #292e2a; }
.studio-drawer-toolbar { display: flex; gap: 7px; margin-bottom: 8px; }
.studio-drawer-toolbar button, .studio-drawer-toolbar select {
  background: #292e2a; border: 1px solid #424843; border-radius: 4px; color: #d7dbd7; padding: 4px 7px;
}
.studio-data-table { border-collapse: collapse; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; width: 100%; }
.studio-data-table th, .studio-data-table td { border: 1px solid #353936; max-width: 360px; overflow: hidden; padding: 5px 7px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.studio-data-table th { color: #d7dbd7; }
.studio-panel-note { color: #7f8981; font-size: 12px; padding: 10px; }
.studio-unavailable strong { color: #b9c0ba; }
.studio-inspector { background: #1d201e; min-height: 0; overflow: auto; }
.studio-inspector-content { padding: 8px 10px; }
#tao-studio-root[data-layout-preset="code"] .studio-workbench { grid-template-columns: 1fr 0; }
#tao-studio-root[data-layout-preset="code"] .studio-preview { display: none; }
#tao-studio-root[data-layout-preset="run"] .studio-workbench { grid-template-columns: 0 1fr; }
#tao-studio-root[data-layout-preset="run"] .studio-editor-pane { display: none; }
.studio-files { padding: 8px; }
.studio-left-panel { min-height: 0; }
.studio-file {
  background: transparent; border: 0; border-radius: 5px; cursor: pointer; display: block;
  padding: 7px 8px; text-align: left; width: 100%;
}
.studio-file:hover, .studio-file[aria-current="true"] { background: #303531; }
.studio-file-tree__toolbar { display: flex; margin-bottom: 7px; }
.studio-file-tree__toolbar button, .studio-file-tree__action {
  background: #292e2a; border: 1px solid #424843; border-radius: 4px; color: #d7dbd7; cursor: pointer;
  font-size: 10px; padding: 4px 6px;
}
.studio-file-tree__toolbar button:hover, .studio-file-tree__action:hover:not(:disabled) { background: #343a35; }
.studio-file-tree__action:disabled { cursor: default; opacity: .35; }
.studio-file-tree__list { list-style: none; margin: 0; padding: 0; }
.studio-file-tree__list > li {
  align-items: center; display: grid; gap: 3px; grid-template-columns: 10px minmax(80px, 1fr) auto auto auto;
}
.studio-file-tree__list details { grid-column: 1 / -1; }
.studio-file-tree__list summary { color: #9ca59d; cursor: pointer; font-size: 11px; padding: 5px 2px; }
.studio-file-tree__list details > .studio-file-tree__list { margin-left: 12px; }
.studio-file-tree__file { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-file-tree__dirty { color: #f3c969; font-size: 7px; grid-column: 1; text-align: center; }
.studio-file-tree__diagnostics {
  background: #7e3f3f; border-radius: 9px; color: #fff; font: 9px ui-monospace, SFMono-Regular, Menlo, monospace;
  min-width: 13px; padding: 2px 4px; text-align: center;
}
.studio-file-tree__action { font-size: 9px; opacity: .72; }
.studio-file-tree__action--delete { color: #e7b0ad; }
.studio-palette { border-top: 1px solid #353936; padding: 10px 8px 14px; }
.studio-palette h2, .studio-inspector h2 {
  color: #aeb5ae; font-size: 11px; letter-spacing: .08em; margin: 8px 0; text-transform: uppercase;
}
.studio-project-views, .studio-inspector-controls, .studio-palette-choices {
  display: grid; gap: 6px; grid-template-columns: repeat(2, minmax(0, 1fr));
}
.studio-components { display: grid; gap: 9px; }
.studio-palette-group h3 { color: #7f8981; font-size: 10px; margin: 0 0 5px; }
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
.studio-screens, .studio-search-panel { display: grid; gap: 7px; padding: 9px; }
.studio-screens h2 { color: #aeb5ae; font-size: 11px; letter-spacing: .08em; margin: 0 0 3px; text-transform: uppercase; }
.studio-screen-item, .studio-search-result {
  background: #252925; border: 1px solid #3d433e; border-radius: 5px; color: #dce1dc; cursor: pointer;
  display: grid; gap: 3px; padding: 7px 8px; text-align: left; width: 100%;
}
.studio-screen-item:hover, .studio-search-result:hover { background: #303630; }
.studio-search-panel label { color: #939c94; display: grid; font-size: 10px; gap: 5px; }
.studio-search-input {
  background: #252925; border: 1px solid #424943; border-radius: 5px; color: #e4e8e3; padding: 6px 7px;
}
.studio-search-results { display: grid; gap: 5px; }
.studio-search-result strong { font-size: 11px; }
.studio-search-result span { color: #89928b; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.studio-design-values { padding: 8px 10px; }
.studio-design-values h2, .studio-design-values h3 { color: #aeb5ae; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
.studio-design-value { align-items: center; display: flex; gap: 7px; margin: 5px 0; }
.studio-design-swatch { border: 1px solid #59605b; border-radius: 3px; height: 18px; width: 18px; }
.studio-design-bundle { border-top: 1px solid #353936; display: grid; gap: 5px; padding: 8px 0; }
.studio-design-bundle input, .studio-design-bundle select, .studio-design-bundle button {
  background: #292e2a; border: 1px solid #424843; border-radius: 4px; color: #d7dbd7; min-width: 0; padding: 5px 6px;
}
.studio-editor { min-height: 0; overflow: hidden; }
.studio-editor .cm-editor { height: 100%; }
.studio-editor .cm-scroller { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.studio-preview { background: #fff; border-left: 1px solid #353936; min-height: 0; position: relative; }
.studio-preview iframe { border: 0; display: block; height: 100%; width: 100%; }
.studio-preview-grid {
  align-content: start; background: #101210; display: grid; gap: 18px; height: 100%;
  overflow: auto; padding: 16px;
}
.studio-preview-group { display: grid; gap: 9px; justify-items: start; min-width: max-content; }
.studio-preview-group-label {
  color: #aeb5ae; font-size: 11px; letter-spacing: .08em; margin: 0; position: sticky; left: 0; text-transform: uppercase;
}
.studio-preview-group-cells { align-items: start; display: flex; gap: 18px; }
.studio-preview-cell { display: grid; gap: 8px; justify-items: start; min-width: 0; }
.studio-preview-cell[aria-current="true"] > .studio-preview-cell-label { color: #f3c969; }
.studio-preview-cell:focus-visible { outline: 2px solid #f3c969; outline-offset: 5px; }
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
  background: #191c1a; border: 1px solid #353b36; border-radius: 7px; display: grid; gap: 9px;
  grid-template-columns: 1fr; margin-top: 8px; padding: 8px; width: 100%;
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
.studio-preview-cell-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 7px; grid-column: 1 / -1; }
.studio-preview-runtime-failure {
  background: #2b1715; border: 1px solid #8d4b42; border-radius: 7px; color: #ffd8d1; display: grid;
  gap: 5px; padding: 9px 10px; width: 100%;
}
.studio-preview-runtime-failure-context { color: #d7a8a0; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.studio-preview-runtime-failure-actions { align-items: center; display: flex; gap: 7px; }
.studio-preview-runtime-failure-actions button, .studio-preview-cell-replay-load {
  background: #3b2926; border: 1px solid #755049; border-radius: 5px; color: #ffe1db; cursor: pointer;
  font-size: 11px; padding: 4px 7px;
}
.studio-preview-runtime-failure-actions button:disabled { cursor: default; opacity: .5; }
.studio-preview-runtime-failure small { color: #c29a93; }
.studio-preview-cell-apply {
  background: #2c4935; border: 1px solid #487555; border-radius: 5px; color: #dcebe0; cursor: pointer;
  font-size: 11px; padding: 4px 7px;
}
.studio-preview-cell-promote, .studio-preview-cell-capture, .studio-preview-cell-generate {
  background: #292e2a; border: 1px solid #485049; border-radius: 5px; color: #dce3dd; cursor: pointer;
  font-size: 11px; padding: 4px 7px;
}
.studio-preview-fixture-name {
  background: #242824; border: 1px solid #424943; border-radius: 4px; color: #e2e6e1; font: inherit;
  min-width: 110px; padding: 4px 6px;
}
.studio-preview-cell-apply:disabled, .studio-preview-cell-promote:disabled,
.studio-preview-cell-capture:disabled, .studio-preview-cell-generate:disabled { cursor: wait; opacity: .55; }
.studio-preview-cell-status { color: #91a096; font-size: 10px; overflow-wrap: anywhere; }
.studio-preview-cell-status[data-state="error"] { color: #ff9c8c; }
.studio-scenario-inspector { border-bottom: 1px solid #353936; margin: -2px -2px 10px; padding: 0 2px 12px; }
.studio-scenario-inspector-label { color: #dce1dc; display: block; font-size: 12px; overflow-wrap: anywhere; }
.studio-preview-cell-viewport {
  background: #fff; border: 1px solid #3c423d; border-radius: 7px; box-shadow: 0 8px 24px #0007;
  flex: none; overflow: hidden;
}
.studio-inspector-summary { display: grid; grid-template-columns: 56px minmax(0, 1fr); margin: 10px 0 14px; }
.studio-inspector-summary dt { color: #89928b; }
.studio-inspector-summary dd { margin: 0; overflow-wrap: anywhere; }
.studio-inspector-controls { grid-template-columns: 1fr; }
.studio-inspector-field { color: #939c94; display: grid; font-size: 11px; gap: 5px; }
.studio-inspector-field input, .studio-inspector-field select {
  background: #252925; border: 1px solid #424943; border-radius: 4px; color: #e4e8e3; min-width: 0;
  padding: 5px 6px; width: 100%;
}
.studio-inspector-inline-controls { display: grid; gap: 5px; grid-template-columns: 1fr 1fr; }
.studio-undo { margin-bottom: 6px; width: 100%; }
.studio-empty { color: #8f9790; display: grid; height: 100%; padding: 24px; place-items: center; text-align: center; }
@media (max-width: 1100px) {
  .studio-body { --studio-right-size: 0px !important; }
  .studio-pane-right, .studio-divider-right { display: none; }
  .studio-workbench { grid-template-columns: minmax(280px, 1fr) minmax(280px, 1fr); }
}
`
