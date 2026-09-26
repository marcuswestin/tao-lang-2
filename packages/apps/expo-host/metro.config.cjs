const { getDefaultConfig } = require('expo/metro-config')
const nodeFs = require('node:fs')
const nodePath = require('node:path')

// Metro config loads as plain CJS, so keep these Node platform calls local.
const config = getDefaultConfig(__dirname)
const runtimeToolchainSourceRoot = process.env.TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT || __dirname
// Inside the repository these three sit where the package layout puts them relative to this host.
// An installed Tao has no repository around its host, so it names each one explicitly instead
// (`RuntimeToolchainPaths.installedExpoEnvironment`).
const repositoryNodeModules = process.env.TAO_HOST_DEPENDENCY_ROOT
  || nodePath.resolve(runtimeToolchainSourceRoot, '..', '..', '..', 'node_modules')
const installedNodeModules = nodeFs.realpathSync(repositoryNodeModules)
const runtimeToolchainNodeModules = nodeFs.realpathSync(nodePath.resolve(__dirname, 'node_modules'))
const runtimeSourceRoot = process.env.TAO_RUNTIME_SOURCE_ROOT
  || nodePath.resolve(runtimeToolchainSourceRoot, '..', 'runtime', 'TaoRuntime-src')
const sharedCoreSourceRoot = process.env.TAO_SHARED_CORE_SOURCE_ROOT
  || nodePath.resolve(runtimeToolchainSourceRoot, '..', '..', 'shared', 'shared-src', 'core')

// A Studio session bundles from a fresh, disposable copy of this project, which Metro keys its file
// map by: no later session can ever read that map back. Left in the OS temp directory it is a couple
// of megabytes per session that nothing removes, and hundreds of megabytes describing directories
// deleted long ago accumulate unseen. Keeping it inside the project root ties its lifetime to the
// root's, so removing the session's runtime directory takes the map with it. The toolchain package
// itself is a stable project whose map is reused across runs, and keeps Metro's shared default.
if (nodePath.resolve(runtimeToolchainSourceRoot) !== __dirname) {
  config.fileMapCacheDirectory = nodePath.resolve(__dirname, '.metro-file-map')
  // Metro writes the map without creating its directory, and only warns when the write fails.
  nodeFs.mkdirSync(config.fileMapCacheDirectory, { recursive: true })
}

// Worktrunk worktrees reuse the primary checkout's install through a root node_modules symlink.
// Watching and searching the physical root makes Bun's package targets visible to Metro's file map,
// so its own resolver can preserve platform-specific package semantics.
//
// Bun's phantom-dependency farm at node_modules/.bun/node_modules stays out of the search path on
// purpose: it flattens every installed package — including Node-only tooling copies of react — into
// the bundle's resolution, which is how a second react once reached the app and broke hooks. Every
// declared dependency and peer resolves through Bun's per-package nested symlinks without it; a
// module that fails to resolve is missing a declaration in its package.json, not this farm.
// Alias resolution below deliberately reaches workspace source outside the isolated preview
// project. Metro must watch those source roots as well as resolve them, or its file map cannot
// compute hashes for the returned files when Watchman is active.
config.watchFolders = [
  ...new Set([
    ...config.watchFolders,
    installedNodeModules,
    runtimeToolchainNodeModules,
    runtimeSourceRoot,
    sharedCoreSourceRoot,
  ]),
]
config.resolver.nodeModulesPaths = [
  ...new Set([
    ...config.resolver.nodeModulesPaths,
    runtimeToolchainNodeModules,
    installedNodeModules,
  ]),
]

// The runtime requires each of these lazily and degrades when the module yields no component.
// Metro resolves every literal require while bundling, so an omitted package would fail the build
// before that degradation could run; resolving a missing optional host to Metro's empty module
// keeps the bundle building and hands the runtime the "no host" case it already handles.
const optionalHostModules = new Set([
  '@react-native-community/datetimepicker',
  '@react-native-community/slider',
  '@react-native-picker/picker',
  '@react-native-segmented-control/segmented-control',
  'expo-glass-effect',
  'react-native-screens',
])

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@tao/runtime/core') {
    return {
      type: 'sourceFile',
      filePath: nodePath.resolve(runtimeSourceRoot, 'core', 'RuntimeCore.ts'),
    }
  }
  if (optionalHostModules.has(moduleName)) {
    try {
      return context.resolveRequest(context, moduleName, platform)
    } catch {
      return { type: 'empty' }
    }
  }
  if (moduleName === '@runtime/TR' || moduleName === '@tao/runtime') {
    return {
      type: 'sourceFile',
      filePath: nodePath.resolve(runtimeSourceRoot, 'TR.ts'),
    }
  }
  // Copied standard-library sidecars also import runtime leaf modules. Keep these pointed at the
  // same runtime as the public entry point, then let Metro select the platform file and extension.
  if (/^@runtime\/TR-[A-Za-z0-9-]+$/.test(moduleName)) {
    return context.resolveRequest(
      context,
      nodePath.resolve(runtimeSourceRoot, moduleName.slice('@runtime/'.length)),
      platform,
    )
  }
  if (moduleName === '@shared/core') {
    return {
      type: 'sourceFile',
      filePath: nodePath.resolve(sharedCoreSourceRoot, 'shared-core.ts'),
    }
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
