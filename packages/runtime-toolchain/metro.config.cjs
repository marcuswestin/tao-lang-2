const { getDefaultConfig } = require('expo/metro-config')
const nodeFs = require('node:fs')
const nodePath = require('node:path')

// Metro config loads as plain CJS, so keep these Node platform calls local.
const config = getDefaultConfig(__dirname)
const repositoryNodeModules = nodePath.resolve(__dirname, '..', '..', 'node_modules')
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

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@runtime/TR') {
    return {
      type: 'sourceFile',
      filePath: nodePath.resolve(__dirname, '..', 'runtime', 'TaoRuntime-src', 'TR.ts'),
    }
  }
  if (moduleName === '@shared/core') {
    return {
      type: 'sourceFile',
      filePath: nodePath.resolve(__dirname, '..', 'shared', 'shared-src', 'core', 'shared-core.ts'),
    }
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
