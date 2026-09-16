import { Errors, FS, Platform, Time } from '@shared'
import { dlopen, FFIType, type Pointer, ptr } from 'bun:ffi'
import { OutputText } from '../cli/OutputText'

/**
 * One scheduler for every parallel repository lane. A node says what must pass before it starts,
 * how much CPU width it occupies, which exclusive resources it holds, and whether it rewrites the
 * tree; the graph turns that into a start order, a slot budget, and a worker budget for nested
 * runners. It never writes to the terminal: a run emits events and the reporters decide what a
 * human or an agent sees.
 *
 * The admission policy is the one `TestRunner` proved on suites — priority first, then longest
 * remaining path, with a head-of-line hold so a wide node is not starved by cheap ones.
 */

/** WorkStatus declares the lifecycle state of one node. `skipped` is never reported as `passed`. */
export type WorkStatus = 'failed' | 'passed' | 'pending' | 'running' | 'skipped'

/** WorkFailureKind is the machine-readable reason a node did not pass. */
export type WorkFailureKind = 'dependency' | 'interrupted' | 'nonzero-exit' | 'process-error' | 'timeout'

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
  /** Display and log-file name; defaults to `name`. */
  label?: string
  /** True for nodes that rewrite the source tree; every non-mutating node in the run waits for them. */
  mutatesTree?: boolean
  /** Names of nodes that must pass before this node starts. Unknown names are ignored. */
  needs?: readonly string[]
  /** Hand-pinned start-order override. Default 0; measured durations refine within a priority. */
  priority?: number
  /** Named exclusive resources (e.g. `gui`); nodes sharing one never run concurrently. */
  resources?: readonly string[]
  /**
   * Milliseconds after which a still-running node is killed and marked failed, so one hung
   * process cannot hold the whole lane open. Unset means unbounded.
   */
  timeoutMs?: number
}

/** WorkState tracks one node's output, status, and timing across a run. */
export type WorkState = {
  /** Original and confirmation results, present when a node was retried. */
  attempts?: readonly WorkAttempt[]
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
  startedAt?: number
  status: WorkStatus
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
  /** Registers how to stop this node early; the graph calls it when the run is interrupted. */
  onCancel: (cancel: () => void) => void
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
  /** Waits briefly for another process to publish a capacity change. */
  waitForAvailability: () => Promise<void>
}

/** WorkRunOptions configures one graph run. */
export type WorkRunOptions = {
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
  /** Registers the run's cancel hook and returns its unsubscribe; defaults to SIGINT. */
  watchInterrupt?: (interrupt: () => void) => () => void
}

/** WorkRunResult reports how a whole run ended. */
export type WorkRunResult = {
  interrupted: boolean
  states: readonly WorkState[]
}

type RunningNode = {
  cancel: () => void
  promise: Promise<void>
}

type TrackedProcess = {
  command: string
  pid: number
  /** Kernel process start time, including microseconds on Darwin, protects against PID reuse. */
  startedAt: string
}

type ProcessTableEntry = TrackedProcess & { ppid: number }

const OUTPUT_LINE_LIMIT = 6
/**
 * Cold-start duration for a node with no measured history. Scaling by `cost` keeps the hand-tuned
 * reservations meaningful on the first run of a lane, before the timings store has anything to say.
 */
