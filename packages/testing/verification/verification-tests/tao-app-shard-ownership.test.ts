import { CLI, FS, Repo, Text } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import type { TimingsStore } from '../verification-src/RunTimings'
import { type SelectedSuite, TestNodes } from '../verification-src/TestNodes'
import { TestRunner } from '../verification-src/TestRunner'

const PARENT = 'Apps/Parent'
const NESTED = 'Apps/Parent/Nested'
const SIBLING = 'Apps/Sibling'
const PARENTISH = 'Apps/Parentish'
const TEST_PATHS = [
  `${PARENT}/App.test.tao`,
  `${NESTED}/App.test.tao`,
  `${SIBLING}/App.test.tao`,
  `${PARENTISH}/App.test.tao`,
] as const
const SOURCE_SIZES = new Map([
  [`${PARENT}/App.test.tao`, 100],
  [`${PARENT}/Main.tao`, 1_000],
  [`${NESTED}/App.test.tao`, 8_000],
  [`${NESTED}/Main.tao`, 10_000],
  [`${SIBLING}/App.test.tao`, 1_200],
  [`${SIBLING}/Main.tao`, 800],
  [`${PARENTISH}/App.test.tao`, 100],
  [`${PARENTISH}/Main.tao`, 100],
])
const EMPTY_LEDGER = { tests: {}, version: 1 } as const
const SUITE = 'tao-apps'

function timings(suiteMs: number): TimingsStore {
  return {
    nodes: {
      [SUITE]: {
        emaMs: suiteMs,
        lastMs: suiteMs,
        lastRunAt: '2026-10-05T00:00:00.000Z',
        samples: 1,
      },
    },
    version: 1,
  }
}

function nodePlan(selected: readonly SelectedSuite[], suiteMs: number) {
  return TestNodes.build({ ledger: EMPTY_LEDGER, selected, timings: timings(suiteMs) })
}

function ownedRoots(plan: ReturnType<typeof nodePlan>): string[][] {
  return plan.states.map(state => [...state.selectedTestFiles!])
}

