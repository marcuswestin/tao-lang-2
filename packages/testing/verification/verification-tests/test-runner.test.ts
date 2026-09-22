import { FS, Repo, TaoTestProtocol } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { FlakeTolerance } from '../verification-src/FlakeTolerance'
import { MachineLanes } from '../verification-src/MachineLanes'
import { TestLedger, type TestLedgerStore } from '../verification-src/TestLedger'
import { type SelectedSuite, TestNodes, type TestProcess } from '../verification-src/TestNodes'
import { TestResultSummary } from '../verification-src/TestResultSummary'
import { type SuiteState, TestRunner, type TestRunRequest } from '../verification-src/TestRunner'
import { WorkGraph } from '../verification-src/WorkGraph'
// The Jest bound lives in a CommonJS config Jest loads itself; it is read here so the three runners'
// ceilings are held together in one place.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const jestConfig = require('../../../apps/expo-host/jest.shared.config.cjs') as { MAX_JOURNEY_DEADLINE_MS: number }

/** An empty history: no recorded duration means no suite is sharded, so a node is named for its suite. */
const NO_HISTORY = { ledger: { tests: {}, version: 1 } as const, timings: { nodes: {}, version: 1 } as const }

type Suites = ReadonlyMap<string, SelectedSuite>

/** discover answers one selection from the real registry and returns the selected suites by name. */
async function discover(
  selection: Parameters<typeof TestRunner.discoverTestSuites>[0] = {},
  context: Parameters<typeof TestRunner.discoverTestSuites>[1] = {},
) {
  const result = await TestRunner.discoverTestSuites(selection, context)
  return { ...result, byName: new Map(result.selected.map(suite => [suite.name, suite])) as Suites }
}

/**
 * processOf builds the process one node would run for a suite: the node's own name, the files that
 * node owns, and the width the graph granted it. A suite builds a process for any subset of its
 * files, which is what makes sharding possible without the registry knowing shards exist.
 */
function processOf(
  suites: Suites,
  name: string,
  options: { files?: readonly string[]; nodeName?: string; slots?: number } = {},
): TestProcess {
  const suite = suites.get(name)
  Expect(suite).toBeDefined()
  return suite!.buildProcess(options.nodeName ?? name, options.files ?? suite!.files, options.slots ?? 1)
}

function argsOf(suites: Suites, name: string, options: Parameters<typeof processOf>[2] = {}): readonly string[] {
  return processOf(suites, name, options).args
}

/** nodesFor builds the nodes one run would schedule, over this checkout's real registry. */
async function nodesFor(request: TestRunRequest, reportRoot?: string) {
  const repositoryRoot = Repo.getRoot()
  const prepared = await TestRunner.prepareRun(request, repositoryRoot)
  const plan = await TestRunner.testNodesFor({ ...NO_HISTORY, prepared, reportRoot, repositoryRoot })
  return { ...plan, byName: new Map(plan.states.map(state => [state.name, state])) }
}

/** A finished test node, for the reporting assertions; only the report fields matter to them. */
function suiteState(name: string): SuiteState {
  const state = WorkGraph.createState({ name, run: { args: [], command: 'true' } }) as SuiteState
  state.suite = name
  return state
}

