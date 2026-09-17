import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { GateCatalog } from '../dev-src/repository-tests/GateCatalog'
import { runGates } from '../dev-src/repository-tests/GateRunner'
import { GreenTree } from '../dev-src/repository-tests/GreenTree'
import type { GateSummary } from '../dev-src/repository-tests/RunSummary'
import { type TestHistoryEvent, TestLedger } from '../dev-src/repository-tests/TestLedger'

/**
 * A tree hash describes the bytes a lane read, and nothing else. Two kinds of verdict it therefore
 * cannot carry are the whole subject here: one that depended on the host it ran on, and one whose
 * output is derived state the tree does not contain. Recording either is the only way this design
 * can hand back a green it has not earned, so each of these tests runs a lane twice at one tree and
 * asserts what the second run did — never what the first one called itself.
 */

const HOST_DEPENDENT_GATE = 'studio-canary'
const RECORDABLE_GATE = '_repo-lint'
const PREPARE_GATE = '_parser-gen'
const SUITE_PACKAGE = 'alpha'
const SUITE_TEST_FILE = `packages/${SUITE_PACKAGE}/${SUITE_PACKAGE}-tests/one.test.ts`
const OUTFILE_FLAG = '--reporter-outfile='

type LaneRun = { started: string[]; summary: GateSummary }

type LaneOptions = {
  gates: readonly string[]
  hash: string
  lane?: string
  lanes?: readonly string[]
  /** Writes each node's native report, so a suite node can pass the way a real one does. */
  reportTests?: boolean
}

/**
 * runLane starts one lane over a temporary checkout with an injected tree hash, so two runs can be
 * given a byte-identical tree without touching a file.
 */
async function runLane(root: string, options: LaneOptions): Promise<LaneRun> {
  const lanes = options.lanes ?? [options.lane ?? 'verify']
  const started: string[] = []
  const summary = await runGates({
    gates: options.gates,
    greenTree: { hashTree: async () => options.hash, lanes },
    jobs: 2,
    lane: options.lane ?? lanes[0],
    registryRoot: FS.resolvePath('registry', root),
    repositoryRoot: root,
    runGate: async (name, logPath, _environment, run) => {
      started.push(name)
      if (options.reportTests === true) {
        await writeNativeReport(run.args)
      }
      await FS.writeText(logPath, `${name} ok\n`)
      return { exitCode: 0, output: '' }
    },
  })
  return { started, summary }
}

/**
 * writeNativeReport publishes the JUnit report a Bun suite node would have written. Without it a
 * passing suite process is turned into a failure over its missing report, and a failed run records
 * nothing at all, which would make every assertion below vacuous.
 */
async function writeNativeReport(args: readonly string[]): Promise<void> {
  const outfile = args.find(argument => argument.startsWith(OUTFILE_FLAG))?.slice(OUTFILE_FLAG.length)
  const files = args.filter(argument => argument.endsWith('.test.ts'))
  if (outfile === undefined || files.length === 0) {
    return
  }
  const cases = files
    .map(file => `<testcase name="works" classname="suite" file="${file}" time="0.01"/>`)
    .join('\n')
  await FS.writeText(
    outfile,
    `<testsuites tests="${files.length}">\n<testsuite name="suite">\n${cases}\n</testsuite>\n</testsuites>\n`,
  )
}

/** flakeEvent is one history line, written exactly as `TestLedger.flakes` reads them back. */
function flakeEvent(outcome: 'failed' | 'passed', recordedAt: string): TestHistoryEvent {
  const id = TestLedger.testId({ file: SUITE_TEST_FILE, name: 'flips under load', suite: SUITE_PACKAGE })
  return {
    durationMs: 10,
    file: SUITE_TEST_FILE,
    // The same identity in both events is what makes this a flake rather than a changed test.
    fileIdentity: 'identity-unchanged',
    id,
    lastRunAt: recordedAt,
    name: 'flips under load',
    outcome,
    recordedAt,
    suite: SUITE_PACKAGE,
    version: 1,
  }
}

