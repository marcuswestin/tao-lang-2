import { FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, settle, Test } from '@shared/test'
import { GateCatalog } from '../dev-src/repository-tests/GateCatalog'
import { runGates } from '../dev-src/repository-tests/GateRunner'
import { type WorkCommand, WorkGraph, type WorkNode } from '../dev-src/repository-tests/WorkGraph'

/**
 * The catalog is metadata, so most of it is asserted as metadata. Claims about scheduling rather
 * than data are proved by running a lane through an injected runner, where a node finishes only
 * when the test lets it and an overlap cannot be missed by being lucky with a sleep.
 */

const REPOSITORY_ROOT = '/repository'
/** The browser smokes: parallel-safe pool members that contend on nothing but the machine. */
const STUDIO_BROWSER_SMOKES = [
  'studio-smoke',
  'studio-proof-real-app',
  'studio-smoke-simulated-user',
  'keyboard-navigation-smoke',
  'studio-dialog-browser',
  'studio-agent-browser',
]
/** Every Studio smoke gate: the pool members the graph numbers. */
const STUDIO_SMOKES = [...STUDIO_BROWSER_SMOKES, 'studio-smoke-native']
/** Every gate that needs a host the managed sandbox denies: the smokes plus the native canary. */
const HOST_ONLY_GATES = [...STUDIO_SMOKES, 'studio-canary']
/** The prepare phase: every node that rewrites something, in the order its classes imply. */
const PREPARE_GATES = [
  '_fix-just-fmt',
  '_fix-dprint',
  '_parser-gen',
  '_fix-tao',
  '_compile-word-flower-app',
]
/** Every writer, for the edge set an untuned gate that reads the whole tree waits on. */
const EVERY_WRITER = [...PREPARE_GATES].toSorted()

function nodeOf(name: string) {
  return GateCatalog.node(name, REPOSITORY_ROOT)
}

/** commandOf reads a node's fixed command; a node whose command depends on admission fails the test. */
function commandOf(node: WorkNode): WorkCommand {
  Expect(typeof node.run).not.toBe('function')
  return typeof node.run === 'function' ? node.run({ slots: 1 }) : node.run
}

/**
 * runLane records which nodes were running at the same moment, and the command each ran. Tests
 * that must prove two nodes can overlap use a start barrier so the first cannot finish before the
 * second is admitted.
 */
async function runLane(gates: readonly string[], jobs: number, startBarrierCount = 0) {
  const root = await mkTestDir('tao-gate-catalog-')
  try {
    const running = new Set<string>()
    const overlaps: string[][] = []
    const started: string[] = []
    const commands = new Map<string, WorkCommand>()
    let releaseStartBarrier = () => {}
    const startBarrier = new Promise<void>(resolve => {
      releaseStartBarrier = resolve
    })
    await runGates({
      gates,
      jobs,
      // The machine is exactly as wide as the lane, so what the broker grants is what `jobs` says
      // and an admission assertion cannot depend on how many CPUs the host running the test has.
      machineCpuCount: jobs,
      logRoot: FS.resolvePath('logs', root),
      registryRoot: FS.resolvePath('registry', root),
      repositoryRoot: root,
      runGate: async (name, _logPath, _environment, run) => {
        started.push(name)
        running.add(name)
        commands.set(name, run)
        if (startBarrierCount > 0) {
          if (started.length >= startBarrierCount) {
            releaseStartBarrier()
          }
          await startBarrier
        } else {
          await settle(2)
        }
        overlaps.push([...running].toSorted())
        running.delete(name)
        return { exitCode: 0, output: '' }
      },
    })
    return { commands, overlaps, started }
  } finally {
    await FS.remove(root)
  }
}

/** overlapped reports whether two nodes were ever recorded running at the same moment. */
function overlapped(overlaps: readonly string[][], left: string, right: string): boolean {
  return overlaps.some(names => names.includes(left) && names.includes(right))
}

