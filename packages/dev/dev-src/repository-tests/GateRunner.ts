import { Errors, FS, Repo, Time } from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { FlakeTolerance } from './FlakeTolerance'
import { GateCatalog } from './GateCatalog'
import {
  GreenTree,
  type GreenTreeKey,
  type GreenTreeMatch,
  type GreenTreeRecord,
  type TreeFingerprint,
} from './GreenTree'
import {
  type ContentionReport,
  type LaneRecord,
  type MachineLane,
  MachineLanes,
  type MachineResourceLease,
} from './MachineLanes'
import { RunArtifacts } from './RunArtifacts'
import { buildSummary, type GateResult, type GateSummary, skippedResult } from './RunSummary'
import { RunTimings } from './RunTimings'
import { TestLedger } from './TestLedger'
import { TestNodes } from './TestNodes'
import { TestRunner } from './TestRunner'
import { TestShards } from './TestShards'
import { type WorkCommand, WorkGraph, type WorkOutcome, type WorkRunContext, type WorkState } from './WorkGraph'
import { type OutputMode, WorkReporter, type WorkReporterHandle } from './WorkReporter'
import { WorkSchedule } from './WorkSchedule'

/**
 * One graph for a whole lane.
 *
 * A lane is a list of names in the Justfile. This turns that list into nodes — including one node
 * per test suite and per shard of a long suite — runs them all through the one scheduler, and leaves
 * the same trail every lane leaves: per-node logs, a versioned summary, one rollup naming every node
 * with its status and cost and where its log is, and the first failure worth acting on.
 *
 * Two phases, not two graphs. Nodes that rewrite the tree are the prepare phase; everything else
 * reads it. The phases are one graph with edges between them, so a reader starts as soon as the
 * writers of the classes it reads are done rather than waiting for the slowest fixer in the lane.
 * What the phase boundary does own is two things a graph cannot express:
 *
 * - The per-checkout prepare lock. Several agents run lanes in one checkout; two of them running
 *   generators and fixers over the same files at once is a corruption risk, not a contention one.
 *   One lane holds the lock until its last writer finishes, and a second lane waits there and then
 *   proceeds into its own read-only phase, which may overlap freely with anything.
 * - The tree snapshot a green record is keyed by. Writers legitimately change the tree, so the
 *   record is keyed by the tree as it stood when the last writer finished. If the tree differs from
 *   that when the run ends, something outside this run changed it, the run is not evidence, and the
 *   warning names the paths.
 */

export type RunGatesOptions = {
  /** Gate recipe names, in the order the Justfile declared them. */
  gates: readonly string[]
  /**
   * Skip the run when this tree is already proved green. The first lane is the name this run
   * records its own green tree under; every lane listed is accepted as proof, so list only this
   * lane and lanes whose gate membership contains it. Absent, no record is read or written.
   */
  greenTree?: {
    /** Ignore every record and run anyway; the run still records its own green tree. */
    noCache?: boolean
    /** Injected by tests; defaults to hashing the Git working tree. */
    hashTree?: (repositoryRoot: string) => Promise<string>
    lanes: readonly string[]
  }
  jobs?: number
  /** Path to write an extra stable copy of the JSON summary to, for the lane's known-path readers. */
  jsonPath?: string
  /**
   * Refuse to start while another lane is registered on this machine. For a lane whose gates drive
   * the window server, sharing the host is not slowness but interference, so the honest answer is
   * to decline rather than to produce a verdict about the contention.
   */
  needsMachine?: boolean
  /** Artifact lane; names the log directory and appears in the summary. */
  lane?: string
  logRoot?: string
  /** Injected CPU total for deterministic coordination tests. */
  machineCpuCount?: number
  /**
   * Injected load reading for deterministic coordination tests. A run's contention verdict decides
   * whether it warns and whether it teaches the timings store, so a test that means an idle or a
   * busy machine says which rather than inheriting whatever the host is doing.
   */
  machineLoadAverage?: () => number
  now?: () => number
  /** How the run reports itself while it runs. Omitted, it reports nothing but the artifacts. */
  outputMode?: OutputMode
  /** Injected by tests; defaults to the machine-wide lane registry. */
  registryRoot?: string
  repositoryRoot?: string
  /** Omit gates whose catalog metadata declares a host capability the managed sandbox denies. */
  skipUnsandboxed?: boolean
  /** Gates deliberately not run in this lane, as `name=reason`. */
  skipped?: readonly string[]
  /** Injected so tests observe orchestration without running the real recipes. */
  runGate?: (
    name: string,
    logPath: string,
    environment: Readonly<Record<string, string>>,
    /** The command the graph resolved for the gate after admission. */
    run: WorkCommand,
  ) => Promise<{ exitCode: number; output: string }>
}

