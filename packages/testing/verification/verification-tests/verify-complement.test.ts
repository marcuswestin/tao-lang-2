import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { GateCatalog } from '../verification-src/GateCatalog'
import { VerifyComplement } from '../verification-src/VerifyComplement'

/**
 * The lane's membership is derived, so what these pin is the derivation: which gates count as
 * host-only, how the workflow's admission narrows them, and that the prepare nodes they read come
 * along. The real full lane and the real workflow are read at the end, so a Justfile or workflow
 * edit that silently empties the lane fails here rather than at a landing.
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

async function justVariable(name: string): Promise<string[]> {
  const text = await FS.readText(FS.resolvePath('Justfile', Repo.getRoot()))
  const match = new RegExp(`^${name} := "([^"]*)"`, 'mu').exec(text)
  return (match?.[1] ?? '').split(' ').filter(gate => gate !== '')
}

Describe('verify-complement', () => {
  Test('reads the admission exactly as the workflow spells it, and treats absence as none', () => {
    Expect(VerifyComplement.admittedHostGates("env:\n  CI_HOST_GATES: 'studio-smoke, studio-canary'\n"))
      .toEqual({ admitted: ['studio-smoke', 'studio-canary'], present: true })
    Expect(VerifyComplement.admittedHostGates("  CI_HOST_GATES: ''\n")).toEqual({ admitted: [], present: true })
    Expect(VerifyComplement.admittedHostGates('env:\n  PARTITIONS: 12\n')).toEqual({ admitted: [], present: false })
  })

  Test('runs every host gate the workflow does not admit, with the prepare nodes they read', () => {
    const plan = VerifyComplement.plan(FULL_LANE, '')
    Expect(plan.host).toEqual(['studio-smoke', 'studio-canary'])
    Expect(plan.workflowAdmits).toBe(false)
    // The portable gates stay on the hosted runners; the fixers and generators the smokes read run first.
    Expect(plan.gates).not.toContain('_typecheck')
    Expect(plan.gates).not.toContain('_test')
    Expect(plan.gates).not.toContain('ship-bundle-proof')
    for (const need of GateCatalog.dependenciesOf('studio-smoke')) {
      Expect(plan.gates).toContain(need)
    }
    // In the full lane's order, so the two lanes read the same way.
    Expect(plan.gates.indexOf('_parser-gen')).toBeLessThan(plan.gates.indexOf('studio-smoke'))
  })

  Test('leaves out what CI macOS admits', () => {
    const plan = VerifyComplement.plan(FULL_LANE, "env:\n  CI_HOST_GATES: 'studio-smoke'\n")
    Expect(plan.admitted).toEqual(['studio-smoke'])
    Expect(plan.host).toEqual(['studio-canary'])
    Expect(plan.gates).not.toContain('studio-smoke')
    Expect(VerifyComplement.plan(FULL_LANE, "  CI_HOST_GATES: 'studio-smoke,studio-canary'\n").host).toEqual([])
  })

  Test('leaves a gate hosted Verify runs on Linux to Verify', () => {
    Expect(VerifyComplement.isHostGate('studio-dialog-browser')).toBe(false)
    const plan = VerifyComplement.plan([...FULL_LANE, 'studio-dialog-browser'], '')
    Expect(plan.host).toEqual(['studio-smoke', 'studio-canary'])
    Expect(plan.gates).not.toContain('studio-dialog-browser')
  })

  Test('the real full lane and workflow leave a non-empty complement of host gates only', async () => {
    const plan = await VerifyComplement.readPlan(await justVariable('VERIFY_FULL_GATES'), Repo.getRoot())
    Expect(plan.host.length).toBeGreaterThan(0)
    for (const name of plan.host) {
      Expect(VerifyComplement.isHostGate(name)).toBe(true)
    }
    for (const name of plan.gates) {
      Expect(VerifyComplement.isHostGate(name) || GateCatalog.isPrepare(name)).toBe(true)
    }
  })

  Test('the receipt lives beside the summary', () => {
    Expect(VerifyComplement.receiptPath('/logs/verify-complement/stamp')).toBe(
      '/logs/verify-complement/stamp/complement.json',
    )
  })
})