Describe('gate catalog metadata', () => {
  Test('runs an untuned recipe as an ordinary single-slot node that waits for every writer', () => {
    const node = nodeOf('_a-recipe-nobody-tuned')

    Expect(GateCatalog.metadata('_a-recipe-nobody-tuned')).toEqual(GateCatalog.DEFAULT_METADATA)
    Expect(node.cost).toBe(1)
    Expect(node.resources).toBeUndefined()
    Expect(node.run).toEqual({ args: ['_a-recipe-nobody-tuned'], command: 'just', cwd: REPOSITORY_ROOT })
    // Untuned means "reads the whole tree", so the default is the safe one and a new gate is
    // runnable before anyone narrows it. Narrowing is an assertion; not narrowing costs only time.
    Expect(GateCatalog.DEFAULT_METADATA.writes).toBeUndefined()
    Expect(GateCatalog.isPrepare('_a-recipe-nobody-tuned')).toBe(false)
    Expect(node.needs?.toSorted()).toEqual(EVERY_WRITER)
  })

  Test('names a gate without its private-recipe underscore', () => {
    Expect(nodeOf('_repo-lint').label).toBe('repo-lint')
    Expect(nodeOf('dead-exports').label).toBe('dead-exports')
  })

  Test('waits for the generated parser in every gate that reads it, and in no gate that does not', () => {
    for (
      const name of [
        '_compile-word-flower-app',
        '_tao-check',
        '_ide-extension-build',
        '_fix-tao',
        '_typecheck',
        ...STUDIO_BROWSER_SMOKES,
      ]
    ) {
      Expect(nodeOf(name).needs).toContain('_parser-gen')
    }
    // dprint owns TypeScript, JSON, and Markdown and reads no generated tree, so it never waits
    // for the generator — which is what lets the two of them run in parallel at the front.
    for (const name of ['_fix-dprint', '_repo-lint', '_dprint-check', '_runtime-pack-check', 'dead-exports']) {
      Expect(nodeOf(name).needs).not.toContain('_parser-gen')
    }
  })

  Test('waits for the compiled WordFlower app in everything that reads it', () => {
    // `packages/runtime-toolchain/tsconfig.json` compiles `_gen_tao-app/**`, where the compile writes.
    Expect(nodeOf('_typecheck').needs).toContain('_compile-word-flower-app')
    // A test node with the default suite reads sits at the end of that same chain.
    Expect(GateCatalog.testDependencies(GateCatalog.DEFAULT_SUITE_READS)).toContain('_compile-word-flower-app')
    Expect(nodeOf('_fix-dprint').needs).not.toContain('_compile-word-flower-app')
    Expect(GateCatalog.testDependencies(['ts'] as const)).not.toContain('_compile-word-flower-app')
  })

  Test('leaves the tree-reading gates independent of one another', () => {
    const readers = ['_repo-lint', '_dprint-check', '_typecheck', '_runtime-pack-check', 'dead-exports']
    for (const name of readers) {
      Expect(nodeOf(name).needs?.filter(need => readers.includes(need))).toEqual([])
    }
  })

  Test('derives each reader edge from the classes it reads, and declares no other', () => {
    // The whole of the old `mutatesTree` barrier, which made every reader in a lane wait for every
    // fixer in it — including the 5s `./tao fix`, which the TypeScript gates never read from.
    Expect(nodeOf('_typecheck').needs).toContain('_fix-dprint')
    Expect(nodeOf('_typecheck').needs).not.toContain('_fix-tao')
    Expect(nodeOf('_repo-lint').needs).toContain('_fix-dprint')
    Expect(nodeOf('_repo-lint').needs).not.toContain('_fix-tao')
    // The Tao gates do read `.tao` sources, so they still wait for the fixer that rewrites them.
    Expect(nodeOf('_tao-check').needs).toContain('_fix-tao')
    Expect(nodeOf('_compile-word-flower-app').needs).toContain('_fix-tao')
    // `dead-exports` is a TypeScript gate that reads `.tao` too: a `.tao` binding is what keeps a
    // bridged export out of its report, so a torn read of one would fail the lane on live code.
    Expect(nodeOf('dead-exports').needs).toContain('_fix-tao')
    Expect(nodeOf('dead-exports').needs).toContain('_fix-dprint')
  })

  Test('makes every recipe-backed node wait for the Justfile formatter, and no runner-backed one', () => {
    // Running a recipe starts by parsing the Justfile, which `_fix-just-fmt` rewrites.
    for (
      const name of [
        '_repo-lint',
        '_typecheck',
        '_tao-check',
        '_parser-gen',
        '_fix-dprint',
        '_fix-tao',
        'dead-exports',
        'studio-canary',
        'ship-bundle-proof',
        '_a-recipe-nobody-tuned',
      ]
    ) {
      Expect(nodeOf(name).needs).toContain('_fix-just-fmt')
    }
    // A smoke runs `./dev studio-smoke` and a test node runs its runner directly, so neither
    // parses the Justfile on its way up and neither is held behind the formatter.
    for (const name of STUDIO_BROWSER_SMOKES) {
      Expect(nodeOf(name).needs).not.toContain('_fix-just-fmt')
    }
    Expect(GateCatalog.testDependencies(GateCatalog.DEFAULT_SUITE_READS)).not.toContain('_fix-just-fmt')
  })

  Test('marks every node that rewrites the tree, and nothing that only reads it', () => {
    Expect(GateCatalog.metadata('_fix-just-fmt').writes).toEqual(['just'])
    Expect(GateCatalog.metadata('_fix-dprint').writes).toEqual(['ts'])
    Expect(GateCatalog.metadata('_fix-tao').writes).toEqual(['tao'])
    Expect(GateCatalog.metadata('_parser-gen').writes).toEqual(['gen-parser'])
    Expect(GateCatalog.metadata('_compile-word-flower-app').writes).toEqual(['gen-app'])
    for (const name of PREPARE_GATES) {
      Expect(GateCatalog.isPrepare(name)).toBe(true)
      // Exhaustive rather than a hand-written list: a writer added later is non-recordable until it
      // declares `canonicalises`, which is what keeps the safe answer the default one.
      Expect(GateCatalog.isRecordable(name)).toBe(GateCatalog.metadata(name).canonicalises === true)
    }
    // A generator's output is derived state no tree hash describes, so a record can never stand for
    // it: proving it again is the only way to know its output is present. A fresh checkout and a
    // reclaimed `.artifacts` hash identically to a checkout that has the generated trees.
    for (const name of ['_parser-gen', '_compile-word-flower-app']) {
      Expect(GateCatalog.isRecordable(name)).toBe(false)
    }
    // A fixer's output is the tracked tree itself, which the hash does describe. A record is keyed
    // by the verified tree the prepare phase left behind, so at that hash the fixer has already
    // reached its fixpoint and re-running it is the `0 fixed, N unchanged` no-op it reports. This is
    // what lets an unchanged tree skip the prepare chain that is every lane's serial floor.
    for (const name of ['_fix-just-fmt', '_fix-dprint', '_fix-tao']) {
      Expect(GateCatalog.isRecordable(name)).toBe(true)
    }
    for (const name of ['_typecheck', '_repo-lint', '_tao-check', '_ide-extension-build', 'dead-exports']) {
      Expect(GateCatalog.metadata(name).writes).toBeUndefined()
      Expect(GateCatalog.isPrepare(name)).toBe(false)
      Expect(GateCatalog.isRecordable(name)).toBe(true)
    }
    // Exactly one writer per class is what makes the derived edges unambiguous.
    Expect(GateCatalog.writerOf('gen-app')).toBe('_compile-word-flower-app')
    Expect(GateCatalog.writerOf('gen-parser')).toBe('_parser-gen')
    Expect(GateCatalog.writerOf('just')).toBe('_fix-just-fmt')
    Expect(GateCatalog.writerOf('tao')).toBe('_fix-tao')
    Expect(GateCatalog.writerOf('ts')).toBe('_fix-dprint')
  })

  Test('formats the Justfile first, so nothing parses it while it is being rewritten', () => {
    // dprint never touches the Justfile, so the formatter has nothing to wait for; running it first
    // costs 15ms and frees every other recipe-backed node from it.
    Expect(nodeOf('_fix-just-fmt').needs).toEqual([])
    Expect(GateCatalog.metadata('_fix-dprint').writes).not.toContain('just')
    Expect(GateCatalog.metadata('_fix-just-fmt').serial).toBe(true)
  })

  Test('never records a host-dependent node green, whatever its verdict was', () => {
    for (const name of HOST_ONLY_GATES) {
      Expect(GateCatalog.metadata(name).hostDependent).toBe(true)
      // The one gap in the green-record design that could produce a false green: a record would let
      // a later run on the same bytes skip a node on a host where it would fail.
      Expect(GateCatalog.isRecordable(name)).toBe(false)
    }
    Expect(GateCatalog.metadata('ship-bundle-proof').hostDependent).toBe(true)
    Expect(GateCatalog.isRecordable('ship-bundle-proof')).toBe(false)
  })

  Test('sizes the widest suites so the largest still fit the machine beside the package gates', () => {
    // Shard counts are derived per checkout; these widths are what one unsharded process reserves.
    Expect(GateCatalog.suiteTuning('tao-apps').cost).toBe(8)
    Expect(GateCatalog.suiteTuning('runtime-jest').cost).toBe(3)
    Expect(GateCatalog.suiteTuning('runtime-toolchain').cost).toBe(2)
    // The developer suite's own tests start child runners and whole lanes, so one of its processes
    // is not one core either; it says so rather than letting the graph assume otherwise.
    Expect(GateCatalog.suiteTuning('dev').cost).toBe(2)
    Expect(GateCatalog.suiteTuning('parser').cost).toBeUndefined()
    Expect(nodeOf('_typecheck').cost).toBe(GateCatalog.TYPECHECK_COST)
    Expect(nodeOf('_tao-check').cost).toBe(GateCatalog.TAO_CHECK_COST)
    // One graph and one budget: the test gate used to reserve `cpuCount - 6` for a scheduler the
    // outer graph could not see, so neither could use the other's idle slots. Nothing is held back.
    Expect(GateCatalog.machineWidth()).toBe(Platform.cpuCount())
  })

  Test('hands the published Tao test runner the budget the graph reserved for it', () => {
    // `./tao test` is the product CLI and sizes itself to the machine unless a lane tells it not to.
    Expect(GateCatalog.suiteTuning('tao-apps').budgetEnvKeys).toEqual([GateCatalog.TAO_TEST_BUDGET_KEY])
    Expect(GateCatalog.TAO_TEST_BUDGET_KEY).toBe(WorkGraph.BUDGET_ENV_KEYS.taoTest)
    // Every other runner is bounded by the graph itself — a shard's one slot, or `--maxWorkers`.
    Expect(GateCatalog.suiteTuning('dev').budgetEnvKeys).toBeUndefined()
    Expect(GateCatalog.suiteTuning('runtime-jest').budgetEnvKeys).toBeUndefined()
    // Its startup dominates, so it declares the measured startup; a Bun suite starts far faster and
    // uses the shared default.
    Expect(GateCatalog.suiteTuning('tao-apps').fixedMs).toBe(6_000)
    Expect(GateCatalog.suiteTuning('tao-apps').shardCost).toBe(2)
    // Jest's own pool already parallelizes its whole run, so splitting it only adds startups.
    Expect(GateCatalog.suiteTuning('runtime-jest').shardable).toBe(false)
    Expect(GateCatalog.suiteTuning('tao-apps').shardable).toBeUndefined()
    Expect(GateCatalog.suiteTuning('dev').fixedMs).toBeUndefined()
    Expect(GateCatalog.BUN_SUITE_FIXED_MS).toBe(600)
  })

  Test('narrows only the suites that provably read no Tao source, app, or generated tree', () => {
    for (
      const suite of [
        'code-editor',
        'generation',
        'host-control',
        'icloud-native',
        'runtime',
        'shared',
        'stdlib',
        'update-server',
      ]
    ) {
      Expect(GateCatalog.suiteReads(suite)).toEqual(['ts'])
      Expect(GateCatalog.testDependencies(GateCatalog.suiteReads(suite))).toEqual(['_fix-dprint'])
    }
    // Reading a `.tao` file while `./tao fix` rewrites it is a torn read, so the default is safe.
    for (
      const suite of [
        'dev',
        'ide-extension',
        'studio',
        'tao-cli',
        'runtime-toolchain',
        'runtime-jest',
        'tao-apps',
        'unclassified-suite',
      ]
    ) {
      Expect(GateCatalog.suiteReads(suite)).toEqual(GateCatalog.DEFAULT_SUITE_READS)
    }
    Expect(GateCatalog.DEFAULT_SUITE_READS).toEqual(['gen-app', 'gen-parser', 'tao', 'ts'])
  })

  Test('keeps the parser writer before suites that load grammar without repository Tao files', () => {
    for (const suite of ['ast-utils', 'performance-checks']) {
      Expect(GateCatalog.suiteReads(suite)).toEqual(['gen-parser', 'ts'])
      Expect(GateCatalog.testDependencies(GateCatalog.suiteReads(suite)).toSorted()).toEqual([
        '_fix-dprint',
        '_parser-gen',
      ])
    }
  })

  Test('keeps Tao and parser writers before language suites without waiting for generated apps', () => {
    for (const suite of ['compiler', 'formatter', 'parser', 'source-actions', 'validator', 'workspace']) {
      Expect(GateCatalog.suiteReads(suite)).toEqual(['gen-parser', 'tao', 'ts'])
      Expect(GateCatalog.testDependencies(GateCatalog.suiteReads(suite)).toSorted()).toEqual([
        '_fix-dprint',
        '_fix-tao',
        '_parser-gen',
      ])
    }
  })

  Test('schedules the real ship bundle proof as a bounded slow lane under its public recipe', () => {
    Expect(GateCatalog.metadata('ship-bundle-proof')).toEqual({
      cost: 3,
      hostDependent: true,
      reads: ['gen-app', 'gen-parser', 'tao', 'ts'],
      timeoutMs: 180_000,
    })
    Expect(commandOf(nodeOf('ship-bundle-proof'))).toEqual({
      args: ['ship-bundle-proof'],
      command: 'just',
      cwd: REPOSITORY_ROOT,
    })
  })

  Test('runs the canary through its public recipe and every smoke through the smoke command', () => {
    Expect(commandOf(nodeOf('studio-canary'))).toEqual({
      args: ['studio-canary'],
      command: 'just',
      cwd: REPOSITORY_ROOT,
    })
    Expect(nodeOf('studio-canary').workerPool).toBeUndefined()
    for (const name of STUDIO_SMOKES) {
      Expect(nodeOf(name).workerPool).toBe(GateCatalog.STUDIO_SMOKE_POOL)
      Expect(typeof nodeOf(name).run).toBe('function')
    }
  })

  Test('pins only the two claims measurement cannot make: the prepare chain and the gui floor', () => {
    // A Studio lane spends its wall time waiting on Metro, a browser, or a simulator, so one
    // accounting slot lets those host waits overlap the CPU-heavy package nodes.
    for (const name of HOST_ONLY_GATES) {
      Expect(nodeOf(name).cost).toBe(GateCatalog.STUDIO_LANE_COST)
    }
    for (const name of STUDIO_BROWSER_SMOKES) {
      Expect(nodeOf(name).priority).toBeUndefined()
    }
    // The two window-server lanes cannot overlap each other, so together they are a serial floor
    // that must begin at t=0 or it extends the run by its own whole length.
    Expect(nodeOf('studio-smoke-native').priority).toBe(GateCatalog.GUI_PRIORITY)
    Expect(nodeOf('studio-canary').priority).toBe(GateCatalog.GUI_PRIORITY)
    // The prepare chain must not be overtaken by readers that are merely cheap.
    for (const name of PREPARE_GATES) {
      Expect(nodeOf(name).priority).toBe(GateCatalog.PREPARE_PRIORITY)
    }
    Expect(GateCatalog.PREPARE_PRIORITY).toBeGreaterThan(GateCatalog.GUI_PRIORITY)
    // Everything else is ordered by measured duration; a hand-pinned reader would defeat that.
    for (const name of ['_typecheck', '_tao-check', '_repo-lint', 'ship-bundle-proof']) {
      Expect(nodeOf(name).priority).toBeUndefined()
    }
  })

  Test('gives only the two window-server lanes the gui resource', () => {
    Expect(nodeOf('studio-smoke-native').resources).toEqual(['gui'])
    Expect(nodeOf('studio-canary').resources).toEqual(['gui'])
    Expect(nodeOf('studio-smoke').resources).toBeUndefined()
    Expect(nodeOf('studio-proof-real-app').resources).toBeUndefined()
    Expect(nodeOf('studio-smoke-simulated-user').resources).toBeUndefined()
    Expect(nodeOf('keyboard-navigation-smoke').resources).toBeUndefined()
    Expect(nodeOf('studio-dialog-browser').resources).toBeUndefined()
    Expect(nodeOf('studio-agent-browser').resources).toBeUndefined()
  })

  Test('marks every browser and native UI lane as requiring an unsandboxed host', () => {
    for (const name of HOST_ONLY_GATES) {
      Expect(GateCatalog.metadata(name).requiresUnsandboxed).toBe(true)
    }
    for (const name of ['ship-bundle-proof', '_doctor-json', 'dead-exports', '_typecheck']) {
      Expect(GateCatalog.metadata(name).requiresUnsandboxed).toBeUndefined()
    }
  })
})

