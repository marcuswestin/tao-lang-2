import { Assert, Platform } from '@shared'
import { type WorkAdmission, type WorkCommand, WorkGraph, type WorkNode } from './WorkGraph'

/**
 * The one declarative place this repository's scheduling facts live: what each node writes, what it
 * reads, how much of the machine it occupies, which exclusive device it holds, what bounds it runs
 * under, whether its verdict may be recorded, and — when the node is not simply the Justfile recipe
 * of its own name — the process it runs.
 *
 * Membership stays in the Justfile. This catalog says nothing about which lane a gate belongs to: an
 * entry may name a gate the lane left out, and the graph ignores an edge whose other end is not
 * present, so one entry serves `check`, `verify`, and `verify-full` alike. A recipe with no entry
 * runs as an ordinary single-slot node that waits for every writer in the lane, which is the safe
 * reading of a gate nobody has said anything about: a new gate is runnable, correctly ordered, and
 * merely later than it needs to be until someone narrows what it reads.
 *
 * Ordering is derived, not hand-written twice. A node declares the file classes it `writes` and the
 * ones it `reads`, and `node` turns that into edges: a reader waits for exactly the writers of the
 * classes it reads, and for nothing else. That is the whole of the old `mutatesTree` barrier, which
 * made every reader in a lane wait for every fixer in it — including the 5s `./tao fix`, which the
 * TypeScript gates have no relationship with at all. Six class names, no globs, and a graph that
 * still fits on a screen.
 *
 * Every recipe-backed node implicitly reads `just`, because it starts by parsing the Justfile, which
 * `_fix-just-fmt` rewrites. That is why `_fix-just-fmt` is first in the prepare phase and depends on
 * nothing: dprint owns TypeScript, JSON, and Markdown (`.config/dprint.jsonc`) and never touches the
 * Justfile, so there is nothing for it to wait for, and running it first costs 15ms and frees every
 * other node from it.
 *
 * Costs are reservations measured against a whole machine, not guesses. A node whose width does not
 * fit holds the admission queue until it can run.
 */

/**
 * SourceClass names one class of files, coarse enough that six names cover the repository. A class
 * is written by at most one node, which is what makes the derived edges unambiguous.
 */
export type SourceClass =
  /** WordFlower's `.tao/cache/_gen_tao-app`, filled by the repository compile. */
  | 'gen-app'
  /** The extension bundles and syntax tree filled by the IDE extension build. */
  | 'gen-ide'
  /** The generated Langium parser under `packages/language/parser/parser-src`. */
  | 'gen-parser'
  /** The Justfile itself, which every recipe-backed node parses on its way up. */
  | 'just'
  /**
   * The two generated developer-environment index pages. They are Markdown, and so also dprint's to
   * format, but they are named apart from `ts` because what makes them correct is being regenerated
   * from the entry files — and `_repo-lint` now fails a stale one. Without a class of their own the
   * lint would be free to read the index before the generator rewrote it and report the drift it was
   * about to fix.
   */
  | 'ledger'
  /** Every `.tao` source: the apps, the standard library, the Tao test journeys. */
  | 'tao'
  /** TypeScript, JSON, and Markdown sources — dprint's file classes. */
  | 'ts'

/** GateCommand is a gate's process without the working directory, which is always the repository. */
type GateCommand = Pick<WorkCommand, 'args' | 'command'>

