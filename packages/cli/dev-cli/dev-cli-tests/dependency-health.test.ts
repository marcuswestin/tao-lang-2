import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { dependencyHealthError } from '@verification/DependencyHealth'
import { installedLockfileError } from '@verification/InstalledLockfile'

Describe('dependency health probes', () => {
  /*
   * The probes name modules and directories as plain strings, and Bun links workspace dependencies
   * per package, so a mistyped module or a probe pointed at the wrong package directory fails
   * exactly like a damaged tree — silently turning `./agent setup` into a permanent repair loop. This
   * runs the real probes against this checkout, which the verify graph has already installed.
   */
  Test('every probe loads on an installed checkout', async () => {
    Expect(await dependencyHealthError()).toBeUndefined()
  })

  Test('reports the underlying loader error instead of Bun location prelude', async () => {
    const failure = await dependencyHealthError('/repo', {
      isFile: async () => false,
      run: async (command, spec) => {
        const options = spec ?? {}
        return {
          args: [...(options.args ?? [])],
          command,
          cwd: options.cwd,
          error: undefined,
          exitCode: 1,
          signal: null,
          stderr: '1 | await import("ink")\n    ^\nerror: Cannot find module "ink" from "/repo/packages/cli/cli-kit"\n',
          stdout: '',
        }
      },
    })

    Expect(failure).toBe('packages/cli/cli-kit: error: Cannot find module "ink" from "/repo/packages/cli/cli-kit"')
  })

  Test('detects a stale installed transitive link against the locked resolution', async () => {
    const root = await mkTestDir('tao-stale-dependency-link-')
    try {
      await FS.writeJson(FS.resolvePath('bun.lock', root), {
        packages: {
          '@expo/plist': ['@expo/plist@0.8.1'],
          '@expo/plist/@xmldom/xmldom': ['@xmldom/xmldom@0.8.15'],
        },
      })
      const store = FS.resolvePath('node_modules/.bun', root)
      const packagePath = (version: string) =>
        FS.resolvePath(
          `@xmldom+xmldom@${version}/node_modules/@xmldom/xmldom`,
          store,
        )
      await FS.writeJson(FS.resolvePath('package.json', packagePath('0.8.13')), {
        name: '@xmldom/xmldom',
        version: '0.8.13',
      })
      await FS.writeJson(FS.resolvePath('package.json', packagePath('0.8.15')), {
        name: '@xmldom/xmldom',
        version: '0.8.15',
      })
      const link = FS.resolvePath('@expo+plist@0.8.1/node_modules/@xmldom/xmldom', store)
      await FS.symlink(packagePath('0.8.13'), link)

      Expect(await installedLockfileError(root)).toBe(
        '@expo/plist/@xmldom/xmldom: bun.lock expects @xmldom/xmldom@0.8.15, installed @xmldom/xmldom@0.8.13',
      )

      await FS.replaceSymlink(packagePath('0.8.15'), link)
      Expect(await installedLockfileError(root)).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })
})
