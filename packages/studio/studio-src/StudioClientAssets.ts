import Runtime from '@runtime-toolchain'
import { Errors, FS } from '@shared'
import { existsSync } from 'node:fs'

export type StudioClientConfig = {
  previewUrl?: string
}

export type StudioClientBundleMode = 'development' | 'release'

/** StudioClientAssetProvider supplies one browser shell revision to the Studio HTTP server. */
export type StudioClientAssetProvider = {
  bundle: (options?: { validationMode?: StudioClientBundleMode }) => Promise<string>
  html: (config: StudioClientConfig) => string
}

const clientBundles = new Map<StudioClientBundleMode, Promise<string>>()
let prebuiltClientBundle: string | undefined
const clientModuleInputs = new Map<StudioClientBundleMode, readonly string[]>()

/** StudioClientAssets builds and serves the browser Studio shell from its typed source. */
export const StudioClientAssets = {
  bundle,
  html,
  usePrebuiltBundle,
  testing: {
    cachedBundle,
    moduleInputs,
    resetBundle,
  },
} as const

async function bundle(options: { validationMode?: StudioClientBundleMode } = {}): Promise<string> {
  if (prebuiltClientBundle !== undefined) {
    return prebuiltClientBundle
  }
  const validationMode = options.validationMode ?? 'development'
  return await cachedBundle(clientBundles, validationMode, () => buildClientBundle(validationMode))
}

async function cachedBundle(
  cache: Map<StudioClientBundleMode, Promise<string>>,
  validationMode: StudioClientBundleMode,
  build: () => Promise<string>,
): Promise<string> {
  let pending = cache.get(validationMode)
  if (pending === undefined) {
    pending = build()
    cache.set(validationMode, pending)
  }
  try {
    return await pending
  } catch (error) {
    if (cache.get(validationMode) === pending) {
      cache.delete(validationMode)
    }
    throw error
  }
}

async function moduleInputs(validationMode: StudioClientBundleMode = 'development'): Promise<readonly string[]> {
  await bundle({ validationMode })
  return clientModuleInputs.get(validationMode) ?? []
}

/** usePrebuiltBundle installs the browser artifact shipped by a packaged Studio application. */
function usePrebuiltBundle(source: string): void {
  if (source.trim() === '') {
    Errors.throwHostEnvironment('The packaged Tao Studio browser bundle is empty.')
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
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23202321'/%3E%3Ctext x='32' y='45' fill='%23e8e7e3' font-family='sans-serif' font-size='42' text-anchor='middle'%3ET%3C/text%3E%3C/svg%3E">
  <title>Tao Studio</title>
  <style>${clientCss}</style>
</head>
<body>
  <main id="tao-studio-root" aria-label="Tao Studio"></main>
  <div id="tao-studio-viewport"></div>
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
    Errors.throwHostEnvironment('Could not compile the Tao Studio browser client.', { cause: error })
  }
  try {
    const result = await Bun.build({
      entrypoints: [FS.resolvePath('TaoStudioBrowser.tsx', import.meta.dir)],
      metafile: true,
      minify: validationMode === 'release',
      plugins: [taoStudioReactSingletonPlugin(), taoStudioBrowserPlugin(generated.outputPath)],
      sourcemap: validationMode === 'development' ? 'inline' : 'none',
      target: 'browser',
    })
    return await completedBundle(result, validationMode)
  } finally {
    await FS.remove(generatedRoot)
  }
}

async function completedBundle(
  result: Awaited<ReturnType<typeof Bun.build>>,
  validationMode: StudioClientBundleMode,
): Promise<string> {
  if (!result.success) {
    const messages = result.logs.map(log => log.message).join('\n')
    Errors.throwHostEnvironment(`Could not build the Tao Studio browser client.\n${messages}`)
  }
  clientModuleInputs.set(validationMode, Object.keys(result.metafile?.inputs ?? {}))
  const output = result.outputs[0]
  if (output === undefined) {
    Errors.throwHostEnvironment('Tao Studio browser build produced no JavaScript output.')
  }
  return await output.text()
}