/** GateMetadata is one node's scheduling shape, in the vocabulary `WorkNode` already speaks. */
export type GateMetadata =
  & Pick<
    WorkNode,
    | 'budgetEnvKeys'
    | 'cost'
    | 'idleTimeoutMs'
    | 'needs'
    | 'priority'
    | 'resources'
    | 'serial'
    | 'timeoutMs'
    | 'workerPool'
  >
  & {
    /**
     * True when the node's verdict depends on something no tree hash describes: Chrome,
     * Electrobun, the iOS simulator, the macOS window server, a signing identity. Such a node is
     * never recorded green, because a record would let a later run on the same bytes skip it on a
     * host where it would fail. This is the only gap in the green-record design that can produce a
     * false green, which is why it is a declared property of the node rather than a heuristic.
     */
    hostDependent?: boolean
    /** Inherently visible test surface; its workflow requires the matching show option. */
    visibleSurface?: 'studio'
    /** Quiet by default, but the scoped show option selects visible windows. */
    optionalVisibleSurface?: 'studio'
    /**
     * Declares that this node rewrites tracked source into its canonical form and derives nothing:
     * its whole output is the tree, which a tree hash does describe. Only such a writer can be
     * recorded green, and only when the prepare phase left the tree it ran against untouched —
     * `GateRunner` establishes that second half, because a hash taken after a later writer finished
     * may already contain an edit this one never saw.
     *
     * Declared per node rather than inferred from which classes it writes, so that a writer added
     * later is not recordable by default. The safe answer for a writer is no.
     */
    canonicalises?: boolean
    /** File classes this node reads; it waits for their writers. `just` is implied for a recipe. */
    reads?: readonly SourceClass[]
    /** True when the node needs host capabilities the managed agent sandbox deliberately denies. */
    requiresUnsandboxed?: boolean
    /**
     * True when the node drives the macOS window server or native launcher. A lane on any other host
     * reports it skipped rather than running it, so it proves nothing there and is never green.
     */
    requiresMacOS?: boolean
    /** True when the node starts Studio, whose Metro refuses to run without the shared Watchman daemon. */
    usesWatchman?: boolean
    /**
     * The process the node runs, or a builder over what the graph admitted; absent, the node is
     * `just <name>`. A public recipe and a catalog command may share a name: the recipe is the
     * human spelling with its own defaults, the command is what the graph runs under that name.
     */
    run?: GateCommand | ((admission: WorkAdmission) => GateCommand)
    /**
     * File classes this node rewrites. A node that writes anything is a prepare node: it runs under
     * the per-checkout prepare lock and before the readers of its classes. It is not recorded green
     * unless it also declares `canonicalises`, because a generator's output is derived state a tree
     * hash does not describe.
     */
    writes?: readonly SourceClass[]
  }

/** A gate nobody has tuned occupies one slot, reads the whole tree, and waits for every writer. */
const DEFAULT_METADATA: GateMetadata = { cost: 1, reads: ['gen-app', 'gen-ide', 'gen-parser', 'tao', 'ts'] }

/** SuiteTuning is what one test suite needs beyond the defaults every suite gets. */
export type SuiteTuning = {
  /** Stable file cohorts run separately without adding an ordering barrier or widening selection. */
  filePartitions?: readonly { name: string; files: readonly string[] }[]
  /** Repository-relative, measured small core files; execute once before dependent app suites. */
  preflightFiles?: readonly string[]
  /** Wait for the core files present in this request; absent core selections add no dependency. */
  afterPreflight?: boolean
  /** Extra runner arguments: Bun's `--concurrent`, a longer per-test timeout. */
  args?: readonly string[]
  /** First-run split for a suite whose measured whole-process cost makes a cold serial run expensive. */
  coldShardCount?: number
  /** Env keys a runner that would otherwise size itself to the machine reads its width from. */
  budgetEnvKeys?: readonly string[]
  /** Width one unsharded process of this suite reserves. */
  cost?: number
  /** Width one shard reserves, for a suite whose shard is not a single-core process. */
  shardCost?: number
  /**
   * Milliseconds one process of this suite spends before it runs any test at all. It is what makes
   * sharding cost something, so it caps the shard count: a shard must carry at least this much work
   * of its own, or it is mostly overhead. Measure it — one shard of the smallest unit the suite has
   * is the measurement — rather than guessing.
   */
  fixedMs?: number
  priority?: number
  /** File classes the suite reads; narrower than the default only where that is provable. */
  reads?: readonly SourceClass[]
  /** Overrides the derived answer to whether one process of this suite occupies one core. */
  serial?: boolean
  /** False for a suite that must stay one process, whatever the timings say. */
  shardable?: boolean
}

/**
 * Every test suite reads the whole tree unless it provably does not. Waiting for a fixer that
 * cannot affect you is wasted time, but reading a `.tao` file while `./tao fix` rewrites it is a
 * torn read, so the default is the safe one and each narrowing is an assertion about that suite.
 */
