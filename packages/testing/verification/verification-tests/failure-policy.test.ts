import { FS, Repo } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import { FailurePolicy } from '../verification-src/FailurePolicy'
import { buildSummary, rollupSuites } from '../verification-src/RunSummary'
import { TaoAppSharedRun } from '../verification-src/TaoAppSharedRun'
import { TestLedger, type TestObservation } from '../verification-src/TestLedger'
import { type SelectedSuite, TestNodes } from '../verification-src/TestNodes'
import { type SuiteState, TestRunner } from '../verification-src/TestRunner'
import { WorkGraph } from '../verification-src/WorkGraph'

const LEXER = 'packages/language/parser/parser-tests/lexer.test.ts'
const SYNTAX = 'packages/language/parser/parser-tests/syntax-parse.test.ts'
const OTHER = 'packages/language/parser/parser-tests/other.test.ts'
const APP = 'packages/apps/expo-host/expo-host-tests/app.test.ts'
const HISTORY = { ledger: { tests: {}, version: 1 } as const, timings: { nodes: {}, version: 1 } as const }

function suite(name: string, files: readonly string[]): SelectedSuite {
  return { name, files, buildProcess: (_name, selected) => ({ command: 'unused', args: selected, files: selected }) }
}

Describe('verification failure policy', () => {
  Test('broad requests stop early while explicit diagnostic scopes collect failures', async () => {
    const root = Repo.getRoot()
    Expect((await TestRunner.prepareRun({ kind: 'full' }, root)).failurePolicy).toBe('fail-fast')
    Expect((await TestRunner.prepareRun({ kind: 'full', pattern: 'syntax' }, root)).failurePolicy).toBe('collect-all')
    Expect((await TestRunner.prepareRun({ kind: 'file', path: SYNTAX }, root)).failurePolicy).toBe('collect-all')
    Expect((await TestRunner.prepareRun({ kind: 'file', path: '.' }, root)).failurePolicy).toBe('fail-fast')
    Expect(FailurePolicy.forTests({ kind: 'changed' })).toBe('fail-fast')
    Expect(FailurePolicy.forTests({ kind: 'retry' })).toBe('collect-all')
    Expect(FailurePolicy.forTests({ kind: 'full', evidenceMode: 'mutation' })).toBe('collect-all')
  })

  Test('core files run once and a core failure prevents expensive app admission', async () => {
    const plan = TestNodes.build({
      ...HISTORY,
      preflight: true,
      selected: [suite('language/parser', [LEXER, OTHER, SYNTAX]), suite('apps/expo-host', [APP])],
    })
    Expect(plan.states.flatMap(state => state.selectedTestFiles ?? []).toSorted()).toEqual(
      [LEXER, OTHER, SYNTAX, APP].toSorted(),
    )
    Expect(plan.states.find(state => state.name === 'language/parser:core')?.selectedTestFiles).toEqual([LEXER, SYNTAX])
    const started: string[] = []
    const failure = FailurePolicy.create({
      observe: async () => {},
      policy: 'fail-fast',
      repositoryRoot: Repo.getRoot(),
      tests: [],
    })
    await WorkGraph.run([...plan.states], {
      jobs: 1,
      runNode: async state => {
        started.push(state.name)
        return { exitCode: state.name === 'language/parser:core' ? 1 : 0, output: 'core defect' }
      },
      stopOnFailure: failure.stopOnFailure,
      watchInterrupt: () => () => {},
    })
    Expect(started).toContain('language/parser:core')
    Expect(started).not.toContain('apps/expo-host')
    Expect(plan.states.find(state => state.name === 'apps/expo-host')?.status).toBe('skipped')
    Expect(TestRunner.completeRun({ kind: 'full', pattern: '' }, plan.states)).toBe(false)
  })

  Test('partial and targeted selections keep their scope without adding core files', () => {
    const partial = TestNodes.build({ ...HISTORY, preflight: true, selected: [suite('language/parser', [SYNTAX])] })
    Expect(partial.states.flatMap(state => state.selectedTestFiles ?? [])).toEqual([SYNTAX])
    const unrelated = TestNodes.build({ ...HISTORY, preflight: true, selected: [suite('apps/expo-host', [APP])] })
    Expect(unrelated.states[0]?.node.after).not.toContain('language/parser:core')
    const targeted = TestNodes.build({ ...HISTORY, selected: [suite('language/parser', [SYNTAX])] })
    Expect(targeted.states.map(state => state.name)).toEqual(['language/parser'])
  })

  Test('changing ordinary shard counts keeps core files partitioned exactly once', () => {
    const ordinary = [
      OTHER,
      'packages/language/parser/parser-tests/another.test.ts',
      'packages/language/parser/parser-tests/third.test.ts',
    ]
    const selected = [suite('language/parser', [LEXER, SYNTAX, ...ordinary])]
    for (const elapsedMs of [100, 20_000]) {
      const plan = TestNodes.build({
        ledger: HISTORY.ledger,
        preflight: true,
        selected,
        timings: {
          version: 1,
          nodes: {
            'language/parser': { emaMs: elapsedMs, lastMs: elapsedMs, lastRunAt: '2026-10-01T00:00:00Z', samples: 3 },
          },
        },
      })
      Expect(plan.states.flatMap(state => state.selectedTestFiles ?? []).toSorted()).toEqual(
        [LEXER, SYNTAX, ...ordinary].toSorted(),
      )
      Expect(plan.states.find(state => state.name === 'language/parser:core')?.selectedTestFiles).toEqual([
        LEXER,
        SYNTAX,
      ])
      Expect(plan.states.length).toBe(elapsedMs === 100 ? 2 : 4)
    }
  })

  Test('expensive apps wait for selected core work while unrelated tests run', async () => {
    const plan = TestNodes.build({
      ...HISTORY,
      preflight: true,
      selected: [suite('language/parser', [LEXER, OTHER]), suite('apps/expo-host', [APP])],
    })
    const coreDone = Deferred()
    const started: string[] = []
    const finished = WorkGraph.run([...plan.states], {
      jobs: 8,
      runNode: async state => {
        started.push(state.name)
        if (state.name === 'language/parser:core') {
          await coreDone.promise
        }
        return { exitCode: 0 }
      },
      watchInterrupt: () => () => {},
    })
    try {
      await until(() => started.includes('language/parser:core') && started.includes('language/parser#1'))
      await settle()
      Expect(started).not.toContain('apps/expo-host')
      coreDone.resolve()
      await finished
      Expect(started).toContain('apps/expo-host')
      const summary = buildSummary({
        elapsedMs: 1,
        lane: 'test',
        logRoot: '/unused',
        states: plan.states,
        suiteOf: name => plan.states.find(state => state.name === name)?.suite,
      })
      Expect(rollupSuites(summary.gates).map(gate => gate.name)).toEqual(['language/parser', 'apps/expo-host'])
    } finally {
      coreDone.resolve()
      await finished
    }
  })

  Test('unstarted Tao app work produces no test observations or complete-run evidence', async () => {
    const state = {
      ...WorkGraph.createState({ name: 'tao-apps', run: { command: 'unused', args: [] } }),
      suite: 'tao-apps',
      selectedTestFiles: ['Apps'],
    }
    Expect(await TestRunner.observationsFor([state], Repo.getRoot())).toEqual([])
    Expect(TestRunner.completeRun({ kind: 'full', pattern: '' }, [state])).toBe(false)
  })

  Test('an unconfirmed core timeout preserves admission for the other tests', async () => {
    const plan = TestNodes.build({
      ...HISTORY,
      preflight: true,
      selected: [suite('language/parser', [LEXER]), suite('apps/expo-host', [APP])],
    })
    const failure = FailurePolicy.create({
      observe: async () => {},
      policy: 'fail-fast',
      repositoryRoot: Repo.getRoot(),
      tests: plan.states,
    })
    const started: string[] = []
    await WorkGraph.run([...plan.states], {
      jobs: 1,
      stopOnFailure: failure.stopOnFailure,
      watchInterrupt: () => () => {},
      runNode: async state => {
        started.push(state.name)
        return state.name === 'language/parser:core'
          ? { exitCode: 1, output: 'timed out after 5000ms' }
          : { exitCode: 0 }
      },
    })
    Expect(started).toEqual(['language/parser:core', 'apps/expo-host'])
    Expect(plan.states[0]?.status).toBe('failed')
    Expect(plan.states[1]?.status).toBe('passed')
  })

  Test('a ledger-tolerated core flake keeps its raw failure without suppressing app coverage', async () => {
    const root = await mkTestDir('tao-core-flake-')
    try {
      await FS.writeText(FS.resolvePath(LEXER, root), 'unchanged test fixture')
      const observation = (outcome: TestObservation['outcome']): TestObservation => ({
        file: LEXER,
        suite: 'language/parser',
        name: 'lexes Tao',
        durationMs: 1,
        outcome,
      })
      for (const [index, outcome] of ['passed', 'failed', 'passed', 'failed'].entries()) {
        await TestLedger.recordRun({
          fullRun: false,
          observations: [observation(outcome as TestObservation['outcome'])],
          repositoryRoot: root,
          startedAt: index + 1,
        })
      }
      const plan = TestNodes.build({
        ...HISTORY,
        preflight: true,
        selected: [suite('language/parser', [LEXER]), suite('apps/expo-host', [APP])],
      })
      const failure = FailurePolicy.create({
        observe: async states => {
          for (const state of states) {
            ;(state as SuiteState).testObservations = [observation('failed')]
          }
        },
        policy: 'fail-fast',
        repositoryRoot: root,
        tests: plan.states,
      })
      const started: string[] = []
      await WorkGraph.run([...plan.states], {
        jobs: 1,
        stopOnFailure: failure.stopOnFailure,
        watchInterrupt: () => () => {},
        runNode: async state => {
          started.push(state.name)
          return { exitCode: state.name === 'language/parser:core' ? 1 : 0, output: 'controlled failure' }
        },
      })
      Expect(started).toEqual(['language/parser:core', 'apps/expo-host'])
      Expect(plan.states[0]?.status).toBe('failed')
      Expect(plan.states[1]?.status).toBe('passed')
    } finally {
      await FS.remove(root)
    }
  })

  Test('shared app preparation inherits the core ordering barrier', () => {
    const appSuite = { ...suite('tao-apps', ['Apps']), shardUnits: ['Apps/A', 'Apps/B'] }
    const plan = TestNodes.build({
      ...HISTORY,
      preflight: true,
      selected: [suite('language/parser', [LEXER]), appSuite],
    })
    const states = TaoAppSharedRun.attach(plan.states, '/unused', Repo.getRoot())
    Expect(states.find(state => state.name === 'tao-apps:prepare')?.node.after).toEqual(['language/parser:core'])
  })
})
