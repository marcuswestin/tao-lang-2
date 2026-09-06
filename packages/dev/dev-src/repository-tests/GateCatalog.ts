import { Assert, Platform } from '@shared'
import { type WorkAdmission, type WorkCommand, WorkGraph, type WorkNode } from './WorkGraph'

/**
 * What the scheduler needs to know about each gate: what must pass before it starts, how much of
 * the machine it occupies while it runs, which exclusive device it holds, whether it rewrites the
 * tree, and — when the gate is not simply the Justfile recipe of its own name — the process it runs.
 *
 * Membership stays in the Justfile. This catalog says nothing about which lane a gate belongs to:
 * an entry may name a gate the lane left out, and the graph ignores an edge whose other end is not
 * present, so one entry serves `check`, `verify`, and `full-verify` alike. A recipe with no entry
 * runs as an ordinary single-slot node with no edges, so a new gate is runnable before anyone tunes
 * it.
 *
 * Costs are reservations measured against a whole machine, not guesses. A node whose width does not
 * fit holds the admission queue until it can run, so the widths here are chosen to fit side by side:
 * `_test` deliberately leaves room for `_typecheck` and `_tao-check` beside it.
 */

/** GateCommand is a gate's process without the working directory, which is always the repository. */
type GateCommand = Pick<WorkCommand, 'args' | 'command'>

/** GateMetadata is one gate's scheduling shape, in the vocabulary `WorkNode` already speaks. */
export type GateMetadata =
  & Pick<
    WorkNode,
    'budgetEnvKeys' | 'cost' | 'mutatesTree' | 'needs' | 'priority' | 'resources' | 'timeoutMs' | 'workerPool'
  >
  & {
    /** True when the gate needs host capabilities the managed agent sandbox deliberately denies. */
    requiresUnsandboxed?: boolean
    /**
     * The process the gate runs, or a builder over what the graph admitted; absent, the gate is
     * `just <name>`. A public recipe and a catalog command may share a name: the recipe is the
     * human spelling with its own defaults, the command is what the graph runs under that name.
     */
    run?: GateCommand | ((admission: WorkAdmission) => GateCommand)
  }

/** A gate nobody has tuned occupies one slot and waits for nothing. */
const DEFAULT_METADATA: GateMetadata = { cost: 1 }

/**
 * Slots `_test` leaves free for the gates that run beside it: `_typecheck` (3), `_tao-check` (2),
 * and one spare so a sub-second gate is not stuck behind them. The margin is what keeps all three
 * admitted at once — on 18 CPUs a `cpuCount - 4` reservation is 14, which no longer fits beside the
 * other two, and the admission queue would then hold `_test` for the 9.3s `_tao-check` measures.
 */
const SLOTS_BESIDE_TEST = 6
const TAO_CHECK_COST = 2
const TYPECHECK_COST = 3
/**
 * Studio smoke spends most of its wall time waiting on Metro, browser, simulator, or IPC
 * readiness. One accounting slot lets those host waits overlap the CPU-heavy package gates; the
 * `gui` resource below, not an inflated CPU reservation, owns the real native-host exclusion.
 */
const STUDIO_LANE_COST = 1
/** The release proof runs CPU-heavy Expo exports rather than waiting on an interactive host. */
const SHIP_BUNDLE_PROOF_COST = 3
/** Generous against a healthy canary run; a bound against a post-report hang regressing. */
const STUDIO_CANARY_TIMEOUT_MS = 300_000
const SHIP_BUNDLE_PROOF_TIMEOUT_MS = 180_000
/**
 * The pool every Studio smoke gate draws its worker index from. `StudioSmoke.resources()` turns the
 * index into ports and an artifact root no other smoke in the run touches, so the graph numbering
 * the pool is what lets the smokes overlap.
 */
const STUDIO_SMOKE_POOL = 'studio-smoke'