const DEFAULT_SUITE_READS: readonly SourceClass[] = ['gen-app', 'gen-ide', 'gen-parser', 'tao', 'ts']
/** Bun's own startup plus this repository's module graph, measured on a warm cache. */
const BUN_SUITE_FIXED_MS = 600
/** The published `./tao test` sizes itself to the machine unless a lane hands it a width. */
const BUDGET_KEY_TAO_TEST = WorkGraph.BUDGET_ENV_KEYS.taoTest

/**
 * SUITE_TUNING is the suite half of this table. Measured shard counts are derived per checkout from
 * recorded duration and per-file costs. Only the two expensive suites with verified cold-start
 * measurements have a fallback width for a new worktree without local timing history.
 */
const SUITE_TUNING = new Map<string, SuiteTuning>([
  ['compiler', { args: ['--concurrent'], reads: ['gen-parser', 'tao', 'ts'] }],
  // Developer and verification tests deliberately run concurrently and many of them spawn child
  // processes. During full verification, a healthy child can wait behind the other CPU-heavy
  // suites long enough to exceed Bun's generic five-second test timeout even though it completes
  // promptly in isolation. Both suites are themselves parallel workloads: they run concurrently,
  // and many of them start real child test runners, gate runs, Studio canaries, and Expo lanes.
  // Sharding the suite multiplies that, and its own tests are then the ones starved — a trivial
  // child `bun test` ran past a fifteen-second bound with three shards of this suite in flight.
  // Like Jest, each already saturates what it is given, so it takes one reservation and stays
  // whole. Its per-test bound is a hang guard, which it no longer has to spell out: `--concurrent`
  // reports each test's duration as the time from the file's shared start, so every concurrent
  // suite is bounded that way and the hand-written `--timeout=60000` that used to sit here said
  // only what the flag already implies.
  ['cli/dev-cli', { args: ['--concurrent'], cost: 2, shardable: false }],
  ['cli/agent-cli', { args: ['--concurrent'], cost: 2, shardable: false }],
  ['testing/verification', { args: ['--concurrent'], cost: 2, shardable: false }],
  ['ides/studio-tooling', { args: ['--concurrent'], cost: 2, shardable: false }],
  ['ides/ide-extension', { args: ['--concurrent'], reads: ['gen-ide', 'gen-parser', 'tao', 'ts'] }],
  // expo-host tests spawn full tsc typechecks per test; under parallel suite load these exceed
  // Bun's 5s default per-test timeout, which kills the tsc child and fails the test on its empty
  // output. That is exactly the case `TestRunner`'s own per-test deadline now stretches for by load,
  // so a hand-written `--timeout=60000` here would no longer say more than the default already does
  // — and under enough load it says less, since the computed deadline can pass 60,000 while this one
  // could not.
  ['apps/expo-host', { afterPreflight: true, cost: 2, reads: ['gen-parser', 'tao', 'ts'], shardCost: 2 }],
  // Its tests lower and validate whole starter projects, which is seconds of real work per test.
  // Bun's five-second default was calibrated when this suite was one process beside a handful of
  // others; sharded, and beside every other suite in the lane, a healthy test can sit behind other
  // work for longer than that and be killed for it. That is starvation, not a hang, so it is the
  // computed deadline's question to answer rather than a fixed number chosen once and left behind as
  // the floor beneath it rose.
  // Fresh history needs enough units to balance the expensive bridge and CLI integration files.
  // Eight initial shards still grouped a 24s tail after splitting those files; twelve lets the
  // scheduler spread the work within its existing CPU budget until measured costs take over.
  ['cli/tao-cli', { coldShardCount: 12 }],
  ['language/validator', {
    args: ['--concurrent'],
    preflightFiles: ['packages/language/validator/validator-tests/phrases.test.ts'],
    reads: ['gen-parser', 'tao', 'ts'],
  }],

  // Jest's own worker pool already parallelizes the whole run, so splitting it into single-worker
  // processes adds startups without adding parallelism: 30 files in one process at `--maxWorkers=3`
  // measure 19.7s, and the same files as three processes at one worker each measure 21.3s. It is
  // handed a reservation and the matching `--maxWorkers`, and left whole.
  [
    'runtime-jest',
    { afterPreflight: true, cost: 3, priority: 4, reads: ['gen-parser', 'tao', 'ts'], shardable: false },
  ],
  // The Tao behavior tests validate and compile once per lane, then each `./tao test` shard runs
  // Jest against its own app roots in the shared compiled run.
  // Unlike Jest's, that pool parallelizes the compile and not the run, so the suite does shard, and
  // roots are what `./tao test` takes. Measured: the whole corpus in one process is 49.7s, and the
  // same corpus as two concurrent halves is 27.8s — 44% less wall for 13% more CPU, which is the
  // trade this scheduling exists to make. The compile is now one prepare node, so shard startup
  // is the warm CLI overhead: a 3.58s WordFlower run spent 2.76s in Jest, leaving about 0.8s.
  [
    'tao-apps',
    {
      afterPreflight: true,
      budgetEnvKeys: [BUDGET_KEY_TAO_TEST],
      // Two app-root shards cut a measured 49.7s whole run to 27.8s with modest extra CPU. A new
      // worktree uses that conservative split before it has trustworthy local timing history.
      coldShardCount: 2,
      cost: 8,
      fixedMs: 800,
      priority: 5,
      reads: ['gen-parser', 'tao', 'ts'],
      serial: false,
      // One shard runs its own Jest pass against the lane's compiled corpus.
      shardCost: 2,
    },
  ],

  // These suites reference no `.tao` source, app, or generated tree, and so wait for dprint alone.
  // Verified by search; a suite that starts reading one belongs off this list.
  ['ai/generation', { reads: ['ts'] }],
  ['testing/host-control', { reads: ['ts'] }],
  ['apps/providers/icloud', { reads: ['ts'] }],
  ['performance-checks', { reads: ['gen-parser', 'ts'] }],
  ['apps/runtime', { reads: ['ts'] }],
  ['shared', { reads: ['ts'] }],
  ['apps/stdlib', { reads: ['ts'] }],
  ['services/update-server', { reads: ['ts'] }],

  // AST utilities import generated parser types but never load Tao source or app output.
  ['language/ast-utils', { reads: ['gen-parser', 'ts'] }],

  // These language-service suites load generated parser code and repository Tao source, including
  // the standard library, but never consume the shared generated-app directory.
  // Three warm file-process samples fit the selection budget; these are ordinary tests,
  // partitioned into stable core nodes, not timing assertions or a wider selection.
  ['language/formatter', {
    preflightFiles: ['packages/language/formatter/formatter-tests/phrases.test.ts'],
    reads: ['gen-parser', 'tao', 'ts'],
  }],
  ['language/parser', {
    preflightFiles: [
      'packages/language/parser/parser-tests/lexer.test.ts',
      'packages/language/parser/parser-tests/syntax-parse.test.ts',
    ],
    reads: ['gen-parser', 'tao', 'ts'],
  }],
  ['language/project-tooling', {
    filePartitions: [{
      name: 'native',
      files: [
        'packages/language/project-tooling/project-tooling-tests/ProjectNativeBindingInventory.test.ts',
        'packages/language/project-tooling/project-tooling-tests/ProjectNativeBindingModules.test.ts',
        'packages/language/project-tooling/project-tooling-tests/ProjectNativeBindingsService.test.ts',
        'packages/language/project-tooling/project-tooling-tests/ProjectNativeBindingsWatch.integration.test.ts',
        'packages/language/project-tooling/project-tooling-tests/ProjectNativeRefreshReceipt.test.ts',
        'packages/language/project-tooling/project-tooling-tests/ProjectNativeTypeScript.test.ts',
      ],
    }, {
      name: 'receipts',
      files: ['packages/language/project-tooling/project-tooling-tests/ProjectRefreshReceipt.test.ts'],
    }, {
      name: 'receipt-inputs',
      files: ['packages/language/project-tooling/project-tooling-tests/ProjectRefreshReceiptInputs.test.ts'],
    }, {
      name: 'receipt-resolution',
      files: ['packages/language/project-tooling/project-tooling-tests/ProjectRefreshReceiptResolution.test.ts'],
    }, {
      name: 'receipt-host',
      files: ['packages/language/project-tooling/project-tooling-tests/ProjectRefreshReceiptHost.test.ts'],
    }, {
      name: 'receipt-races',
      files: ['packages/language/project-tooling/project-tooling-tests/ProjectRefreshReceiptRaces.test.ts'],
    }],
  }],
  ['language/source-actions', { reads: ['gen-parser', 'tao', 'ts'] }],
])