Describe('gate catalog scheduling', () => {
  Test('keeps full and sandbox verification on one identical gate membership', async () => {
    const [full, sandbox] = await Promise.all([
      justGateNames('verify-full'),
      justGateNames('verify-full-sandbox'),
    ])

    Expect(full).toEqual(sandbox)
    Expect(full).toContain('ship-bundle-proof')
    Expect(full).toContain('studio-canary')
  })

  Test('numbers the Studio smokes from the pool and runs each under its own run id', async () => {
    const smokes = ['studio-smoke', 'studio-proof-real-app', 'studio-smoke-native']
    const { commands } = await runLane(smokes, 24, smokes.length)

    const workers = smokes.map(name => {
      const args = commands.get(name)?.args ?? []
      Expect(commands.get(name)?.command).toBe('./dev')
      Expect(args.slice(0, 1)).toEqual(['studio-smoke'])
      Expect(args).toContain('--run-id')
      Expect(args[args.indexOf('--run-id') + 1]).toBe(name)
      return Number(args[args.indexOf('--worker') + 1])
    })
    // Three smokes admitted together hold three distinct indices, so `StudioSmoke.resources()`
    // hands each its own ports and artifact root without any recipe carrying a literal.
    Expect(workers.toSorted()).toEqual([0, 1, 2])
    Expect(commands.get('studio-smoke-native')?.args).toContain('--native')
    Expect(commands.get('studio-smoke')?.args).not.toContain('--native')
    Expect(commands.get('studio-smoke')?.args.at(-1)).toBe('packages/dev/studio-smoke/studio-launch.test.ts')
  })

  Test('runs the generator, then the Tao fixer, then the compile, then the tests', async () => {
    const { started } = await runLane(['_compile-word-flower-app', '_fix-tao', '_parser-gen'], 24)

    Expect(started).toEqual(['_parser-gen', '_fix-tao', '_compile-word-flower-app'])
    // A test node with the default suite reads sits at the end of that same chain. It is not a
    // recipe, so it is built by `TestNodes` rather than run through this lane.
    Expect(GateCatalog.testDependencies(GateCatalog.DEFAULT_SUITE_READS)).toContain('_compile-word-flower-app')
  })

  Test('finishes each fixer before the gates that read what it rewrote, and no others', async () => {
    const { overlaps, started } = await runLane(
      ['_typecheck', '_repo-lint', '_fix-dprint', '_fix-tao', '_parser-gen'],
      24,
    )

    // dprint owns the TypeScript sources every other node here reads, so it is alone at the front.
    Expect(started[0]).toBe('_fix-dprint')
    Expect(started.slice(-2).toSorted()).toEqual(['_fix-tao', '_typecheck'])
    Expect(overlapped(overlaps, '_fix-dprint', '_typecheck')).toBe(false)
    Expect(overlapped(overlaps, '_fix-dprint', '_repo-lint')).toBe(false)
    Expect(overlapped(overlaps, '_parser-gen', '_typecheck')).toBe(false)
    // What the edges bought: repo-lint reads TypeScript alone, so it starts as soon as dprint is
    // done rather than queueing behind the 5s `./tao fix` it has no relationship with.
    Expect(started.indexOf('_repo-lint')).toBeLessThan(started.indexOf('_fix-tao'))
  })

  Test('starts the gui floor at t=0 with the widest package gates beside it', async () => {
    const { started } = await runLane(
      [
        'ship-bundle-proof',
        '_typecheck',
        'studio-canary',
        '_tao-check',
      ],
      8,
      3,
    )

    // The canary holds `gui`, which nothing can overlap, so its own length is added to the run
    // unless it begins immediately. The two three-slot package gates fill the rest of the eight.
    Expect(started[0]).toBe('studio-canary')
    Expect(started.slice(0, 3).toSorted()).toEqual(['_typecheck', 'ship-bundle-proof', 'studio-canary'])
    // `_tao-check` needs two slots and one is left, so it waits rather than letting a cheaper node
    // jump the queue.
    Expect(started[3]).toBe('_tao-check')
  })

  Test('uses the slots beside package work for three Studio waits at once', async () => {
    const { overlaps, started } = await runLane(
      [
        'studio-smoke',
        'studio-proof-real-app',
        'studio-smoke-simulated-user',
        'studio-smoke-native',
        '_typecheck',
        '_tao-check',
      ],
      // One slot for the native smoke, three for typecheck, two for tao-check, and the two browser
      // smokes that fit beside them; the fourth smoke waits for a slot rather than for a phase.
      8,
      5,
    )

    Expect(started[0]).toBe('studio-smoke-native')
    Expect(overlaps.some(names =>
      names.includes('_typecheck')
      && names.includes('_tao-check')
      && names.filter(name => STUDIO_SMOKES.includes(name)).length === 3
    )).toBe(true)
  })

  Test('keeps the gui lanes exclusive and lets the browser lane overlap either one', async () => {
    // Each pair fits inside 24 slots. The barrier makes allowed overlap deterministic, while the
    // two gui nodes must still run sequentially because they hold the same resource.
    const guiPair = await runLane(['studio-smoke-native', 'studio-canary'], 24)
    const nativeAndBrowser = await runLane(['studio-smoke-native', 'studio-smoke-simulated-user'], 24, 2)
    const canaryAndBrowser = await runLane(['studio-canary', 'studio-smoke-simulated-user'], 24, 2)

    Expect(overlapped(guiPair.overlaps, 'studio-smoke-native', 'studio-canary')).toBe(false)
    Expect(overlapped(nativeAndBrowser.overlaps, 'studio-smoke-native', 'studio-smoke-simulated-user')).toBe(true)
    Expect(overlapped(canaryAndBrowser.overlaps, 'studio-canary', 'studio-smoke-simulated-user')).toBe(true)
  })
})

async function justGateNames(recipe: string): Promise<string[]> {
  const result = await Bun.$`just --dry-run ${recipe}`.cwd(Repo.getRoot()).quiet().nothrow()
  Expect(result.exitCode).toBe(0)
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  const gateLine = output.split('\n').find(line => line.includes('./dev gates '))
  Expect(gateLine).toBeDefined()
  const tokens = gateLine!.trim().split(/\s+/)
  const optionIndex = tokens.findIndex(token => token.startsWith('--'))
  return tokens.slice(2, optionIndex < 0 ? undefined : optionIndex)
}
