import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

type MetroConfig = {
  resolver: {
    nodeModulesPaths: readonly string[]
    resolveRequest: (
      context: MetroResolutionContext,
      moduleName: string,
      platform: string | null,
    ) => MetroResolution
  }
  watchFolders: readonly string[]
}

type MetroResolution = { filePath: string; type: 'sourceFile' }

type MetroResolutionContext = {
  originModulePath: string
  resolveRequest: (
    context: MetroResolutionContext,
    moduleName: string,
    platform: string | null,
  ) => MetroResolution
}

const config = require('../metro.config.cjs') as MetroConfig

Describe('Expo Metro configuration', () => {
  Test('resolves packages through the physical root install used by linked worktrees', async () => {
    const installedNodeModules = await FS.realPath(Repo.resolvePath('node_modules'))

    Expect(config.resolver.nodeModulesPaths).toContain(installedNodeModules)
    Expect(config.watchFolders).toContain(installedNodeModules)
  })

  Test('keeps the Bun phantom-dependency farm out of module resolution', async () => {
    // The farm at .bun/node_modules flattens every installed package — including Node-only tooling
    // copies of react — into the bundle's resolution, which once put a second react in the app and
    // broke hooks. A module that fails to resolve without it is missing a package.json declaration.
    const installedNodeModules = await FS.realPath(Repo.resolvePath('node_modules'))
    const installedBunNodeModules = FS.resolvePath('.bun/node_modules', installedNodeModules)

    Expect(config.resolver.nodeModulesPaths).not.toContain(installedBunNodeModules)
    Expect(config.watchFolders).not.toContain(installedBunNodeModules)
  })

  Test('resolves the runtime and shared aliases to workspace sources', () => {
    const context: MetroResolutionContext = {
      originModulePath: Repo.resolvePath('packages/runtime-toolchain/index.ts'),
      resolveRequest() {
        throw new Error('aliases must not reach the default resolver')
      },
    }

    Expect(config.resolver.resolveRequest(context, '@runtime/TR', 'ios')).toEqual({
      filePath: Repo.resolvePath('packages/runtime/TaoRuntime-src/TR.ts'),
      type: 'sourceFile',
    })
    Expect(config.resolver.resolveRequest(context, '@shared/core', 'ios')).toEqual({
      filePath: Repo.resolvePath('packages/shared/shared-src/core/shared-core.ts'),
      type: 'sourceFile',
    })
  })

  Test('delegates every other module to Metro resolution with its origin preserved', () => {
    const expected: MetroResolution = { filePath: '/resolved/module.js', type: 'sourceFile' }
    const calls: Array<{ moduleName: string; originModulePath: string; platform: string | null }> = []
    const context: MetroResolutionContext = {
      originModulePath: Repo.resolvePath('packages/runtime-toolchain/index.ts'),
      resolveRequest(nextContext, moduleName, platform) {
        calls.push({ moduleName, originModulePath: nextContext.originModulePath, platform })
        return expected
      },
    }

    Expect(config.resolver.resolveRequest(context, 'react', 'web')).toBe(expected)
    Expect(calls).toEqual([
      {
        moduleName: 'react',
        originModulePath: Repo.resolvePath('packages/runtime-toolchain/index.ts'),
        platform: 'web',
      },
    ])
  })
})
