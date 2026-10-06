import { OutputText } from '@cli-kit'
import { Errors, FS, Platform, ProcessTree, type TrackedProcess, VerificationTimeouts } from '@shared'

/**
 * One scheduler for every parallel repository lane. A node says what must pass before it starts,
 * how much CPU width it occupies, and which exclusive resources it holds; the graph turns that into
 * a start order and a slot budget. It never writes to the terminal: a run emits events and the
 * reporters decide what a human or an agent sees.
 *
 * The admission policy is the one `TestRunner` proved on suites — priority first, then longest
 * remaining path, with a head-of-line hold so a wide node is not starved by cheap ones.
 *
 * The kernel knows nothing about this repository. It has no notion of a fixer, a generated
 * directory, a test suite, or a shard: a caller that needs one node to precede another says so with
 * an edge. There used to be one exception — a `mutatesTree` bit whose nodes every other node in the
 * run waited for — and it made the whole lane serial behind the slowest fixer. `GateCatalog` now
 * derives those edges from what each node writes and reads, so the ordering is declared where the
 * repository facts live and the scheduler is left with edges alone.
 *
 * A run also records why each node waited and when it was admitted, which is what makes the schedule
 * reviewable: `WorkSchedule` turns those into a makespan, a serial floor, and idle slot-seconds.
 */

/** WorkStatus declares the lifecycle state of one node. `skipped` is never reported as `passed`. */
export type WorkStatus = 'failed' | 'passed' | 'pending' | 'running' | 'skipped'

/** WorkFailureKind is the machine-readable reason a node did not pass. */
export type WorkFailureKind = 'dependency' | 'fail-fast' | 'interrupted' | 'nonzero-exit' | 'process-error' | 'timeout'

/** WorkTimeoutKind distinguishes a node that ran too long from one that went quiet. */
type WorkTimeoutKind = 'idle' | 'wall-clock'

/** WorkFailure keeps retry and reporting policy out of human-readable output matching. */
export type WorkFailure = {
  kind: WorkFailureKind
  message: string
}

/** WorkAttempt is an immutable result from one execution of a node. */
type WorkAttempt = {
  elapsedMs: number
  exitCode?: number | null
  failure?: WorkFailure
  fullOutput: string
  status: WorkStatus
}

/** WorkCommand declares the process one node runs. */
export type WorkCommand = {
  args: readonly string[]
  command: string
  cwd?: string
  env?: Record<string, string>
}

/**
 * WorkAdmission is what the graph settled when it admitted a node: the width the machine-wide
 * broker actually granted, and the node's index within its worker pool.
 */
export type WorkAdmission = {
  slots: number
  /** Unique among the pool's members in one run; absent for a node outside any pool. */
  workerIndex?: number
}

/** WorkNode declares one unit of schedulable work and how it relates to the rest of a run. */
export type WorkNode = {
  name: string
  /**
   * The process the node runs with piped output in its own process group: a command, or a builder
   * handed what the graph admitted so the command can carry its granted width or worker index.
   */
  run: WorkCommand | ((admission: WorkAdmission) => WorkCommand)
  /**
   * Named pool of worker indices. The graph numbers a pool's members in admission order, so two
   * members running at once never share an index and neither has to carry one as a literal.
   */
  workerPool?: string
  /** Env keys a nested runner reads its own worker budget from; inferred from `run` when absent. */
  budgetEnvKeys?: readonly string[]
  /** Worker slots reserved while running (CPU width). Default 1. */
  cost?: number
  /**
   * Milliseconds of silence after which a still-running node is killed and marked failed. A runaway
   * that allocates without printing — bun's assertion formatter on a multiply-reachable value is the
   * worked example — produces no output at all, so the wall-clock bound below is the only other
   * thing that would ever notice it, and it is necessarily much larger.
   */
  idleTimeoutMs?: number
  /** Display and log-file name; defaults to `name`. */
  label?: string
  /** Names of nodes that must pass before this node starts. Unknown names are ignored. */
  needs?: readonly string[]
  /** Ordering prerequisites that must settle, including classification, but need not pass. */
  after?: readonly string[]
  /** Hand-pinned start-order override. Default 0; measured durations refine within a priority. */
  priority?: number
  /** Named exclusive resources (e.g. `gui`); nodes sharing one never run concurrently. */
  resources?: readonly string[]
  /**
   * True for a node that cannot use more than one core however long it runs: a single-threaded tool,
   * or one unsharded test process. Its width is one slot, and it sorts ahead of its equal-priority
   * neighbours, because a run can be no shorter than its longest serial node and everything else can
   * be packed around one.
   */
  serial?: boolean
  /**
   * Milliseconds after which a still-running node is killed and marked failed, so one hung
   * process cannot hold the whole lane open. Unset means unbounded.
   */
  timeoutMs?: number
}

/** WorkWait records one reason a node was not started yet, and how long that reason held. */
export type WorkWait = {
  /** What held the node: an unpassed edge, a held resource, local width, or the machine broker. */
  kind: 'capacity' | 'dependency' | 'machine' | 'resource'
  /** The dependency or resource name, when the kind names one. */
  detail?: string
  ms: number
}

