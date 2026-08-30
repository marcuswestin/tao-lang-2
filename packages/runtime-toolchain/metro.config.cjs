const { getDefaultConfig } = require('expo/metro-config')
const nodeFs = require('node:fs')
const nodePath = require('node:path')

// Metro config loads as plain CJS, so keep these Node platform calls local.
const config = getDefaultConfig(__dirname)
const runtimeToolchainSourceRoot = process.env.TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT || __dirname
const repositoryNodeModules = nodePath.resolve(runtimeToolchainSourceRoot, '..', '..', 'node_modules')
const installedNodeModules = nodeFs.realpathSync(repositoryNodeModules)

// Worktrunk worktrees reuse the primary checkout's install through a root node_modules symlink.
// Watching and searching the physical root makes Bun's package targets visible to Metro's file map,
// so its own resolver can preserve platform-specific package semantics.
//
// Bun's phantom-dependency farm at node_modules/.bun/node_modules stays out of the search path on
// purpose: it flattens every installed package — including Node-only tooling copies of react — into
// the bundle's resolution, which is how a second react once reached the app and broke hooks. Every
// declared dependency and peer resolves through Bun's per-package nested symlinks without it; a
// module that fails to resolve is missing a declaration in its package.json, not this farm.
config.watchFolders = [...new Set([...config.watchFolders, installedNodeModules])]
config.resolver.nodeModulesPaths = [
  ...new Set([
    ...config.resolver.nodeModulesPaths,
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
  'react-native-screens',
])

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (optionalHostModules.has(moduleName)) {
    try {
      return context.resolveRequest(context, moduleName, platform)
    } catch {
      return { type: 'empty' }
    }
  }
  if (moduleName === '@runtime/TR') {
    return {
      type: 'sourceFile',
      filePath: nodePath.resolve(runtimeToolchainSourceRoot, '..', 'runtime', 'TaoRuntime-src', 'TR.ts'),
    }
  }
  if (moduleName === '@shared/core') {
    return {
      type: 'sourceFile',
      filePath: nodePath.resolve(runtimeToolchainSourceRoot, '..', 'shared', 'shared-src', 'core', 'shared-core.ts'),
    }
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