const TAO_CHECK_COST = 2
const TYPECHECK_COST = 3
/**
 * Studio smoke spends most of its wall time waiting on Metro, browser, simulator, or IPC
 * readiness. One accounting slot lets those host waits overlap the CPU-heavy package nodes; the
 * `gui` resource below, not an inflated CPU reservation, owns the real native-host exclusion — in
 * this lane's own graph, and machine-wide once `GateRunner` takes the lease of the same name.
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
 * Start-order pins. Measured durations order nodes within a priority, and a serial node already
 * sorts ahead of its equal-priority neighbours. These two pins remain because they are claims
 * measurement cannot make: the `gui` chain is a serial floor of its own that must begin at t=0 or
 * it extends the run by its whole length, and the prepare chain must not be overtaken by readers
 * that are merely cheap.
 */
const PREPARE_PRIORITY = 8
const GUI_PRIORITY = 6

/**
 * The window-server / native-host resource name. The graph serializes its own `gui` nodes against
 * each other under it, the same as any other declared `resources` entry; `GateRunner` additionally
 * takes a machine-wide lease under this exact name for as long as either is in flight, so two
 * worktrees' `gui` nodes — or a standalone recipe running `studio-smoke-native` or `studio-canary`'s
 * work outside `./dev gates` entirely — cannot overlap either. One name, two guarantees: the graph
 * edge is free and in-process; the lease is what reaches outside this one lane.
 */