const COLD_START_MS_PER_SLOT = 1_000
const INTERRUPTED_REASON = 'interrupted'
const MACHINE_CAPACITY_REASON = 'waiting for machine capacity'
/** How long a cancelled process gets to honor SIGTERM before it is killed outright. */
const FORCE_KILL_GRACE_MS = 250
/** Env keys the nested runners read their own worker budget from. */
const BUDGET_ENV_KEYS = {
  devTest: 'TAO_DEV_TEST_JOBS',
  taoTest: 'TAO_TEST_JOBS',
} as const

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
  const heldResources = new Set<string>()
  const workersAdmitted = new Map<string, number>()
  const runOne = options.runNode ?? runProcess
  let availableSlots = capacity
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
  return { interrupted, states }

  async function admit(): Promise<{ machineBlocked: boolean; settled: number; started: number }> {
    let started = 0
    let settled = 0
    let machineBlocked = false
    for (let index = 0; index < pending.length;) {
      const state = pending[index]!
      const failedDependency = failedDependencyName(state, states)
      if (failedDependency !== undefined) {
        pending.splice(index, 1)
        finishWithoutRunning(state, `dependency failed: ${failedDependency}`, emit)
        settled += 1
        continue
      }
      if (!isReady(state, states) || !resourcesAvailable(state, heldResources)) {
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
      if (interrupted || pending[index] !== state || state.status !== 'pending') {
        await machineReservation?.release()
        return { machineBlocked: false, settled, started }
      }
      if (options.slotBroker !== undefined && machineReservation === undefined) {
        machineBlocked = true
        if (state.reason !== MACHINE_CAPACITY_REASON) {
          state.reason = MACHINE_CAPACITY_REASON
          emit({ kind: 'waiting', reason: MACHINE_CAPACITY_REASON, state })
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
    let cancel = () => {}
    let timedOut = false
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
        emit({ kind: 'output', output, state })
      },
    }
    state.status = 'running'
    state.reason = undefined
    state.startedAt = Date.now()
    emit({ kind: 'start', state })
    const timeout = state.node.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true
      cancel()
    }, state.node.timeoutMs)

    const promise = executeNode(state, context, runOne).finally(async () => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      availableSlots += slots
      for (const resource of state.node.resources ?? []) {
        heldResources.delete(resource)
      }
      if (timedOut) {
        state.status = 'failed'
        state.reason = `timed out after ${formatTimeout(state.node.timeoutMs ?? 0)}`
        state.failure = { kind: 'timeout', message: state.reason }
        if (!state.fullOutput.includes(state.reason)) {
          appendOutput(state, `${state.fullOutput.length > 0 ? '\n' : ''}${state.reason}\n`)
        }
      }
      if (interrupted && !timedOut && state.status === 'failed') {
        state.status = 'failed'
        state.reason = INTERRUPTED_REASON
        state.failure = { kind: 'interrupted', message: INTERRUPTED_REASON }
      }
      await machineReservation?.release()
      // Keep the node in `running` through asynchronous broker cleanup. The scheduler uses this map
      // as its drain condition; deleting first lets the graph return and its caller remove the
      // registry root while a reservation is still trying to lock it.
      running.delete(state)
      emit({ kind: 'complete', state })
    })
    running.set(state, { cancel: () => cancel(), promise })
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

/** runProcess is the default runner: one child process with its output piped back to the graph. */
async function runProcess(_state: WorkState, context: WorkRunContext): Promise<WorkOutcome> {
  const child = Platform.spawn(context.run.command, {
    args: [...context.run.args],
    cwd: context.run.cwd,
    detached: true,
    env: context.env,
    stdio: 'pipe',
  })
  let forceKill: ReturnType<typeof setTimeout> | undefined
  let trackedDescendants: TrackedProcess[] = []
  child.stdout?.on('data', chunk => context.onOutput(String(chunk)))
  child.stderr?.on('data', chunk => context.onOutput(String(chunk)))
  let cancelled = false
  try {
    context.onCancel(() => {
      cancelled = true
      trackedDescendants = child.pid === undefined ? [] : descendantProcesses(child.pid)
      signalTrackedProcesses(trackedDescendants, 'SIGTERM')
      signalProcessGroup(child.pid, 'SIGTERM')
      // A node cancelled for hanging may ignore SIGTERM — the canary's surviving launch process
      // did — and would then hold the lane open through the very mechanism meant to unblock it.
      forceKill = setTimeout(() => {
        signalTrackedProcesses(trackedDescendants, 'SIGKILL')
        signalProcessGroup(child.pid, 'SIGKILL')
      }, FORCE_KILL_GRACE_MS)
    })
    const outcome = await waitForProcess(child)
    if (cancelled) {
      await Promise.all([
        waitForProcessGroupExit(child.pid),
        waitForTrackedProcessesExit(trackedDescendants),
      ])
    }
    return outcome
  } finally {
    if (forceKill !== undefined) {
      clearTimeout(forceKill)
    }
    child.stdin?.destroy()
    child.stdout?.destroy()
    child.stderr?.destroy()
    child.removeAllListeners()
  }
}

/**
 * descendantProcesses snapshots the whole owned tree before cancellation can orphan an escaped
 * process group. Each PID carries its OS start identity so a later signal cannot hit a reused PID.
 */
function descendantProcesses(rootPid: number): TrackedProcess[] {
  if (process.platform === 'darwin') {
    return darwinDescendantProcesses(rootPid)
  }
  const byParent = new Map<number, TrackedProcess[]>()
  for (const process of processTable()) {
    const children = byParent.get(process.ppid) ?? []
    children.push(process)
    byParent.set(process.ppid, children)
  }
  const descendants: Array<TrackedProcess & { depth: number }> = []
  const visit = (pid: number, depth: number) => {
    for (const child of byParent.get(pid) ?? []) {
      descendants.push({ ...child, depth })
      visit(child.pid, depth + 1)
    }
  }
  visit(rootPid, 1)
  return descendants.toSorted((left, right) => right.depth - left.depth).map(({ depth: _depth, ...process }) => process)
}

