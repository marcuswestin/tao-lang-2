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
/** Every Studio smoke gate: the pool members the graph numbers. */
const STUDIO_SMOKES = [
  'studio-smoke',
  'studio-proof-real-app',
  'studio-smoke-simulated-user',
  'keyboard-navigation-smoke',
  'studio-dialog-browser',
  'studio-agent-browser',
  'studio-smoke-native',
]
/** Every gate that needs a host the managed sandbox denies: the smokes plus the native canary. */
const HOST_ONLY_GATES = [...STUDIO_SMOKES, 'studio-canary']

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
    Expect(nodeOf('studio-smoke-simulated-user').needs).toEqual(['_parser-gen'])
    Expect(nodeOf('keyboard-navigation-smoke').needs).toEqual(['_parser-gen'])
    Expect(nodeOf('studio-dialog-browser').needs).toEqual(['_parser-gen'])
    Expect(nodeOf('studio-agent-browser').needs).toEqual(['_parser-gen'])
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
    for (const name of ['_typecheck', '_test', '_repo-lint', '_tao-check', 'studio-smoke-native']) {
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
    Expect(commandOf(nodeOf('_test')).command).toBe('just')
  })

  Test('schedules the real ship bundle proof as a bounded slow lane under its public recipe', () => {
    Expect(GateCatalog.metadata('ship-bundle-proof')).toEqual({
      cost: 3,
      needs: ['_parser-gen'],
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

  Test('starts the package critical path before one-slot Studio waits', () => {
    for (const name of HOST_ONLY_GATES) {
      Expect(nodeOf(name).cost).toBe(1)
      Expect(nodeOf(name).priority).toBeUndefined()
    }
    Expect(nodeOf('_test').priority).toBe(4)
    Expect(nodeOf('_typecheck').priority).toBe(4)
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
    for (const name of ['ship-bundle-proof', '_doctor-json', 'dead-exports', '_test']) {
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

  Test('starts test and typecheck before auxiliary full-verification gates', async () => {
    const { started } = await runLane(
      [
        'studio-canary',
        'ship-bundle-proof',
        '_typecheck',
        '_test',
      ],
      GateCatalog.testCost() + 6,
      3,
    )

    Expect(started.slice(0, 2).toSorted()).toEqual(['_test', '_typecheck'])
    Expect(started[2]).toBe('ship-bundle-proof')
  })

  Test('uses the slots beside package work for three Studio waits at once', async () => {
    const { overlaps, started } = await runLane(
      [
        'studio-smoke',
        'studio-proof-real-app',
        'studio-smoke-simulated-user',
        'studio-smoke-native',
        '_typecheck',
        '_test',
      ],
      GateCatalog.testCost() + 6,
      5,
    )

    Expect(started.slice(0, 2).toSorted()).toEqual(['_test', '_typecheck'])
    Expect(overlaps.some(names =>
      names.includes('_test')
      && names.includes('_typecheck')
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
