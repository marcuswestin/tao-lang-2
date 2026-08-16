const { getDefaultConfig } = require('expo/metro-config')
const nodeFs = require('node:fs')
const nodePath = require('node:path')

// Metro config loads as plain CJS, so keep these Node platform calls local.
const config = getDefaultConfig(__dirname)
const repositoryNodeModules = nodePath.resolve(__dirname, '..', '..', 'node_modules')
const installedNodeModules = nodeFs.realpathSync(repositoryNodeModules)
const installedBunRoot = nodePath.join(installedNodeModules, '.bun')
const installedBunNodeModules = nodePath.join(installedNodeModules, '.bun', 'node_modules')
const installedBunResolutionOrigin = nodePath.join(installedBunNodeModules, '__tao_metro_resolution__.js')

// Worktrunk worktrees reuse the primary checkout's install through a root node_modules symlink.
// Give peer imports reached through Bun's nested physical symlinks (notably react and
// expo-modules-core) the real install and Bun's peer-dependency symlink farm as explicit fallbacks.
// Watching the physical root makes both the package targets and peer-farm symlinks visible to
// Metro's file map, so its own resolver can preserve platform-specific package semantics.
config.watchFolders = [...new Set([...config.watchFolders, installedNodeModules])]
config.resolver.nodeModulesPaths = [
  ...new Set([
    ...config.resolver.nodeModulesPaths,
    installedNodeModules,
    installedBunNodeModules,
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

  try {
    return context.resolveRequest(context, moduleName, platform)
  } catch (error) {
    if (!originIsInsideInstalledBunStore(context.originModulePath)) {
      throw error
    }
    try {
      // Bun stores peer dependencies in .bun/node_modules while package sources live behind
      // physical symlinks. Retry from that peer-dependency directory while preserving Metro's
      // platform extensions, package conditions, browser redirects, and configured main fields.
      return context.resolveRequest(
        { ...context, originModulePath: installedBunResolutionOrigin },
        moduleName,
        platform,
      )
    } catch {
      throw error
    }
  }
}

function originIsInsideInstalledBunStore(originModulePath) {
  try {
    const physicalOrigin = nodeFs.realpathSync(originModulePath)
    const relativeOrigin = nodePath.relative(installedBunRoot, physicalOrigin)
    return relativeOrigin !== ''
      && relativeOrigin !== '..'
      && !relativeOrigin.startsWith(`..${nodePath.sep}`)
      && !nodePath.isAbsolute(relativeOrigin)
  } catch {
    return false
  }
}

module.exports = config