/**
 * The `tao test` opt-out, spelled here the way `TAO_TEST_JOBS` is: the command owns the contract and
 * this package only sets it. `tao test` reuses a previous passing run's compiled apps when nothing
 * they are built from has changed, which is a memoized verdict of exactly the kind `--no-cache`
 * exists to refuse. A `--no-cache` lane therefore compiles every app for itself.
 */
export const TAO_TEST_NO_CACHE_ENV_KEY = 'TAO_TEST_NO_CACHE'

const DEFAULT_LANE = 'verify'
/** The two lane-list names that stand for the whole test selection rather than a recipe. */
const TEST_GATE = '_test'
const TEST_CHANGED_GATE = '_test-changed'
/** Where the per-checkout prepare lock lives. One directory per checkout, not per machine. */
const PREPARE_LOCK_PATH = '.artifacts/verify/prepare-lock'
const PREPARE_RESOURCE = 'verify-prepare'
/** A lane may wait this long for another lane's prepare phase before it gives up and says who holds it. */
const PREPARE_WAIT_MS = 10 * 60 * 1_000

/** runGates executes every node of a lane through the one work graph and returns the rollup. */
export async function runGates(options: RunGatesOptions): Promise<GateSummary> {
  const location = RunArtifacts.locate({
    lane: options.lane ?? DEFAULT_LANE,
    logRoot: options.logRoot,
    repositoryRoot: options.repositoryRoot ?? Repo.getRoot(),
  })
  const now = options.now ?? Time.nowMs
  const startedAt = now()
  const fingerprintOf = treeFingerprinter(options)
  // Fingerprinted before anything runs. A --no-cache run reads no proof but still needs this seed,
  // because the drift guard below compares what the readers proved against what the run leaves.
  const startingTree = options.greenTree === undefined ? undefined : await fingerprintOf(location.repositoryRoot)
  const toolchain = options.greenTree === undefined ? undefined : await GreenTree.toolchain(location.repositoryRoot)
  const startingKey: GreenTreeKey | undefined = startingTree === undefined || toolchain === undefined
    ? undefined
    : { toolchain, treeHash: startingTree.hash }
  const readsGreenTree = options.greenTree !== undefined && options.greenTree.noCache !== true
  // A whole-lane record may stand in for the lane only when every node in it is one the key
  // describes — exactly the nodes `isRecordable` admits, and no others. A lane holding a
  // host-dependent node cannot be skipped wholesale, however green its record: it would be
  // asserting that Chrome, Electrobun, the simulator, and the window server behave here as they did
  // on the run that wrote it, which no tree hash says. Neither can a lane holding a generator: its
  // output is Git-ignored and so outside the hash, and `just verify && just clean && just verify`
  // would otherwise match the record at an unchanged tree and report PASSED having generated
  // nothing. Such a lane still skips its recordable nodes one by one below, which is the same
  // saving without the lie, and a generator skipped that way costs its own stamp check rather than
  // its full run.
  const wholeLaneSkippable = options.gates.every(name => GateCatalog.isRecordable(name))
  if (readsGreenTree && wholeLaneSkippable && startingKey !== undefined) {
    const match = await GreenTree.find(location.repositoryRoot, startingKey, options.greenTree!.lanes)
    if (match !== undefined) {
      return greenTreeSummary(options, location.lane, match, now() - startedAt)
    }
  }

  // A gate that is both run and declared skipped is run: the declaration is stale, and counting
  // it twice would make the totals disagree with the list above them.
  const runnableGates = options.skipUnsandboxed === true
    ? options.gates.filter(name => GateCatalog.metadata(name).requiresUnsandboxed !== true)
    : [...options.gates]
  const unsandboxedSkips = options.skipUnsandboxed === true
    ? options.gates
      .filter(name => GateCatalog.metadata(name).requiresUnsandboxed === true)
      .map(name => `${name}=requires unsandboxed host capabilities; run just verify-full outside the sandbox`)
    : []

  const recipeGates = runnableGates.filter(name => !isTestGate(name))
  const testGate = runnableGates.find(isTestGate)
  const testPlan = testGate === undefined ? undefined : await testNodes(testGate, location)
  const suiteOfNode = new Map((testPlan?.states ?? []).map(state => [state.name, state.suite]))

  // What another lane already proved at this exact tree and toolchain. Only work whose verdict the
  // key fully describes qualifies: a node that rewrites the tree or fills a generated directory
  // produces state no hash describes, and a node whose verdict depends on the host is not described
  // by this tree at all.
  //
  // For tests the unit of proof is the suite, never the shard. A shard's composition is derived from
  // the recorded timings and per-file costs in `.artifacts`, which the tree hash does not cover, so
  // the same tree can legitimately split a suite differently on a later run. A record named
  // `studio#2` would then skip a process covering different files than the one that earned it, and
  // some file could go unproved while the lane reported green. A suite name is stable, and its
  // record is written only when every one of its shards passed.
  //
  // Either kind may only stand on a record while every generated tree it reads is being regenerated
  // beside it. Those trees are Git-ignored and so outside the key; a lane that reads one without
  // running its generator would be skipping work on a hash that cannot speak for the input.
  const suites = [...new Set(suiteOfNode.values())]
  const canStandOnRecord = (name: string) => GateCatalog.unrunGeneratedReads(name, options.gates).length === 0
  const recordable = [
    ...recipeGates.filter(name => GateCatalog.isRecordable(name) && canStandOnRecord(name)),
    ...suites.filter(canStandOnRecord),
  ]
  const unstable = await unstableSuites(location.repositoryRoot, testPlan?.states ?? [])
  const proved = !readsGreenTree || startingKey === undefined
    ? { excluded: [] as readonly string[], proved: new Map<string, GreenTreeRecord>() }
    : await GreenTree.findGates(location.repositoryRoot, startingKey, recordable, { excluded: unstable })

  const gatesToRun = recipeGates.filter(name => !proved.proved.has(name))
  const testStates = (testPlan?.states ?? []).filter(state => !proved.proved.has(state.suite))
  const greenSkips = [...proved.proved].map(([name, record]): GateResult => ({
    elapsedMs: 0,
    name,
    reason: GreenTree.describeGate(record),
    status: 'skipped',
    ...(suites.includes(name) ? { suite: name } : {}),
  }))
  const declaredSkips = [
    ...[...options.skipped ?? [], ...unsandboxedSkips].map(skippedResult),
    ...greenSkips,
  ]
    .filter(result => !gatesToRun.includes(result.name))
    .filter((result, index, results) => results.findIndex(candidate => candidate.name === result.name) === index)

  const states: WorkState[] = [
    ...gatesToRun.map(name => WorkGraph.createState(GateCatalog.node(name, location.repositoryRoot))),
    ...testStates,
  ]
  await RunArtifacts.assignLogPaths(states, location)
  const timings = await RunTimings.load({ repositoryRoot: location.repositoryRoot })
  const expectedMs = (name: string) => RunTimings.expectedMs(timings, name)
  const reporter = createReporter(options, location.logRoot)
  const liveArtifacts = RunArtifacts.liveWriter(location, event => reporter.handle(event))
  // Asked before this lane registers: a lane that can see its own registration finds a holder every
  // time and refuses every time.
  await refuseWithoutMachine(options, location.lane)
  // Every worktree on this machine reserves against the same CPUs. Registration establishes this
  // lane's ceiling; the broker recomputes its fair share at every node admission.
  const machineLane = await MachineLanes.acquire({
    lane: location.lane,
    cpuCount: options.machineCpuCount,
    loadAverage: options.machineLoadAverage,
    registryRoot: options.registryRoot,
    repositoryRoot: location.repositoryRoot,
    requestedJobs: options.jobs,
  })

  const runNode = options.runGate === undefined ? undefined : injectedRunner(options.runGate)
  const prepareNames = new Set(states.filter(state => GateCatalog.isPrepare(state.name)).map(state => state.name))
  // Two lanes must not run fixers and generators over the same files at once. Read-only work may
  // overlap freely, so the lock covers the prepare phase and is released the moment it ends.
  const prepareLease = prepareNames.size === 0 ? undefined : await acquirePrepare(location.repositoryRoot, options)
  let verifiedTree: TreeFingerprint | undefined
  let snapshot: Promise<TreeFingerprint | undefined> = Promise.resolve(startingTree)

  const { contention, result } = await runUnderLane(async () => {
    const finishedPrepare = new Set<string>()
    const onPrepareFinished = () => {
      if (options.greenTree === undefined) {
        void prepareLease?.release()
        return
      }
      // Mutators intentionally rewrite the tree. Snapshot only once they have all settled, so a
      // later edit by anyone else cannot be mistaken for bytes this run proved — and hold the
      // prepare lock until that snapshot is taken, because a peer released to run its own fixers
      // rewrites the tree while it is still being hashed, and the hash would then describe a tree
      // that never existed.
      snapshot = fingerprintOf(location.repositoryRoot)
      // Not `void snapshot.finally(...)`: that chain rejects with the snapshot and nothing is
      // listening on it, which is an unhandled rejection rather than a release. The rejection
      // itself is answered where the snapshot is awaited, below.
      void snapshot.catch(() => undefined).then(async () => await prepareLease?.release())
    }
    const graphResult = await WorkGraph.run(states, {
      env: graphEnvironment(machineLane.id, options.greenTree?.noCache === true),
      expectedMs,
      jobs: machineLane.ceiling,
      onEvent: event => {
        liveArtifacts.handle(event)
        if (event.kind === 'complete' && prepareNames.has(event.state.name)) {
          finishedPrepare.add(event.state.name)
          if (finishedPrepare.size === prepareNames.size) {
            onPrepareFinished()
          }
        }
      },
      runNode,
      slotBroker: machineLane,
    })
    if (prepareNames.size > 0 && finishedPrepare.size < prepareNames.size) {
      // An interrupted or dependency-skipped prepare phase never emitted its last completion.
      onPrepareFinished()
    }
    await liveArtifacts.finish()
    await reporter.finish()
    if (!graphResult.interrupted) {
      // A contended timeout is a claim about this machine, and one isolated re-run is what settles it.
      await ContentionRetry.confirmContendedFailures({
        contention: machineLane.report(),
        location,
        machineLane,
        runNode,
        states,
      })
    }
    return graphResult
  }, machineLane).finally(async () => {
    // The lane body can return while the tree is still being hashed — the read-only phase runs on
    // after the last writer finishes, and the contention retry can outlast it too. Releasing here
    // without waiting hands a peer the prepare lock mid-hash, and its fixers then rewrite the tree
    // into a hash describing a state that never existed. The early release above is what keeps the
    // lock from being held for the whole read-only phase; this one is only the backstop.
    await snapshot.catch(() => undefined)
    await prepareLease?.release()
  })

  verifiedTree = await snapshot
  // Reading a test node's structured report can still fail it — a node that exited zero without
  // writing its results proved nothing — so the observations are gathered before the summary
  // decides whether this lane passed, not after it has said so.
  const observations = testPlan === undefined
    ? []
    : await TestRunner.observationsFor(
      testPlan.states.filter(state => states.some(candidate => candidate.name === state.name)),
      location.repositoryRoot,
    )
  // A node whose every failing test the ledger has already watched flip without its file changing
  // stops failing this lane. The states themselves are left failed: the summary is the one place
  // that decides a verdict, so the green record below still refuses a node that exited non-zero,
  // and `RunTimings` still declines to learn from it.
  const tolerance = testPlan === undefined || result.interrupted
    ? FlakeTolerance.empty()
    : FlakeTolerance.apply(
      testPlan.states.filter(state => states.some(candidate => candidate.name === state.name)),
      await TestLedger.tolerated(location.repositoryRoot),
    )
  const schedule = WorkSchedule.report(result)
  const summary = buildSummary({
    contention,
    declaredSkips,
    elapsedMs: now() - startedAt,
    expectedMs,
    interrupted: result.interrupted,
    lane: location.lane,
    logRoot: location.logRoot,
    order: [...recipeGates, ...suiteOfNode.keys()],
    schedule,
    states,
    suiteOf: name => suiteOfNode.get(name),
    toleratedFlakes: tolerance.demoted.map(flake => ({
      evidence: flake.evidence,
      file: flake.file,
      id: flake.id,
      node: flake.node,
    })),
  })
  for (const excluded of proved.excluded) {
    summary.warnings = [...summary.warnings, GreenTree.describeExclusion(excluded)]
  }
  // The readers proved the tree as it stood when the prepare phase ended. Anything that changed it
  // after that — a concurrent agent's edit, not this run's own fixers — means this is not evidence.
  const finalTree = verifiedTree === undefined ? undefined : await fingerprintOf(location.repositoryRoot)
  if (verifiedTree !== undefined && finalTree !== undefined && finalTree.hash !== verifiedTree.hash) {
    summary.status = 'failed'
    summary.warnings = [...summary.warnings, driftWarning(verifiedTree, finalTree)]
  }
  // The same question asked of this run's own prepare phase. A node skipped on an earlier proof was
  // proved against the tree this run started from; if the fixers then rewrote that tree, nothing
  // checked those nodes against the tree the run leaves behind. That is not evidence, and a run that
  // is not evidence must not exit 0 — `merge-with-main` reads the exit code and nothing else.
  if (proved.proved.size > 0 && verifiedTree !== undefined && verifiedTree.hash !== startingTree?.hash) {
    summary.status = 'failed'
    summary.warnings = [...summary.warnings, STALE_PROOF_WARNING]
  }
  // A lane record is only written when the lane's own membership is fully describable by the key,
  // for the same reason it is only read then. A lane whose nodes include a host-dependent one, or a
  // suite the flake ledger has seen flip, records its nodes and not itself.
  const recordsLane = wholeLaneSkippable && unstable.size === 0
  if (options.greenTree !== undefined && summary.status === 'passed' && !result.interrupted) {
    await recordGreen({
      canStandOnRecord,
      lane: recordsLane,
      key: startingKey,
      lanes: options.greenTree.lanes,
      location,
      provedCount: proved.proved.size,
      startingTree,
      suiteOf: name => suiteOfNode.get(name),
      states,
      summary,
      verifiedTree,
    })
  }
  if (testPlan !== undefined && !result.interrupted && observations.length > 0) {
    await TestLedger.recordRun({
      // A node skipped on an earlier proof did not run here, so this is not the complete pass the
      // retry ledger keys its full-run boundary on, however complete the selection was.
      fullRun: testPlan.fullRun && testPlan.states.every(state => states.some(other => other.name === state.name)),
      observations,
      repositoryRoot: location.repositoryRoot,
      startedAt,
    })
  }
  await RunArtifacts.finishRun({
    location,
    extraDurations: testPlan === undefined ? undefined : TestNodes.suiteDurations(testPlan.states),
    recordTimings: !contention.contended,
    states,
    summary,
  })
  if (options.jsonPath !== undefined) {
    await RunArtifacts.writeSummaryCopy(options.jsonPath, location.repositoryRoot, summary)
  }
  return summary
}

