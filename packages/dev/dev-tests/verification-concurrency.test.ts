import { CLI, FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import { GateCatalog } from '../dev-src/repository-tests/GateCatalog'
import { runGates } from '../dev-src/repository-tests/GateRunner'
import { GreenTree } from '../dev-src/repository-tests/GreenTree'
import type { GateSummary } from '../dev-src/repository-tests/RunSummary'

/**
 * Two lanes in one checkout, started for real. Every property here is about what happens when two
 * `runGates` runs overlap — the prepare lock, the drift guard, the record files, the `latest` link —
 * and none of it can be established by reasoning about one run, so each test starts two.
 *
 * The lanes are given separate machine registries on purpose. They share the checkout, which is what
 * the prepare lock is keyed on, but not the machine-wide slot broker: if they shared it, a lane held
 * back by its share of the CPUs would look exactly like a lane held back by the prepare lock, and
 * the assertions below would pass for the wrong reason.
 */

/** Window is one gate's entry and exit, counted in run order rather than read from a clock. */
type Window = { enteredAt: number; exitedAt?: number }

const PREPARE_GATE = '_fix-dprint'
const READER_GATE = '_repo-lint'
/**
 * Budget for a lane reaching a phase: generous enough to survive a busy machine, and still under
 * the dev suite's own per-test timeout so a stuck lane reports the wait's own description.
 */
const LANE_WAIT_MS = 10_000

function overlap(left: Window | undefined, right: Window | undefined): boolean {
  if (left === undefined || right === undefined || left.exitedAt === undefined || right.exitedAt === undefined) {
    return false
  }
  return left.enteredAt < right.exitedAt && right.enteredAt < left.exitedAt
}

async function gitInit(root: string): Promise<void> {
  const result = await CLI.run('git', { args: ['init', '--quiet'], cwd: root, stdio: 'pipe' })
  Expect(result.exitCode).toBe(0)
  // Artifacts a lane writes are derived state, so they are outside the tree the run is proving.
  await FS.writeText(FS.resolvePath('.gitignore', root), '.artifacts/\n')
}

Describe('two lanes in one checkout', () => {
  Test('serializes the prepare phase and still lets the read-only phases overlap', async () => {
    const root = await mkTestDir('tao-verify-prepare-lock-')
    const registries = [await mkTestDir('tao-verify-lanes-a-'), await mkTestDir('tao-verify-lanes-b-')]
    const preparesHeld = Deferred()
    const readersHeld = Deferred()
    const windows = new Map<string, Window>()
    let order = 0

    // The gate table decides which node is a prepare node; asserting on the lock is meaningless if
    // the node under it is not one.
    Expect(GateCatalog.isPrepare(PREPARE_GATE)).toBe(true)
    Expect(GateCatalog.isPrepare(READER_GATE)).toBe(false)

    const lane = async (name: string, registryRoot: string): Promise<GateSummary> =>
      await runGates({
        gates: [PREPARE_GATE, READER_GATE],
        jobs: 2,
        lane: name,
        logRoot: FS.resolvePath(`logs-${name}`, root),
        registryRoot,
        repositoryRoot: root,
        runGate: async gate => {
          const key = `${name}:${gate}`
          windows.set(key, { enteredAt: order += 1 })
          await (gate === PREPARE_GATE ? preparesHeld.promise : readersHeld.promise)
          windows.get(key)!.exitedAt = order += 1
          return { exitCode: 0, output: '' }
        },
      })

    const runs = [lane('alpha', registries[0]!), lane('beta', registries[1]!)]
    try {
      await until(() => windows.has(`alpha:${PREPARE_GATE}`) || windows.has(`beta:${PREPARE_GATE}`), {
        description: 'the first lane to enter its prepare phase',
        // The second lane polls the lock every 100ms, and this suite runs beside every other lane
        // on a shared machine; the budget is for that, not for a condition that needs the time.
        timeoutMs: LANE_WAIT_MS,
      })
      const first = windows.has(`alpha:${PREPARE_GATE}`) ? 'alpha' : 'beta'
      const second = first === 'alpha' ? 'beta' : 'alpha'
      await settle(20)

      // The second lane's whole prepare phase is still outside the lock: no fixer of its own has
      // started while the first lane's is in flight.
      Expect(windows.has(`${second}:${PREPARE_GATE}`)).toBe(false)

      preparesHeld.resolve()
      await until(
        () => windows.get(`alpha:${READER_GATE}`) !== undefined && windows.get(`beta:${READER_GATE}`) !== undefined,
        { description: 'both lanes to reach their read-only phase', timeoutMs: LANE_WAIT_MS },
      )
      readersHeld.resolve()
      const summaries = await Promise.all(runs)

      Expect(summaries.map(summary => summary.status)).toEqual(['passed', 'passed'])
      // The two prepare windows are disjoint, and the first one closed before the second opened.
      Expect(overlap(windows.get(`alpha:${PREPARE_GATE}`), windows.get(`beta:${PREPARE_GATE}`))).toBe(false)
      Expect(windows.get(`${first}:${PREPARE_GATE}`)!.exitedAt!)
        .toBeLessThan(windows.get(`${second}:${PREPARE_GATE}`)!.enteredAt)
      // The lock costs the read-only phases nothing: they did overlap.
      Expect(overlap(windows.get(`alpha:${READER_GATE}`), windows.get(`beta:${READER_GATE}`))).toBe(true)
    } finally {
      preparesHeld.resolve()
      readersHeld.resolve()
      // Both lanes must be finished before the checkout they are writing into is removed, however
      // this test ended.
      await Promise.allSettled(runs)
      await FS.remove(root)
      await Promise.all(registries.map(async registry => await FS.remove(registry)))
    }
  })

  Test('records nothing when the tree moved under the run, and says so', async () => {
    const root = await mkTestDir('tao-verify-drift-')
    const hashes = ['tree-before', 'tree-after']
    try {
      const summary = await runGates({
        gates: [READER_GATE],
        greenTree: { hashTree: async () => hashes.shift() ?? 'tree-after', lanes: ['verify'] },
        logRoot: FS.resolvePath('logs', root),
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
        runGate: async () => ({ exitCode: 0, output: '' }),
      })

      Expect(summary.gates.map(gate => gate.status)).toEqual(['passed'])
      // Every gate passed and the run still failed, because it is not evidence about any tree.
      Expect(summary.status).toBe('failed')
      // The injected hasher carries no per-path detail, so the warning cannot name paths here; the
      // named form is proved below over a real working tree.
      Expect(summary.warnings).toContain(
        'working tree changed while verification was running; this run is not green evidence',
      )
      const store = await GreenTree.load(root)
      Expect(store.lanes['verify']).toBeUndefined()
      Expect(store.gates[READER_GATE]).toBeUndefined()
      // Not merely unmatched: no record file for this lane was written at all.
      Expect(await FS.exists(FS.resolvePath(`${GreenTree.STORE_DIR}/lane-verify.json`, root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('names every path two fingerprints of one working tree disagree about', async () => {
    const root = await mkTestDir('tao-verify-fingerprint-')
    try {
      await gitInit(root)
      await FS.writeText(FS.resolvePath('kept.txt', root), 'kept\n')
      await FS.writeText(FS.resolvePath('rewritten.txt', root), 'before\n')
      await FS.writeText(FS.resolvePath('removed.txt', root), 'doomed\n')
      const before = await GreenTree.fingerprint(root)

      await FS.writeText(FS.resolvePath('rewritten.txt', root), 'after\n')
      await FS.remove(FS.resolvePath('removed.txt', root))
      await FS.writeText(FS.resolvePath('added.txt', root), 'new\n')
      const after = await GreenTree.fingerprint(root)

      Expect(before.hash).not.toBe(after.hash)
      Expect(GreenTree.changedPaths(before, after)).toEqual(['added.txt', 'removed.txt', 'rewritten.txt'])
      Expect(GreenTree.changedPaths(before, before)).toEqual([])
      Expect(before.paths.get('kept.txt')).toBe(after.paths.get('kept.txt'))
    } finally {
      await FS.remove(root)
    }
  })

  Test('names the path a gate changed under a real working tree', async () => {
    const root = await mkTestDir('tao-verify-drift-named-')
    const registryRoot = await mkTestDir('tao-verify-drift-lanes-')
    try {
      await gitInit(root)
      await FS.writeText(FS.resolvePath('kept.txt', root), 'kept\n')
      const summary = await runGates({
        gates: [READER_GATE],
        // No injected hasher: the run fingerprints this checkout itself, paths and all.
        greenTree: { lanes: ['verify'] },
        registryRoot,
        repositoryRoot: root,
        runGate: async () => {
          await FS.writeText(FS.resolvePath('drifted.txt', root), 'written by something else\n')
          return { exitCode: 0, output: '' }
        },
      })

      Expect(summary.status).toBe('failed')
      Expect(summary.warnings).toContain(
        'working tree changed while verification was running (drifted.txt); this run is not green evidence',
      )
      Expect((await GreenTree.load(root)).lanes['verify']).toBeUndefined()
    } finally {
      await FS.remove(root)
      await FS.remove(registryRoot)
    }
  })

  Test("leaves both lanes' records readable when two of them finish at once", async () => {
    const root = await mkTestDir('tao-verify-record-race-')
    const registries = [await mkTestDir('tao-verify-race-a-'), await mkTestDir('tao-verify-race-b-')]
    const gates = [READER_GATE, '_typecheck', 'dead-exports']
    try {
      const lane = async (name: string, registryRoot: string) =>
        await runGates({
          gates,
          greenTree: { hashTree: async () => 'shared-tree', lanes: [name] },
          jobs: 2,
          lane: name,
          logRoot: FS.resolvePath(`logs-${name}`, root),
          registryRoot,
          repositoryRoot: root,
          runGate: async () => ({ exitCode: 0, output: '' }),
        })
      const summaries = await Promise.all([lane('verify', registries[0]!), lane('full-verify', registries[1]!)])

      Expect(summaries.map(summary => summary.status)).toEqual(['passed', 'passed'])
      const store = await GreenTree.load(root)
      // Both lane records survived, and neither lane lost a gate record to the other's rename.
      Expect(store.lanes['verify']?.treeHash).toBe('shared-tree')
      Expect(store.lanes['full-verify']?.treeHash).toBe('shared-tree')
      Expect(gates.map(gate => store.gates[gate]?.treeHash)).toEqual(['shared-tree', 'shared-tree', 'shared-tree'])
      // Every file in the directory is a complete record, and no temporary file was orphaned.
      const files = await FS.listDir(FS.resolvePath(GreenTree.STORE_DIR, root))
      Expect(files.toSorted()).toEqual([
        'gate-_repo-lint.json',
        'gate-_typecheck.json',
        'gate-dead-exports.json',
        'lane-full-verify.json',
        'lane-verify.json',
      ])
      for (const file of files) {
        const record = await FS.readJson<{ kind: string; treeHash: string }>(
          FS.resolvePath(`${GreenTree.STORE_DIR}/${file}`, root),
        )
        Expect(record.treeHash).toBe('shared-tree')
      }
      // Two lanes at once is contention by `MachineLanes`' own definition, and a contended run
      // deliberately records no durations rather than teaching the planner a number it measured
      // while something else had the CPUs. Whether these two fast lanes actually observe each other
      // is a scheduling detail, so assert what each outcome requires instead of assuming one: no
      // store when the contention was seen, and a whole one — never a torn write — when it was not.
      const timingsPath = FS.resolvePath('.artifacts/timings/durations.json', root)
      const contended = summaries.some(summary => summary.contention?.contended === true)
      Expect(await FS.isFile(timingsPath)).toBe(!contended)
      if (!contended) {
        const timings = await FS.readJson<{ nodes: Record<string, { samples: number }> }>(timingsPath)
        Expect(Object.keys(timings.nodes).toSorted()).toEqual(gates.toSorted())
        Expect(Object.values(timings.nodes).every(node => node.samples >= 1)).toBe(true)
      }
    } finally {
      await FS.remove(root)
      await Promise.all(registries.map(async registry => await FS.remove(registry)))
    }
  })

  Test("leaves the lane's latest link pointing at one whole run", async () => {
    const root = await mkTestDir('tao-verify-latest-')
    const registries = [await mkTestDir('tao-verify-latest-a-'), await mkTestDir('tao-verify-latest-b-')]
    try {
      const lane = async (registryRoot: string) =>
        await runGates({
          gates: [READER_GATE],
          lane: 'verify',
          registryRoot,
          repositoryRoot: root,
          runGate: async () => ({ exitCode: 0, output: 'ok\n' }),
        })
      const summaries = await Promise.all([lane(registries[0]!), lane(registries[1]!)])

      const runRoots = await Promise.all(summaries.map(async summary => await FS.realPath(summary.logRoot)))
      Expect(new Set(runRoots).size).toBe(2)
      const latest = FS.resolvePath('.artifacts/logs/verify/latest', root)
      // The link resolves, and it resolves to one of the two real run directories rather than to a
      // path that was being created when the other lane repointed it.
      Expect(await FS.exists(latest)).toBe(true)
      const resolved = await FS.realPath(latest)
      Expect(runRoots.includes(resolved)).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('summary.json', latest))).toBe(true)
      Expect(await FS.readText(FS.resolvePath('repo-lint.log', latest))).toBe('ok\n')
    } finally {
      await FS.remove(root)
      await Promise.all(registries.map(async registry => await FS.remove(registry)))
    }
  })
})