/** WorkState tracks one node's output, status, and timing across a run. */
export type WorkState = {
  /** The command built with this node's actual admission, retained for diagnostic scope output. */
  resolvedCommand?: WorkCommand
  /** Original and confirmation results, present when a node was retried. */
  attempts?: readonly WorkAttempt[]
  /** Presentation-only group for dashboards; scheduling and reporting still treat this node independently. */
  dashboardGroup?: string
  /**
   * Milliseconds of CPU time (`resourceUsage().cpuTime.user + .system`) the node's own process
   * consumed, captured once it exits. Absent when the process never started (a spawn failure) or
   * the runtime never reports usage; never 0 in either case, so a reader cannot mistake "unmeasured"
   * for "measured and free."
   */
  cpuMs?: number
  elapsedMs: number
  exitCode?: number | null
  failure?: WorkFailure
  fullOutput: string
  /** The last few output lines, for the dashboard. */
  lines: string[]
  logPath?: string
  name: string
  node: WorkNode
  /** Why a node was skipped, or what kind of failure it was, in one line. */
  reason?: string
  /** True once a node that failed under machine contention has been run again on its own. */
  retried?: boolean
  /** The width the machine broker granted this node, once it was admitted. */
  slots?: number
  startedAt?: number
  status: WorkStatus
  /** Why this node was not started earlier, longest reason first; empty for one that never waited. */
  waits?: readonly WorkWait[]
}

/** WorkEvent is what a run reports as it progresses; reporters consume nothing else. */
export type WorkEvent =
  | { kind: 'planned'; states: readonly WorkState[] }
  | { kind: 'waiting'; reason: string; state: WorkState }
  | { kind: 'start'; state: WorkState }
  | { kind: 'output'; output: string; state: WorkState }
  | { kind: 'complete'; state: WorkState }
  | { kind: 'done'; interrupted: boolean; states: readonly WorkState[] }

/** WorkRunContext is what a node's runner is handed when the graph admits it. */
export type WorkRunContext = WorkAdmission & {
  /** Command resolved after admission, including arguments derived from the reserved slots. */
  run: WorkCommand
  /** Env the command runs with, including the worker budget the graph reserved for it. */
  env: Record<string, string>
  /** Registers how to stop this node early on interruption or a confirmed fail-fast halt. */
  onCancel: (cancel: (graceMs?: number) => void) => void
  /** Reports incremental output; the graph records it and emits it. */
  onOutput: (output: string) => void
}

/** WorkOutcome is how one node ended. */
export type WorkOutcome = {
  error?: Error
  exitCode: number | null
  /** Output a runner buffered instead of streaming; appended to the state as if streamed. */
  output?: string
}

/** WorkSlotReservation is machine-wide capacity held for one running node. */
export type WorkSlotReservation = {
  release: () => Promise<void>
  slots: number
}

/** WorkSlotBroker atomically admits nodes across otherwise independent work graphs. */
export type WorkSlotBroker = {
  /** Returns no reservation when another lane currently owns the available capacity. */
  tryAcquire: (requestedSlots: number, allowPartial: boolean) => Promise<WorkSlotReservation | undefined>
  /** Why the last admission was declined, shown on the waiting node so the run explains itself. */
  readonly waitReason?: string | undefined
  /** Waits briefly for another process to publish a capacity change. */
  waitForAvailability: () => Promise<void>
}

/** WorkRunOptions configures one graph run. */
export type WorkRunOptions = {
  /** Timeout behavior fixtures keep their deadline even during an unbounded diagnostic run. */
  timeoutPolicy?: VerificationTimeouts.Policy
  /** Environment inherited by every child in this graph, such as the owning machine-lane id. */
  env?: Record<string, string>
  /** Measured duration per node, for critical-path ordering. Cold start falls back to `cost`. */
  expectedMs?: (name: string) => number | undefined
  jobs?: number
  onEvent?: (event: WorkEvent) => void
  /** Injected so tests observe scheduling without starting real processes. */
  runNode?: (state: WorkState, context: WorkRunContext) => Promise<WorkOutcome>
  /** Optional machine-wide admission; nested graphs omit it because their parent owns the slots. */
  slotBroker?: WorkSlotBroker
  /** A confirmed failure stops new admissions; nodes already running finish and keep their logs. */
  stopOnFailure?: (state: WorkState) => boolean | Promise<boolean>
  /** Registers the run's cancel hook and returns its unsubscribe; defaults to SIGINT. */
  watchInterrupt?: (interrupt: () => void) => () => void
}

/** WorkRunResult reports how a whole run ended, including what the schedule had to work with. */
export type WorkRunResult = {
  /** Local worker width this run was allowed, which is the divisor for idle slot-seconds. */
  capacity: number
  finishedAt: number
  /** The node whose confirmed failure stopped admission, when one did. */
  haltedBy?: string
  interrupted: boolean
  startedAt: number
  states: readonly WorkState[]
}

type RunningNode = {
  cancel: (graceMs?: number) => void
  failFastReason?: string
  timeoutStarted: boolean
  promise: Promise<void>
}

const OUTPUT_LINE_LIMIT = 6
const FAIL_FAST_KILL_GRACE_MS = 3_000
/**
 * Cold-start duration for a node with no measured history. Scaling by `cost` keeps the hand-tuned
 * reservations meaningful on the first run of a lane, before the timings store has anything to say.
 */
