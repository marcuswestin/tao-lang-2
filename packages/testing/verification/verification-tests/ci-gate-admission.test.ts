import { Describe, Expect, Test } from '@shared/test'
import { CiGateAdmission } from '../verification-src/CiGateAdmission'
import { GateCatalog } from '../verification-src/GateCatalog'

/*
 * What these pin is the mirror: the hosted macOS lane runs exactly the host gates the workflow
 * admits, with the prepare nodes they read, and names every other host gate as pending. The
 * complement's tests pin the other half of the same key.
 */

const FULL_LANE = [
  '_fix-dprint',
  '_fix-tao',
  '_parser-gen',
  '_compile-word-flower-app',
  '_typecheck',
  '_test',
  'dead-exports',
  'ship-bundle-proof',
  'studio-smoke',
  'studio-canary',
]

Describe('CI gate admission', () => {
  Test('an empty admission runs nothing and reports every host gate pending', () => {
    const admission = CiGateAdmission.select(FULL_LANE, '')
    Expect(admission.admitted).toEqual([])
    Expect(admission.gates).toEqual([])
    Expect(admission.skipped).toEqual([
      'studio-smoke=Pending CI host admission',
      'studio-canary=Pending CI host admission',
    ])
  })

  Test('an admitted gate brings the prepare nodes it reads and leaves the portable readers out', () => {
    const admission = CiGateAdmission.select(FULL_LANE, ' studio-smoke ')
    Expect(admission.admitted).toEqual(['studio-smoke'])
    Expect(admission.gates).toContain('studio-smoke')
    for (const need of GateCatalog.dependenciesOf('studio-smoke')) {
      Expect(admission.gates).toContain(need)
    }
    Expect(admission.gates).not.toContain('_typecheck')
    Expect(admission.gates).not.toContain('_test')
    Expect(admission.gates).not.toContain('ship-bundle-proof')
    Expect(admission.gates.indexOf('_parser-gen')).toBeLessThan(admission.gates.indexOf('studio-smoke'))
    Expect(admission.skipped).toEqual(['studio-canary=Pending CI host admission'])
  })

  Test('admits in lane order whatever order the workflow lists', () => {
    const admission = CiGateAdmission.select(FULL_LANE, 'studio-canary,studio-smoke')
    Expect(admission.admitted).toEqual(['studio-smoke', 'studio-canary'])
    Expect(admission.skipped).toEqual([])
  })

  Test('refuses names the lane cannot honour', () => {
    Expect(() => CiGateAdmission.select(FULL_LANE, 'studio-smoke,')).toThrow('without empty entries')
    Expect(() => CiGateAdmission.select(FULL_LANE, 'studio-smoke,studio-smoke')).toThrow('more than once')
    Expect(() => CiGateAdmission.select(FULL_LANE, 'studio-nowhere')).toThrow("not in this lane's gate list")
    Expect(() => CiGateAdmission.select(FULL_LANE, '_typecheck')).toThrow('portable gate')
  })
})