Describe('Tao app shard ownership', () => {
  Test('discovers nested journeys once and keeps their cost in the recursive parent root', async () => {
    const root = await mkTestDir('tao-app-shard-ownership-')
    try {
      for (const [path, size] of SOURCE_SIZES) {
        const comment = `//${'x'.repeat(size - 3)}\n`
        await FS.writeText(FS.resolvePath(path, root), comment)
      }

      const discovered = await TestRunner.discoverTestSuites(
        { suites: new Set([SUITE]) },
        { verificationEnv: {} },
        root,
      )
      const suite = discovered.selected[0]!
      Expect(discovered.selected).toHaveLength(1)
      Expect(suite.name).toBe(SUITE)
      Expect(suite.files).toEqual(['Apps'])
      Expect(suite.shardUnits).toEqual([PARENT, PARENTISH, SIBLING])
      Expect(suite.estimationUnits).toEqual([PARENT, NESTED, PARENTISH, SIBLING])
      Expect(suite.unitCostMs).toEqual(
        new Map([
          [PARENT, 1_100],
          [NESTED, 18_000],
          [PARENTISH, 200],
          [SIBLING, 2_000],
        ]),
      )

      const single = nodePlan([suite], 7_999)
      Expect(single.states).toHaveLength(1)
      Expect(ownedRoots(single)).toEqual([[PARENT, PARENTISH, SIBLING]])

      const two = nodePlan([suite], 8_600)
      Expect(two.states).toHaveLength(2)
      Expect(ownedRoots(two)).toEqual([[PARENT], [PARENTISH, SIBLING]])

      const three = nodePlan([suite], 12_600)
      Expect(three.states).toHaveLength(3)
      Expect(ownedRoots(three)).toEqual([[PARENT], [SIBLING], [PARENTISH]])

      for (const plan of [single, two, three]) {
        const allOwned = plan.states.flatMap(state => state.selectedTestFiles ?? [])
        for (const path of TEST_PATHS) {
          Expect(allOwned.filter(rootPath => path.startsWith(`${rootPath}/`))).toHaveLength(1)
        }
        Expect(allOwned).not.toContain(NESTED)
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('normalizes overlapping explicit roots while retaining a child-only estimate and Apps selection', async () => {
    const root = await mkTestDir('tao-app-shard-selection-')
    try {
      for (const [path, size] of SOURCE_SIZES) {
        await FS.writeText(FS.resolvePath(path, root), `//${'x'.repeat(size - 3)}\n`)
      }

      const discover = (files: readonly string[], pattern = '') =>
        TestRunner.discoverTestSuites(
          { files: new Map([[SUITE, files]]), pattern, suites: new Set([SUITE]) },
          { verificationEnv: {} },
          root,
        )
      for (const kind of ['changed', 'file'] as const) {
        const overlapping = await TestRunner.discoverTestSuites(
          {
            files: new Map([[SUITE, [PARENT, NESTED, PARENT]]]),
            kind,
            suites: new Set([SUITE]),
          },
          {},
          root,
        )
        Expect(overlapping.selected[0]!.files).toEqual([PARENT])
      }

      const childOnly = await discover([NESTED])
      const childSuite = childOnly.selected[0]!
      Expect(childSuite.files).toEqual([NESTED])
      Expect(childSuite.estimationUnits).toEqual([PARENT, NESTED, PARENTISH, SIBLING])
      const childPlan = nodePlan([childSuite], 12_600)
      Expect(childPlan.states).toHaveLength(1)
      Expect(childPlan.states[0]!.expectedMs).toBe(Math.round(800 + 11_800 * (18_000 / 21_300)))
      Expect(ownedRoots(childPlan)).toEqual([[NESTED]])

      const parentOnly = await discover([PARENT])
      const parentPlan = nodePlan(parentOnly.selected, 12_600)
      Expect(parentPlan.states).toHaveLength(1)
      Expect(parentPlan.states[0]!.expectedMs).toBe(Math.round(800 + 11_800 * (19_100 / 21_300)))

      const appsRoot = await discover(['Apps'])
      Expect(appsRoot.selected[0]!.files).toEqual(['Apps'])
      Expect(appsRoot.selected[0]!.estimationUnits).toEqual([PARENT, NESTED, PARENTISH, SIBLING])

      const filtered = await discover([PARENT, SIBLING], 'matching journey')
      const filteredPlan = nodePlan(filtered.selected, 12_600)
      Expect(filteredPlan.states).toHaveLength(2)
      const args = filtered.selected[0]!.buildProcess('tao-apps', [PARENT, SIBLING], 1).args
      Expect(args).toEqual([
        'test',
        '--output',
        'lines',
        PARENT,
        SIBLING,
        '--name',
        'matching journey',
        '--pass-with-no-tests',
      ])
      const plannedRun = filteredPlan.states[0]!.node.run
      const plannedArgs = typeof plannedRun === 'function' ? plannedRun({ slots: 1 }).args : plannedRun.args
      Expect(plannedArgs).toContain('--name')
      Expect(plannedArgs).toContain('matching journey')
      Expect(plannedArgs).toContain('--pass-with-no-tests')
    } finally {
      await FS.remove(root)
    }
  })

  Test('executes each authored journey once across shard counts and scoped selections', async () => {
    const root = await mkTestDir('tao-app-shard-execution-')
    const handoff = FS.resolvePath('shared-run.json', root)
    const cases = [
      [PARENT, 'ShardParent'],
      [NESTED, 'ShardNested'],
      [SIBLING, 'ShardSibling'],
      [PARENTISH, 'ShardParentish'],
    ] as const
    const run = async (args: readonly string[]) => {
      const result = await CLI.run(Repo.resolvePath('tao'), {
        args: [...args],
        cwd: root,
        env: { TAO_HOME: FS.resolvePath('.tao', root), TAO_TEST_JOBS: '1' },
        stdio: 'pipe',
      })
      Expect({ exitCode: result.exitCode, output: result.exitCode === 0 ? '' : result.stdout + result.stderr })
        .toEqual({ exitCode: 0, output: '' })
      return Text.stripAnsi(result.stdout + result.stderr)
    }
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', root), '')
      for (const [directory, name] of cases) {
        await FS.writeText(
          FS.resolvePath(`${directory}/App.tao`, root),
          `
use Text from @tao/ui
app ${name} { id "${name.toLowerCase()}" version "1.0.0" name "${name}" view Main }
view Main() { render Text("${name}") }
`,
        )
        await FS.writeText(
          FS.resolvePath(`${directory}/App.test.tao`, root),
          `
use ${name} from ./
test "${name}" { test "runs" { run ${name} expect text "${name}" } }
`,
        )
      }
      await run(['test', '--shared-prepare', handoff, 'Apps'])
      const scopes = [
        {
          count: 1,
          files: undefined,
          ms: 7_999,
          pattern: '',
          expected: ['ShardNested', 'ShardParent', 'ShardParentish', 'ShardSibling'],
        },
        {
          count: 2,
          files: undefined,
          ms: 8_600,
          pattern: '',
          expected: ['ShardNested', 'ShardParent', 'ShardParentish', 'ShardSibling'],
        },
        {
          count: 3,
          files: undefined,
          ms: 12_600,
          pattern: '',
          expected: ['ShardNested', 'ShardParent', 'ShardParentish', 'ShardSibling'],
        },
        {
          count: 1,
          files: [PARENT, NESTED, PARENT],
          ms: 12_600,
          pattern: '',
          expected: ['ShardNested', 'ShardParent'],
        },
        { count: 1, files: [NESTED], ms: 12_600, pattern: '', expected: ['ShardNested'] },
        { count: 1, files: [PARENT], ms: 12_600, pattern: 'ShardNested', expected: ['ShardNested'] },
      ]
      for (const scope of scopes) {
        const selection = {
          ...(scope.files === undefined ? {} : { files: new Map([[SUITE, scope.files]]) }),
          pattern: scope.pattern,
          suites: new Set([SUITE]),
        }
        const { selected } = await TestRunner.discoverTestSuites(selection, {}, root)
        const plan = nodePlan(selected, scope.ms)
        Expect(plan.states).toHaveLength(scope.count)
        const executed: string[] = []
        for (const state of plan.states) {
          const process = selected[0]!.buildProcess(state.name, state.selectedTestFiles!, 1)
          const output = await run(['test', '--shared-run', handoff, ...process.args.slice(1)])
          const passed = [...output.matchAll(/✓ (Shard\w+) > runs /g)].map(match => match[1]!)
          Expect(passed.length).toBeGreaterThan(0)
          executed.push(...passed)
        }
        // Compare raw records, without deduplicating: a second nested execution must fail here.
        Expect(executed.toSorted()).toEqual(scope.expected)
      }
    } finally {
      if (await FS.isFile(handoff)) {
        await run(['test', '--shared-finalize', handoff])
      }
      await FS.remove(root)
    }
  })
})
