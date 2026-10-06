import { FS, HCI, Platform, Repo, Time, VerificationTimeouts } from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { FailurePolicy } from './FailurePolicy'
import { FlakeTolerance } from './FlakeTolerance'
import { GateCatalog } from './GateCatalog'
import {
  GeneratedEvidence,
  type GeneratedEvidence as GeneratedEvidenceRecord,
  type GeneratedEvidenceCapture,
  type GeneratedOutput,
} from './GeneratedEvidence'
import {
  GreenTree,
  type GreenTreeKey,
  type GreenTreeMatch,
  type GreenTreeRecord,
  type TreeFingerprint,
} from './GreenTree'
import {
  type ContentionReport,
  type MachineLane,
  MachineLanes,
  type MachineResourceLease,
} from './MachineLanes'
import { RunArtifacts } from './RunArtifacts'
import { type OverlapReport, RunHistory } from './RunHistory'
import { buildSummary, type GateResult, type GateSummary, skippedResult } from './RunSummary'
import { RunTimings } from './RunTimings'
import { TaoAppSharedRun } from './TaoAppSharedRun'
import { TestLedger } from './TestLedger'
import { TestNodes } from './TestNodes'
import { TestRunner } from './TestRunner'
import { TestShards } from './TestShards'
import { UiVisibility } from './UiVisibility'
import { VerificationLanes } from './VerificationLanes'
import { type PartitionSpec, VerifyPartition } from './VerifyPartition'
import {
  type WorkCommand,
  type WorkEvent,
  WorkGraph,
  type WorkOutcome,
  type WorkRunContext,
  type WorkState,
} from './WorkGraph'
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
  /** Injected explicit diagnostic resume list; ignored by every verification lane. */
  diagnosticCompleted?: readonly string[]
  /** Broad lanes fail fast; internal explicitly scoped diagnostic callers may collect failures. */
  failurePolicy?: FailurePolicy
  /** Gate recipe names, in the order the Justfile declared them. */
  gates: readonly string[]
  showStudio?: boolean
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
    /** Injected by tests; defaults to hashing the generator-owned ignored inputs and outputs. */
    captureGenerated?: GeneratedEvidenceCapture
    lanes: readonly string[]
    /**
     * The store per-gate records are also read from and published to, so a gate proved in another
     * checkout or on another machine at this exact tree is not run again. Absent, records stay in
     * this checkout; the CLI passes `GreenTree.sharedRoot()`.
     */
    sharedRoot?: string
  }
  jobs?: number
  /**
   * Run only this machine's share of the lane's readers; the prepare phase still runs in full. Every
   * machine of the split runs the same command with its own index and publishes the plan's digest.
   */
  partition?: PartitionSpec
  /** Path to write an extra stable copy of the JSON summary to, for the lane's known-path readers. */
  jsonPath?: string
  /**
   * Injected by tests; bounds how long a `gui` node waits for the machine-wide `gui` lease
   * (`GateCatalog.GUI_RESOURCE`) before it gives up and reports the exact holder. Production uses
   * `GUI_WAIT_MS`.
   */
  guiLeaseWaitMs?: number
  /** Artifact lane; names the log directory and appears in the summary. */
  lane?: string
  logRoot?: string
  /** Injected CPU total for deterministic coordination tests. */
  machineCpuCount?: number
  /**
   * Injected load reading for deterministic coordination tests. A run's contention verdict decides
   * whether it warns and whether timings are limited to plausible CPU samples, so a test that means
   * an idle or a busy machine says which rather than inheriting whatever the host is doing.
   */
  machineLoadAverage?: () => number
  now?: () => number
  /** Lets a caller observe scheduling events as they happen, alongside whatever `outputMode` reports. */
  onEvent?: (event: WorkEvent) => void
  /** How the run reports itself while it runs. Omitted, it reports nothing but the artifacts. */
  outputMode?: OutputMode
  /** The OS the lane runs on; off macOS, `requiresMacOS` gates are skipped. Omitted, none is skipped for its OS. */
  hostPlatform?: string
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
/** The lanes `RunHistory` keeps: every broad lane, and the diff-scoped per-commit gate. */
const HISTORY_LANES: readonly string[] = [...VerificationLanes.BROAD, VerificationLanes.VERIFY_CHANGED]
/** The two lane-list names that stand for the whole test selection rather than a recipe. */
const TEST_GATE = '_test'
const TEST_CHANGED_GATE = '_test-changed'
/** Where the per-checkout prepare lock lives. One directory per checkout, not per machine. */
const PREPARE_LOCK_PATH = '.artifacts/verify/prepare-lock'
const PREPARE_RESOURCE = 'verify-prepare'
/** A lane may wait this long for another lane's prepare phase before it gives up and says who holds it. */
const PREPARE_WAIT_MS = 10 * 60 * 1_000
/**
 * A `gui` node may wait this long for another worktree's `gui` node, or a standalone recipe using
 * the same machine-wide lease, before it gives up and reports the exact holder. Generous for the
 * same reason as `PREPARE_WAIT_MS`: a `verify-full` run beside another one is ordinary, not a
 * failure, and the canary, the only `gui` node `verify-full` runs, takes about 10s once admitted.
 */
