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
  'studio-proof-real-app',
  'studio-canary',
]

const PULL_REQUEST_ON = 'on:\n  pull_request:\n  push:\n    branches: [main]\n\n'
const PUSH_ON = 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\n'

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
    Expect(plan.host).toEqual(['studio-proof-real-app', 'studio-canary'])
    Expect(plan.workflowAdmits).toBe(false)
    // The portable gates stay on the hosted runners; the fixers and generators the smokes read run first.
    Expect(plan.gates).not.toContain('_typecheck')
    Expect(plan.gates).not.toContain('_test')
    Expect(plan.gates).not.toContain('ship-bundle-proof')
    for (const need of GateCatalog.dependenciesOf('studio-proof-real-app')) {
      Expect(plan.gates).toContain(need)
    }
    // In the full lane's order, so the two lanes read the same way.
    Expect(plan.gates.indexOf('_parser-gen')).toBeLessThan(plan.gates.indexOf('studio-proof-real-app'))
  })

  Test('leaves out what CI macOS admits', () => {
    const plan = VerifyComplement.plan(FULL_LANE, `${PULL_REQUEST_ON}env:\n  CI_HOST_GATES: 'studio-proof-real-app'\n`)
    Expect(plan.admitted).toEqual(['studio-proof-real-app'])
    Expect(plan.host).toEqual(['studio-canary'])
    Expect(plan.gates).not.toContain('studio-proof-real-app')
    Expect(
      VerifyComplement.plan(FULL_LANE, `${PULL_REQUEST_ON}  CI_HOST_GATES: 'studio-proof-real-app,studio-canary'\n`)
        .host,
    )
      .toEqual([])
  })

  Test('counts an admission only when the workflow runs on pull requests', () => {
    const admission = "env:\n  CI_HOST_GATES: 'studio-proof-real-app'\n"
    // Pushes to main and dispatch prove nothing before a merge, so the gate stays in the complement.
    const unproved = VerifyComplement.plan(FULL_LANE, `${PUSH_ON}${admission}`)
    Expect(unproved.admitted).toEqual([])
    Expect(unproved.host).toEqual(['studio-proof-real-app', 'studio-canary'])
    Expect(unproved.workflowAdmits).toBe(true)
    // A comment that mentions the trigger does not declare it.
    Expect(VerifyComplement.plan(FULL_LANE, `# add pull_request here\n${PUSH_ON}${admission}`).host)
      .toEqual(['studio-proof-real-app', 'studio-canary'])
    Expect(VerifyComplement.plan(FULL_LANE, `${PULL_REQUEST_ON}${admission}`).host).toEqual(['studio-canary'])
  })

  Test('reads a pull_request trigger in the block, flow, and scalar spellings of on', () => {
    Expect(VerifyComplement.runsOnPullRequests(`${PULL_REQUEST_ON}jobs:\n`)).toBe(true)
    Expect(VerifyComplement.runsOnPullRequests('on: [push, pull_request]\n')).toBe(true)
    Expect(VerifyComplement.runsOnPullRequests('on: pull_request\n')).toBe(true)
    Expect(VerifyComplement.runsOnPullRequests(`${PUSH_ON}jobs:\n  pull_request:\n`)).toBe(false)
    Expect(VerifyComplement.runsOnPullRequests('on:\n  pull_request_target:\n')).toBe(false)
    Expect(VerifyComplement.runsOnPullRequests('')).toBe(false)
  })

  Test('leaves a gate hosted Verify runs on Linux to Verify', () => {
    const hostedLinux = [
      'studio-dialog-browser',
      'studio-metro-refresh',
      'studio-smoke',
      'studio-network-simulation',
      'keyboard-navigation-smoke',
      'studio-smoke-simulated-user',
    ]
    for (const name of hostedLinux) {
      Expect(VerifyComplement.isHostGate(name)).toBe(false)
    }
    const plan = VerifyComplement.plan([...FULL_LANE, ...hostedLinux], '')
    Expect(plan.host).toEqual(['studio-proof-real-app', 'studio-canary'])
    for (const name of hostedLinux) {
      Expect(plan.gates).not.toContain(name)
    }
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

  Test('hosted Verify checks formatting, Tao sources and the ledger index although it skips their fixers', async () => {
    const hosted = GateCatalog.hostedLinuxGates(await justVariable('VERIFY_FULL_GATES'), { hostedLinux: true })
    for (const check of ['_dprint-check', '_tao-check', '_repo-lint']) {
      Expect(hosted).toContain(check)
    }
  })

  Test('the real Verify workflow runs the gates the complement leaves to its Linux partitions', async () => {
    // isHostGate drops a runsOnHostedLinux gate on the catalog flag alone; only the workflow's
    // --hosted-linux makes the partitions run it. Without the flag they report it skipped and Verify
    // stays green, so a gate left to Verify would be proved nowhere.
    const leftToVerify = (await justVariable('VERIFY_FULL_GATES')).filter(name =>
      GateCatalog.metadata(name).runsOnHostedLinux === true && !VerifyComplement.isHostGate(name)
    )
    Expect(leftToVerify.length).toBeGreaterThan(0)
    const workflow = await FS.readText(FS.resolvePath('.github/workflows/verify.yml', Repo.getRoot()))
    Expect(VerifyComplement.runsOnPullRequests(workflow)).toBe(true)
    const partitionRuns = workflow.split('\n').filter(line => /^\s*run:.*\bverify-full-sandbox\b/u.test(line))
    Expect(partitionRuns.length).toBeGreaterThan(0)
    for (const line of partitionRuns) {
      Expect({ line: line.trim(), hostedLinux: /\s--hosted-linux(?:\s|$)/u.test(line) })
        .toEqual({ line: line.trim(), hostedLinux: true })
    }
  })

  Test('the receipt lives beside the summary', () => {
    Expect(VerifyComplement.receiptPath('/logs/verify-complement/stamp')).toBe(
      '/logs/verify-complement/stamp/complement.json',
    )
  })
})