const GUI_RESOURCE = 'gui'
/** Graph GUI children inherit the lease held by GateRunner instead of taking it again. */
const GUI_LEASE_HELD_ENV_KEY = 'TAO_GUI_LEASE_HELD'

/** studioLane is the shape every browser or native UI node shares. */
function studioLane(resources?: readonly string[]): GateMetadata {
  return {
    cost: STUDIO_LANE_COST,
    // Every UI lane dies on a missing `_gen_tao-parser`, and none of them may read a source file
    // while a fixer is still rewriting it; the declared classes handle both.
    hostDependent: true,
    reads: ['gen-app', 'gen-parser', 'tao', 'ts'],
    requiresUnsandboxed: true,
    resources,
    usesWatchman: true,
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
    ['studio-host-control-smoke', {
      ...studioSmoke(
        'studio-host-control-smoke',
        'packages/ides/studio-tooling/studio-smoke/studio-host-control.test.ts',
        { native: true, resources: [GUI_RESOURCE] },
      ),
      visibleSurface: 'studio',
    }],
    ['studio-mac2-acceptance', {
      ...studioSmoke(
        'studio-mac2-acceptance',
        'packages/ides/studio-tooling/studio-smoke/studio-mac2-acceptance.test.ts',
        { native: true, resources: [GUI_RESOURCE] },
      ),
      visibleSurface: 'studio',
    }],
    // The prepare phase, in the order its declared classes imply: the Justfile first because every
    // recipe parses it, then the parser generator and dprint in parallel, then `./tao fix`, then the
    // WordFlower compile, which reads the `.tao` sources `./tao fix` has just canonicalized.
    ['_fix-just-fmt', { canonicalises: true, priority: PREPARE_PRIORITY, serial: true, writes: ['just'] }],
    ['_fix-dprint', { canonicalises: true, priority: PREPARE_PRIORITY, reads: ['ts'], serial: true, writes: ['ts'] }],
    // Generated from the entry files, so it must land before the lint that now fails a stale index.
    ['_fix-ledger-index', {
      canonicalises: true,
      priority: PREPARE_PRIORITY,
      reads: ['ts'],
      serial: true,
      writes: ['ledger'],
    }],
    ['_parser-gen', { priority: PREPARE_PRIORITY, reads: ['ts'], serial: true, writes: ['gen-parser'] }],
    // `./tao fix` reports "0 fixed, 123 unchanged" in 5s of single-threaded language-service work,
    // and is the prepare phase's whole critical path. A workspace daemon is the lever on it; until
    // then `serial` is what tells the scheduler to pack the rest of the run around it.
    [
      '_fix-tao',
      { canonicalises: true, priority: PREPARE_PRIORITY, reads: ['gen-parser', 'ts'], serial: true, writes: ['tao'] },
    ],
    [
      '_compile-word-flower-app',
      {
        priority: PREPARE_PRIORITY,
        reads: ['gen-parser', 'tao', 'ts'],
        serial: true,
        writes: ['gen-app'],
      },
    ],

    // Readers. Each waits for the writers of the classes it names and for nothing else: the
    // TypeScript gates never wait for `./tao fix`, and the Tao gates never wait for dprint.
    ['_dprint-check', { reads: ['ts'] }],
    ['_repo-lint', { reads: ['ledger', 'ts'] }],
    ['_runtime-pack-check', { reads: ['ts'] }],
    // It walks the `.tao` sources as well as the TypeScript, because a `.tao` binding is what keeps
    // a bridged export out of its report; reading one mid-rewrite would report live code as dead.
    ['dead-exports', { reads: ['tao', 'ts'] }],
    ['_doctor-json', { reads: ['ts'] }],
    [
      '_ide-extension-build',
      { priority: PREPARE_PRIORITY, reads: ['gen-parser', 'tao', 'ts'], writes: ['gen-ide'] },
    ],
    ['_tao-check', { cost: TAO_CHECK_COST, reads: ['gen-parser', 'tao', 'ts'] }],
    // The parser tsconfig includes Langium's generated tree. Typecheck retains its conservative
    // ordering after the app compile moved into the WordFlower project's cache.
    ['_typecheck', { cost: TYPECHECK_COST, reads: ['gen-app', 'gen-parser', 'ts'] }],
    [
      'ship-bundle-proof',
      {
        cost: SHIP_BUNDLE_PROOF_COST,
        // The proof exports real iOS bundles through Expo and compares them; the result depends on
        // the host toolchain, so it is never recorded green.
        hostDependent: true,
        reads: ['gen-app', 'gen-parser', 'tao', 'ts'],
        timeoutMs: SHIP_BUNDLE_PROOF_TIMEOUT_MS,
      },
    ],

    // Browser smokes have separate ports, artifacts and disposable launch projects. The native
    // shell and canary contend on the window server, which is what `gui` names. Each smoke gate
    // is named for its public recipe.
    [
      'studio-smoke',
      studioSmoke('studio-smoke', 'packages/ides/studio-tooling/studio-smoke/studio-launch.test.ts'),
    ],
    [
      'studio-proof-real-app',
      studioSmoke('studio-proof-real-app', 'packages/ides/studio-tooling/studio-smoke/studio-real-app.test.ts'),
    ],
    [
      'studio-smoke-simulated-user',
      studioSmoke(
        'studio-smoke-simulated-user',
        'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts',
      ),
    ],
    [
      'keyboard-navigation-smoke',
      studioSmoke(
        'keyboard-navigation-smoke',
        'packages/ides/studio-tooling/studio-smoke/runtime-keyboard-navigation.test.ts',
      ),
    ],
    [
      'studio-dialog-browser',
      studioSmoke('studio-dialog-browser', 'packages/ides/studio-tooling/studio-smoke/studio-dialog-browser.test.ts'),
    ],
    [
      'studio-agent-browser',
      studioSmoke('studio-agent-browser', 'packages/ides/studio-tooling/studio-smoke/studio-agent-browser.test.ts'),
    ],
    [
      'studio-network-simulation',
      studioSmoke(
        'studio-network-simulation',
        'packages/ides/studio-tooling/studio-smoke/studio-network-simulation.test.ts',
      ),
    ],
    // The two `gui` nodes cannot overlap each other, so together they are a ~21s serial floor of
    // their own. They start at t=0 for that reason, ahead of work that can be packed later. `gui` is
    // also the resource name `GateRunner` takes a machine-wide lease under for as long as either is
    // in flight, so a peer worktree's `gui` node — or a standalone `studio-smoke-native` /
    // `studio-canary` recipe run outside `./dev gates` — cannot overlap these either.
    [
      'studio-smoke-native',
      {
        ...studioSmoke(
          'studio-smoke-native',
          'packages/ides/studio-tooling/studio-smoke/studio-simulated-user.test.ts',
          {
            native: true,
            resources: [GUI_RESOURCE],
          },
        ),
        priority: GUI_PRIORITY,
        requiresMacOS: true,
      },
    ],
    // The canary once hung after printing its verdict on a launch-owned process that survived
    // shutdown; `completeNativeProbe` now stops Hutch when the probe resolves, and a healthy run
    // takes ~10s. The bound stays so a regression fails the node instead of holding the lane open.
    [
      'studio-canary',
      {
        ...studioLane([GUI_RESOURCE]),
        optionalVisibleSurface: 'studio',
        priority: GUI_PRIORITY,
        requiresMacOS: true,
        timeoutMs: STUDIO_CANARY_TIMEOUT_MS,
      },
    ],
  ])
}