const GUI_WAIT_MS = 10 * 60 * 1_000

/** runGates executes every node of a lane through the one work graph and returns the rollup. */
export async function runGates(options: RunGatesOptions): Promise<GateSummary> {
  const selectedGates = options.skipUnsandboxed === true
    ? options.gates.filter(name => GateCatalog.metadata(name).requiresUnsandboxed !== true)
    : options.gates
  const visibilityWarnings = UiVisibility.preflightGates(selectedGates, options.showStudio)
  UiVisibility.warn(visibilityWarnings)
  const location = RunArtifacts.locate({
    lane: options.lane ?? DEFAULT_LANE,
    logRoot: options.logRoot,
    repositoryRoot: options.repositoryRoot ?? Repo.getRoot(),
  })
  const now = options.now ?? Time.nowMs
  const startedAt = now()
  // Durations use a monotonic clock; retry settlement compares wall-clock timestamps.
  const testRunStartedAt = Date.now()
  const fingerprintOf = treeFingerprinter(options)
  // Fingerprinted before anything runs. A --no-cache run reads no proof but still needs this seed,
  // because the drift guard below compares what the readers proved against what the run leaves.
  const startingTree = options.greenTree === undefined ? undefined : await fingerprintOf(location.repositoryRoot)
  const toolchain = options.greenTree === undefined ? undefined : await GreenTree.toolchain(location.repositoryRoot)
  const startingKey: GreenTreeKey | undefined = startingTree === undefined || toolchain === undefined
    ? undefined
    : { toolchain, treeHash: startingTree.hash }
  const readsGreenTree = options.greenTree !== undefined && options.greenTree.noCache !== true
  const generatedOutputs = GeneratedEvidence.outputsForGates(options.gates)
  // A whole-lane record may stand in for the lane only when every node in it is one the key
  // describes — exactly the nodes `isRecordable` admits, and no others. A lane holding a
  // host-dependent node cannot be recorded or skipped wholesale, however green its record: it would be
  // asserting that Chrome, Electrobun, the simulator, and the window server behave here as they did
  // on the run that wrote it, which no tree hash says. A lane holding a generator cannot be skipped
  // by this runner either: the generator's cheap stamp check must first restore any missing output.
  // It can still write whole-lane evidence for finalize, provided the ignored generated inputs and
  // outputs are captured after prepare and remain unchanged through every reader below.
  const wholeLaneSkippable = options.gates.every(name => GateCatalog.isRecordable(name))
  const wholeLaneRecordable = options.gates.every(name =>
    GateCatalog.isRecordable(name) || GeneratedEvidence.isWriter(name)
  )
  if (readsGreenTree && wholeLaneSkippable && startingKey !== undefined) {
    const match = await GreenTree.find(location.repositoryRoot, startingKey, options.greenTree!.lanes, {
      captureGenerated: options.greenTree?.captureGenerated,
      generatedOutputs,
    })
    if (match !== undefined) {
      return greenTreeSummary(options, location.lane, match, now() - startedAt)
    }
  }

  // A gate that is both run and declared skipped is run: the declaration is stale, and counting
  // it twice would make the totals disagree with the list above them.
  const { hostPlatform } = options
  const skipsUnsandboxed = (name: string) =>
    options.skipUnsandboxed === true && GateCatalog.metadata(name).requiresUnsandboxed === true
  const skipsMacOS = (name: string) =>
    hostPlatform !== undefined && hostPlatform !== 'darwin' && GateCatalog.metadata(name).requiresMacOS === true
  const runnableGates = options.gates.filter(name => !skipsUnsandboxed(name) && !skipsMacOS(name))
  const hostSkips = options.gates.flatMap(name =>
    skipsUnsandboxed(name)
      ? [`${name}=requires unsandboxed host capabilities; run ./agent unsandboxed verify-full`]
      : skipsMacOS(name)
      ? [`${name}=requires macOS; not run on ${hostPlatform}`]
      : []
  )

  const recipeGates = runnableGates.filter(name => !isTestGate(name))
  const testGate = runnableGates.find(isTestGate)
  const testPlan = testGate === undefined ? undefined : await testNodes(testGate, location)
  const suiteOfNode = new Map((testPlan?.states ?? []).map(state => [state.name, state.suite]))
  const timings = await RunTimings.load({ repositoryRoot: location.repositoryRoot })
  // A test node weighs what the planner estimated for the files it holds; a recipe gate weighs its
  // own history. The scheduler's ranking, the partition plan and the summary all read this one
  // answer, so a shard is never ranked at `cost × 1s` while the partition plan charges it 30s.
  const expectedMs = TestNodes.expectedMsFor(testPlan?.states ?? [], timings)

  // One machine's share of a lane split across several. It is planned over every reader before any
  // record is consulted, because records can differ between machines and the plan must not.
  const partition = options.partition === undefined ? undefined : VerifyPartition.plan([
    ...recipeGates.filter(name => !GateCatalog.isPrepare(name)).map(name => ({ expectedMs: expectedMs(name), name })),
    ...(testPlan?.states ?? []).map(state => ({
      expectedMs: expectedMs(state.name),
      files: state.selectedTestFiles,
      name: state.name,
    })),
  ], options.partition)
  const elsewhere = (name: string) => partition !== undefined && !VerifyPartition.owns(partition, name)

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
    : await GreenTree.findGates(location.repositoryRoot, startingKey, recordable, {
      excluded: unstable,
      sharedRoot: options.greenTree?.sharedRoot,
    })

  // Diagnostic resumes are an explicit list of reviewed completed parts, never merge evidence.
  // The caller reruns affected parts after a fix; full verification ignores this list entirely.
  const diagnosticCompleted = options.lane === VerificationLanes.DIAGNOSE_VERIFICATION
    ? new Set(
      options.diagnosticCompleted
        ?? (Platform.runtimeProcess.env['TAO_VERIFY_DIAGNOSTIC_COMPLETED'] ?? '').split(',').filter(Boolean),
    )
    : new Set<string>()
  const gatesToRun = recipeGates.filter(name =>
    !proved.proved.has(name) && !elsewhere(name) && !diagnosticCompleted.has(name)
  )
  const testStates = (testPlan?.states ?? []).filter(state =>
    !proved.proved.has(state.suite) && !elsewhere(state.name)
    && !diagnosticCompleted.has(state.name) && !diagnosticCompleted.has(state.suite)
  )
  const partitionSkips = partition === undefined ? [] : [
    ...recipeGates.filter(elsewhere).map((name): GateResult => ({
      elapsedMs: 0,
      name,
      reason: VerifyPartition.describe(partition, name),
      status: 'skipped',
    })),
    ...(testPlan?.states ?? []).filter(state => elsewhere(state.name)).map((state): GateResult => ({
      elapsedMs: 0,
      name: state.name,
      reason: VerifyPartition.describe(partition, state.name),
      status: 'skipped',
      suite: state.suite,
    })),
  ]
  const greenSkips = [...proved.proved].map(([name, record]): GateResult => ({
    elapsedMs: 0,
    name,
    reason: GreenTree.describeGate(record),
    status: 'skipped',
    ...(suites.includes(name) ? { suite: name } : {}),
  }))
  const declaredSkips = [
    ...[...diagnosticCompleted].map(name => ({
      elapsedMs: 0,
      name,
      reason: 'explicitly retained diagnostic result; not merge evidence',
      status: 'skipped' as const,
    })),
    ...[...options.skipped ?? [], ...hostSkips].map(skippedResult),
    ...greenSkips,
    ...partitionSkips,
  ]
    .filter(result => !gatesToRun.includes(result.name))
    .filter((result, index, results) => results.findIndex(candidate => candidate.name === result.name) === index)

  const states: WorkState[] = [
    ...gatesToRun.map(name => WorkGraph.createState(GateCatalog.node(name, location.repositoryRoot))),
    ...TaoAppSharedRun.attach(testStates, location.logRoot, location.repositoryRoot),
  ]
  await RunArtifacts.assignLogPaths(states, location)
  const reporter = createReporter(options, location.logRoot)
  const liveArtifacts = RunArtifacts.liveWriter(location, event => reporter.handle(event))
  // A lane registers before it takes any other lease. A landing priority window captures existing
  // registrations; a later lane must wait here so it cannot hold GUI or prepare while paused.
  const guiLeaseNames = new Set(
    states
      .filter(state => (state.node.resources ?? []).includes(GateCatalog.GUI_RESOURCE))
      .map(state => state.name),
  )
  const failure = FailurePolicy.create({
    observe: TestRunner.observationsFor,
    policy: options.failurePolicy ?? 'fail-fast',
    repositoryRoot: location.repositoryRoot,
    tests: testPlan?.states ?? [],
  })
  // Every worktree on this machine reserves against the same CPUs. Registration puts this lane in
  // the machine-wide queue; admission is whole-lane and in arrival order, so a lane either runs at
  // its full requested width or waits with a printed position — it is never thinned to a slot or
  // two while a dozen siblings do the same.
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
  let guiLease: MachineResourceLease | undefined
  let prepareLease: MachineResourceLease | undefined
  try {
    await machineLane.waitForLandingPriority()
    guiLease = guiLeaseNames.size === 0 ? undefined : await acquireGuiLease(location.repositoryRoot, options)
    prepareLease = prepareNames.size === 0 ? undefined : await acquirePrepare(location.repositoryRoot, options)
  } catch (error) {
    await guiLease?.release()
    await machineLane.release()
    throw error
  }
  let verifiedTree: TreeFingerprint | undefined
  let verifiedGenerated: GeneratedEvidenceRecord | undefined
  let snapshot: Promise<TreeFingerprint | undefined> = Promise.resolve(startingTree)
  let generatedSnapshot: Promise<GeneratedEvidenceRecord | undefined> = Promise.resolve(undefined)
  let prepareRelease: Promise<void> | undefined
  let guiRelease: Promise<void> | undefined
  const releasePrepare = () => {
    prepareRelease ??= Promise.all([snapshot, generatedSnapshot]).catch(() => undefined).then(async () =>
      await prepareLease?.release()
    )
    // Observe early rejection immediately; final cleanup still awaits and propagates it.
    void prepareRelease.catch(() => undefined)
    return prepareRelease
  }
  const releaseGui = () => {
    guiRelease ??= guiLease?.release() ?? Promise.resolve()
    void guiRelease.catch(() => undefined)
    return guiRelease
  }

  const { contention, overlap, result } = await runUnderLane(async () => {
    const finishedPrepare = new Set<string>()
    const finishedGui = new Set<string>()
    const onPrepareFinished = () => {
      if (options.greenTree === undefined) {
        void releasePrepare()
        return
      }
      // Mutators intentionally rewrite the tree. Snapshot only once they have all settled, so a
      // later edit by anyone else cannot be mistaken for bytes this run proved — and hold the
      // prepare lock until that snapshot is taken, because a peer released to run its own fixers
      // rewrites the tree while it is still being hashed, and the hash would then describe a tree
      // that never existed.
      snapshot = fingerprintOf(location.repositoryRoot)
      generatedSnapshot = captureGenerated(options, location.repositoryRoot, generatedOutputs)
      // Not `void snapshot.finally(...)`: that chain rejects with the snapshot and nothing is
      // listening on it, which is an unhandled rejection rather than a release. The rejection
      // itself is answered where the snapshot is awaited, below.
      void releasePrepare()
    }
    const graphResult = await WorkGraph.run(states, {
      env: graphEnvironment(machineLane.id, options.greenTree?.noCache === true, options.showStudio === true),
      expectedMs,
      jobs: machineLane.ceiling,
      onEvent: event => {
        options.onEvent?.(event)
        liveArtifacts.handle(event)
        if (event.kind === 'complete' && prepareNames.has(event.state.name)) {
          finishedPrepare.add(event.state.name)
          if (finishedPrepare.size === prepareNames.size) {
            onPrepareFinished()
          }
        }
        if (event.kind === 'complete' && guiLeaseNames.has(event.state.name)) {
          finishedGui.add(event.state.name)
          if (
            finishedGui.size === guiLeaseNames.size
            && states.every(state => !guiLeaseNames.has(state.name) || state.status === 'passed')
          ) {
            // Only a complete pass can release early. Failed GUI work can run again under isolated
            // confirmation, and a recovered dependency can resume a skipped GUI node.
            void releaseGui()
          }
        }
      },
      runNode,
      slotBroker: machineLane,
      stopOnFailure: failure.stopOnFailure,
    })
    if (prepareNames.size > 0 && finishedPrepare.size < prepareNames.size) {
      // An interrupted or dependency-skipped prepare phase never emitted its last completion.
      onPrepareFinished()
    }
    await liveArtifacts.finish()
    await reporter.finish()
    if (!graphResult.interrupted && graphResult.haltedBy === undefined) {
      // A contended timeout is a claim about this machine, and one isolated re-run is what settles it.
      await ContentionRetry.confirmContendedFailures({
        env: graphEnvironment(machineLane.id, options.greenTree?.noCache === true, options.showStudio === true),
        contention: machineLane.report(),
        location,
        machineLane,
        onProgress: message => HCI.writeLine(message),
        runNode,
        states,
      })
      if (
        guiLeaseNames.size > 0 && states.every(state => !guiLeaseNames.has(state.name) || state.status === 'passed')
      ) {
        void releaseGui()
      }
    }
    return graphResult
  }, machineLane).finally(async () => {
    // The lane body can return while the tree is still being hashed — the read-only phase runs on
    // after the last writer finishes, and the contention retry can outlast it too. Releasing here
    // without waiting hands a peer the prepare lock mid-hash, and its fixers then rewrite the tree
    // into a hash describing a state that never existed. The early release above is what keeps the
    // lock from being held for the whole read-only phase; this one is only the backstop.
    const releases = await Promise.allSettled([releasePrepare(), releaseGui()])
    // Backstop for the same reason as the prepare lock's: a throw between acquiring the gui lease
    // and either release above running must not leave a crashed lane holding the window server
    // against every other worktree and standalone recipe sharing it.
    for (const release of releases) {
      if (release.status === 'rejected') {
        throw release.reason
      }
    }
  })

  verifiedTree = await snapshot
  verifiedGenerated = await generatedSnapshot
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
      await failure.tolerated(),
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
    // Every scheduled node reports, including the shared-run nodes `TaoAppSharedRun` attached
    // beside the suites: a `summary.json` without `tao-apps:prepare` hides the one node every
    // partition pays for and leaves a schedule replay guessing at it.
    order: [...new Set([...recipeGates, ...suiteOfNode.keys(), ...states.map(state => state.name)])],
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
  summary.warnings = [...visibilityWarnings, ...summary.warnings]
  if (result.haltedBy !== undefined) {
    const notRun = states.filter(state => state.reason?.startsWith('not run after definite failure:')).length
    summary.warnings = [
      ...summary.warnings,
      `verification stopped after definite failure in ${result.haltedBy}; ${notRun} ${
        notRun === 1 ? 'check' : 'checks'
      } not run`,
    ]
  }
  for (const excluded of proved.excluded) {
    summary.warnings = [...summary.warnings, GreenTree.describeExclusion(excluded)]
  }
  // A suite that lost its sharding is still green, so nothing else in this summary would say a word
  // about it; the lane just runs at a fraction of the machine and looks normal.
  for (const warning of testPlan?.warnings ?? []) {
    summary.warnings = [...summary.warnings, warning]
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
  if (options.greenTree !== undefined && generatedOutputs.length > 0) {
    const finalGenerated = await captureGenerated(options, location.repositoryRoot, generatedOutputs)
    if (
      verifiedGenerated === undefined
      || finalGenerated === undefined
      || !GeneratedEvidence.equals(verifiedGenerated, finalGenerated)
    ) {
      summary.status = 'failed'
      summary.warnings = [...summary.warnings, GENERATED_DRIFT_WARNING]
    }
  }
  // A lane record is only written when the lane's own membership is fully describable by the key,
  // for the same reason it is only read then. A lane whose nodes include a host-dependent one, or a
  // suite the flake ledger has seen flip, records its nodes and not itself.
  // A partition never stands for its lane: the rest of the lane ran on other machines.
  const recordsLane = wholeLaneRecordable && unstable.size === 0 && partition === undefined
  if (options.greenTree !== undefined && summary.status === 'passed' && !result.interrupted) {
    await recordGreen({
      canStandOnRecord,
      lane: recordsLane,
      key: startingKey,
      lanes: options.greenTree.lanes,
      location,
      provedCount: proved.proved.size,
      sharedRoot: options.greenTree.sharedRoot,
      startingTree,
      suiteOf: name => suiteOfNode.get(name),
      states,
      summary,
      verifiedTree,
      generated: verifiedGenerated,
      generatedOutputs,
    })
  }
  if (testPlan !== undefined && !result.interrupted && observations.length > 0) {
    await TestLedger.recordRun({
      // A node skipped on an earlier proof or stopped after a failure did not run here, so this is
      // not the complete pass the retry ledger keys its full-run boundary on.
      fullRun: testPlan.fullRun
        && testPlan.states.every(state =>
          states.some(other => other.name === state.name && (other.status === 'passed' || other.status === 'failed'))
        ),
      observations,
      repositoryRoot: location.repositoryRoot,
      startedAt: testRunStartedAt,
    })
  }
  summary.overlap = overlap
  if (partition !== undefined) {
    summary.partition = { count: partition.count, digest: partition.digest, index: partition.index + 1 }
  }
  if (HISTORY_LANES.includes(location.lane)) {
    // Written while a broad lane still holds the landing lock, and kept outside this worktree, so a
    // reclaimed checkout does not take the machine's only timing record with it.
    await RunHistory.recordRun(
      RunHistory.runRecord({
        contention,
        elapsedMs: summary.elapsedMs,
        ...(summary.firstFailure === undefined ? {} : { firstFailure: summary.firstFailure }),
        gates: summary.gates,
        interrupted: result.interrupted,
        lane: location.lane,
        landing: (Platform.runtimeProcess.env[MachineLanes.LANDING_PRIORITY_ENV_KEY] ?? '').length > 0,
        logRoot: location.logRoot,
        overlap,
        repositoryRoot: location.repositoryRoot,
        ...(schedule === undefined ? {} : { schedule }),
        startedAtMs: startedAt,
        status: summary.status,
      }),
      options.registryRoot,
    )
  }
  await RunArtifacts.finishRun({
    cpuOnly: contention.contended,
    location,
    extraDurations: testPlan === undefined ? undefined : TestNodes.suiteDurations(testPlan.states),
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
  generated?: GeneratedEvidenceRecord
  generatedOutputs: readonly GeneratedOutput[]
  key?: GreenTreeKey
  /** False when this lane's own membership is not fully described by the key; its nodes still are. */
  lane: boolean
  lanes: readonly string[]
  location: ReturnType<typeof RunArtifacts.locate>
  /** How many nodes this run skipped on an earlier proof, which the tree it leaves must still match. */
  provedCount: number
  startingTree?: TreeFingerprint
  /** The shared store gate records are published to as well, when the lane reads one. */
  sharedRoot?: string
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
  const recordsGenerated = GeneratedEvidence.covers(options.generated, options.generatedOutputs)
  await GreenTree.record(
    location.repositoryRoot,
    options.lane && recordsGenerated ? options.lanes[0] ?? location.lane : undefined,
    { at: new Date().toISOString(), logRoot: location.logRoot, toolchain: key.toolchain, treeHash: verifiedTree.hash },
    [...passedGates, ...provedSuites(options.states, options.suiteOf).filter(options.canStandOnRecord)],
    {
      laneGenerated: options.lane && recordsGenerated ? options.generated : undefined,
      neverRecord: new Set(
        options.states.filter(state => !GateCatalog.isRecordable(state.name)).map(state => state.name),
      ),
      sharedRoot: options.sharedRoot,
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

/** Why ignored output that moved after its readers ran cannot back a whole-lane proof. */
const GENERATED_DRIFT_WARNING = 'generated output changed or became unreadable while verification was running; '
  + 'this run is not green evidence'

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
    waitTimeoutMs: VerificationTimeouts.resolve(PREPARE_WAIT_MS) ?? Infinity,
  })
}

/**
 * acquireGuiLease takes the machine-wide `gui` lease before this run's own `gui`-declaring nodes are
 * admitted, and holds it until every one of them has finished. A second worktree's `gui` node, or a
 * standalone `studio-canary` or `studio-smoke --native` run outside `./dev gates` entirely, waits on
 * it or is told the exact holder instead of clicking into this run's windows.
 *
 * This replaces `--needs-machine`, which refused a lane outright whenever any other lane was
 * registered at all, because it could not see whether that lane's gates touched the window server.
 * That wideness is no longer needed: `verify-full` and `verify-full-sandbox` cannot overlap each
 * other regardless (both sit in `VerificationLanes.LOCKED`, behind the machine-wide landing lock),
 * the browser gates run headless Chrome on disjoint ports and are declared parallel-safe, and the
 * gates that do drive a real window server — `studio-canary` and the opt-in native smokes — are
 * exactly the ones `GateCatalog` declares `resources: [GUI_RESOURCE]` on. Naming the lease after that
 * resource, rather than after the lane, is what lets every other gate share the machine freely while
 * those still cannot overlap a peer's.
 *
 * It waits rather than refuses, unlike the flag it replaces: a refusal costs whoever hits it a model
 * turn to retry by hand, and a bounded wait costs nothing when the holder finishes well within it —
 * which the canary, at a measured ~10s, usually does. `MachineResourceBusyError`'s
 * message already names the holder the way `LandingLock.describeWaiting` does, once the wait finally
 * runs out; nothing here has to spell that out a second time.
 *
 * Acquired before this run's own nodes are admitted rather than at the point one is ready to start:
 * `GateCatalog.GUI_PRIORITY` already pins the `gui` node to begin at t=0, so by the time it
 * would actually run the lease is already held, and taking it up front means a lane that will end up
 * waiting or failing on it never first reserves CPU broker slots for work it has not been allowed to
 * run.
 */
async function acquireGuiLease(repositoryRoot: string, options: RunGatesOptions): Promise<MachineResourceLease> {
  return await MachineLanes.acquireResource({
    command: `${options.lane ?? DEFAULT_LANE} gui`,
    name: GateCatalog.GUI_RESOURCE,
    registryRoot: options.registryRoot,
    repositoryRoot,
    waitTimeoutMs: options.guiLeaseWaitMs ?? VerificationTimeouts.resolve(GUI_WAIT_MS) ?? Infinity,
  })
}

/** graphEnvironment is what every child of one lane's graph inherits beyond its own command's env. */
function graphEnvironment(
  laneId: string | undefined,
  noCache: boolean,
  showStudio: boolean,
): Record<string, string> | undefined {
  const environment = {
    [UiVisibility.STUDIO_ENV_KEY]: showStudio ? 'true' : 'false',
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

/** generated evidence uses the production hashers unless a test supplies a deterministic capture. */
function captureGenerated(
  options: RunGatesOptions,
  repositoryRoot: string,
  outputs: readonly GeneratedOutput[],
): Promise<GeneratedEvidenceRecord | undefined> {
  if (outputs.length === 0) {
    return Promise.resolve(undefined)
  }
  return (options.greenTree?.captureGenerated ?? GeneratedEvidence.capture)(repositoryRoot, outputs)
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
): Promise<{ contention: ContentionReport; overlap: OverlapReport; result: T }> {
  let outcome: { contention: ContentionReport; result: T }
  try {
    // The report is read after the work, not beside it: its whole value is what the machine did
    // while the lane ran.
    const result = await work()
    outcome = { contention: machineLane.report(), result }
  } finally {
    await machineLane.release()
  }
  // Read after the release, which is what puts this lane's own end on record.
  return { ...outcome, overlap: await machineLane.overlap() }
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