function isTestGate(name: string): boolean {
  return name === TEST_GATE || name === TEST_CHANGED_GATE
}

/** testNodes expands a lane's test gate into one node per suite and per shard of a long suite. */
async function testNodes(
  gate: string,
  location: ReturnType<typeof RunArtifacts.locate>,
): Promise<Awaited<ReturnType<typeof TestRunner.testNodesFor>> & { fullRun: boolean }> {
  const reportRoot = FS.resolvePath('test-results', location.logRoot)
  await FS.mkdir(reportRoot)
  const prepared = await TestRunner.prepareRun(
    gate === TEST_GATE ? { kind: 'full' } : { kind: 'changed' },
    location.repositoryRoot,
  )
  const plan = await TestRunner.testNodesFor({ prepared, reportRoot, repositoryRoot: location.repositoryRoot })
  return { ...plan, fullRun: prepared.kind === 'full' }
}

/**
 * unstableSuites names the suites covering a file whose outcome has flipped without the file
 * changing. A tree hash cannot see instability, so a record would let a flake go unrun for as long
 * as nobody touches its file — which is exactly the case where it most needs to run.
 */
async function unstableSuites(
  repositoryRoot: string,
  states: readonly { selectedTestFiles?: readonly string[]; suite: string }[],
): Promise<ReadonlySet<string>> {
  if (states.length === 0) {
    return new Set()
  }
  const flaky = new Set((await TestLedger.flakes(repositoryRoot, Number.MAX_SAFE_INTEGER)).map(flake => flake.file))
  if (flaky.size === 0) {
    return new Set()
  }
  return new Set(
    states
      .filter(state => (state.selectedTestFiles ?? []).some(file => flaky.has(file)))
      .map(state => state.suite),
  )
}