Describe('gates a green record never covers', () => {
  Test('never records a host-dependent gate, and runs it again at the same tree', async () => {
    // The policy is the catalog's to declare; asserting on it here is meaningless if the gate under
    // test is not actually declared host-dependent.
    Expect(GateCatalog.metadata(HOST_DEPENDENT_GATE).hostDependent).toBe(true)
    Expect(GateCatalog.isRecordable(HOST_DEPENDENT_GATE)).toBe(false)
    Expect(GateCatalog.isRecordable(RECORDABLE_GATE)).toBe(true)
    Expect(GateCatalog.metadata('ship-bundle-proof').hostDependent).toBe(true)

    const root = await mkTestDir('tao-green-host-')
    try {
      const gates = [HOST_DEPENDENT_GATE, RECORDABLE_GATE]
      const first = await runLane(root, { gates, hash: 'tree-1', lanes: ['full-verify'] })
      Expect(first.summary.status).toBe('passed')
      Expect(first.started.toSorted()).toEqual([RECORDABLE_GATE, HOST_DEPENDENT_GATE].toSorted())

      // Everything passed, and the host-dependent gate still earned no record of its own.
      const store = await GreenTree.load(root)
      Expect(store.gates[RECORDABLE_GATE]?.treeHash).toBe('tree-1')
      Expect(store.gates[HOST_DEPENDENT_GATE]).toBeUndefined()
      Expect(await FS.exists(FS.resolvePath(`${GreenTree.STORE_DIR}/gate-studio-canary.json`, root))).toBe(false)

      // Same tree, same toolchain, a lane no whole-lane record covers: the recordable gate stands on
      // its record and the host-dependent one goes back to the machine, because this host is not
      // the host that proved it.
      const second = await runLane(root, { gates, hash: 'tree-1', lanes: ['verify'] })
      Expect(second.started).toEqual([HOST_DEPENDENT_GATE])
      const skipped = second.summary.gates.find(gate => gate.name === RECORDABLE_GATE)
      Expect(skipped?.status).toBe('skipped')
      Expect(skipped?.reason).toContain('proved green at this tree')
      Expect(second.summary.gates.find(gate => gate.name === HOST_DEPENDENT_GATE)?.status).toBe('passed')
    } finally {
      await FS.remove(root)
    }
  })

  Test('never records a prepare node, whose output no tree hash describes', async () => {
    Expect(GateCatalog.isPrepare(PREPARE_GATE)).toBe(true)
    Expect(GateCatalog.isRecordable(PREPARE_GATE)).toBe(false)

    const root = await mkTestDir('tao-green-prepare-')
    try {
      const gates = [PREPARE_GATE, RECORDABLE_GATE]
      const first = await runLane(root, { gates, hash: 'tree-1', lanes: ['full-verify'] })
      Expect(first.summary.status).toBe('passed')

      const store = await GreenTree.load(root)
      Expect(store.gates[RECORDABLE_GATE]?.treeHash).toBe('tree-1')
      // The generated parser is not in the tree hash, so only running it proves it is there.
      Expect(store.gates[PREPARE_GATE]).toBeUndefined()

      const second = await runLane(root, { gates, hash: 'tree-1', lanes: ['verify'] })
      Expect(second.started).toEqual([PREPARE_GATE])
    } finally {
      await FS.remove(root)
    }
  })

  Test('sends a test node covering a known flake back to the machine, and says why', async () => {
    const root = await mkTestDir('tao-green-flake-')
    try {
      await FS.writeText(
        FS.resolvePath(SUITE_TEST_FILE, root),
        "import { Describe, Expect, Test } from '@shared/test'\n",
      )
      const first = await runLane(root, { gates: ['_test'], hash: 'tree-1', lanes: ['full-verify'], reportTests: true })
      Expect(first.summary.status).toBe('passed')
      Expect(first.started).toContain(SUITE_PACKAGE)
      Expect((await GreenTree.load(root)).gates[SUITE_PACKAGE]?.treeHash).toBe('tree-1')

      // One outcome reversal with the file's identity unchanged is exactly what the ledger calls a
      // flake, and no tree hash can see it.
      await FS.writeText(
        FS.resolvePath(TestLedger.HISTORY_PATH, root),
        `${JSON.stringify(flakeEvent('passed', '2026-01-01T00:00:00.000Z'))}\n`
          + `${JSON.stringify(flakeEvent('failed', '2026-01-02T00:00:00.000Z'))}\n`,
      )
      Expect((await TestLedger.flakes(root)).map(flake => flake.file)).toContain(SUITE_TEST_FILE)

      const second = await runLane(root, { gates: ['_test'], hash: 'tree-1', lanes: ['verify'], reportTests: true })

      // The node owning the flaky file ran even though its record matched, and the summary names it
      // rather than leaving a surprising re-run unexplained.
      Expect(second.started).toEqual([SUITE_PACKAGE])
      Expect(second.summary.warnings).toContain(
        `${SUITE_PACKAGE}: proved green at this tree by an earlier run, but that record was excluded; `
          + 'running it again.',
      )
      // Every other suite node still stood on its record, so the exclusion is the flake's and not a
      // whole run thrown away.
      Expect(second.summary.gates.find(gate => gate.name === 'tao-apps')?.status).toBe('skipped')
      Expect(second.summary.gates.find(gate => gate.name === SUITE_PACKAGE)?.status).toBe('passed')
    } finally {
      await FS.remove(root)
    }
  })

  Test('invalidates every record when the pinned toolchain changes under an identical tree', async () => {
    const root = await mkTestDir('tao-green-toolchain-')
    const profileLink = FS.resolvePath('.devenv/profile', root)
    try {
      await FS.mkdir(FS.resolvePath('.devenv', root))
      await FS.replaceSymlink('/nix/store/tao-toolchain-a', profileLink)
      Expect(await GreenTree.toolchain(root)).toBe('/nix/store/tao-toolchain-a')

      const first = await runLane(root, { gates: [RECORDABLE_GATE], hash: 'tree-1' })
      Expect(first.started).toEqual([RECORDABLE_GATE])
      Expect((await GreenTree.load(root)).lanes['verify']?.toolchain).toBe('/nix/store/tao-toolchain-a')

      // A new profile is a new bun, node, just and dprint over the same bytes, so the earlier
      // verdict says nothing about what these tools would report.
      await FS.replaceSymlink('/nix/store/tao-toolchain-b', profileLink)
      const retooled = await runLane(root, { gates: [RECORDABLE_GATE], hash: 'tree-1' })
      Expect(retooled.summary.greenTree).toBeUndefined()
      Expect(retooled.started).toEqual([RECORDABLE_GATE])

      // The record written under the new toolchain is honored, so it was the toolchain and not a
      // broken record that sent the previous run back to the machine.
      const settled = await runLane(root, { gates: [RECORDABLE_GATE], hash: 'tree-1' })
      Expect(settled.started).toEqual([])
      Expect(settled.summary.greenTree?.toolchain).toBe('/nix/store/tao-toolchain-b')
      Expect(settled.summary.status).toBe('passed')
    } finally {
      await FS.remove(root)
    }
  })
})
