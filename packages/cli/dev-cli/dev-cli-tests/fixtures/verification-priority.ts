/** Isolate irreversible priority changes and CLI module replacements from the test runner. */
import { Errors, FS, HCI, Platform } from '@shared'
import { MockModule } from '@shared/test'
import type { RunGatesOptions } from '@verification/GateRunner'
import * as GateRunner from '@verification/GateRunner'
import * as LandingLockModule from '@verification/LandingLock'
import type { GateSummary } from '@verification/RunSummary'
import { WorkGraph } from '@verification/WorkGraph'

const lane = Platform.runtimeProcess.argv[2] ?? 'default'
if (lane === 'child') {
  HCI.writeLine(String(Platform.processPriority()))
} else {
  const before = Platform.processPriority()
  const originalPlatform = { ...Platform }
  const originalGateRunner = { ...GateRunner }
  const originalLandingLock = { ...LandingLockModule }
  let priorityCalls = 0
  let refused = false
  MockModule('@shared/Platform', () => ({
    ...originalPlatform,
    lowerProcessPriority() {
      priorityCalls++
      try {
        if (lane === 'denied') {
          Errors.throwHostEnvironment('Could not lower command scheduling priority.')
        }
        originalPlatform.lowerProcessPriority()
      } catch (error) {
        refused = true
        throw error
      }
    },
  }))
  // The CLI action is real; only its expensive work and shared landing lock are replaced.
  MockModule('@verification/LandingLock', () => ({
    ...originalLandingLock,
    LandingLock: {
      ...originalLandingLock.LandingLock,
      holdingForLane: async (_options: unknown, work: () => Promise<unknown>) => await work(),
    },
  }))
  MockModule('@verification/GateRunner', () => ({
    ...originalGateRunner,
    async runGates(options: RunGatesOptions): Promise<GateSummary> {
      const atGate = Platform.processPriority()
      const gate = WorkGraph.createState({
        name: 'priority-probe',
        run: {
          command: Platform.runtimeProcess.execPath,
          args: [FS.resolvePath('verification-priority.ts', import.meta.dir), 'child'],
        },
      })
      await WorkGraph.run([gate], { jobs: options.jobs })
      // Reapplying the policy must neither compound niceness nor boost an inherited priority.
      if (priorityCalls > 0 && !refused) {
        originalPlatform.lowerProcessPriority()
      }
      HCI.writeLine(`PRIORITY ${
        JSON.stringify({
          before,
          atGate,
          gateChild: Number(gate.fullOutput.trim()),
          gateStatus: gate.status,
          repeated: Platform.processPriority(),
          priorityCalls,
          refused,
          jobs: options.jobs,
        })
      }`)
      return {
        elapsedMs: 0,
        gates: [],
        lane: options.lane ?? 'verify',
        logRoot: '.artifacts/scratch',
        status: 'passed',
        version: 2,
        warnings: [],
      }
    },
  }))
  Platform.runtimeProcess.argv.splice(
    2,
    Platform.runtimeProcess.argv.length - 2,
    'gates',
    'priority-probe',
    '--jobs',
    '3',
    ...(lane === 'default' ? [] : ['--lane', lane === 'denied' ? 'verify-full' : lane]),
    // The hosted lane insists on its admission argument; none admitted keeps the probe's own gate out
    // of the catalog's host-gate check, and the mocked runner runs the probe regardless.
    ...(lane === 'verify-full-ci' ? ['--ci-host-gates', ''] : []),
  )
  await import('../../dev-cli-src/dev')
}