Describe('test runner suite registry', () => {
  Test('a name pattern filters every suite, including the Tao behavior suite', async () => {
    const { byName } = await discover({ pattern: 'one package only' })

    Expect(argsOf(byName, 'cli/dev-cli')).toContain('--pass-with-no-tests')
    Expect(argsOf(byName, 'cli/dev-cli')).toContain('--test-name-pattern=one package only')
    // A name that selects plenty in other suites normally selects nothing here, so the Tao suite is
    // told to pass on no match. Without that it would fail the whole run, which is why it used to
    // sit filtered runs out — and a run that skips it silently loses its Tao behavior coverage.
    Expect(argsOf(byName, 'tao-apps')).toContain('--name')
    Expect(argsOf(byName, 'tao-apps')).toContain('one package only')
    Expect(argsOf(byName, 'tao-apps')).toContain('--pass-with-no-tests')
  })

  Test('a name pattern narrows the scope that chose the suites instead of replacing it', async () => {
    const { byName } = await discover({
      files: new Map([['tao-apps', ['Apps/WordFlower']]]),
      kind: 'changed',
      pattern: 'one package only',
      suites: new Set(['cli/dev-cli', 'tao-apps']),
    })

    // `just test "<name>"` means the suites the diff reaches, filtered to that name. The scope still
    // decides which suites run — a pattern can only ever narrow the tests inside them.
    Expect([...byName.keys()].sort()).toEqual(['cli/dev-cli', 'tao-apps'])
    Expect(argsOf(byName, 'cli/dev-cli')).toContain('--test-name-pattern=one package only')
    Expect(argsOf(byName, 'cli/dev-cli')).toContain('--pass-with-no-tests')
    Expect(argsOf(byName, 'tao-apps')).toContain('--pass-with-no-tests')
  })

  Test('leaves the Tao behavior suite unfiltered when the run carries no pattern', async () => {
    const { byName } = await discover({
      files: new Map([['tao-apps', ['Apps/WordFlower']]]),
      kind: 'changed',
      suites: new Set(['tao-apps']),
    })

    // `--pass-with-no-tests` is how a filtered run says a miss is expected. An unfiltered run has no
    // such excuse: a scope that selected this suite and then found nothing to run is a real failure.
    Expect(argsOf(byName, 'tao-apps')).not.toContain('--pass-with-no-tests')
    Expect(argsOf(byName, 'tao-apps')).not.toContain('--name')
  })

  Test('only an unfiltered complete run counts as having observed every test', () => {
    // The retry ledger and the timings store both stand on this: a filtered run schedules every
    // suite but skips most of the tests inside them, so it can neither call a test green nor say
    // what a suite costs.
    Expect(TestRunner.completeRun({ kind: 'full', pattern: '' })).toBe(true)
    Expect(TestRunner.completeRun({ kind: 'full', pattern: 'one package only' })).toBe(false)
    Expect(TestRunner.completeRun({ kind: 'changed', pattern: '' })).toBe(false)
  })

  Test('gives concurrent process-heavy developer tests a contention-safe timeout', async () => {
    const { byName } = await discover()

    Expect(argsOf(byName, 'cli/dev-cli')).toContain('--concurrent')
    Expect(argsOf(byName, 'cli/dev-cli')).toContain(`--timeout=${TestRunner.MAX_TEST_DEADLINE_MS}`)
    // A suite that chose its own bound keeps exactly that one: a second `--timeout` would leave
    // which bound is in force up to Bun's argument precedence rather than to this table.
    Expect(argsOf(byName, 'cli/dev-cli').filter(argument => argument.startsWith('--timeout='))).toHaveLength(1)
  })

  // Under `--concurrent` Bun starts every test in the file at once and reports each one's duration
  // as the time from that shared start, so the number a per-test budget would bound describes the
  // process rather than the test: one validator file measured a 1.8s minimum and a 4.9s median for
  // tests that take about 50ms alone, and the slowest reached 7.5s and was killed. Stretching the
  // budget by load cannot fix a number that was never about one test, so a concurrent suite gets
  // the hang guard and the budget keeps its job where a duration really is one test's own.
  Test('bounds a concurrent suite by the hang guard and a serial one by the work budget', async () => {
    const { byName } = await discover()
    const timeoutOf = (suite: string) =>
      Number(
        argsOf(byName, suite).find(argument => argument.startsWith('--timeout='))?.slice('--timeout='.length),
      )

    Expect(argsOf(byName, 'language/validator')).toContain('--concurrent')
    Expect(timeoutOf('language/validator')).toBe(TestRunner.MAX_TEST_DEADLINE_MS)
    Expect(timeoutOf('cli/dev-cli')).toBe(TestRunner.MAX_TEST_DEADLINE_MS)
    // A suite whose tests run one at a time keeps the budget, which is what catches a regression.
    Expect(argsOf(byName, 'shared')).not.toContain('--concurrent')
    Expect(timeoutOf('shared')).toBeLessThanOrEqual(TestRunner.MAX_TEST_DEADLINE_MS)
    Expect(timeoutOf('shared')).toBeGreaterThan(0)
  })

  Test('keeps the node idle bound clear of the longest a single test may be silent', () => {
    // A gate lane reports to a file, so a healthy suite prints nothing between tests and a test
    // spending its whole deadline is indistinguishable from a stalled one. Raising the per-test
    // deadline past half the idle floor would start killing suites that were only slow, and the
    // two constants live in modules that cannot import each other — so they are held together here.
    Expect(TestNodes.IDLE_TIMEOUT_FLOOR_MS).toBeGreaterThanOrEqual(TestRunner.MAX_TEST_DEADLINE_MS * 2)
    // The bounds nest, inside out: a Jest journey inside a Bun test inside a node. Each outer bound
    // sits strictly above the one it contains, so whatever hangs is named by the nearest bound and
    // not swallowed by the one around it; the wall bound is armed before the process even spawns.
    Expect(jestConfig.MAX_JOURNEY_DEADLINE_MS).toBeLessThan(TestRunner.MAX_TEST_DEADLINE_MS)
    Expect(TestNodes.WALL_TIMEOUT_FLOOR_MS).toBeGreaterThan(TestNodes.IDLE_TIMEOUT_FLOOR_MS)
  })

  Test('weighs Tao app shards by the source they compile, not by how many journeys they hold', async () => {
    const { byName } = await discover()
    const costs = byName.get('tao-apps')?.unitCostMs

    Expect(costs).toBeDefined()
    const wordFlower = costs?.get('Apps/WordFlower/1 - Current') ?? 0
    const navigation = costs?.get('Apps/Test Apps/Navigation') ?? 0
    Expect(wordFlower).toBeGreaterThan(0)
    Expect(navigation).toBeGreaterThan(0)
    // Counting journeys read WordFlower's six `.test.tao` files as lighter than Navigation's seven,
    // so the balancer packed 2,462 lines beside four more apps into the shard that then measured
    // 51.3s while seven small apps finished together in 14.2s. Compiling the source is where that
    // time goes, so the heavier app has to weigh more than the one with more journeys.
    Expect(wordFlower).toBeGreaterThan(navigation)
    // An app's own sources are compiled with it, so a unit's weight includes what sits beneath it.
    Expect(wordFlower).toBeGreaterThan(
      (await FS.readText(Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao'))).length,
    )
  })

  // `validator` is tuned `--concurrent` (like `dev`) and stays shardable; `shared` is neither. A
  // `--concurrent` suite's per-file ledger sums are inflated by however many other tests in the file
  // finished after the one being measured (see the `--concurrent` timeout test above), not by real
  // work, so packing by them would weigh a file wrong in exactly the suites this catches.
  Test('ignores stale per-file ledger costs when packing a suite tuned --concurrent', async () => {
    const files = [
      'packages/demo/demo-tests/a.test.ts',
      'packages/demo/demo-tests/b.test.ts',
      'packages/demo/demo-tests/c.test.ts',
      'packages/demo/demo-tests/d.test.ts',
    ]
    const skewedLedgerFor = (suite: string) => {
      const tests: TestLedgerStore['tests'] = {}
      // File `a` alone outweighs the other three combined — if honored, it packs onto its own shard.
      const durations: Record<string, number> = {
        'a.test.ts': 100_000,
        'b.test.ts': 10,
        'c.test.ts': 10,
        'd.test.ts': 10,
      }
      for (const file of files) {
        const id = `${suite}::${file}::only`
        tests[id] = {
          durationMs: durations[file.split('/').at(-1)!],
          file,
          fileIdentity: `identity-${file}`,
          id,
          lastRunAt: '2026-01-01T00:00:00.000Z',
          name: 'only',
          outcome: 'passed',
          suite,
        }
      }
      return { tests, version: 1 as const }
    }
    const buildProcess: SelectedSuite['buildProcess'] = (_name, units) => ({ args: [], command: 'true', files: units })
    // 8_600ms measured less the 600ms default startup is 8_000ms of work: two shards at the 4.0s
    // target, well clear of both the sharding floor and the startup cap.
    const timings = {
      nodes: {
        shared: {
          emaMs: 8_600,
          lastMs: 8_600,
          lastRunAt: '2026-01-01T00:00:00.000Z',
          samples: 1,
          source: 'wall' as const,
        },
        'language/validator': {
          emaMs: 8_600,
          lastMs: 8_600,
          lastRunAt: '2026-01-01T00:00:00.000Z',
          samples: 1,
          source: 'wall' as const,
        },
      },
      version: 1 as const,
    }

    const concurrentPlan = TestNodes.build({
      ledger: skewedLedgerFor('language/validator'),
      selected: [{ buildProcess, files, name: 'language/validator' }],
      timings,
    }).plans.find(plan => plan.suite === 'language/validator')
    const serialPlan = TestNodes.build({
      ledger: skewedLedgerFor('shared'),
      selected: [{ buildProcess, files, name: 'shared' }],
      timings,
    }).plans.find(plan => plan.suite === 'shared')

    Expect(concurrentPlan?.shards.length).toBe(2)
    Expect(serialPlan?.shards.length).toBe(2)
    // Ignored: the mean-cost fallback splits four equally-weighted files two and two.
    Expect(concurrentPlan?.shards.map(shard => shard.length).toSorted()).toEqual([2, 2])
    // Honored: file `a`'s 100_000ms dwarfs the rest, so it packs alone against the other three.
    Expect(serialPlan?.shards.map(shard => shard.length).toSorted()).toEqual([1, 3])
  })

  // The package restructure renamed every suite at once. Each one lost the recorded duration held
  // under its old name, so each ran as a single process, and the lane reported an ordinary green
  // while running at a fraction of the machine. Nothing said a word for hours.
  Test('says so when a suite runs whole because its recorded duration is under another name', () => {
    const buildProcess: SelectedSuite['buildProcess'] = (_name, units) => ({ args: [], command: 'true', files: units })
    const files = Array.from({ length: 12 }, (_, index) => `packages/demo/demo-tests/f${index}.test.ts`)
    const noHistory = { nodes: {}, version: 1 as const }

    const plan = TestNodes.build({
      ledger: { tests: {}, version: 1 as const },
      selected: [{ buildProcess, files, name: 'cli/tao-cli' }],
      timings: noHistory,
    })

    Expect(plan.plans[0]?.shards.length).toBe(1)
    Expect(plan.warnings).toHaveLength(1)
    Expect(plan.warnings[0]).toContain('cli/tao-cli')
    Expect(plan.warnings[0]).toContain('12 units')
  })

  // A small suite running whole is ordinary, and a warning on every one of them is a warning nobody
  // reads. Only a suite big enough to have been split is worth the line.
  Test('stays quiet about a suite too small to have been sharded anyway', () => {
    const buildProcess: SelectedSuite['buildProcess'] = (_name, units) => ({ args: [], command: 'true', files: units })

    const plan = TestNodes.build({
      ledger: { tests: {}, version: 1 as const },
      selected: [{
        buildProcess,
        files: ['packages/demo/demo-tests/a.test.ts', 'packages/demo/demo-tests/b.test.ts'],
        name: 'demo',
      }],
      timings: { nodes: {}, version: 1 as const },
    })

    Expect(plan.warnings).toEqual([])
  })

  Test('gives a suite that declares no bound one work-denominated timeout', async () => {
    const { byName } = await discover()

    // Bun's per-test deadline is wall time, so leaving it at the five-second default makes the
    // judgment depend on how busy the machine is rather than on what the test did. Studio is the
    // suite that exposed it: its client bundle measures 1.4s alone and was killed at 5s beside
    // three other lanes. Every Bun suite therefore carries an explicit bound.
    const bounds = argsOf(byName, 'ides/studio').filter(argument => argument.startsWith('--timeout='))
    Expect(bounds).toHaveLength(1)
    Expect(Number(bounds[0]?.slice('--timeout='.length))).toBeGreaterThanOrEqual(45_000)
  })

  Test('spends the per-test budget on work, and stretches the deadline only while the machine is loaded', () => {
    const { starvationAdjustedTimeoutMs } = TestRunner

    // A machine this run has to itself keeps the fixed budget, so a test that genuinely regresses
    // is still caught. This is the case a flat two-minute bound gives up.
    Expect(starvationAdjustedTimeoutMs(2, 18)).toBe(45_000)
    Expect(starvationAdjustedTimeoutMs(9, 18)).toBe(45_000)
    // The run that motivated this: load 41.1 on 18 CPUs, where the killed test had run 3.7x slower
    // than in isolation. The raised floor times that multiple is past the ceiling, so what the suite
    // actually gets here is the ceiling itself rather than the scaled multiple.
    Expect(starvationAdjustedTimeoutMs(41.1, 18)).toBe(TestRunner.MAX_TEST_DEADLINE_MS)
    // Past the ceiling the deadline stops distinguishing a starved test from a hung one.
    Expect(starvationAdjustedTimeoutMs(1_000, 18)).toBe(120_000)
  })

  Test('names every Bun test file absolutely, so the runner never walks the repository to find it', async () => {
    const { byName } = await discover()

    // Bun reads a bare relative path as a filter and walks the whole tree to resolve it, leaving a
    // descriptor open per visited entry; children spawned by a test then inherit an exhausted
    // table and their piped output never arrives. An absolute path is taken literally.
    const files = argsOf(byName, 'cli/dev-cli').filter(argument => argument.endsWith('.test.ts'))
    Expect(files.length).toBeGreaterThan(0)
    Expect(files.every(file => file.startsWith('/'))).toBe(true)
    Expect(
      argsOf(byName, 'performance-checks').some(argument =>
        argument.endsWith('/packages/cli/dev-cli/performance-checks/language-performance.test.ts')
      ),
    ).toBe(true)
  })

  Test('holds the Jest suite to the slots it was granted instead of letting it size to the machine', async () => {
    const { byName } = await discover()

    // Jest defaults to `cpuCount - 1` workers. Inside a three-slot reservation that fills the
    // machine on its own, and on a machine already shared with another worktree it fills it twice.
    Expect(argsOf(byName, 'runtime-jest', { slots: 3 })).toContain('--maxWorkers=3')
    Expect(argsOf(byName, 'runtime-jest', { slots: 1 })).toContain('--maxWorkers=1')
    Expect(argsOf(byName, 'runtime-jest', { slots: 1 })).toContain('--no-watchman')
  })

  Test('narrows the Jest child to the slots actually admitted after another lane joins', async () => {
    const { byName } = await nodesFor({ kind: 'full' })
    const run = byName.get('runtime-jest')?.node.run

    // The node's command is built after admission, so a narrowed grant reaches the child rather
    // than the width the catalog hoped for.
    Expect(typeof run).toBe('function')
    if (typeof run !== 'function') {
      return
    }
    Expect(run({ slots: 1 }).args).toContain('--maxWorkers=1')
    Expect(run({ slots: 2 }).args).toContain('--maxWorkers=2')
  })

  Test('names every structured report after the node that writes it, so two shards cannot collide', async () => {
    const { byName } = await discover({}, { reportRoot: '/tmp/test-reports' })

    Expect(argsOf(byName, 'cli/dev-cli')).toContain('--reporter=junit')
    Expect(argsOf(byName, 'cli/dev-cli')).toContain('--reporter-outfile=/tmp/test-reports/cli_dev-cli.xml')
    Expect(argsOf(byName, 'runtime-jest')).toContain('--json')
    Expect(argsOf(byName, 'runtime-jest')).toContain('--outputFile=/tmp/test-reports/runtime-jest.json')

    // Two shards of one suite run at once. A path named for the suite would have each overwrite the
    // other's results, and the run would then read a report that describes half of what it ran.
    const first = processOf(byName, 'cli/dev-cli', { nodeName: 'dev#1' })
    const second = processOf(byName, 'cli/dev-cli', { nodeName: 'dev#2' })
    Expect(first.args).toContain('--reporter-outfile=/tmp/test-reports/dev_1.xml')
    Expect(second.args).toContain('--reporter-outfile=/tmp/test-reports/dev_2.xml')
    Expect(first.testReport?.path).not.toBe(second.testReport?.path)
    // The report still says which suite it belongs to, so the ledger records per-suite outcomes.
    Expect(first.testReport?.suite).toBe('cli/dev-cli')
    Expect(processOf(byName, 'runtime-jest', { nodeName: 'runtime-jest#2' }).args)
      .toContain('--outputFile=/tmp/test-reports/runtime-jest_2.json')
  })

  Test('builds a process for any subset of a suite files, which is what a shard runs', async () => {
    const { byName } = await discover()
    const all = byName.get('cli/dev-cli')?.files ?? []
    const subset = all.slice(0, 2)

    Expect(subset.length).toBe(2)
    const shard = processOf(byName, 'cli/dev-cli', { files: subset, nodeName: 'dev#1' })
    Expect(shard.files).toEqual(subset)
    Expect(shard.args.filter(argument => argument.endsWith('.test.ts'))).toHaveLength(2)
    Expect(processOf(byName, 'cli/dev-cli').args.filter(argument => argument.endsWith('.test.ts')))
      .toHaveLength(all.length)
  })

  Test('a suite plan keeps only the named suites and hands the Tao Apps suite its roots', async () => {
    const { byName, selected } = await discover({
      files: new Map([['tao-apps', ['Apps/WordFlower']]]),
      kind: 'changed',
      suites: new Set(['cli/dev-cli', 'runtime-jest', 'tao-apps']),
    })

    Expect(selected.map(suite => suite.name)).toEqual(['cli/dev-cli', 'runtime-jest', 'tao-apps'])
    // Whole suites run in full: neither runner is asked to narrow by Git, because Bun's
    // `--changed` stops at the package boundary and Jest ignores `--changedSince` beside paths.
    Expect(argsOf(byName, 'cli/dev-cli').some(argument => argument.startsWith('--changed'))).toBe(false)
    Expect(argsOf(byName, 'cli/dev-cli')).not.toContain('--pass-with-no-tests')
    Expect(argsOf(byName, 'runtime-jest').some(argument => argument.startsWith('--changedSince'))).toBe(false)
    Expect(argsOf(byName, 'tao-apps')).toEqual(['test', 'Apps/WordFlower'])
    Expect(byName.get('tao-apps')?.files).toEqual(['Apps/WordFlower'])
  })

  Test('exact files run only their own suites, over only those files', async () => {
    const file = 'packages/shared/shared-tests/shared.test.ts'
    const { byName, selected } = await discover({
      files: new Map([['shared', [file]]]),
      kind: 'file',
      suites: new Set(['shared']),
    })

    Expect(selected.map(suite => suite.name)).toEqual(['shared'])
    Expect(byName.get('shared')?.files).toEqual([file])
    Expect(argsOf(byName, 'shared').filter(argument => argument.endsWith('.test.ts'))).toHaveLength(1)
  })

  Test('the complete run tests every app and the inventory names every suite it would run', async () => {
    const { byName, selected } = await discover()
    const inventory = await TestRunner.suiteInventory()

    Expect(argsOf(byName, 'tao-apps')).toEqual(['test', 'Apps'])
    Expect(inventory.packageSuites).toContain('cli/dev-cli')
    Expect(inventory.packageSuites).toContain('cli/agent-cli')
    Expect(inventory.packageSuites).toContain('shared')
    Expect(inventory.hasRuntimeJest).toBe(true)
    const expected = [...inventory.packageSuites, 'performance-checks', 'runtime-jest', 'tao-apps'].sort()
    Expect(selected.map(suite => suite.name).sort()).toEqual(expected)
  })

  Test('carries each suite declared width onto the node the graph schedules', async () => {
    const { byName } = await nodesFor({ kind: 'full' })

    // The widths belong to the catalog, but they only mean anything once they reach a node: this is
    // where a suite renamed in the registry silently loses its reservation.
    Expect(byName.get('tao-apps')?.node.cost).toBe(8)
    Expect(byName.get('tao-apps')?.node.priority).toBe(5)
    Expect(byName.get('runtime-jest')?.node.cost).toBe(3)
    Expect(byName.get('apps/expo-host')?.node.cost).toBe(2)
    // An untuned Bun suite is one unsharded process that cannot use more than one core, so it
    // reserves one slot and the scheduler packs the rest of the run around it.
    Expect(byName.get('language/parser')?.node.cost).toBeUndefined()
    Expect(byName.get('language/parser')?.node.serial).toBe(true)
    // A suite that declares a width is not serial: it says so precisely because one of its
    // processes uses more than one core, which is what the reservation is for.
    Expect(byName.get('cli/dev-cli')?.node.cost).toBe(2)
    Expect(byName.get('cli/dev-cli')?.node.serial).toBe(false)
    Expect(byName.get('tao-apps')?.node.serial).toBe(false)
    // Every node is bounded, so no runaway can hold a lane open for three quarters of an hour.
    Expect(byName.get('cli/dev-cli')?.node.timeoutMs).toBeGreaterThan(0)
    Expect(byName.get('cli/dev-cli')?.node.idleTimeoutMs).toBeGreaterThan(0)
  })

  Test('gives each node the edges its suite reads imply, and never the Justfile formatter', async () => {
    const { byName } = await nodesFor({ kind: 'full' })

    // A test node runs its runner directly, so it does not parse the Justfile on its way up.
    Expect(byName.get('cli/dev-cli')?.node.needs).toContain('_compile-word-flower-app')
    Expect(byName.get('cli/dev-cli')?.node.needs).toContain('_fix-tao')
    Expect(byName.get('cli/dev-cli')?.node.needs).not.toContain('_fix-just-fmt')
    // stdlib references no `.tao` source, no app, and no generated tree, so it waits for dprint alone.
    Expect(byName.get('apps/stdlib')?.node.needs).toEqual(['_fix-dprint'])
  })

  Test('a name-filter run fails only when reporter metadata proves zero tests executed', () => {
    const states = [suiteState('cli/dev-cli'), suiteState('runtime-jest')]
    for (const state of states) {
      state.status = 'passed'
      state.testObservations = []
    }

    Expect(TestRunner.noTestsMatched('a name nothing has', [], states)).toBe(true)
    Expect(TestRunner.noTestsMatched('a name nothing has', [{
      file: 'packages/dev/dev-tests/example.test.ts',
      name: 'not selected',
      outcome: 'skipped',
      suite: 'cli/dev-cli',
    }], states)).toBe(true)
    states[0]!.testReport = { format: 'bun-junit', path: '/missing.xml', suite: 'cli/dev-cli' }
    states[0]!.testObservations = undefined
    Expect(TestRunner.noTestsMatched('a name nothing has', [{
      file: 'packages/apps/expo-host/expo-host-tests/example.jest-test.ts',
      name: 'not selected',
      outcome: 'skipped',
      suite: 'runtime-jest',
    }], states)).toBe(false)
    // An unfiltered run has no pattern to have matched nothing, whatever scope chose its suites.
    Expect(TestRunner.noTestsMatched('', [], states)).toBe(false)
  })

  // A process that crashed or timed out named no test, so nothing about it can have earned
  // tolerance — and `FlakeTolerance` refuses to demote a failure by that exact name. The runner
  // writes the name and that module reads it; the two agreeing is the whole of the rule, and they
  // live in modules that never read each other's source.
  Test('names a whole-process failure what the tolerance rule refuses to demote', async () => {
    const crashed = suiteState('shared')
    crashed.status = 'failed'
    crashed.selectedTestFiles = ['packages/shared/shared-tests/shared.test.ts']

    const observations = await TestRunner.observationsFor([crashed], Repo.getRoot())

    Expect(observations).toHaveLength(1)
    Expect(observations[0]?.name).toBe(FlakeTolerance.PROCESS_STAND_IN_NAME)
    Expect(observations[0]?.outcome).toBe('failed')
  })

  // The Tao behavior suite writes no per-test report, so the runner fabricates one observation for
  // it. That stand-in is the only thing the guard above sees from this suite, and `tao test` is
  // handed `--pass-with-no-tests` so that an empty `--name` selection exits zero — so a stand-in
  // recorded `passed` on the exit code alone would disable the guard for every filtered run, which
  // is every run the guard exists for.
  Test('the Tao behavior suite reports skipped when it says it matched no journey', async () => {
    const matchedNothing = suiteState('tao-apps')
    matchedNothing.status = 'passed'
    matchedNothing.selectedTestFiles = ['Apps']
    matchedNothing.fullOutput = 'No Tao test journey matches --name "a name nothing has". '
      + `Searched 41 journeys under Apps; ${TaoTestProtocol.NO_JOURNEYS_MATCHED}.\n`

    const ranSomething = suiteState('tao-apps')
    ranSomething.status = 'passed'
    ranSomething.selectedTestFiles = ['Apps']
    ranSomething.fullOutput = 'Selected 2 of 41 Tao journeys\ntest suites ok\n'

    Expect((await TestRunner.observationsFor([matchedNothing], Repo.getRoot()))[0]?.outcome).toBe('skipped')
    Expect((await TestRunner.observationsFor([ranSomething], Repo.getRoot()))[0]?.outcome).toBe('passed')

    // And the guard, which is what the outcome is for: a whole run in which nothing matched. The
    // Bun suite reported for itself and found nothing, the Tao suite says it matched no journey,
    // and the union of the two is what the guard reads.
    const bun = suiteState('cli/dev-cli')
    bun.status = 'passed'
    bun.testObservations = []
    const observations = await TestRunner.observationsFor([matchedNothing], Repo.getRoot())

    Expect(TestRunner.noTestsMatched('a name nothing has', observations, [bun, matchedNothing])).toBe(true)
    Expect(
      TestRunner.noTestsMatched('a name nothing has', [
        ...await TestRunner.observationsFor([ranSomething], Repo.getRoot()),
      ], [bun, ranSomething]),
    ).toBe(false)
  })

  // `dev` is tuned `--concurrent` and `shared` is not (see `test('gives concurrent process-heavy
  // developer tests a contention-safe timeout')` above), so the same reporter output means something
  // different for each: `dev`'s per-case `time` is the file's shared start to that test's own
  // completion, never the test's own work, where `shared`'s is the test's own duration outright.
  Test('drops a per-case duration for a suite tuned --concurrent and keeps it where a test runs alone', async () => {
    const reportRoot = await mkTestDir('tao-test-report-')
    const reportPath = FS.resolvePath('report.xml', reportRoot)
    await FS.writeText(
      reportPath,
      '<testsuites tests="1"><testsuite>'
        + '<testcase classname="d" file="packages/dev/dev-tests/example.test.ts" name="t" time="6.2027"></testcase>'
        + '</testsuite></testsuites>',
    )
    try {
      const concurrentState = suiteState('cli/dev-cli')
      concurrentState.status = 'passed'
      concurrentState.testReport = { format: 'bun-junit', path: reportPath, suite: 'cli/dev-cli' }
      const serialState = suiteState('shared')
      serialState.status = 'passed'
      serialState.testReport = { format: 'bun-junit', path: reportPath, suite: 'shared' }

      const observations = await TestRunner.observationsFor([concurrentState, serialState], Repo.getRoot())

      Expect(observations.find(observation => observation.suite === 'cli/dev-cli')?.durationMs).toBeUndefined()
      Expect(observations.find(observation => observation.suite === 'shared')?.durationMs).toBe(6_202.7)
    } finally {
      await FS.remove(reportRoot)
    }
  })

  Test('a filter that matched somewhere passes, however many suites it matched nothing in', () => {
    // The question is asked of the whole run, not of each suite. A Bun test name never matches a
    // Jest test or a Tao journey, so a suite finding nothing is the ordinary case: failing on it
    // would make `just test "<a real bun test>"` red for every other suite doing the right thing.
    const states = [suiteState('cli/dev-cli'), suiteState('runtime-jest')]
    for (const state of states) {
      state.status = 'passed'
      state.testObservations = []
    }
    const matchedInOneSuite = [
      {
        file: 'packages/dev/dev-tests/example.test.ts',
        name: 'the one match',
        outcome: 'passed' as const,
        suite: 'cli/dev-cli',
      },
      {
        file: 'packages/apps/expo-host/expo-host-tests/example.jest-test.ts',
        name: 'not selected',
        outcome: 'skipped' as const,
        suite: 'runtime-jest',
      },
    ]

    Expect(TestRunner.noTestsMatched('the one match', matchedInOneSuite, states)).toBe(false)
    // And the same suites with nothing matched anywhere is the typo the rule exists to catch.
    Expect(TestRunner.noTestsMatched('the one match', [matchedInOneSuite[1]!], states)).toBe(true)
  })

  Test('routes exact Bun and runtime Jest files to their owning suites', async () => {
    Expect((await TestRunner.testFile('packages/shared/shared-tests/shared.test.ts')).suite).toBe('shared')
    Expect(
      (await TestRunner.testFile(
        'packages/apps/expo-host/expo-host-tests/navigation-e2e.jest-test.tsx',
      )).suite,
    ).toBe('runtime-jest')
  })

  Test('an exact-file subset does not teach the full-suite timing estimate', async () => {
    const root = await mkTestDir('tao-test-runner-subset-timing-')
    const file = 'packages/example/example-tests/example.test.ts'
    // This starts a real top-level lane, which would otherwise register in the machine-wide
    // registry and wait on whatever the other worktrees on this host are doing — including a peer's
    // exclusive confirmation. Give it a test-owned registry instead of changing the process
    // environment shared by concurrent tests.
    try {
      await FS.writeText(
        FS.resolvePath(file, root),
        `import { expect, test } from '${['bun', 'test'].join(':')}'\ntest('passes', () => expect(1).toBe(1))\n`,
      )
      const captured = await withCapturedOutput(() =>
        TestRunner.runTestRequest({ kind: 'file', path: file }, {
          jobs: 1,
          outputMode: 'quiet',
          registryRoot: FS.resolvePath('machine-lanes', root),
          repositoryRoot: root,
        })
      )

      Expect(captured.result).toBe(0)
      Expect(await FS.exists(FS.resolvePath('.artifacts/timings/durations.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('report-test-stats', () => {
  function ledgerRecord(
    suite: string,
    name: string,
    file: string,
    durationMs: number | undefined,
  ): TestLedgerStore['tests'][string] {
    const id = `${suite}::${file}::${name}`
    return {
      durationMs,
      file,
      fileIdentity: 'identity',
      id,
      lastRunAt: '2026-01-01T00:00:00.000Z',
      name,
      outcome: 'passed',
      suite,
    }
  }

  // `dev` is tuned `--concurrent`; a record left over from before this change still carries a
  // per-case duration that was never one test's own. Filtering the "Slowest tests" output by suite,
  // rather than trusting every such record to already be gone, is what still catches it.
  Test('drops a stale --concurrent per-case duration and keeps a real one', async () => {
    const root = await mkTestDir('tao-report-test-stats-')
    try {
      const store: TestLedgerStore = {
        tests: {
          [`cli/dev-cli::packages/dev/dev-tests/example.test.ts::stale`]: ledgerRecord(
            'cli/dev-cli',
            'stale',
            'packages/dev/dev-tests/example.test.ts',
            6_202.7,
          ),
          [`shared::packages/shared/shared-tests/shared.test.ts::real`]: ledgerRecord(
            'shared',
            'real',
            'packages/shared/shared-tests/shared.test.ts',
            12.5,
          ),
        },
        version: 1,
      }
      await FS.writeJson(FS.resolvePath(TestLedger.LEDGER_PATH, root), store)

      const captured = await withCapturedOutput(() => TestRunner.printSlowest(20, root))

      Expect(captured.stdout).toContain('real')
      Expect(captured.stdout).not.toContain('stale')
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('test lane reporting on a shared machine', () => {
  const shared = MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 3, peakLoadAverage: 44 })

  async function report(state: SuiteState, contention = shared): Promise<string> {
    const captured = await withCapturedOutput(() => {
      TestResultSummary.printResultSummary([state], 1_000, { contention })
    })
    return `${captured.stdout}${captured.stderr}`
  }

  Test('names the contention and how to confirm a suite that ran out of time', async () => {
    const state = suiteState('validator')
    state.status = 'failed'
    state.exitCode = 1
    state.fullOutput = 'error: Test "resolves imports" timed out after 5000ms'

    const output = await report(state)

    Expect(output).toContain('Machine contention: 3 Tao lanes ran at once; load peaked at 44.0 on 18 CPUs.')
    Expect(output).toContain('validator ran out of time under that load')
    Expect(output).toContain('once the machine is quiet')
  })

  Test('says a suite only passed because it was run again on its own', async () => {
    const state = suiteState('runtime-jest')
    state.status = 'passed'
    state.retried = true
    state.reason = 'timed out under machine contention; passed on an isolated retry'

    Expect(await report(state)).toContain('passed on an isolated retry')
  })

  Test('uses process output counts when a native report is unavailable', async () => {
    const state = suiteState('cli/dev-cli')
    state.status = 'passed'
    state.fullOutput = ' 3 pass\n 0 fail\n 7 expect() calls\nRan 3 tests across 1 file.\n'

    const output = await report(state)

    Expect(output).toContain('tests 3; pass 3; fail 0; expect 7')
    Expect(output).not.toContain('tests 0; pass 0')
  })

  Test('does not repeat manual timeout advice after an isolated retry already ran', async () => {
    const state = suiteState('validator')
    state.status = 'failed'
    state.retried = true
    state.reason = 'timed out under machine contention and failed again on an isolated retry'
    state.fullOutput = 'timed out after 5000ms again'

    const output = await report(state)

    Expect(output).toContain('failed again on an isolated retry')
    Expect(output).not.toContain('Confirm it alone')
  })

  Test('says nothing at all about a machine this run had to itself', async () => {
    const state = suiteState('validator')
    state.status = 'passed'
    const quiet = MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 1, peakLoadAverage: 4 })

    // A note nobody needs is a note nobody reads, and the next one that matters gets skipped too.
    Expect(await report(state, quiet)).not.toContain('Machine contention')
  })
})