const COLD_START_MS_PER_SLOT = 1_000
const INTERRUPTED_REASON = 'interrupted'
const MACHINE_CAPACITY_REASON = 'waiting for machine capacity'
/**
 * Env key the one remaining nested runner reads its own worker budget from. `./tao test` is the
 * published product CLI and sizes itself to the machine unless told otherwise, so a node that runs
 * it has to hand down the width the graph reserved. There used to be a second key for a nested
 * `./dev test`, which existed only because the test gate started a second scheduler inside itself;
 * suites and shards are ordinary nodes now, so nothing nests and nothing divides the machine twice.
 */
const BUDGET_ENV_KEYS = {
  taoTest: 'TAO_TEST_JOBS',
} as const

/**
 * machineCapacityReason appends the broker's own explanation to the stable prefix every machine
 * wait shares. The prefix is what the scheduler matches on; the suffix is for whoever is watching.
 */
function machineCapacityReason(detail: string | undefined): string {
  return detail === undefined ? MACHINE_CAPACITY_REASON : `${MACHINE_CAPACITY_REASON}: ${detail}`
}

function isMachineCapacityReason(reason: string | undefined): reason is string {
  return reason !== undefined && reason.startsWith(MACHINE_CAPACITY_REASON)
}

function machineCapacityDetail(reason: string): string | undefined {
  const detail = reason.slice(MACHINE_CAPACITY_REASON.length).replace(/^: /, '')
  return detail.length > 0 ? detail : undefined
}

/** createState returns the tracking state one node starts a run in. */
function createState(node: WorkNode): WorkState {
  return {
    elapsedMs: 0,
    fullOutput: '',
    lines: [],
    name: node.name,
    node,
    status: 'pending',
  }
}

/** nodeLabel returns the name a node is displayed and logged under. */
function nodeLabel(node: WorkNode): string {
  return node.label ?? node.name
}

/**
 * run schedules every node until the graph is exhausted. States are mutated in place so a live
 * dashboard and the final summary read the same objects.
 */