/** recordGreen stores what this run proved, and only what a tree and a toolchain fully describe. */
async function recordGreen(options: {
  /**
   * Whether a node's verdict is one a tree hash can speak for in this lane. It gates writing a
   * record as well as reading one: a reader of a generated tree whose generator did not run here
   * was judged against whatever that Git-ignored tree happened to hold, so recording it at this
   * tree's hash would let a later lane skip it on evidence about bytes nothing attests to. Reading
   * alone was guarded, which left `./dev gates <subset>` able to write exactly that record.
   */
  canStandOnRecord: (name: string) => boolean
  key?: GreenTreeKey
  /** False when this lane's own membership is not fully described by the key; its nodes still are. */
  lane: boolean
  lanes: readonly string[]
  location: ReturnType<typeof RunArtifacts.locate>
  /** How many nodes this run skipped on an earlier proof, which the tree it leaves must still match. */
  provedCount: number
  startingTree?: TreeFingerprint
  /** The suite a node reports under, so a suite is recorded rather than its shards. */
  suiteOf: (name: string) => string | undefined
  states: readonly WorkState[]
  summary: GateSummary
  verifiedTree?: TreeFingerprint
}): Promise<void> {
  const { key, location, verifiedTree } = options
  if (key === undefined || verifiedTree === undefined) {
    return
  }
  // The verified tree is snapshotted once, when the *last* writer finishes — not when each one
  // does. A fixer that exited early therefore ran against a tree that a later writer's runtime gave
  // someone else time to edit, and recording it at the verified hash would claim it reached its
  // fixpoint on bytes it never read. Only when the prepare phase changed nothing is every writer
  // provably at its fixpoint on exactly the recorded tree; otherwise the writers sit this one out
  // and the readers, whose verdicts are about the tree rather than about rewriting it, still count.
  const preparePreservedTree = verifiedTree.hash === options.startingTree?.hash
  const passedGates = options.states
    .filter(state => state.status === 'passed' && GateCatalog.isRecordable(state.name))
    .filter(state => preparePreservedTree || !GateCatalog.isPrepare(state.name))
    .map(state => state.name)
    .filter(name => options.suiteOf(name) === undefined)
    .filter(options.canStandOnRecord)
  await GreenTree.record(
    location.repositoryRoot,
    options.lane ? options.lanes[0] ?? location.lane : undefined,
    { at: new Date().toISOString(), logRoot: location.logRoot, toolchain: key.toolchain, treeHash: verifiedTree.hash },
    [...passedGates, ...provedSuites(options.states, options.suiteOf).filter(options.canStandOnRecord)],
    {
      neverRecord: new Set(
        options.states.filter(state => !GateCatalog.isRecordable(state.name)).map(state => state.name),
      ),
    },
  )
}

