import { Describe, Expect, Test } from '@shared/test'
import { dependencyHealthError } from '../dev-src/doctor/DependencyHealth'

Describe('dependency health probes', () => {
  /*
   * The probes name modules and directories as plain strings, and Bun links workspace dependencies
   * per package, so a mistyped module or a probe pointed at the wrong package directory fails
   * exactly like a damaged tree — silently turning `just deps` into a permanent repair loop. This
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
          stderr: '1 | await import("ink")\n    ^\nerror: Cannot find module "ink" from "/repo/packages/dev"\n',
          stdout: '',
        }
      },
    })

    Expect(failure).toBe('packages/dev: error: Cannot find module "ink" from "/repo/packages/dev"')
  })
})