const CATALOG = buildCatalog()

/** The class every recipe-backed node reads, because running it parses the Justfile. */
const RECIPE_CLASS: SourceClass = 'just'

/** metadata returns one node's scheduling shape, or the untuned default for an unknown recipe. */
function metadata(name: string): GateMetadata {
  return CATALOG.get(name) ?? DEFAULT_METADATA
}

/** isPrepare reports whether a node rewrites anything, which is what puts it in the prepare phase. */
function isPrepare(name: string): boolean {
  return (metadata(name).writes ?? []).length > 0
}

/**
 * isRecordable reports whether a node's verdict is fully described by the tree that produced it.
 *
 * A node that writes nothing qualifies unless its verdict depended on the host. A node that writes
 * qualifies only by saying so with `canonicalises`, because the safe answer for a writer is no and a
 * writer added later must not inherit a yes it never asked for: a generator's output is Git-ignored
 * and therefore outside the tree hash, so a matching hash cannot attest that the generated tree is
 * current, or that it exists at all — a fresh checkout hashes identically to one that has it.
 *
 * `canonicalises` is necessary but not sufficient. A fixer's record is only sound when the prepare
 * phase left the tree it ran against untouched, and `GateRunner` is what establishes that; this
 * function cannot see it.
 */
function isRecordable(name: string): boolean {
  const gate = metadata(name)
  if (gate.hostDependent === true) {
    return false
  }
  return (gate.writes ?? []).length === 0 || gate.canonicalises === true
}