/**
 * provedSuites names the suites every one of whose shards passed in this run. A suite with one shard
 * still running, failed, or skipped on anything is not proved: its record has to mean that all of it
 * ran green at this tree, or a later run would skip work that was never done.
 */
function provedSuites(
  states: readonly WorkState[],
  suiteOf: (name: string) => string | undefined,
): readonly string[] {
  const shardsBySuite = new Map<string, WorkState[]>()
  for (const state of states) {
    const suite = suiteOf(state.name)
    if (suite !== undefined) {
      shardsBySuite.set(suite, [...shardsBySuite.get(suite) ?? [], state])
    }
  }
  return [...shardsBySuite]
    .filter(([, shards]) => shards.every(shard => shard.status === 'passed'))
    .map(([suite]) => suite)
}

/** Why a run that reused proofs and then rewrote the tree under them cannot report itself green. */
const STALE_PROOF_WARNING = 'nodes were skipped on an earlier proof and the prepare phase then '
  + 'changed the tree; this run is not green evidence. Re-run with --no-cache.'

/** driftWarning names what changed under a run, because "the tree changed" is not actionable. */
function driftWarning(before: TreeFingerprint, after: TreeFingerprint): string {
  const changed = GreenTree.changedPaths(before, after)
  const named = changed.slice(0, 5).join(', ')
  const more = changed.length > 5 ? `, and ${changed.length - 5} more` : ''
  return changed.length === 0
    ? 'working tree changed while verification was running; this run is not green evidence'
    : `working tree changed while verification was running (${named}${more}); this run is not green evidence`
}