async function run(states: WorkState[], options: WorkRunOptions = {}): Promise<WorkRunResult> {
  const capacity = Math.max(1, resolveCapacity(options.jobs))
  const emit = (event: WorkEvent) => options.onEvent?.(event)
  const ranks = criticalPathRanks(states, options.expectedMs)
  const pending = [...states].sort(startOrder(states, ranks))
  const running = new Map<WorkState, RunningNode>()
  /** What each pending node was blocked on when the last admission scan looked. */
  const heldBy = new Map<WorkState, Pick<WorkWait, 'detail' | 'kind'>>()
  const heldResources = new Set<string>()
  const workersAdmitted = new Map<string, number>()
  const runOne = options.runNode ?? runProcess
  const startedAt = Date.now()
  let lastScanAt = startedAt
  let availableSlots = capacity
  let classifyingFailures = 0
  let haltedBy: string | undefined
  let interrupted = false

  const interrupt = () => {
    if (interrupted) {
      return
    }
    interrupted = true
    for (const node of running.values()) {
      node.cancel()
    }
    for (const state of pending.splice(0)) {
      finishWithoutRunning(state, INTERRUPTED_REASON, emit)
    }
  }
  const stopWatchingInterrupt = (options.watchInterrupt ?? watchProcessInterrupt)(interrupt)

  emit({ kind: 'planned', states })
  try {
    while (pending.length > 0 || running.size > 0) {
      accountWaits()
      const admission = await admit()
      if (running.size === 0) {
        if (admission.machineBlocked) {
          await options.slotBroker?.waitForAvailability()
          continue
        }
        if (admission.settled > 0) {
          // A dependency skip can make an earlier pending node newly skippable. Re-scan before
          // deciding the remainder is a cycle; priority ordering does not guarantee dependencies
          // appear before every descendant.
          continue
        }
        if (admission.started === 0) {
          // Nothing runs, nothing can start: what is left needs something this run never provides.
          // That is a defect in the catalog, not a skip, so the lane fails rather than passing green
          // with work it never did.
          for (const state of pending.splice(0)) {
            finishWithoutRunning(state, 'dependency cycle or unreachable dependency', emit, 'failed')
          }
        }
        continue
      }
      const localCompletion = [...running.values()].map(node => node.promise)
      await Promise.race(
        admission.machineBlocked && options.slotBroker !== undefined
          ? [...localCompletion, options.slotBroker.waitForAvailability()]
          : localCompletion,
      )
    }
  } catch (error) {
    // A scheduler/broker failure must not let already-admitted children outlive the lane record
    // their reservations belong to. Reuse interruption's bounded process cancellation, drain the
    // promises, and only then let the caller release machine-wide coordination.
    interrupt()
    await Promise.allSettled([...running.values()].map(node => node.promise))
    throw error
  } finally {
    stopWatchingInterrupt()
  }
  emit({ kind: 'done', interrupted, states })
  return { capacity, finishedAt: Date.now(), haltedBy, interrupted, startedAt, states }

  /**
   * accountWaits charges the time since the last admission scan to whatever was holding each
   * still-pending node *at the start* of that slice, then records what is holding it now for the
   * next one. Charging what is holding it now would misattribute every node's last slice: a scan
   * only happens when something completes, so by the time the scan looks, the dependency the node
   * was waiting for has already passed and the wait would be filed under capacity instead. A node
   * with exactly one dependency would then never report waiting on it.
   */
  function accountWaits(): void {
    const now = Date.now()
    const sliceMs = now - lastScanAt
    lastScanAt = now
    for (const state of pending) {
      if (state.status !== 'pending') {
        continue
      }
      const held = heldBy.get(state)
      if (held !== undefined && sliceMs > 0) {
        addWait(state, held, sliceMs)
      }
      heldBy.set(state, blockingReason(state))
    }
  }

  /** blockingReason names the first thing standing between a pending node and its start. */
  function blockingReason(state: WorkState): Pick<WorkWait, 'detail' | 'kind'> {
    const dependency = (state.node.needs ?? [])
      .map(need => states.find(candidate => candidate.name === need))
      .find(candidate => candidate !== undefined && candidate.status !== 'passed')
      ?? (state.node.after ?? [])
        .map(name => states.find(candidate => candidate.name === name))
        .find(candidate => candidate !== undefined && !isSettled(candidate, running))
    if (dependency !== undefined) {
      return { detail: dependency.name, kind: 'dependency' }
    }
    const resource = (state.node.resources ?? []).find(candidate => heldResources.has(candidate))
    if (resource !== undefined) {
      return { detail: resource, kind: 'resource' }
    }
    if (!isMachineCapacityReason(state.reason)) {
      return { kind: 'capacity' }
    }
    // The detail is what the broker said, so a run whose machine wait changes cause — a peer's
    // exclusive confirmation, then an ordinary share — reports the two separately in its summary.
    return { detail: machineCapacityDetail(state.reason), kind: 'machine' }
  }

  async function admit(): Promise<{ machineBlocked: boolean; settled: number; started: number }> {
    let started = 0
    let settled = 0
    let machineBlocked = false
    if (haltedBy !== undefined || classifyingFailures > 0) {
      return { machineBlocked, settled, started }
    }
    for (let index = 0; index < pending.length;) {
      const state = pending[index]!
      const failedDependency = failedDependencyName(state, states)
      if (failedDependency !== undefined) {
        pending.splice(index, 1)
        finishWithoutRunning(state, `dependency failed: ${failedDependency}`, emit)
        settled += 1
        continue
      }
      if (!isReady(state, states, running) || !resourcesAvailable(state, heldResources)) {
        index += 1
        continue
      }
      // A node whose width does not fit waits for running nodes to release slots rather than
      // letting cheaper nodes jump the queue; with nothing running its width clamps to capacity.
      const requestedSlots = Math.min(nodeCost(state.node), capacity)
      if (requestedSlots > availableSlots && running.size > 0) {
        break
      }
      const machineReservation = await options.slotBroker?.tryAcquire(
        requestedSlots,
        running.size === 0 && started === 0,
      )
      if (
        interrupted || haltedBy !== undefined || classifyingFailures > 0 || pending[index] !== state
        || state.status !== 'pending'
      ) {
        await machineReservation?.release()
        return { machineBlocked: false, settled, started }
      }
      if (options.slotBroker !== undefined && machineReservation === undefined) {
        machineBlocked = true
        const reason = machineCapacityReason(options.slotBroker.waitReason)
        if (state.reason !== reason) {
          state.reason = reason
          emit({ kind: 'waiting', reason, state })
        }
        break
      }
      const slots = machineReservation?.slots ?? requestedSlots
      pending.splice(index, 1)
      availableSlots -= slots
      for (const resource of state.node.resources ?? []) {
        heldResources.add(resource)
      }
      startNode(state, slots, machineReservation)
      started += 1
    }
    return { machineBlocked, settled, started }
  }

  function startNode(state: WorkState, slots: number, machineReservation?: WorkSlotReservation): void {
    let cancel: (graceMs?: number) => void = () => {}
    let timeoutStarted = false
    let expiry: WorkTimeoutKind | undefined
    const admission: WorkAdmission = { slots, workerIndex: nextWorkerIndex(state.node.workerPool) }
    const run = typeof state.node.run === 'function' ? state.node.run(admission) : state.node.run
    const context: WorkRunContext = {
      ...admission,
      run,
      env: { ...run.env, ...options.env, ...budgetEnv(state.node, run, slots) },
      onCancel: handler => {
        cancel = handler
      },
      onOutput: output => {
        appendOutput(state, output)
        restartIdleTimer()
        emit({ kind: 'output', output, state })
      },
    }
    state.slots = slots
    state.resolvedCommand = run
    state.status = 'running'
    state.reason = undefined
    state.startedAt = Date.now()
    emit({ kind: 'start', state })
    const expire = (kind: WorkTimeoutKind) => {
      if (expiry === undefined && running.get(state)?.failFastReason === undefined) {
        expiry = kind
        timeoutStarted = true
        cancel()
      }
    }
    const timeoutMs = VerificationTimeouts.resolve(state.node.timeoutMs, options.timeoutPolicy)
    const timeout = timeoutMs === undefined
      ? undefined
      : setTimeout(() => expire('wall-clock'), timeoutMs)
    let idleTimeout: ReturnType<typeof setTimeout> | undefined
    // The idle bound is armed from the start, not from the first byte: a node that never prints
    // anything is exactly the case it exists for.
    function restartIdleTimer(): void {
      const idleTimeoutMs = VerificationTimeouts.resolve(state.node.idleTimeoutMs, options.timeoutPolicy)
      if (idleTimeoutMs === undefined) {
        return
      }
      if (idleTimeout !== undefined) {
        clearTimeout(idleTimeout)
      }
      idleTimeout = setTimeout(() => expire('idle'), idleTimeoutMs)
    }
    restartIdleTimer()

    const promise = executeNode(state, context, runOne).finally(async () => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      if (idleTimeout !== undefined) {
        clearTimeout(idleTimeout)
      }
      availableSlots += slots
      for (const resource of state.node.resources ?? []) {
        heldResources.delete(resource)
      }
      if (expiry !== undefined) {
        state.status = 'failed'
        state.reason = expiry === 'idle'
          ? `timed out after ${formatTimeout(state.node.idleTimeoutMs ?? 0)} with no output`
          : `timed out after ${formatTimeout(state.node.timeoutMs ?? 0)}`
        state.failure = { kind: 'timeout', message: state.reason }
        if (!state.fullOutput.includes(state.reason)) {
          appendOutput(state, `${state.fullOutput.length > 0 ? '\n' : ''}${state.reason}\n`)
        }
      }
      const failFastReason = running.get(state)?.failFastReason
      if (failFastReason !== undefined && expiry === undefined) {
        state.status = 'skipped'
        state.reason = failFastReason
        state.failure = { kind: 'fail-fast', message: failFastReason }
      }
      if (interrupted && expiry === undefined && state.status === 'failed') {
        state.status = 'failed'
        state.reason = INTERRUPTED_REASON
        state.failure = { kind: 'interrupted', message: INTERRUPTED_REASON }
      }
      // Mark classification before the first await: a peer can complete while broker cleanup is
      // pending, and its completion would otherwise let the scheduler admit another node.
      const stopOnFailure = options.stopOnFailure
      const classify = !interrupted && haltedBy === undefined && state.status === 'failed'
        && stopOnFailure !== undefined
      if (classify) {
        classifyingFailures += 1
      }
      // Keep the node in `running` through broker cleanup and failure classification. An unrelated
      // completion may wake the scheduler while a test report is being read; it must not admit more
      // work until the caller has decided whether this failure is conclusive.
      try {
        await machineReservation?.release()
        if (classify && stopOnFailure !== undefined) {
          if (await stopOnFailure(state) && !interrupted && haltedBy === undefined) {
            haltedBy = state.name
            const reason = `canceled after definite failure: ${state.name}`
            for (const [peer, node] of running) {
              if (peer.status !== 'running' || node.timeoutStarted) {
                continue
              }
              node.failFastReason = reason
              node.cancel(FAIL_FAST_KILL_GRACE_MS)
            }
          }
        }
      } finally {
        if (classify) {
          classifyingFailures -= 1
        }
        running.delete(state)
        emit({ kind: 'complete', state })
      }
      if (haltedBy === state.name) {
        accountWaits()
        for (const waiting of pending.splice(0)) {
          finishWithoutRunning(waiting, `not run after definite failure: ${state.name}`, emit)
        }
      }
    })
    running.set(state, {
      cancel: graceMs => cancel(graceMs),
      get timeoutStarted() {
        return timeoutStarted
      },
      promise,
    })
  }

  /** nextWorkerIndex numbers one more member of a pool; indices are never reused within a run. */
  function nextWorkerIndex(pool: string | undefined): number | undefined {
    if (pool === undefined) {
      return undefined
    }
    const index = workersAdmitted.get(pool) ?? 0
    workersAdmitted.set(pool, index + 1)
    return index
  }
}