/**
 * Start-order pins. Measured durations order nodes within a priority; these make the two stable
 * package critical-path gates start before auxiliary work once the tree-mutating preflight ends.
 * Starting the children is sufficient: their reservations protect their worker budgets, so a
 * fixed sleep before admitting the remaining work would only add idle time.
 */
const TEST_PRIORITY = 4
const TYPECHECK_PRIORITY = TEST_PRIORITY

/**
 * testCost reserves most of the machine for `_test` while leaving `_typecheck` and `_tao-check`
 * room to run beside it. The reservation is also the nested runner's own worker budget, so it is
 * the one number that decides both how much of the lane `_test` occupies and how much parallelism
 * `./dev test` gets inside it.
 */
function testCost(): number {
  return Math.max(2, Platform.cpuCount() - SLOTS_BESIDE_TEST)
}

/** testGate is the shape the complete and changed-files test gates share. */
function testGate(): GateMetadata {
  return {
    // `just _test` hides the nested runner behind a recipe name, so the graph cannot infer the
    // budget key from the command it starts. Naming it here is what makes `cost` an enforced
    // bound on `./dev test` rather than a reservation it ignores.
    budgetEnvKeys: [WorkGraph.BUDGET_ENV_KEYS.devTest],
    cost: testCost(),
    // The tao-apps suite runs against the compiled WordFlower app, and a stale generated app is
    // worse than a slow one.
    needs: ['_compile-word-flower-app'],
    priority: TEST_PRIORITY,
  }
}

/** studioLane is the shape every browser or native UI node shares. */
function studioLane(resources?: readonly string[]): GateMetadata {
  return {
    cost: STUDIO_LANE_COST,
    // Every UI lane dies on a missing `_gen_tao-parser`, and none of them may read the tree
    // while `fix` is still rewriting it; the mutates-tree barrier handles the second half.
    needs: ['_parser-gen'],
    requiresUnsandboxed: true,
    resources,
  }
}

/**
 * studioSmoke runs one smoke file through `./dev studio-smoke` under the gate's own run id, on the
 * worker index the graph assigns from the smoke pool.
 */
function studioSmoke(
  name: string,
  file: string,
  options: { native?: boolean; resources?: readonly string[] } = {},
): GateMetadata {
  return {
    ...studioLane(options.resources),
    run: ({ workerIndex }) => {
      Assert.defined(workerIndex, `a worker index for pool member ${name}`)
      return {
        args: [
          'studio-smoke',
          ...(options.native === true ? ['--native'] : []),
          '--run-id',
          name,
          '--worker',
          String(workerIndex),
          file,
        ],
        command: './dev',
      }
    },
    workerPool: STUDIO_SMOKE_POOL,
  }
}

