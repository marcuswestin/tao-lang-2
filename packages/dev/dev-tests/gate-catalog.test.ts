import { FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, settle, Test } from '@shared/test'
import { GateCatalog } from '../dev-src/repository-tests/GateCatalog'
import { runGates } from '../dev-src/repository-tests/GateRunner'
import { WorkGraph } from '../dev-src/repository-tests/WorkGraph'

/**
 * The catalog is metadata, so most of it is asserted as metadata. The three claims that are about
 * scheduling rather than data — the dependency edge, the fix barrier, and the `gui` pair — are
 * proved by running a lane through an injected runner, where a node finishes only when the test
 * lets it and an overlap cannot be missed by being lucky with a sleep.
 */

const REPOSITORY_ROOT = '/repository'

function nodeOf(name: string) {
  return GateCatalog.node(name, REPOSITORY_ROOT)
}

/**
 * runLane records which nodes were running at the same moment. Tests that must prove two nodes can
 * overlap use a start barrier so filesystem-backed admission timing cannot let the first finish
 * before the second is admitted.
 */
async function runLane(gates: readonly string[], jobs: number, startBarrierCount = 0) {
  const root = await mkTestDir('tao-gate-catalog-')
  try {
    const running = new Set<string>()
    const overlaps: string[][] = []
    const started: string[] = []
    let releaseStartBarrier = () => {}
    const startBarrier = new Promise<void>(resolve => {
      releaseStartBarrier = resolve
    })
    await runGates({
      gates,
      jobs,
      logRoot: FS.resolvePath('logs', root),
      registryRoot: FS.resolvePath('registry', root),
      repositoryRoot: root,
      runGate: async name => {
        started.push(name)
        running.add(name)
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
    return { overlaps, started }
  } finally {
    await FS.remove(root)
  }
}

/** overlapped reports whether two nodes were ever recorded running at the same moment. */
function overlapped(overlaps: readonly string[][], left: string, right: string): boolean {
  return overlaps.some(names => names.includes(left) && names.includes(right))
}

Describe('gate catalog metadata', () => {
  Test('runs an unknown recipe as an ordinary single-slot node with no edges', () => {
    const node = nodeOf('_a-recipe-nobody-tuned')

    Expect(GateCatalog.metadata('_a-recipe-nobody-tuned')).toEqual(GateCatalog.DEFAULT_METADATA)
    Expect(node.cost).toBe(1)
    Expect(node.needs).toBeUndefined()
    Expect(node.mutatesTree).toBeUndefined()
    Expect(node.resources).toBeUndefined()
    Expect(node.run).toEqual({ args: ['_a-recipe-nobody-tuned'], command: 'just', cwd: REPOSITORY_ROOT })
  })

  Test('names a gate without its private-recipe underscore', () => {
    Expect(nodeOf('_repo-lint').label).toBe('repo-lint')
    Expect(nodeOf('dead-exports').label).toBe('dead-exports')
  })

  Test('waits for the generated parser in every gate that reads it', () => {
    Expect(nodeOf('_compile-word-flower-app').needs).toEqual(['_parser-gen'])
    Expect(nodeOf('_tao-check').needs).toEqual(['_parser-gen'])
    Expect(nodeOf('_ide-extension-build').needs).toEqual(['_parser-gen'])
    Expect(nodeOf('_fix-tao').needs).toEqual(['_parser-gen'])
    Expect(nodeOf('_full-verify-simulated').needs).toEqual(['_parser-gen'])
  })

  Test('waits for the compiled WordFlower app before the test lane runs', () => {
    Expect(nodeOf('_test').needs).toEqual(['_compile-word-flower-app'])
  })

  Test('starts the tree-reading gates that depend on nothing at once', () => {
    for (const name of ['_repo-lint', '_dprint-check', '_typecheck', '_runtime-pack-check']) {
      Expect(nodeOf(name).needs).toBeUndefined()
    }
  })

  Test('marks every node that rewrites the tree, and nothing that only reads it', () => {
    for (const name of ['_fix-dprint', '_fix-tao', '_fix-just-fmt', '_parser-gen', '_compile-word-flower-app']) {
      Expect(nodeOf(name).mutatesTree).toBe(true)
    }
    for (const name of ['_typecheck', '_test', '_repo-lint', '_tao-check', '_full-verify-native']) {
      Expect(nodeOf(name).mutatesTree).toBeUndefined()
    }
  })

  Test('formats the Justfile only once no sibling gate is parsing it', () => {
    Expect(nodeOf('_fix-just-fmt').needs).toEqual(['_fix-dprint', '_fix-tao'])
  })

  Test('reserves the test lane wide enough to leave typecheck and tao-check beside it', () => {
    const testCost = nodeOf('_test').cost ?? 0

    Expect(testCost).toBe(Math.max(2, Platform.cpuCount() - 6))
    Expect(nodeOf('_typecheck').cost).toBe(3)
    Expect(nodeOf('_tao-check').cost).toBe(2)
    // The whole point of the reservation: all three fit at once, so none of them holds the queue.
    Expect(testCost + 3 + 2).toBeLessThanOrEqual(Math.max(6, Platform.cpuCount()))
  })

  Test('hands the nested test runner the budget the graph reserved for it', () => {
    Expect(nodeOf('_test').budgetEnvKeys).toEqual([WorkGraph.BUDGET_ENV_KEYS.devTest])
    // `just _test` hides `./dev test`, so nothing else can infer the key from the command.
    Expect(nodeOf('_test').run.command).toBe('just')
  })

  Test('schedules the real ship bundle proof as a bounded slow lane', () => {
    Expect(GateCatalog.metadata('_ship-bundle-proof')).toEqual({
      cost: GateCatalog.STUDIO_LANE_COST,
      needs: ['_parser-gen'],
      timeoutMs: 180_000,
    })
  })

  Test('starts the Studio lanes before the package gates and keeps four of them fitting at once', () => {
    for (
      const name of [
        '_full-verify-smoke-launch',
        '_full-verify-real-app',
        '_full-verify-simulated',
        '_full-verify-native',
        '_full-verify-canary',
      ]
    ) {
      Expect(nodeOf(name).cost).toBe(3)
      Expect(nodeOf(name).priority).toBe(5)
    }
    Expect(nodeOf('_test').priority).toBe(4)
    Expect(nodeOf('_typecheck').priority).toBe(3)
  })

  Test('gives only the two window-server lanes the gui resource', () => {
    Expect(nodeOf('_full-verify-native').resources).toEqual(['gui'])
    Expect(nodeOf('_full-verify-canary').resources).toEqual(['gui'])
    Expect(nodeOf('_full-verify-smoke-launch').resources).toBeUndefined()
    Expect(nodeOf('_full-verify-real-app').resources).toBeUndefined()
    Expect(nodeOf('_full-verify-simulated').resources).toBeUndefined()
  })

  Test('marks exactly the five Studio lanes as requiring an unsandboxed host', () => {
    const studioLanes = [
      '_full-verify-smoke-launch',
      '_full-verify-real-app',
      '_full-verify-simulated',
      '_full-verify-native',
      '_full-verify-canary',
    ]

    for (const name of studioLanes) {
      Expect(GateCatalog.metadata(name).requiresUnsandboxed).toBe(true)
    }
    for (const name of ['_ship-bundle-proof', '_doctor-json', 'dead-exports', '_test']) {
      Expect(GateCatalog.metadata(name).requiresUnsandboxed).toBeUndefined()
    }
  })
})

Describe('gate catalog scheduling', () => {
  Test('keeps full and sandbox verification on one identical gate membership', async () => {
    const [full, sandbox] = await Promise.all([
      justGateNames('full-verify'),
      justGateNames('full-verify-sandbox'),
    ])

    Expect(full).toEqual(sandbox)
    Expect(full).toContain('_ship-bundle-proof')
    Expect(full).toContain('_full-verify-canary')
  })

  Test('runs the generator, then the compile, then the tests', async () => {
    const { started } = await runLane(['_test', '_compile-word-flower-app', '_parser-gen'], 24)

    Expect(started).toEqual(['_parser-gen', '_compile-word-flower-app', '_test'])
  })

  Test('finishes every fix step before a gate reads the tree', async () => {
    const { overlaps, started } = await runLane(
      ['_typecheck', '_repo-lint', '_fix-dprint', '_fix-tao', '_parser-gen'],
      24,
    )

    Expect(started.slice(0, 2).toSorted()).toEqual(['_fix-dprint', '_parser-gen'])
    Expect(started.slice(-2).toSorted()).toEqual(['_repo-lint', '_typecheck'])
    Expect(overlapped(overlaps, '_fix-dprint', '_typecheck')).toBe(false)
    Expect(overlapped(overlaps, '_fix-tao', '_repo-lint')).toBe(false)
  })

  Test('keeps the gui lanes exclusive and lets the browser lane overlap either one', async () => {
    // Each pair fits inside 24 slots. The barrier makes allowed overlap deterministic, while the
    // two gui nodes must still run sequentially because they hold the same resource.
    const guiPair = await runLane(['_full-verify-native', '_full-verify-canary'], 24)
    const nativeAndBrowser = await runLane(['_full-verify-native', '_full-verify-simulated'], 24, 2)
    const canaryAndBrowser = await runLane(['_full-verify-canary', '_full-verify-simulated'], 24, 2)

    Expect(overlapped(guiPair.overlaps, '_full-verify-native', '_full-verify-canary')).toBe(false)
    Expect(overlapped(nativeAndBrowser.overlaps, '_full-verify-native', '_full-verify-simulated')).toBe(true)
    Expect(overlapped(canaryAndBrowser.overlaps, '_full-verify-canary', '_full-verify-simulated')).toBe(true)
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