async function executeNode(
  state: WorkState,
  context: WorkRunContext,
  runOne: NonNullable<WorkRunOptions['runNode']>,
): Promise<void> {
  try {
    const outcome = await runOne(state, context)
    if (outcome.output !== undefined && outcome.output.length > 0) {
      context.onOutput(outcome.output)
    }
    state.elapsedMs = elapsedMs(state)
    state.exitCode = outcome.error === undefined ? outcome.exitCode : null
    state.status = outcome.error === undefined && outcome.exitCode === 0 ? 'passed' : 'failed'
    if (outcome.error !== undefined) {
      const message = Errors.messageOf(outcome.error)
      state.failure = { kind: 'process-error', message }
      appendOutput(state, message)
    } else if (outcome.exitCode !== 0) {
      state.failure = { kind: 'nonzero-exit', message: `exited ${outcome.exitCode ?? 'unknown'}` }
    }
  } catch (error) {
    state.elapsedMs = elapsedMs(state)
    state.exitCode = null
    state.status = 'failed'
    const message = Errors.messageOf(error)
    state.failure = { kind: 'process-error', message }
    appendOutput(state, message)
  }
}

/**
 * runProcess is the default runner: one child process in its own process group, with its output
 * piped back to the graph.
 *
 * A node runs detached deliberately, unlike an ordinary `CLI.start` child. The graph owns when a
 * node stops — a timeout, an idle bound, an interrupt — and a lane that was itself interrupted must
 * be able to stop a node that is ignoring SIGTERM without the terminal's own signal racing it.
 * Everything a node started is stopped with it: `ProcessTree` snapshots the owned tree before
 * cancellation can orphan any of it, signals each PID only while its OS start identity still
 * matches so a reused PID can never be hit, and escalates to SIGKILL after a grace period, because
 * a node cancelled for hanging may ignore SIGTERM — the Studio canary's surviving launch process
 * did — and would then hold the lane open through the very mechanism meant to unblock it.
 *
 * It stops what it started and nothing else. A sibling agent's `bun test`, Metro, simulator, or
 * Studio session shares this machine and this checkout, and is never signalled by name, port, or
 * working directory.
 *
 * This spawns through `Bun.spawn` rather than `Platform.spawn` (Node's `child_process`), which is
 * the one Bun-specific seam in this file: only `Bun.spawn`'s `Subprocess` exposes `resourceUsage()`,
 * and that per-child CPU time is what lets a node's duration outlive the machine contention that
 * corrupts wall clock. `Bun.spawn` differs from `Platform.spawn` in two ways this function absorbs
 * rather than exposes: it throws synchronously instead of emitting an async `error` event on a
 * missing executable, and its `env` replaces the child's environment outright instead of extending
 * it, so the parent's own environment is merged in explicitly below.
 */
