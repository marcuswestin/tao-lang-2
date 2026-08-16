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
    const installedBunNodeModules = FS.resolvePath('.bun/node_modules', installedNodeModules)
    Expect(config.resolver.nodeModulesPaths).toContain(installedBunNodeModules)
    Expect(config.watchFolders).toContain(installedNodeModules)
    Expect(config.watchFolders).not.toContain(installedBunNodeModules)
  })

  Test('retries physical Bun package imports through Metro with the requested platform', async () => {
    const installedNodeModules = await FS.realPath(Repo.resolvePath('node_modules'))
    const bunPackageOrigin = await FS.realPath(
      Repo.resolvePath('packages/runtime-toolchain/node_modules/expo/package.json'),
    )
    const expected: MetroResolution = { filePath: '/resolved/browser-entry.ts', type: 'sourceFile' }
    const calls: Array<{ moduleName: string; originModulePath: string; platform: string | null }> = []
    const firstError = new Error('physical Bun origin missed its peer')
    const context: MetroResolutionContext = {
      originModulePath: bunPackageOrigin,
      resolveRequest(nextContext, moduleName, platform) {
        calls.push({ moduleName, originModulePath: nextContext.originModulePath, platform })
        if (calls.length === 1) {
          throw firstError
        }
        return expected
      },
    }

    Expect(config.resolver.resolveRequest(context, 'peer-package', 'web')).toBe(expected)
    Expect(calls).toEqual([
      { moduleName: 'peer-package', originModulePath: bunPackageOrigin, platform: 'web' },
      {
        moduleName: 'peer-package',
        originModulePath: FS.resolvePath(
          '.bun/node_modules/__tao_metro_resolution__.js',
          installedNodeModules,
        ),
        platform: 'web',
      },
    ])
  })

  Test('does not retry ordinary project origins and preserves a failed Bun resolution', async () => {
    const projectError = new Error('project resolution failed')
    let projectCalls = 0
    const projectContext: MetroResolutionContext = {
      originModulePath: Repo.resolvePath('packages/runtime-toolchain/index.ts'),
      resolveRequest() {
        projectCalls += 1
        throw projectError
      },
    }

    Expect(() => config.resolver.resolveRequest(projectContext, 'missing-project-package', 'ios'))
      .toThrow(projectError)
    Expect(projectCalls).toBe(1)

    const bunPackageOrigin = await FS.realPath(
      Repo.resolvePath('packages/runtime-toolchain/node_modules/expo/package.json'),
    )
    const retryError = new Error('peer retry failed')
    let bunCalls = 0
    const bunContext: MetroResolutionContext = {
      originModulePath: bunPackageOrigin,
      resolveRequest() {
        bunCalls += 1
        throw bunCalls === 1 ? projectError : retryError
      },
    }

    Expect(() => config.resolver.resolveRequest(bunContext, 'missing-peer-package', 'android'))
      .toThrow(projectError)
    Expect(bunCalls).toBe(2)
  })
})
