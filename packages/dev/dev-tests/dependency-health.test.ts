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
})