async function runProcess(state: WorkState, context: WorkRunContext): Promise<WorkOutcome> {
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    child = Bun.spawn([context.run.command, ...context.run.args], {
      cwd: context.run.cwd,
      detached: true,
      env: { ...Platform.runtimeProcess.env, ...context.env },
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    })
  } catch (error) {
    return { error: Errors.asError(error), exitCode: null }
  }
  let forceKill: ReturnType<typeof setTimeout> | undefined
  let ownershipPoll: ReturnType<typeof setInterval> | undefined
  let trackedDescendants: TrackedProcess[] = []
  const trackedByIdentity = new Map<string, TrackedProcess>()
  const rememberDescendants = () => {
    if (child.exitCode !== null) {
      return
    }
    for (const process of ProcessTree.descendants(child.pid)) {
      trackedByIdentity.set(`${process.pid}:${process.startedAt}`, process)
    }
  }
  const rememberOwnedDescendants = () => {
    const owners = [...trackedByIdentity.values()]
    const current = ProcessTree.identities(owners.map(process => process.pid))
    for (const owner of owners) {
      if (ProcessTree.sameProcess(current.get(owner.pid), owner)) {
        for (const process of ProcessTree.descendants(owner.pid)) {
          trackedByIdentity.set(`${process.pid}:${process.startedAt}`, process)
        }
      }
    }
  }
  let cancelled = false
  try {
    ownershipPoll = setInterval(rememberDescendants, 100)
    context.onCancel(graceMs => {
      if (cancelled) {
        return
      }
      cancelled = true
      rememberDescendants()
      for (const process of ProcessTree.groupMembers(child.pid)) {
        trackedByIdentity.set(`${process.pid}:${process.startedAt}`, process)
      }
      rememberOwnedDescendants()
      trackedDescendants = [...trackedByIdentity.values()]
      ProcessTree.signalTracked(trackedDescendants, 'SIGTERM')
      forceKill = setTimeout(() => {
        rememberOwnedDescendants()
        trackedDescendants = [...trackedByIdentity.values()]
        ProcessTree.signalTracked(trackedDescendants, 'SIGKILL')
        ProcessTree.signalGroup(child.pid, 'SIGKILL')
        forceKill = undefined
      }, graceMs ?? ProcessTree.FORCE_KILL_GRACE_MS)
    })
    const outcome = await waitForProcess(
      child,
      output => {
        rememberDescendants()
        context.onOutput(output)
      },
      async () => {
        if (ownershipPoll !== undefined) {
          clearInterval(ownershipPoll)
          ownershipPoll = undefined
        }
        const groupMembers = ProcessTree.groupMembers(child.pid)
        for (const process of groupMembers) {
          trackedByIdentity.set(`${process.pid}:${process.startedAt}`, process)
        }
        rememberOwnedDescendants()
        const owned = [...trackedByIdentity.values()]
        trackedDescendants = owned
        const current = ProcessTree.identities(owned.map(process => process.pid))
        const survivors = owned.filter(process => ProcessTree.sameProcess(current.get(process.pid), process))
        if (survivors.length > 0 && !cancelled) {
          ProcessTree.signalTracked(survivors, 'SIGTERM')
          forceKill = setTimeout(() => {
            rememberOwnedDescendants()
            ProcessTree.signalTracked([...trackedByIdentity.values()], 'SIGKILL')
            ProcessTree.signalGroup(child.pid, 'SIGKILL')
            forceKill = undefined
          }, ProcessTree.FORCE_KILL_GRACE_MS)
        }
        if (cancelled && survivors.length > 0) {
          // Cancellation may have raced with a descendant escaping its original process group.
          ProcessTree.signalTracked(survivors, 'SIGTERM')
          if (forceKill === undefined) {
            forceKill = setTimeout(() => {
              rememberOwnedDescendants()
              ProcessTree.signalTracked([...trackedByIdentity.values()], 'SIGKILL')
              ProcessTree.signalGroup(child.pid, 'SIGKILL')
              forceKill = undefined
            }, ProcessTree.FORCE_KILL_GRACE_MS)
          }
        }
        await Promise.all([
          groupMembers.length > 0 ? ProcessTree.waitForGroupExit(child.pid) : Promise.resolve(),
          ProcessTree.waitForTrackedExit(owned),
        ])
        if (forceKill !== undefined) {
          clearTimeout(forceKill)
          forceKill = undefined
        }
        const diagnostic = survivors.length > 0
          ? `\nOwned child processes outlived the command (${
            survivors.map(process => process.pid).join(', ')
          }); terminated ${survivors.length}.\n`
          : undefined
        return {
          exitCode: child.exitCode === 0 && diagnostic !== undefined ? 1 : child.exitCode,
          ...(diagnostic === undefined ? {} : { output: diagnostic }),
        }
      },
    )
    state.cpuMs = directCpuMs(child)
    return outcome
  } finally {
    if (ownershipPoll !== undefined) {
      clearInterval(ownershipPoll)
    }
    if (forceKill !== undefined) {
      clearTimeout(forceKill)
    }
  }
}