/**
 * The source classes a gate generates rather than a person writes. Their trees are Git-ignored, so
 * the tree hash a green record is keyed by says nothing about whether they exist or are current — a
 * fresh checkout hashes identically to one that has them.
 */
const GENERATED_CLASSES: readonly SourceClass[] = ['gen-app', 'gen-ide', 'gen-parser']

/**
 * unrunGeneratedReads names the generated classes a node reads whose writer this lane does not run.
 *
 * A reader's verdict is only as current as the generated trees it read, and no tree hash attests to
 * those. When the writer runs in the same lane the reader is safe, because a generator is never
 * recordable and so always regenerates. When it does not — a narrow `./dev gates` lane, or a lane
 * list someone trims later — the reader's record would be asserting a generated tree it cannot see,
 * and it has to run instead. This is the one remaining way a green record could outrun its inputs,
 * so it is answered here rather than left to whoever writes the next lane list.
 */
function unrunGeneratedReads(name: string, lane: readonly string[]): SourceClass[] {
  const running = new Set(lane)
  return (metadata(name).reads ?? [])
    .filter(sourceClass => GENERATED_CLASSES.includes(sourceClass))
    .filter(sourceClass => {
      const writer = writerOf(sourceClass)
      return writer === undefined || !running.has(writer)
    })
}

/** writerOf names the node that rewrites one class, when the catalog has one. */
function writerOf(sourceClass: SourceClass): string | undefined {
  for (const [name, gate] of CATALOG) {
    if ((gate.writes ?? []).includes(sourceClass)) {
      return name
    }
  }
  return undefined
}

/**
 * dependenciesOf resolves the edges one node runs under: what it declared, plus the writer of every
 * class it reads. A recipe-backed node also reads the Justfile, because that is what starts it.
 */
