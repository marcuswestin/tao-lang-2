import { Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { RunArtifacts } from '../dev-src/repository-tests/RunArtifacts'
import {
  buildSummary,
  classifyFailure,
  formatGateSummary,
  gateExitCode,
} from '../dev-src/repository-tests/RunSummary'
import { WorkGraph, type WorkNode, type WorkState } from '../dev-src/repository-tests/WorkGraph'

function finishedState(node: Partial<WorkNode> & { name: string }, outcome: Partial<WorkState> = {}): WorkState {
  return {
    ...WorkGraph.createState({ run: { args: [], command: 'true' }, ...node }),
    elapsedMs: 1_000,
    exitCode: 0,
    status: 'passed',
    ...outcome,
  }
}

Describe('versioned run summary', () => {
  Test('gives same-millisecond runs collision-proof stamps while allowing deterministic injection', () => {
    const first = RunArtifacts.locate({ lane: 'test', repositoryRoot: '/repo' })
    const second = RunArtifacts.locate({ lane: 'test', repositoryRoot: '/repo' })
    const injected = RunArtifacts.locate({ lane: 'test', repositoryRoot: '/repo', stamp: 'fixture-stamp' })

    Expect(first.stamp).not.toBe(second.stamp)
    Expect(first.stamp).toContain(`-${Platform.runtimeProcess.pid}-`)
    Expect(injected.stamp).toBe('fixture-stamp')
  })

  Test('records the lane and each node graph fact a later consumer schedules from', () => {
    const summary = buildSummary({
      elapsedMs: 4_200,
      expectedMs: name => (name === 'studio-canary' ? 30_000 : undefined),
      lane: 'full-verify',
      logRoot: '/repo/.artifacts/logs/full-verify/stamp',
      states: [
        finishedState({ name: 'studio-smoke-native', needs: ['_compile'], resources: ['gui'] }),
        finishedState({ name: 'studio-canary', resources: ['gui'] }),
      ],
    })

    Expect(summary.version).toBe(2)
    Expect(summary.lane).toBe('full-verify')
    Expect(summary.gates[0]?.needs).toEqual(['_compile'])
    Expect(summary.gates[0]?.resources).toEqual(['gui'])
    Expect(summary.gates[0]?.expectedMs).toBeUndefined()
    Expect(summary.gates[1]?.expectedMs).toBe(30_000)
  })

  Test('a node skipped by a failed dependency reports why, and never as passed', () => {
    const summary = buildSummary({
      elapsedMs: 900,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [
        finishedState({ name: '_compile' }, { exitCode: 1, fullOutput: 'compile blew up', status: 'failed' }),
        finishedState({ name: '_test', needs: ['_compile'] }, {
          elapsedMs: 0,
          exitCode: undefined,
          reason: 'dependency failed: _compile',
          status: 'skipped',
        }),
      ],
    })

    Expect(summary.gates.map(gate => gate.status)).toEqual(['failed', 'skipped'])
    Expect(summary.gates[1]?.reason).toBe('dependency failed: _compile')
    Expect(summary.firstFailure?.name).toBe('_compile')
    Expect(formatGateSummary(summary)).toContain('- _test: skipped — dependency failed: _compile')
    Expect(gateExitCode(summary)).toBe(1)
  })

  Test('an interrupted run fails even when nothing it managed to run failed', () => {
    const summary = buildSummary({
      elapsedMs: 500,
      interrupted: true,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [finishedState({ name: '_repo-lint' })],
    })

    Expect(summary.status).toBe('failed')
    Expect(gateExitCode(summary)).toBe(1)
  })

  Test('the rollup names both artifact paths an agent reads afterwards', () => {
    const summary = buildSummary({
      elapsedMs: 500,
      lane: 'verify',
      logRoot: '/repo/.artifacts/logs/verify/stamp',
      states: [finishedState({ name: '_repo-lint' })],
    })

    Expect(formatGateSummary(summary)).toContain('logs/verify/stamp')
    Expect(formatGateSummary(summary)).toContain('logs/verify/stamp/summary.json')
  })

  Test('a test-runner timeout under measured contention is not hidden by its FAIL banner', () => {
    const contention = { contended: true, cpuCount: 8, peakLanes: 2, peakLoadAverage: 12 }

    Expect(classifyFailure(
      'FAIL packages/example.test.ts\n(fail) renders\nerror: Test "renders" timed out after 5000ms',
      { contention },
    )).toBe('machine-contention')
  })

  Test('recognizes the native runtime exit messages emitted by Studio', () => {
    Expect(classifyFailure('Native Studio runtime exited with code 7.')).toBe('native-runtime-exit')
    Expect(classifyFailure('Native Studio runtime terminated by signal 6.')).toBe('native-runtime-exit')
  })

  Test('recognizes generated-tree cleanup failures imposed by the host', () => {
    Expect(classifyFailure(
      "EFAULT: bad address in system call argument, rm '/repo/packages/ide-extension/_gen_ide-extension/@tao'",
    )).toBe('sandbox-restriction')
    Expect(classifyFailure(
      "EPERM: operation not permitted, rmdir '/repo/packages/runtime-toolchain/.artifacts/tests/run/_gen_tao-app'",
    )).toBe('sandbox-restriction')
  })

  Test('keeps unrelated bad-address failures assigned to the repository', () => {
    Expect(classifyFailure("EFAULT: bad address in system call argument, read '/repo/Apps/HNReader/App.tao'"))
      .toBe('repository')
    Expect(classifyFailure("EFAULT: bad address in system call argument, rm '/repo/Apps/HNReader/App.tao'"))
      .toBe('repository')
  })
})
