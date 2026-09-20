import Runtime from '@runtime-toolchain'
import { Errors, FS } from '@shared'
import { existsSync } from 'node:fs'
import { studioClientStylesheet } from './StudioClientStylesheet'

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
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230f0f0f'/%3E%3Ctext x='32' y='45' fill='%23ff6a1f' font-family='sans-serif' font-size='42' text-anchor='middle'%3ET%3C/text%3E%3C/svg%3E">
  <title>Tao Studio</title>
  <style>${studioClientStylesheet}</style>
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
    'expo-glass-effect',
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
        if (args.path === '@runtime/TR' || args.path === '@tao/runtime') {
          return { path: resolveBrowserDependency('@runtime/TR') }
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