function buildCatalog(): ReadonlyMap<string, GateMetadata> {
  return new Map<string, GateMetadata>([
    // Generators, not ordinary gates: each deletes and rewrites a `_gen_*` directory that other
    // nodes read. `packages/parser/tsconfig.json` compiles `parser-src/**`, which is where Langium
    // writes, and `packages/runtime-toolchain/tsconfig.json` compiles `_gen_tao-app/**`, which is
    // where the WordFlower compile writes — so `_typecheck` reads both. `mutatesTree` is what keeps
    // a reader off a directory that is being replaced under it.
    ['_parser-gen', { mutatesTree: true }],
    ['_compile-word-flower-app', { mutatesTree: true, needs: ['_parser-gen'] }],

    // The fix steps own provably disjoint file classes: dprint owns TS/JSON/MD and excludes
    // `**/_gen_*/**` (`config/dprint.jsonc`), `./tao fix` owns `.tao`, `just --fmt` owns the
    // Justfile. `_fix-just-fmt` still goes last, because it rewrites the file every sibling gate's
    // own `just` process parses on the way up.
    ['_fix-dprint', { mutatesTree: true }],
    ['_fix-tao', { mutatesTree: true, needs: ['_parser-gen'] }],
    ['_fix-just-fmt', { mutatesTree: true, needs: ['_fix-dprint', '_fix-tao'] }],

    ['_ide-extension-build', { needs: ['_parser-gen'] }],
    ['_tao-check', { cost: TAO_CHECK_COST, needs: ['_parser-gen'] }],
    ['_typecheck', { cost: TYPECHECK_COST, priority: TYPECHECK_PRIORITY }],
    ['_test', testGate()],
    // The changed-files selection of the same runner, for `verify --changed`. It reserves the same
    // width because a change in `shared` still selects every suite.
    ['_test-changed', testGate()],

    // Sub-second gates that read the tree and nothing else.
    ['_dprint-check', {}],
    ['_repo-lint', {}],
    ['_runtime-pack-check', {}],
    ['dead-exports', {}],
    ['_doctor-json', {}],
    [
      'ship-bundle-proof',
      {
        cost: SHIP_BUNDLE_PROOF_COST,
        needs: ['_parser-gen'],
        timeoutMs: SHIP_BUNDLE_PROOF_TIMEOUT_MS,
      },
    ],

    // The browser smokes are parallel-safe on the worker indices the pool hands them; the native
    // shell and the canary contend on the window server, which is what `gui` names. Each smoke
    // gate is named for the public recipe that runs the same file by hand.
    ['studio-smoke', studioSmoke('studio-smoke', 'packages/dev/studio-smoke/studio-launch.test.ts')],
    [
      'studio-proof-real-app',
      studioSmoke('studio-proof-real-app', 'packages/dev/studio-smoke/studio-real-app.test.ts'),
    ],
    [
      'studio-smoke-simulated-user',
      studioSmoke('studio-smoke-simulated-user', 'packages/dev/studio-smoke/studio-simulated-user.test.ts'),
    ],
    [
      'keyboard-navigation-smoke',
      studioSmoke('keyboard-navigation-smoke', 'packages/dev/studio-smoke/runtime-keyboard-navigation.test.ts'),
    ],
    [
      'studio-smoke-native',
      studioSmoke('studio-smoke-native', 'packages/dev/studio-smoke/studio-simulated-user.test.ts', {
        native: true,
        resources: ['gui'],
      }),
    ],
    // The canary once hung after printing its verdict on a launch-owned process that survived
    // shutdown; `completeNativeProbe` now stops Hutch when the probe resolves, and a healthy run
    // takes ~10s. The bound stays so a regression fails the node instead of holding the lane open.
    ['studio-canary', { ...studioLane(['gui']), timeoutMs: STUDIO_CANARY_TIMEOUT_MS }],
  ])
}

const CATALOG = buildCatalog()

/** metadata returns one gate's scheduling shape, or the untuned default for an unknown recipe. */
function metadata(name: string): GateMetadata {
  return CATALOG.get(name) ?? DEFAULT_METADATA
}

/** node turns one gate name into the work-graph node that runs it. */
function node(name: string, repositoryRoot: string): WorkNode {
  const { requiresUnsandboxed: _requiresUnsandboxed, run, ...scheduling } = metadata(name)
  const inRepository = (command: GateCommand): WorkCommand => ({ ...command, cwd: repositoryRoot })
  return {
    ...scheduling,
    // Logs and dashboard tiles have always named a gate without its private-recipe underscore.
    label: name.replace(/^_/, ''),
    name,
    run: run === undefined
      ? inRepository({ args: [name], command: 'just' })
      : typeof run === 'function'
      ? admission => inRepository(run(admission))
      : inRepository(run),
  }
}

/** GateCatalog owns the scheduling metadata every gate runs under. */
export const GateCatalog = {
  DEFAULT_METADATA,
  STUDIO_LANE_COST,
  STUDIO_SMOKE_POOL,
  TAO_CHECK_COST,
  TYPECHECK_COST,
  metadata,
  node,
  testCost,
} as const