/**
 * acquirePrepare takes the per-checkout prepare lock. A second lane in the same checkout waits here
 * rather than rewriting the same files concurrently; if the wait runs out, the error names the lane
 * that holds it instead of failing anonymously.
 */
async function acquirePrepare(
  repositoryRoot: string,
  options: RunGatesOptions,
): Promise<MachineResourceLease> {
  return await MachineLanes.acquireResource({
    command: `${options.lane ?? DEFAULT_LANE} prepare`,
    name: PREPARE_RESOURCE,
    registryRoot: FS.resolvePath(PREPARE_LOCK_PATH, repositoryRoot),
    repositoryRoot,
    waitTimeoutMs: PREPARE_WAIT_MS,
  })
}

/**
 * refuseWithoutMachine stops a lane that needs the machine while another lane holds part of it.
 *
 * Every other kind of contention on this host is a scheduling problem: lanes divide the CPUs and a
 * busy machine makes a run slower, not wrong. The browser and native gates are the exception,
 * because they drive one window server and one set of simulators between them — two runs do not
 * halve each other's speed, they click into each other's windows. A verdict produced under that is
 * about the contention rather than about the branch, so this declines to produce one.
 *
 * It declines rather than waits: the lane it is waiting for may be a person's interactive session
 * with no end in sight, and a command that says why it will not run is more useful than one that
 * hangs. Nothing is held, so retrying costs nothing once the other lane finishes.
 *
 * The predicate is any registered lane, not only one that itself drives the window server, and that
 * is wider than the reason above on purpose: a purely CPU-bound lane still starves the timing-
 * sensitive gates this one is about to run, which is the same wrong verdict by a different route.
 * The window server is why the refusal exists; starvation is why it does not try to be clever about
 * which neighbour it found. Two such lanes starting together can both read an empty registry and
 * both proceed — this narrows a window rather than closing one, and the loser of that race is a
 * slow, noisy run rather than a wrong one.
 */