/** Darwin's libproc gives child PIDs and microsecond process-start identity inside the sandbox. */
function darwinDescendantProcesses(rootPid: number): TrackedProcess[] {
  const library = dlopen('/usr/lib/libproc.dylib', {
    proc_listchildpids: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
    proc_pidinfo: {
      args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
  })
  try {
    const descendants: Array<TrackedProcess & { depth: number }> = []
    const visited = new Set<number>([rootPid])
    const visit = (pid: number, depth: number) => {
      const children = new Int32Array(4_096)
      const count = library.symbols.proc_listchildpids(pid, ptr(children), children.byteLength)
      for (const childPid of children.subarray(0, Math.min(Math.max(0, count), children.length))) {
        if (!Number.isSafeInteger(childPid) || childPid <= 1 || visited.has(childPid)) {
          continue
        }
        visited.add(childPid)
        const child = darwinProcessIdentity(childPid, library.symbols.proc_pidinfo)
        if (child === undefined) {
          continue
        }
        descendants.push({ ...child, depth })
        visit(childPid, depth + 1)
      }
    }
    visit(rootPid, 1)
    return descendants.toSorted((left, right) => right.depth - left.depth)
      .map(({ depth: _depth, ...process }) => process)
  } finally {
    library.close()
  }
}

function darwinProcessIdentity(
  pid: number,
  inspect: (pid: number, flavor: number, arg: number, buffer: Pointer, size: number) => number,
): TrackedProcess | undefined {
  const bytes = new Uint8Array(136)
  if (inspect(pid, 3, 0, ptr(bytes), bytes.byteLength) < bytes.byteLength) {
    return undefined
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(12, true) !== pid) {
    return undefined
  }
  return {
    command: darwinProcessName(bytes),
    pid,
    startedAt: `${view.getBigUint64(120, true)}:${view.getBigUint64(128, true)}`,
  }
}

function darwinProcessName(bytes: Uint8Array): string {
  const decode = (offset: number, length: number) =>
    new TextDecoder().decode(bytes.subarray(offset, offset + length)).replace(/\0.*$/, '')
  return decode(64, 32) || decode(48, 16)
}

/** processTable uses the repository-approved fixed process listing, not caller-shaped ps arguments. */
function processTable(): ProcessTableEntry[] {
  const result = Platform.spawnSync('ps', {
    args: ['-axo', 'pid=,ppid=,lstart=,command='],
  })
  if (result.status !== 0) {
    return []
  }
  const processes: ProcessTableEntry[] = []
  for (const line of String(result.stdout).split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/)
    if (match === null) {
      continue
    }
    const pid = Number(match[1])
    const ppid = Number(match[2])
    if (Number.isSafeInteger(pid) && pid > 1 && Number.isSafeInteger(ppid) && ppid >= 0) {
      processes.push({ command: match[4]!, pid, ppid, startedAt: match[3]! })
    }
  }
  return processes
}

/** signalTrackedProcesses signals only PIDs whose start identities still match the owned snapshot. */
type ProcessSignalSeams = {
  identities: (pids: readonly number[]) => Map<number, TrackedProcess>
  signal: (pids: readonly number[], signal: Platform.ProcessSignal) => void
}

function signalTrackedProcesses(
  processes: readonly TrackedProcess[],
  signal: Platform.ProcessSignal,
  seams: ProcessSignalSeams = systemProcessSignalSeams,
): void {
  if (processes.length === 0) {
    return
  }
  const current = seams.identities(processes.map(process => process.pid))
  const pids = processes
    .filter(process => sameProcess(current.get(process.pid), process))
    .map(process => process.pid)
  if (pids.length > 0) {
    seams.signal(pids, signal)
  }
}

const systemProcessSignalSeams: ProcessSignalSeams = {
  identities: currentProcessIdentities,
  signal: (pids, signal) => {
    Platform.spawnSync('/bin/kill', {
      args: [`-${signal.replace(/^SIG/, '')}`, '--', ...pids.map(String)],
      stdio: 'ignore',
    })
  },
}

function sameProcess(current: TrackedProcess | undefined, expected: TrackedProcess): boolean {
  return current?.startedAt === expected.startedAt && current.command === expected.command
}

