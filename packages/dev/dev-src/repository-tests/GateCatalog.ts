import { Platform } from '@shared'
import { WorkGraph, type WorkNode } from './WorkGraph'

/**
 * What the scheduler needs to know about each Justfile gate: what must pass before it starts, how
 * much of the machine it occupies while it runs, which exclusive device it holds, and whether it
 * rewrites the tree.
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

/** GateMetadata is one gate's scheduling shape, in the vocabulary `WorkNode` already speaks. */
export type GateMetadata = Pick<
  WorkNode,
  'budgetEnvKeys' | 'cost' | 'mutatesTree' | 'needs' | 'priority' | 'resources' | 'timeoutMs'
>

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
/** Wide enough that a Studio lane is not starved, narrow enough that four fit at once. */
const STUDIO_LANE_COST = 3
/** Generous against a healthy canary run; a bound against a post-report hang regressing. */
const STUDIO_CANARY_TIMEOUT_MS = 300_000
const SHIP_BUNDLE_PROOF_TIMEOUT_MS = 180_000

/**
 * Start-order pins. Measured durations order nodes within a priority; these say which node should
 * be looked at first when several are ready at once. The Studio lanes dominate `full-verify`'s wall
 * time, and `_test` and `_typecheck` dominate every other lane's.
 */
const STUDIO_LANE_PRIORITY = 5
const TEST_PRIORITY = 4
const TYPECHECK_PRIORITY = 3

/**
 * testCost reserves most of the machine for `_test` while leaving `_typecheck` and `_tao-check`
 * room to run beside it. The reservation is also the nested runner's own worker budget, so it is
 * the one number that decides both how much of the lane `_test` occupies and how much parallelism
 * `./dev test` gets inside it.
 */
function testCost(): number {
  return Math.max(2, Platform.cpuCount() - SLOTS_BESIDE_TEST)
}

/** studioLane is the shape every `full-verify` Studio node shares. */
function studioLane(resources?: readonly string[]): GateMetadata {
  return {
    cost: STUDIO_LANE_COST,
    // Every Studio lane dies on a missing `_gen_tao-parser`, and none of them may read the tree
    // while `fix` is still rewriting it; the mutates-tree barrier handles the second half.
    needs: ['_parser-gen'],
    priority: STUDIO_LANE_PRIORITY,
    resources,
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
    [
      '_test',
      {
        // `just _test` hides the nested runner behind a recipe name, so the graph cannot infer the
        // budget key from the command it starts. Naming it here is what makes `cost` an enforced
        // bound on `./dev test` rather than a reservation it ignores.
        budgetEnvKeys: [WorkGraph.BUDGET_ENV_KEYS.devTest],
        cost: testCost(),
        // The tao-apps suite runs against the compiled WordFlower app, and a stale generated app is
        // worse than a slow one.
        needs: ['_compile-word-flower-app'],
        priority: TEST_PRIORITY,
      },
    ],

    // Sub-second gates that read the tree and nothing else.
    ['_dprint-check', {}],
    ['_repo-lint', {}],
    ['_runtime-pack-check', {}],
    ['dead-exports', {}],
    ['_doctor-json', {}],
    [
      '_ship-bundle-proof',
      {
        cost: STUDIO_LANE_COST,
        needs: ['_parser-gen'],
        timeoutMs: SHIP_BUNDLE_PROOF_TIMEOUT_MS,
      },
    ],

    // The three browser lanes are parallel-safe on distinct worker indices; the native shell and
    // the canary contend on the window server, which is what `gui` names.
    ['_full-verify-smoke-launch', studioLane()],
    ['_full-verify-real-app', studioLane()],
    ['_full-verify-simulated', studioLane()],
    ['_full-verify-native', studioLane(['gui'])],
    // The canary once hung after printing its verdict on a launch-owned process that survived
    // shutdown; `completeNativeProbe` now stops Hutch when the probe resolves, and a healthy run
    // takes ~10s. The bound stays so a regression fails the node instead of holding the lane open.
    ['_full-verify-canary', { ...studioLane(['gui']), timeoutMs: STUDIO_CANARY_TIMEOUT_MS }],
  ])
}

const CATALOG = buildCatalog()

/** metadata returns one gate's scheduling shape, or the untuned default for an unknown recipe. */
function metadata(name: string): GateMetadata {
  return CATALOG.get(name) ?? DEFAULT_METADATA
}

/** node turns one Justfile recipe name into the work-graph node that runs it. */
function node(name: string, repositoryRoot: string): WorkNode {
  return {
    ...metadata(name),
    // Logs and dashboard tiles have always named a gate without its private-recipe underscore.
    label: name.replace(/^_/, ''),
    name,
    run: { args: [name], command: 'just', cwd: repositoryRoot },
  }
}

/** GateCatalog owns the scheduling metadata every Justfile gate runs under. */
export const GateCatalog = {
  DEFAULT_METADATA,
  STUDIO_LANE_COST,
  TAO_CHECK_COST,
  TYPECHECK_COST,
  metadata,
  node,
  testCost,
} as const