async function refuseWithoutMachine(options: RunGatesOptions, lane: string): Promise<void> {
  if (options.needsMachine !== true) {
    return
  }
  const inspection = await MachineLanes.inspectLanes(options.registryRoot)
  // A registry the host will not reveal proves nothing in either direction. Refusing on it would
  // make this lane unrunnable wherever the registry cannot be read, over a conflict that may not
  // exist; the lane runs, and the contention report still says what it saw.
  if (!inspection.available || inspection.lanes.length === 0) {
    return
  }
  const holders = inspection.lanes.map(describeLaneHolder).join(', ')
  Errors.throwHostEnvironment(
    `${lane} needs this machine to itself: ${holders} ${inspection.lanes.length === 1 ? 'is' : 'are'} already `
      + 'running. Its browser and native gates share one window server, so a run beside another lane '
      + 'reports that interference rather than this branch. Wait for that lane to finish or stop it, then retry.',
  )
}

/**
 * describeLaneHolder names one registered lane the way `MachineLanes.describeExclusiveHolder` names
 * the holder of an exclusive confirmation, so the two refusals a developer can meet read alike.
 */
function describeLaneHolder(record: LaneRecord): string {
  return record.lane.length === 0 || record.repositoryRoot.length === 0
    ? `PID ${record.pid}`
    : `${record.lane} in ${FS.basename(record.repositoryRoot)}`
}