/**
 * waitForProcess waits for the direct child to exit, tears down any owned descendants, then waits for
 * both output streams to reach end-of-stream. While the command itself is still running, an escaped
 * background job that keeps producing no output still holds the node open and remains subject to its
 * timeout; once the command exits, inherited pipes cannot keep the graph waiting on an orphan.
 */
async function waitForProcess(
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
  onOutput: (output: string) => void,
  afterExit: () => Promise<WorkOutcome>,
): Promise<WorkOutcome> {
  const output = Promise.all([pumpOutput(child.stdout, onOutput), pumpOutput(child.stderr, onOutput)])
  await child.exited
  const outcome = await afterExit()
  await output
  return outcome
}

/** pumpOutput reports each chunk to the graph as it arrives, rather than buffering to the end. */
async function pumpOutput(stream: ReadableStream<Uint8Array>, onOutput: (output: string) => void): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        return
      }
      onOutput(decoder.decode(value, { stream: true }))
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * directCpuMs reads the milliseconds of CPU time (user+system) a just-exited child consumed.
 * `resourceUsage()` is only ever `undefined` for a process that has not exited, which cannot be true
 * here — `waitForProcess` already awaited `child.exited` — but the guard is kept rather than asserted
 * past, because an unmeasured node must read as absent, never as a false `0`.
 */
function directCpuMs(child: Bun.Subprocess): number | undefined {
  const usage = child.resourceUsage()
  return usage === undefined ? undefined : Number(usage.cpuTime.user + usage.cpuTime.system) / 1000
}

function finishWithoutRunning(
  state: WorkState,
  reason: string,
  emit: (event: WorkEvent) => void,
  status: 'failed' | 'skipped' = 'skipped',
): void {
  state.status = status
  state.reason = reason
  state.failure = {
    kind: reason === INTERRUPTED_REASON ? 'interrupted' : reason.startsWith('not run after definite failure:')
      ? 'fail-fast'
      : 'dependency',
    message: reason,
  }
  emit({ kind: 'complete', state })
}

/** failedDependencyName names the first dependency that will never pass, when there is one. */
function failedDependencyName(state: WorkState, states: readonly WorkState[]): string | undefined {
  for (const need of state.node.needs ?? []) {
    const dependency = states.find(candidate => candidate.name === need)
    if (dependency !== undefined && (dependency.status === 'failed' || dependency.status === 'skipped')) {
      return need
    }
  }
  return undefined
}

function isSettled(state: WorkState, running: ReadonlyMap<WorkState, unknown>): boolean {
  return state.status !== 'pending' && state.status !== 'running' && !running.has(state)
}

function isReady(state: WorkState, states: readonly WorkState[], running: ReadonlyMap<WorkState, unknown>): boolean {
  return (state.node.needs ?? []).every(need => {
    const dependency = states.find(candidate => candidate.name === need)
    return dependency === undefined || dependency.status === 'passed'
  }) && (state.node.after ?? []).every(name => {
    const dependency = states.find(candidate => candidate.name === name)
    return dependency === undefined || isSettled(dependency, running)
  })
}

function resourcesAvailable(state: WorkState, heldResources: ReadonlySet<string>): boolean {
  return (state.node.resources ?? []).every(resource => !heldResources.has(resource))
}

function startOrder(
  states: readonly WorkState[],
  ranks: ReadonlyMap<string, number>,
): (left: WorkState, right: WorkState) => number {
  const declarationOrder = new Map(states.map((state, index) => [state.name, index]))
  const rankOf = (state: WorkState) => ranks.get(state.name) ?? 0
  const orderOf = (state: WorkState) => declarationOrder.get(state.name) ?? 0
  // A serial node is a floor on the whole run: it cannot be made shorter by any amount of machine,
  // and everything else can be packed around it. Starting it before its equal-priority neighbours
  // is therefore free, and starting it late costs the run its own length.
  const serialFirst = (state: WorkState) => state.node.serial === true ? 1 : 0
  return (left, right) =>
    nodePriority(right.node) - nodePriority(left.node)
    || serialFirst(right) - serialFirst(left)
    || rankOf(right) - rankOf(left)
    || orderOf(left) - orderOf(right)
}

/**
 * criticalPathRanks measures how much work still depends on each node, so the longest chain starts
 * first and every stage finishes as a whole as early as it can.
 */