function taoStudioReactSingletonPlugin(): Bun.BunPlugin {
  const dependencyBase = FS.resolvePath('../../runtime-toolchain', import.meta.dir)
  const singletonDependencies = new Set([
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-dev-runtime',
    'react/jsx-runtime',
  ])
  return {
    name: 'tao-studio-react-singleton',
    setup(build) {
      build.onResolve({ filter: /^react(?:$|[-/])/ }, args =>
        singletonDependencies.has(args.path)
          ? { path: Bun.resolveSync(args.path, dependencyBase) }
          : undefined)
    },
  }
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
    'expo-constants',
    'expo-haptics',
    'expo-secure-store',
    'react-native-get-random-values',
    'react-native-screens',
  ])
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
        if (args.path.startsWith('@noble/')) {
          // The device trust primitives reach the bundle through TR.Studio.DeviceHost, which only a
          // native device mounts; the workbench never dials the gateway, so the browser skips them.
          return { namespace: 'tao-studio-empty-native', path: args.path }
        }
        if (args.path === 'react-native-safe-area-context') {
          return { namespace: 'tao-studio-safe-area', path: args.path }
        }
        if (args.path === 'react-native') {
          return { path: resolveBrowserDependency('react-native-web') }
        }
        if (args.path === 'qrcode') {
          // Bun.resolveSync ignores the package's browser field; the Node entry carries PNG and
          // terminal renderers over zlib streams that only bloat the workbench bundle.
          return { path: resolveBrowserDependency('qrcode/lib/browser.js') }
        }
        if (args.path === '@runtime/TR') {
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
html, body, #tao-studio-root, #tao-studio-viewport { width: 100%; height: 100%; margin: 0; }
#tao-studio-root, #tao-studio-viewport { inset: 0; position: fixed; }
#tao-studio-viewport { pointer-events: none; }
.tao-studio-product-host {
  bottom: 0 !important; height: auto !important; left: 0 !important; min-height: 0; min-width: 0;
  overflow: clip; pointer-events: auto; position: fixed !important; right: 0 !important; top: 0 !important;
  width: auto !important;
}
button { color: inherit; font: inherit; }
.studio-shell {
  display: grid; grid-template-rows: 48px minmax(0, 1fr); height: 100%; inset: 0;
  min-height: 0; min-width: 0; position: fixed; width: 100%;
}
.studio-toolbar {
  align-items: center; background: #202321; border-bottom: 1px solid #353936; display: flex;
  gap: 8px; min-width: 0; padding: 0 12px;
}
.studio-wordmark { font-weight: 700; letter-spacing: .02em; }
.studio-picker, .studio-command-palette, .studio-layout-presets button, .studio-drawer-tabs button,
.studio-inspector-tabs button, .studio-inspector-pane-header button, .studio-editor-tab, .studio-pane-header button, .studio-rail-button {
  background: transparent; border: 0; cursor: pointer;
}
.studio-inspector-tao-context { border-bottom: 1px solid #2c323d; min-width: 0; }
.studio-context-panel-surface { min-width: 0; padding: 9px 12px; }
.studio-context-summary { color: #8f98a8; display: flex; flex-wrap: wrap; font-size: 11px; gap: 4px 9px; min-width: 0; }
.studio-context-summary strong { color: #d5d9e2; flex: 1 1 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio-context-selected { color: #72a4ff; }
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
  display: grid; grid-template-columns: 48px var(--studio-left-size) 5px minmax(420px, 1fr);
  min-height: 0; min-width: 0;
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
.studio-divider-left, .studio-divider-right, .studio-divider-preview { cursor: col-resize; }
.studio-divider-bottom { cursor: row-resize; }
.studio-center {
  --studio-bottom-size: 180px; --studio-preview-size: 440px; display: grid;
  grid-template-columns: var(--studio-right-size) 5px minmax(360px, 1fr) 5px minmax(280px, var(--studio-preview-size));
  grid-template-rows: minmax(240px, 1fr) 5px var(--studio-bottom-size); min-height: 0; min-width: 0;
}
.studio-workbench { display: contents; }
.studio-editor-pane { grid-column: 3; grid-row: 1; }
.studio-divider-preview { grid-column: 4; grid-row: 1 / 4; }
.studio-preview { grid-column: 5; grid-row: 1 / 4; }
.studio-inspector { grid-column: 1; grid-row: 1; }
.studio-divider-right { grid-column: 2; grid-row: 1 / 4; }
.studio-divider-bottom { grid-column: 1 / 4; grid-row: 2; }
.studio-drawer { grid-column: 1 / 4; grid-row: 3; }
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
.studio-inspector {
  background: #1d201e; display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
  min-height: 0; min-width: 0; overflow: hidden;
}
.studio-inspector-pane { min-height: 0; min-width: 0; overflow: auto; }
.studio-inspector-pane + .studio-inspector-pane { border-left: 1px solid #353936; }
.studio-inspector-pane-header {
  align-items: center; background: #181b1a; border-bottom: 1px solid #353936; display: flex; height: 35px;
  justify-content: space-between; padding: 0 8px 0 10px; position: sticky; top: 0; z-index: 2;
}
.studio-inspector-pane-header strong { color: #9ba59c; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.studio-scenario-inspector-content, .studio-inspector-content { padding: 8px 10px; }
.tao-studio-product-host[data-layout-preset="code"] .studio-center { grid-template-columns: 0 0 minmax(420px, 1fr) 0 0; }
.tao-studio-product-host[data-layout-preset="code"] .studio-preview,
.tao-studio-product-host[data-layout-preset="code"] .studio-divider-preview,
.tao-studio-product-host[data-layout-preset="code"] .studio-inspector,
.tao-studio-product-host[data-layout-preset="code"] .studio-divider-right { display: none; }
.tao-studio-product-host[data-layout-preset="run"] .studio-center { grid-template-columns: 0 0 0 0 minmax(420px, 1fr); grid-template-rows: minmax(0, 1fr); }
.tao-studio-product-host[data-layout-preset="run"] .studio-editor-pane,
.tao-studio-product-host[data-layout-preset="run"] .studio-inspector,
.tao-studio-product-host[data-layout-preset="run"] .studio-divider-right,
.tao-studio-product-host[data-layout-preset="run"] .studio-divider-preview,
.tao-studio-product-host[data-layout-preset="run"] .studio-divider-bottom,
.tao-studio-product-host[data-layout-preset="run"] .studio-drawer { display: none; }
.tao-studio-product-host[data-layout-preset="run"] .studio-preview { grid-column: 1 / 6; grid-row: 1; }
.studio-files { padding: 8px; }
.studio-left-panel { min-height: 0; }
[data-studio-files-surface="compact"] { padding: 2px 4px 10px; }
[data-studio-tree-file] button[aria-label^="Rename "],
[data-studio-tree-file] button[aria-label^="Delete "] { opacity: 0; transition: color 100ms ease, opacity 100ms ease; }
[data-studio-tree-file]:hover button[aria-label^="Rename "],
[data-studio-tree-file]:hover button[aria-label^="Delete "],
[data-studio-tree-file] button[aria-label^="Rename "]:focus-visible,
[data-studio-tree-file] button[aria-label^="Delete "]:focus-visible { opacity: 1; }
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
.studio-editor[data-tao-editor-mounted="true"] > .cm-editor { display: none !important; }
.studio-editor-tao-surface { height: 100%; min-height: 0; min-width: 0; }
.studio-editor-tao-surface > [data-testid="studio-active-editor"] { height: 100%; }
.studio-editor-tao-surface > [data-testid="studio-active-editor"] > div:first-child { height: 100%; }
.studio-editor .cm-scroller { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.studio-preview { background: #fff; border-left: 1px solid #353936; min-height: 0; position: relative; }
.studio-preview iframe { border: 0; display: block; height: 100%; width: 100%; }
.studio-preview-grid {
  align-content: start; background: #101210; display: grid; gap: 18px; height: 100%; min-width: 0;
  overflow-x: hidden; overflow-y: auto; padding: 16px;
}
.studio-preview-group { display: grid; gap: 9px; min-width: 0; width: 100%; }
.studio-preview-group-label {
  color: #aeb5ae; font-size: 11px; letter-spacing: .08em; margin: 0; position: sticky; left: 0; text-transform: uppercase;
}
.studio-preview-group-cells {
  align-items: start; display: flex; gap: 18px; max-width: 100%; min-width: 0; overflow-x: auto;
  overscroll-behavior-x: contain; padding: 2px 2px 10px; scroll-snap-type: x proximity;
}
.studio-preview-group-cells > .studio-preview-cell { scroll-snap-align: start; }
[data-tao-studio-sketch-host] { flex: none; }
[data-tao-studio-sketch-workspace] { align-items: flex-start; border: 1px dashed var(--studio-stroke); border-radius: 10px; cursor: crosshair; position: relative; }
[data-tao-studio-sketch-create-surface] [data-tao-studio-sketch-workspace]::before { color: var(--studio-text-muted); content: "Drag empty space to draw a view"; font-size: 10px; left: 10px; pointer-events: none; position: absolute; top: 6px; }
[data-tao-studio-sketch] { background: #f8f9fb; border: 1px solid #8792a3; border-radius: 8px; box-shadow: 0 10px 28px #0007; color: #242a33; }
[data-tao-studio-sketch-rect] { background: #dce6f5; border: 1px solid #7693bc; box-sizing: border-box; cursor: move; overflow: visible; }
[data-tao-studio-sketch-rect-kind="Text"] { background: transparent; border-color: #9ca8b8; }
[data-tao-studio-sketch-rect][data-selected="true"] { outline: 2px solid #4b91ff; outline-offset: 1px; }
[data-tao-studio-sketch-handle] { background: #fff; border: 1px solid #397ee8; border-radius: 50%; height: 8px; padding: 0; position: absolute; width: 8px; }
[data-tao-studio-sketch-handle="north-west"] { cursor: nwse-resize; left: -5px; top: -5px; }
[data-tao-studio-sketch-handle="north"] { cursor: ns-resize; left: calc(50% - 4px); top: -5px; }
[data-tao-studio-sketch-handle="north-east"] { cursor: nesw-resize; right: -5px; top: -5px; }
[data-tao-studio-sketch-handle="east"] { cursor: ew-resize; right: -5px; top: calc(50% - 4px); }
[data-tao-studio-sketch-handle="south-east"] { bottom: -5px; cursor: nwse-resize; right: -5px; }
[data-tao-studio-sketch-handle="south"] { bottom: -5px; cursor: ns-resize; left: calc(50% - 4px); }
[data-tao-studio-sketch-handle="south-west"] { bottom: -5px; cursor: nesw-resize; left: -5px; }
[data-tao-studio-sketch-handle="west"] { cursor: ew-resize; left: -5px; top: calc(50% - 4px); }
[data-tao-studio-sketch-inspector] { background: var(--studio-panel-raised); border: 1px solid var(--studio-stroke); border-radius: 8px; cursor: default; display: grid; gap: 6px; padding: 8px; }
[data-tao-studio-sketch-inspector][hidden] { display: none; }
[data-tao-studio-sketch-inspector] input, [data-tao-studio-sketch-inspector] select { background: #101319; border: 1px solid #3a4352; border-radius: 4px; color: #dce2ec; min-width: 0; padding: 5px 6px; }
.studio-preview-cell { display: grid; flex: none; gap: 8px; justify-items: start; min-width: 0; }
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
.studio-preview-cell-capture:disabled, .studio-preview-cell-generate:disabled { cursor: default; opacity: .55; }
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
.studio-inspector-accordions { display: grid; gap: 7px; }
.studio-inspector-accordion { border: 1px solid #353936; border-radius: 6px; overflow: clip; }
.studio-inspector-accordion > summary {
  background: #202421; color: #bdc4be; cursor: pointer; font-size: 10px; font-weight: 700; letter-spacing: .08em;
  padding: 7px 9px; text-transform: uppercase;
}
.studio-inspector-accordion > summary:hover { background: #292e2a; }
.studio-inspector-accordion-content { border-top: 1px solid #353936; padding: 8px; }
.studio-empty { color: #8f9790; display: grid; height: 100%; padding: 24px; place-items: center; text-align: center; }
.studio-global-loading {
  -webkit-backdrop-filter: grayscale(1) brightness(.52); align-items: center;
  backdrop-filter: grayscale(1) brightness(.52); background: #10131bbb; display: grid;
  inset: 0; justify-items: center; padding: 24px; position: fixed; z-index: 60;
}
.studio-global-loading[hidden] { display: none; }
.studio-global-loading-panel {
  align-items: center; background: #171b25f5; border: 1px solid #4f6590; border-radius: 12px;
  box-shadow: 0 20px 80px #000d; display: flex; gap: 14px; max-width: 420px; min-width: 300px; padding: 18px 20px;
}
.studio-global-loading-panel > span:last-child { display: grid; gap: 3px; }
.studio-global-loading strong { color: #edf3ff; font-size: 12px; }
.studio-global-loading small { color: #8f9aad; font-size: 10px; }
.studio-global-loading-spinner {
  animation: studio-loading-spin 700ms linear infinite; border: 2px solid #48536a; border-radius: 50%;
  border-top-color: #72a0ff; height: 18px; width: 18px;
}
@keyframes studio-loading-spin { to { transform: rotate(360deg); } }
.studio-beta-ship {
  background: #315fbb; border: 1px solid #5b8def; border-radius: 5px; color: #f4f7ff; cursor: pointer;
  font-size: 11px; font-weight: 700; padding: 5px 9px;
}
.studio-beta-ship:hover { background: #3b6dcc; }
.studio-beta-ship:disabled { cursor: wait; opacity: .62; }
.studio-ship-overlay {
  align-items: center; background: #090b10d9; display: grid; inset: 0; padding: 24px; place-items: center;
  position: fixed; z-index: 100;
}
.studio-ship-overlay[hidden] { display: none; }
.studio-ship-progress {
  background: #171a21; border: 1px solid #4f6590; border-radius: 12px; box-shadow: 0 24px 90px #000d;
  display: grid; gap: 10px; max-width: 460px; padding: 24px; text-align: center; width: min(100%, 460px);
}
.studio-ship-progress progress { accent-color: #72a0ff; width: 100%; }
.studio-ship-progress strong { color: #edf3ff; font-size: 15px; }
.studio-ship-progress small { color: #9ba7bc; font-size: 11px; line-height: 1.5; }
.studio-device {
  background: transparent; border: 1px solid var(--studio-stroke); border-radius: 7px; color: var(--studio-text-muted);
  font-size: 11px; padding: 5px 8px; white-space: nowrap;
}
.studio-device:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-device[aria-expanded="true"] { background: var(--studio-accent-surface); color: #f4f7ff; }
.studio-device[data-state="connected"] { border-color: #3d7352; color: #ccebd6; }
.studio-device[data-state="pairing"] { border-color: #8a6d2f; color: #ffe2a8; }
.studio-device[data-state="behind"] { border-color: #8a4a3a; color: #ffc0b5; }
.studio-device-popover {
  background: var(--studio-panel); border: 1px solid var(--studio-stroke-strong); border-radius: 10px;
  box-shadow: 0 18px 60px #000a; color: var(--studio-text); display: grid; font-size: 11px; gap: 12px;
  max-height: calc(100vh - 72px); overflow: auto; padding: 14px; position: fixed; right: 12px; top: 58px;
  width: min(440px, calc(100vw - 24px)); z-index: 90;
}
.studio-device-popover[hidden] { display: none; }
.studio-device-section { display: grid; gap: 6px; }
.studio-device-section h3 {
  color: var(--studio-text-muted); font-size: 10px; font-weight: 700; letter-spacing: .06em; margin: 0;
  text-transform: uppercase;
}
.studio-device-row { align-items: center; display: grid; gap: 8px; grid-template-columns: 96px minmax(0, 1fr) auto; }
.studio-device-row-label { color: var(--studio-text-dim); }
.studio-device-row-value { min-width: 0; overflow-wrap: anywhere; }
.studio-device-note { color: var(--studio-text-muted); line-height: 1.45; margin: 0; }
.studio-device-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
.studio-device-actions button, .studio-device-row button {
  background: #1b1e25; border: 1px solid var(--studio-stroke-strong); border-radius: 6px; color: var(--studio-text);
  cursor: pointer; font-size: 11px; padding: 4px 9px;
}
.studio-device-actions button:hover, .studio-device-row button:hover { background: var(--studio-surface-hover); }
.studio-device-actions button:disabled, .studio-device-row button:disabled { cursor: default; opacity: .5; }
.studio-device-trust { background: #315fbb !important; border-color: #5b8def !important; color: #f4f7ff !important; font-weight: 700; }
.studio-device-revoke, .studio-device-decline { color: #ffaaa2 !important; }
.studio-device-scenario {
  background: #1b1e25; border: 1px solid var(--studio-stroke-strong); border-radius: 6px; color: var(--studio-text);
  font-size: 11px; max-width: 100%; padding: 4px 6px;
}
.studio-device-code-block {
  background: var(--studio-bg-deep); border: 1px solid var(--studio-stroke); border-radius: 6px; display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow-wrap: anywhere; padding: 6px 8px;
  user-select: all;
}
.studio-device-code {
  display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 30px; font-weight: 700;
  letter-spacing: .12em; padding: 4px 0; text-align: center;
}
.studio-device-countdown { color: var(--studio-text-muted); }
.studio-device-qr-box { background: #fff; border-radius: 8px; justify-self: center; padding: 8px; width: 200px; }
.studio-device-qr-box svg { display: block; height: auto; width: 100%; }
.studio-device-revision[data-revision="applied"] { color: var(--studio-positive); }
.studio-device-revision[data-revision="behind"] { color: #ffc0b5; }
.studio-device-diagnostics { display: grid; gap: 4px; list-style: none; margin: 0; padding: 0; }
.studio-device-diagnostic { color: #ffe2a8; }
.studio-device-diagnostic::before { content: "⚠ "; }
.studio-device-status { color: var(--studio-text-muted); margin: 0; }
.studio-device-status[data-state="error"] { color: #ffaaa2; }
.studio-device-status[hidden] { display: none; }

/* Desktop workbench theme. Component rules above own layout behavior; this layer owns product hierarchy. */
:root {
  --studio-accent: #5b8def;
  --studio-accent-strong: #72a0ff;
  --studio-accent-surface: #263b63;
  --studio-bg: #111319;
  --studio-bg-deep: #0c0e13;
  --studio-canvas: #0e1015;
  --studio-divider: #2a303a;
  --studio-divider-active: #496fae;
  --studio-error: #ff766b;
  --studio-panel: #171a21;
  --studio-panel-raised: #1c2028;
  --studio-positive: #62cf84;
  --studio-stroke: #2c323d;
  --studio-stroke-strong: #3a424f;
  --studio-surface-active: #2a3e66;
  --studio-surface-hover: #222731;
  --studio-text: #e7eaf0;
  --studio-text-dim: #697180;
  --studio-text-muted: #929aa8;
  background: var(--studio-bg);
  color: var(--studio-text);
  color-scheme: dark;
  font: 13px/1.42 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
html, body, #tao-studio-root, #tao-studio-viewport { background: var(--studio-bg); }
body { overflow: hidden; }
::selection { background: #315b9f; color: #fff; }
button, input, select, textarea { font: inherit; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--studio-accent); outline-offset: 1px;
}
* { scrollbar-color: #3c4451 transparent; scrollbar-width: thin; }

.studio-shell { background: var(--studio-bg); grid-template-rows: 52px minmax(0, 1fr); }
.studio-toolbar {
  background: #181b22; border-bottom-color: var(--studio-stroke); display: grid; gap: 14px;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); padding: 0 12px;
}
.studio-toolbar-context, .studio-toolbar-mode, .studio-toolbar-actions { align-items: center; display: flex; min-width: 0; }
.studio-toolbar-context { gap: 8px; }
.studio-toolbar-mode { gap: 10px; justify-self: center; }
.studio-toolbar-actions { gap: 8px; justify-self: end; }
.studio-window-controls { align-items: center; display: flex; flex: none; gap: 8px; margin: 0 8px 0 3px; }
.studio-window-controls i { background: #69717d; border-radius: 50%; display: block; height: 10px; width: 10px; }
.studio-picker { color: var(--studio-text-muted); }
.studio-project { background: #181b22; border: 0; color: var(--studio-text); font-weight: 650; padding: 4px 22px 4px 6px; }
.studio-project:hover, .studio-app-picker:hover { color: #fff; }
.studio-app-picker { background: #181b22; border-left: 1px solid var(--studio-stroke); padding: 4px 22px 4px 10px; }
.studio-layout-presets { background: var(--studio-bg-deep); border-color: var(--studio-stroke); border-radius: 8px; padding: 3px; }
.studio-layout-presets button { border-radius: 6px; color: var(--studio-text-muted); min-width: 58px; padding: 5px 12px; }
.studio-layout-presets button:hover { color: var(--studio-text); }
.studio-layout-presets button[aria-current="true"] {
  background: var(--studio-accent-surface); box-shadow: inset 0 0 0 1px #5f8adb66; color: #f4f7ff;
}
.studio-command-palette {
  background: #1b1e25; border-color: var(--studio-stroke-strong); border-radius: 7px; color: var(--studio-text-muted);
  font-size: 11px; min-width: 44px; padding: 6px 9px;
}
.studio-command-palette:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-interaction-mode, .studio-reload {
  background: transparent; border: 1px solid var(--studio-stroke); border-radius: 7px; color: var(--studio-text-muted);
  font-size: 11px; padding: 5px 8px;
}
.studio-reload:hover, .studio-interaction-mode:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-interaction-mode[data-mode="edit"] { border-color: #476ba9; color: #cfe0ff; }
.studio-interaction-mode[data-mode="run"] { border-color: #3d7352; color: #ccebd6; }
.studio-status {
  align-items: center; color: var(--studio-text-muted); display: flex; font-size: 11px; gap: 7px; margin-left: 4px;
  max-width: min(420px, 32vw);
}
.studio-status::before { background: #66707e; border-radius: 50%; content: ""; flex: none; height: 7px; width: 7px; }
.studio-status[data-state="compiled"] { color: #b9c2ce; }
.studio-status[data-state="compiled"]::before { background: var(--studio-positive); box-shadow: 0 0 0 3px #62cf8417; }
.studio-status[data-state="error"] { color: #ffaaa2; }
.studio-status[data-state="error"]::before { background: var(--studio-error); box-shadow: 0 0 0 3px #ff766b17; }
.studio-status-diagnostic { max-width: 100%; text-decoration: none; }
.studio-status-diagnostic:hover { color: #ffd0cb; }

.studio-body { background: var(--studio-bg); grid-template-columns: 52px var(--studio-left-size) 4px minmax(420px, 1fr); }
.studio-rail { background: #13161c; border-right-color: var(--studio-stroke); gap: 4px; padding: 10px 6px; }
.studio-rail-button {
  border-radius: 8px; color: #737c8a; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 17px;
  font-weight: 500; height: 39px; position: relative; width: 39px;
}
.studio-rail-button::before {
  background: transparent; border-radius: 0 3px 3px 0; content: ""; height: 22px; left: -6px; position: absolute;
  top: 8px; width: 3px;
}
.studio-rail-button:hover { background: var(--studio-surface-hover); color: #c6ccd6; }
.studio-rail-button[aria-current="true"] { background: var(--studio-accent-surface); color: #edf3ff; }
.studio-rail-button[aria-current="true"]::before { background: var(--studio-accent-strong); }
.studio-sidebar, .studio-inspector { background: var(--studio-panel); }
.studio-sidebar { border-right: 0; }
.studio-pane-header { background: #181b22; border-bottom-color: var(--studio-stroke); height: 38px; padding: 0 7px 0 13px; }
.studio-pane-header strong { color: #9da6b5; font-size: 10px; font-weight: 650; letter-spacing: .13em; }
.studio-pane-header button { color: #707987; }
.studio-pane-header button:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-divider { background: transparent; }
.studio-divider::before { background: var(--studio-divider); content: ""; inset: 0 1px; position: absolute; transition: background 120ms ease; }
.studio-divider-bottom::before { inset: 1px 0; }
.studio-divider:hover::before, .studio-divider:active::before { background: var(--studio-divider-active); }
.studio-divider::after { inset: -4px; }

.studio-center {
  --studio-bottom-size: 188px; --studio-preview-size: 440px; background: var(--studio-bg);
  grid-template-columns: var(--studio-right-size) 4px minmax(380px, 1fr) 4px minmax(280px, var(--studio-preview-size));
  grid-template-rows: minmax(240px, 1fr) 4px var(--studio-bottom-size);
}
.studio-workbench { display: contents; }
.studio-editor-pane { background: var(--studio-bg); grid-template-rows: 38px 30px minmax(0, 1fr); }
.studio-editor-tabs { align-items: stretch; background: #15181e; border-bottom-color: var(--studio-stroke); padding-left: 0; }
.studio-editor-tab-item { border: 0; border-right: 1px solid var(--studio-stroke); border-radius: 0; position: relative; }
.studio-editor-tab-item::after { background: transparent; bottom: 0; content: ""; height: 2px; left: 0; position: absolute; right: 0; }
.studio-editor-tab-item[aria-current="page"] { background: var(--studio-bg); }
.studio-editor-tab-item[aria-current="page"]::after { background: var(--studio-accent); }
.studio-editor-tab { color: var(--studio-text-muted); padding: 9px 6px 8px 13px; }
.studio-editor-tab-item[aria-current="page"] .studio-editor-tab { color: var(--studio-text); }
.studio-editor-tab-close { color: #646d7a; padding-right: 10px; }
.studio-editor-tab-close:hover { color: #ffaaa2; }
.studio-breadcrumbs { background: var(--studio-bg); border-bottom-color: #252a33; color: #767f8d; font-size: 11px; padding: 0 13px; }
.studio-breadcrumb-separator { color: #424956; }
.studio-editor { background: var(--studio-bg); }
.studio-editor .cm-editor { background: var(--studio-bg); }
.studio-editor .cm-gutters { background: #101218; border-right-color: #242a33; color: #505866; }
.studio-editor .cm-activeLine, .studio-editor .cm-activeLineGutter { background: #1a1e26; }
.studio-editor .cm-selectionBackground { background: #315b9f !important; }

.studio-preview { background: var(--studio-canvas); border-left-color: var(--studio-stroke); }
.studio-preview-grid { background: var(--studio-canvas); gap: 22px; padding: 18px 20px 28px; }
.studio-preview-group { gap: 10px; }
.studio-preview-group-label { color: #737d8c; font-size: 10px; font-weight: 650; letter-spacing: .12em; }
.studio-preview-group-cells { gap: 20px; }
.studio-preview-cell { gap: 7px; }
.studio-preview-cell-label { color: #d3d8e0; font-size: 11px; font-weight: 650; }
.studio-preview-cell-details { color: #687180; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.studio-preview-cell[aria-current="true"] > .studio-preview-cell-label { color: #cfe0ff; }
.studio-preview-cell:focus-visible { outline-color: var(--studio-accent); }
.studio-preview-cell-viewport {
  border-color: #303744; border-radius: 10px; box-shadow: 0 14px 38px #0008, 0 0 0 1px #0008;
}
.studio-preview-cell[aria-current="true"] .studio-preview-cell-viewport {
  border-color: var(--studio-accent); box-shadow: 0 14px 38px #0009, 0 0 0 2px var(--studio-accent);
}
.studio-preview-cell-controls, .studio-preview-cell-disclosure-summary {
  background: var(--studio-panel-raised); border-color: var(--studio-stroke); color: var(--studio-text-muted);
}
.studio-preview-control-input input:not([type="checkbox"]), .studio-preview-control-input select,
.studio-preview-control-input textarea, .studio-preview-fixture-name {
  background: #12151b; border-color: var(--studio-stroke-strong); color: var(--studio-text);
}

.studio-inspector { border-left: 0; }
.studio-inspector-pane + .studio-inspector-pane { border-left-color: var(--studio-stroke); }
.studio-inspector-pane-header { background: #181b22; border-bottom-color: var(--studio-stroke); }
.studio-inspector-pane-header strong { color: #858f9e; font-weight: 650; letter-spacing: .12em; }
.studio-drawer { background: #14171d; }
.studio-drawer-tabs, .studio-inspector-tabs {
  background: #181b22; border-bottom-color: var(--studio-stroke); gap: 2px; min-height: 38px; padding: 0 9px;
}
.studio-drawer-tabs button, .studio-inspector-tabs button {
  border-radius: 6px; color: #858e9c; font-size: 11px; margin: 5px 0; padding: 5px 9px;
}
.studio-drawer-tabs .studio-pane-collapse, .studio-inspector-pane-header .studio-pane-collapse {
  background: transparent; color: #697281; font-size: 16px; margin-left: auto; min-width: 26px; padding: 2px 7px;
}
.studio-drawer-tabs .studio-pane-collapse:hover, .studio-inspector-pane-header .studio-pane-collapse:hover {
  background: var(--studio-surface-hover); color: var(--studio-text);
}
.studio-drawer-tabs button:hover, .studio-inspector-tabs button:hover { background: var(--studio-surface-hover); color: #cbd1da; }
.studio-drawer-tabs button[aria-current="true"], .studio-inspector-tabs button[aria-current="true"] {
  background: var(--studio-accent-surface); color: #f0f5ff;
}
.studio-drawer-content { color: var(--studio-text-muted); padding: 10px 13px; }
.studio-data { color: var(--studio-text-muted); padding: 10px 12px; }
.studio-data .studio-data-table { display: block; overflow-x: auto; }
.studio-drawer-content dt, .studio-drawer-content dd { border-bottom-color: #242a32; }
.studio-drawer-row { border-radius: 5px; color: #e7a8a1; padding: 6px 8px; }
.studio-drawer-row:hover:not(:disabled) { background: var(--studio-surface-hover); }
.studio-scenario-inspector-content, .studio-inspector-content { padding: 12px; }
.studio-scenario-inspector { border-bottom: 0; margin: 0; padding: 0; }
.studio-scenario-inspector-label { color: var(--studio-text); font-size: 11px; font-weight: 650; }
.studio-palette h2, .studio-inspector h2 {
  color: #858f9e; font-size: 10px; font-weight: 650; letter-spacing: .12em; margin: 10px 0;
}
.studio-inspector-summary { border-bottom: 1px solid var(--studio-stroke); gap: 3px 8px; grid-template-columns: 52px minmax(0, 1fr); margin: 10px 0 14px; padding-bottom: 11px; }
.studio-inspector-summary dt { color: #697281; }
.studio-inspector-summary dd { color: #aeb6c2; }
.studio-inspector-accordion { border-color: var(--studio-stroke); }
.studio-inspector-accordion > summary { background: var(--studio-panel-raised); color: #aeb7c4; }
.studio-inspector-accordion > summary:hover { background: var(--studio-surface-hover); }
.studio-inspector-accordion-content { border-top-color: var(--studio-stroke); }
.studio-inspector-field { color: #8b94a2; gap: 6px; }
.studio-inspector-field input, .studio-inspector-field select, .studio-design-bundle input,
.studio-design-bundle select, .studio-search-input {
  background: #11141a; border-color: var(--studio-stroke-strong); border-radius: 6px; color: var(--studio-text); padding: 6px 8px;
}
.studio-palette-button, .studio-inspector-button, .studio-file-tree__toolbar button, .studio-file-tree__action,
.studio-drawer-toolbar button, .studio-drawer-toolbar select, .studio-design-bundle button {
  background: var(--studio-panel-raised); border-color: var(--studio-stroke-strong); border-radius: 6px; color: #c6ccd5;
}
.studio-palette-button:hover, .studio-inspector-button:hover:not(:disabled), .studio-file-tree__toolbar button:hover,
.studio-file-tree__action:hover:not(:disabled) { background: var(--studio-surface-hover); }
.studio-undo { color: #aeb7c4; margin-bottom: 9px; }
.studio-panel-note, .studio-palette-empty, .studio-inspector-empty, .studio-empty { color: #707987; }

.studio-files { padding: 8px 7px 12px; }
.studio-file { border-radius: 6px; color: #aeb6c1; padding: 6px 8px; }
.studio-file:hover { background: var(--studio-surface-hover); color: var(--studio-text); }
.studio-file[aria-current="true"] { background: var(--studio-surface-active); color: #eef4ff; }
.studio-file-tree__toolbar { gap: 5px; margin: 1px 2px 9px; }
.studio-file-tree__toolbar button { font-size: 10px; padding: 4px 7px; }
.studio-file-tree__list > li { gap: 4px; grid-template-columns: 10px minmax(80px, 1fr) auto auto auto; }
.studio-file-tree__list summary { color: #8c96a4; font-size: 11px; padding: 5px 3px; }
.studio-file-tree__list summary:hover { color: #d1d7df; }
.studio-file-tree__dirty { color: #ffb657; }
.studio-file-tree__diagnostics { background: #ad4a51; }
.studio-file-tree__action { opacity: 0; transition: opacity 100ms ease; }
.studio-file-tree__list > li:hover > .studio-file-tree__action,
.studio-file-tree__action:focus-visible { opacity: .9; }
.studio-palette { border-top-color: var(--studio-stroke); }
.studio-palette-group h3, .studio-design-values h2, .studio-design-values h3 { color: #707a88; }
.studio-screen-item, .studio-search-result {
  background: var(--studio-panel-raised); border-color: var(--studio-stroke); border-radius: 7px; color: #d7dce4;
}
.studio-screen-item:hover, .studio-search-result:hover { background: var(--studio-surface-hover); border-color: #414a58; }
.studio-command-overlay {
  background: #1a1d24; border-color: #424b5a; border-radius: 12px; box-shadow: 0 24px 80px #000c;
  padding: 13px; top: 76px;
}
.studio-command-overlay input { background: #101218; border-color: #3a4351; border-radius: 8px; color: var(--studio-text); padding: 10px 11px; }
.studio-command-result { border-radius: 7px; padding: 8px 10px; }
.studio-command-result:hover, .studio-command-result:focus { background: var(--studio-surface-hover); }
.studio-command-result span { color: #737d8b; }
@media (max-width: 1400px) {
  .studio-center {
    --studio-right-size: 0px !important;
    grid-template-columns: 0 0 minmax(280px, 1fr) 4px minmax(280px, var(--studio-preview-size));
  }
  .studio-pane-right, .studio-divider-right { display: none; }
  .studio-reload { display: none; }
  .studio-toolbar { gap: 8px; }
  .studio-toolbar-actions { gap: 5px; }
  .studio-status { max-width: 26vw; }
}
@media (max-width: 760px) {
  .tao-studio-product-host { overflow: clip; }
  .studio-toolbar { grid-template-columns: minmax(0, 1fr) auto; padding-inline: 8px; }
  .studio-toolbar-mode { justify-self: end; }
  .studio-toolbar-actions, .studio-window-controls, .studio-picker, .studio-app-picker { display: none; }
  .studio-body { grid-template-columns: 0 0 0 minmax(0, 1fr); }
  .studio-rail, .studio-sidebar, .studio-divider-left { display: none; }
  .studio-center {
    --studio-bottom-size: 0px !important;
    grid-column: 4;
    grid-template-columns: 0 0 minmax(0, 1fr) 4px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .studio-divider-bottom, .studio-drawer { display: none; }
  .studio-editor-pane, .studio-preview { min-width: 0; }
  .tao-studio-product-host[data-layout-preset="code"] .studio-center {
    grid-template-columns: 0 0 minmax(0, 1fr) 0 0;
  }
  .tao-studio-product-host[data-layout-preset="run"] .studio-center {
    grid-template-columns: 0 0 0 0 minmax(0, 1fr);
  }
}
`