function currentProcessIdentities(pids: readonly number[]): Map<number, TrackedProcess> {
  if (process.platform !== 'darwin') {
    return new Map(processTable().map(process => [process.pid, process]))
  }
  const library = dlopen('/usr/lib/libproc.dylib', {
    proc_pidinfo: {
      args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
  })
  try {
    return new Map(pids.flatMap(pid => {
      const process = darwinProcessIdentity(pid, library.symbols.proc_pidinfo)
      return process === undefined ? [] : [[pid, process] as const]
    }))
  } finally {
    library.close()
  }
}

async function waitForTrackedProcessesExit(processes: readonly TrackedProcess[]): Promise<void> {
  const expected = new Map(processes.map(process => [process.pid, process.startedAt]))
  while (
    [...currentProcessIdentities([...expected.keys()]).values()]
      .some(process => sameProcess(process, processes.find(expected => expected.pid === process.pid)!))
  ) {
    await Time.sleep(25)
  }
}

async function waitForProcess(child: ReturnType<typeof Platform.spawn>): Promise<WorkOutcome> {
  return await new Promise(resolve => {
    let settled = false
    let processError: Error | undefined
    const finish = (outcome: WorkOutcome) => {
      if (settled) {
        return
      }
      settled = true
      resolve(outcome)
    }
    child.once('error', error => {
      processError = error
      finish({ error, exitCode: null })
    })
    child.once('close', exitCode => {
      finish({ error: processError, exitCode })
    })
  })
}

/** signalProcessGroup stops the detached command and every descendant that inherited its pipes. */
function signalProcessGroup(pid: number | undefined, signal: Platform.ProcessSignal): boolean {
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) {
    return false
  }
  const result = Platform.spawnSync('/bin/kill', {
    args: [`-${signal.replace(/^SIG/, '')}`, '--', `-${pid}`],
    stdio: 'ignore',
  })
  return result.status === 0
}

/** waitForProcessGroupExit keeps cancellation pending until no descendant remains signalable. */
async function waitForProcessGroupExit(pid: number | undefined): Promise<void> {
  if (pid === undefined) {
    return
  }
  while (processGroupIsAlive(pid)) {
    await Time.sleep(25)
  }
}

function processGroupIsAlive(pid: number): boolean {
  return Platform.spawnSync('/bin/kill', { args: ['-0', '--', `-${pid}`], stdio: 'ignore' }).status === 0
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
    kind: reason === INTERRUPTED_REASON ? 'interrupted' : 'dependency',
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

function isReady(state: WorkState, states: readonly WorkState[]): boolean {
  if (state.node.mutatesTree !== true && states.some(other => other.node.mutatesTree === true && !isFinished(other))) {
    // A node that rewrites the tree must complete before anything reads the tree in the same run.
    return false
  }
  return (state.node.needs ?? []).every(need => {
    const dependency = states.find(candidate => candidate.name === need)
    return dependency === undefined || dependency.status === 'passed'
  })
}

function isFinished(state: WorkState): boolean {
  return state.status === 'failed' || state.status === 'passed' || state.status === 'skipped'
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
  return (left, right) =>
    nodePriority(right.node) - nodePriority(left.node)
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
    for (const need of state.node.needs ?? []) {
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
  if (subcommand !== 'test') {
    return []
  }
  if (runner === 'tao') {
    return [BUDGET_ENV_KEYS.taoTest]
  }
  return runner === 'dev' ? [BUDGET_ENV_KEYS.devTest] : []
}

/** resolveCapacity resolves the worker width of a run: `--jobs`, then the env budget, then CPUs. */
function resolveCapacity(requestedJobs: number | undefined): number {
  if (requestedJobs !== undefined) {
    return requestedJobs
  }
  const envJobs = Number(Platform.runtimeProcess.env[BUDGET_ENV_KEYS.devTest] ?? '')
  if (Number.isInteger(envJobs) && envJobs > 0) {
    return envJobs
  }
  return Platform.cpuCount()
}

function watchProcessInterrupt(interrupt: () => void): () => void {
  return Platform.onProcessSignal('SIGINT', interrupt)
}

function nodeCost(node: WorkNode | undefined): number {
  return Math.max(1, node?.cost ?? 1)
}

function nodePriority(node: WorkNode): number {
  return node.priority ?? 0
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
  OUTPUT_LINE_LIMIT,
  createState,
  elapsedMs,
  exitCodeFor,
  nodeLabel,
  run,
  signalTrackedProcesses,
} as const