function dependenciesOf(name: string, gate: GateMetadata = metadata(name)): readonly string[] {
  const reads = new Set<SourceClass>(gate.reads ?? [])
  if (gate.run === undefined) {
    reads.add(RECIPE_CLASS)
  }
  const needs = new Set<string>(gate.needs ?? [])
  for (const sourceClass of reads) {
    const writer = writerOf(sourceClass)
    if (writer !== undefined && writer !== name) {
      needs.add(writer)
    }
  }
  return [...needs]
}

/** node turns one gate name into the work-graph node that runs it. */
function node(name: string, repositoryRoot: string): WorkNode {
  const {
    hostDependent: _hostDependent,
    reads: _reads,
    requiresMacOS: _requiresMacOS,
    requiresUnsandboxed: _requiresUnsandboxed,
    run,
    usesWatchman: _usesWatchman,
    writes: _writes,
    ...scheduling
  } = metadata(name)
  const inRepository = (command: GateCommand): WorkCommand => ({
    ...command,
    cwd: repositoryRoot,
    ...((scheduling.resources ?? []).includes(GUI_RESOURCE)
      ? { env: { [GUI_LEASE_HELD_ENV_KEY]: 'true' } }
      : {}),
  })
  return {
    ...scheduling,
    needs: dependenciesOf(name),
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

/**
 * testDependencies is the edge set a generated test node runs under. Suites and shards are built by
 * `TestNodes` from what this checkout actually contains, so they cannot be table rows; what they
 * share is this one declared relationship to the prepare phase, stated here with everything else.
 * A test node runs its runner directly rather than through a recipe, so it does not read the
 * Justfile and `_fix-just-fmt` is not among its edges.
 */
function testDependencies(reads: readonly SourceClass[]): readonly string[] {
  return dependenciesOf('', { reads, run: { args: [], command: '' } })
}

/** suiteTuning returns one suite's declared scheduling shape, or the defaults every suite gets. */
function suiteTuning(suite: string): SuiteTuning {
  return SUITE_TUNING.get(suite) ?? {}
}

/**
 * reportsAttributableDurations answers whether a suite's per-test durations mean what they say.
 *
 * Under `--concurrent` Bun reports every test in a file as the time from that file's shared start to
 * its own completion, so a test's recorded duration grows with how many of its neighbours finish
 * after it rather than with its own work: `studio-dev.test.ts` runs 61 tests in 3.3s and the ledger
 * held a dozen of its cases at ~6.20s each. Nothing downstream can repair that, so the judgment
 * lives here and the ledger declines to record the number at all. Shard packing asks the same
 * question, and asking it in one place is what keeps the two answers from drifting apart.
 */
function reportsAttributableDurations(suite: string): boolean {
  return !(suiteTuning(suite).args ?? []).includes('--concurrent')
}

/** suiteReads returns the file classes a suite reads: its declared narrowing, or the whole tree. */
function suiteReads(suite: string): readonly SourceClass[] {
  return suiteTuning(suite).reads ?? DEFAULT_SUITE_READS
}

/** machineWidth is the whole machine, which is what a single graph of small nodes now packs into. */
function machineWidth(): number {
  return Platform.cpuCount()
}

/** GateCatalog owns the scheduling metadata every node in every lane runs under. */
export const GateCatalog = {
  BUN_SUITE_FIXED_MS,
  DEFAULT_METADATA,
  DEFAULT_SUITE_READS,
  GUI_PRIORITY,
  GUI_LEASE_HELD_ENV_KEY,
  GUI_RESOURCE,
  PREPARE_PRIORITY,
  STUDIO_LANE_COST,
  STUDIO_SMOKE_POOL,
  TAO_CHECK_COST,
  TAO_TEST_BUDGET_KEY: WorkGraph.BUDGET_ENV_KEYS.taoTest,
  TYPECHECK_COST,
  dependenciesOf,
  isPrepare,
  isRecordable,
  machineWidth,
  metadata,
  node,
  reportsAttributableDurations,
  suiteReads,
  suiteTuning,
  testDependencies,
  unrunGeneratedReads,
  writerOf,
} as const