function criticalPathRanks(
  states: readonly WorkState[],
  expectedMs: WorkRunOptions['expectedMs'],
): Map<string, number> {
  const dependents = new Map<string, string[]>()
  const known = new Set(states.map(state => state.name))
  for (const state of states) {
    for (const need of new Set([...(state.node.needs ?? []), ...(state.node.after ?? [])])) {
      if (known.has(need)) {
        dependents.set(need, [...dependents.get(need) ?? [], state.name])
      }
    }
  }

  const ranks = new Map<string, number>()
  const visiting = new Set<string>()
  const rankOf = (name: string): number => {
    const cached = ranks.get(name)
    if (cached !== undefined) {
      return cached
    }
    if (visiting.has(name)) {
      return 0
    }
    visiting.add(name)
    const state = states.find(candidate => candidate.name === name)
    const own = expectedMs?.(name) ?? nodeCost(state?.node) * COLD_START_MS_PER_SLOT
    const rank = own + Math.max(0, ...(dependents.get(name) ?? []).map(rankOf))
    visiting.delete(name)
    ranks.set(name, rank)
    return rank
  }
  for (const state of states) {
    rankOf(state.name)
  }
  return ranks
}

/**
 * budgetEnv hands a nested runner the width this graph already reserved for it, so `cost` is an
 * enforced bound rather than a guess and the two pools cannot oversubscribe the machine together.
 */
function budgetEnv(node: WorkNode, command: WorkCommand, slots: number): Record<string, string> {
  const keys = node.budgetEnvKeys ?? nestedRunnerBudgetKeys(command)
  return Object.fromEntries(keys.map(key => [key, String(slots)]))
}

function nestedRunnerBudgetKeys(command: WorkCommand): readonly string[] {
  const isBunRun = FS.basename(command.command) === 'bun' && command.args[0] === 'run'
  const runner = FS.basename(isBunRun ? command.args[1] ?? '' : command.command).replace(/\.ts$/, '')
  const subcommand = isBunRun ? command.args[2] : command.args[0]
  return subcommand === 'test' && runner === 'tao' ? [BUDGET_ENV_KEYS.taoTest] : []
}

/**
 * DEFAULT_WIDTH_CAP bounds a run's worker width when nothing asked for one. Replaying a recorded
 * green `verify-full` through this scheduler (`Docs/Roadmap/Verification speed research.md`, §10)
 * put the simulated makespan at 362 s at width 12 and 371 s at width 18 once per-slot inflation on
 * the machine's twelve usable cores is counted: past twelve, every extra slot slows the slots already
 * running by more than it adds. `--jobs` and `TAO_VERIFY_JOBS` still set any width explicitly.
 */
const DEFAULT_WIDTH_CAP = 12

/** resolveCapacity resolves the worker width of a run: `--jobs`, then the machine up to the cap. */
function resolveCapacity(requestedJobs: number | undefined): number {
  return requestedJobs ?? defaultCapacity(Platform.cpuCount())
}

/** defaultCapacity is the width a run takes on a machine of `cpuCount` cores when none was asked for. */
function defaultCapacity(cpuCount: number): number {
  return Math.max(1, Math.min(DEFAULT_WIDTH_CAP, cpuCount))
}

function watchProcessInterrupt(interrupt: () => void): () => void {
  return Platform.onProcessSignal('SIGINT', interrupt)
}

function nodeCost(node: WorkNode | undefined): number {
  // A serial node occupies one core by definition, so its width is one whatever else it declares.
  return node?.serial === true ? 1 : Math.max(1, node?.cost ?? 1)
}

function nodePriority(node: WorkNode): number {
  return node.priority ?? 0
}

/** addWait folds one slice of waiting into the node's per-reason totals, longest reason first. */
function addWait(state: WorkState, reason: Pick<WorkWait, 'detail' | 'kind'>, sliceMs: number): void {
  const waits = [...state.waits ?? []]
  const existing = waits.find(wait => wait.kind === reason.kind && wait.detail === reason.detail)
  if (existing === undefined) {
    waits.push({ ...reason, ms: sliceMs })
  } else {
    existing.ms += sliceMs
  }
  state.waits = waits.toSorted((left, right) => right.ms - left.ms)
}

function appendOutput(state: WorkState, output: string): void {
  state.fullOutput += output
  state.lines = OutputText.sanitize(state.fullOutput)
    .split('\n')
    .filter(line => line.length > 0)
    .slice(-OUTPUT_LINE_LIMIT)
}

function elapsedMs(state: WorkState): number {
  return state.startedAt === undefined ? 0 : Date.now() - state.startedAt
}

function formatTimeout(timeoutMs: number): string {
  return timeoutMs >= 1_000 ? `${Math.round(timeoutMs / 1_000)}s` : `${timeoutMs}ms`
}

/** exitCodeFor reports the process exit code a finished run deserves. */
function exitCodeFor(result: WorkRunResult): number {
  return result.interrupted || result.states.some(state => state.status === 'failed') ? 1 : 0
}

/** WorkGraph owns dependency-aware, prioritized scheduling for every parallel repository lane. */
export const WorkGraph = {
  BUDGET_ENV_KEYS,
  DEFAULT_WIDTH_CAP,
  OUTPUT_LINE_LIMIT,
  createState,
  defaultCapacity,
  elapsedMs,
  exitCodeFor,
  nodeLabel,
  run,
} as const