/** graphEnvironment is what every child of one lane's graph inherits beyond its own command's env. */
function graphEnvironment(laneId: string | undefined, noCache: boolean): Record<string, string> | undefined {
  const environment = {
    ...(laneId === undefined ? {} : { [MachineLanes.LANE_ID_ENV_KEY]: laneId }),
    ...(noCache ? { [TAO_TEST_NO_CACHE_ENV_KEY]: 'true' } : {}),
  }
  return Object.keys(environment).length === 0 ? undefined : environment
}

/** treeFingerprinter resolves how this run identifies the tree, honoring an injected hasher. */
function treeFingerprinter(options: RunGatesOptions): (repositoryRoot: string) => Promise<TreeFingerprint> {
  const injected = options.greenTree?.hashTree
  if (injected === undefined) {
    return GreenTree.fingerprint
  }
  return async repositoryRoot => ({ hash: await injected(repositoryRoot), paths: new Map() })
}

/** greenTreeSummary is the rollup of a run that did not happen because its tree was already proved. */
function greenTreeSummary(
  options: RunGatesOptions,
  lane: string,
  match: GreenTreeMatch,
  elapsedMs: number,
): GateSummary {
  const reason = `tree unchanged since the green ${match.lane} run at ${match.at}`
  return {
    // Rounded like every other summary's: the field is a published integer, and the verdict line
    // renders it as `105ms` rather than as the raw fraction of a millisecond the clock returned.
    elapsedMs: Math.round(elapsedMs),
    gates: options.gates.map(name => ({ elapsedMs: 0, name, reason, status: 'skipped' })),
    greenTree: match,
    lane,
    logRoot: match.logRoot,
    status: 'passed',
    version: 2,
    warnings: [],
  }
}

/** runUnderLane runs one lane's work and releases its machine registration however that ends. */
async function runUnderLane<T>(
  work: () => Promise<T>,
  machineLane: MachineLane,
): Promise<{ contention: ContentionReport; result: T }> {
  try {
    // The report is read after the work, not beside it: its whole value is what the machine did
    // while the lane ran.
    const result = await work()
    return { contention: machineLane.report(), result }
  } finally {
    await machineLane.release()
  }
}

function injectedRunner(
  runGate: NonNullable<RunGatesOptions['runGate']>,
): (state: WorkState, context: WorkRunContext) => Promise<WorkOutcome> {
  return async (state, context) => {
    const result = await runGate(state.name, state.logPath ?? '', context.env, context.run)
    return { exitCode: result.exitCode, output: result.output }
  }
}

function createReporter(options: RunGatesOptions, logRoot: string): WorkReporterHandle {
  if (options.outputMode === undefined) {
    return { finish: async () => {}, handle: () => {} }
  }
  return WorkReporter.create({ lane: options.lane ?? DEFAULT_LANE, logRoot, mode: options.outputMode })
}

/** GateRunner's shard-name helper is re-exported so a lane's readers can group shards by suite. */
export const suiteOfNodeName = TestShards.suiteOf
