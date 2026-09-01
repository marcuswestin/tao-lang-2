import { CLI, FS, Platform } from '@shared'
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

/** WorkCommand declares the process one node runs. */
export type WorkCommand = {
  args: readonly string[]
  command: string
  cwd?: string
  env?: Record<string, string>
}

/** WorkNode declares one unit of schedulable work and how it relates to the rest of a run. */
export type WorkNode = {
  name: string
  /** Just recipe or explicit command; both run through `CLI.start` with piped output. */
  run: WorkCommand
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
  elapsedMs: number
  exitCode?: number | null
  fullOutput: string
  /** The last few output lines, for the dashboard. */
  lines: string[]
  logPath?: string
  name: string
  node: WorkNode
  /** Why a node was skipped, or what kind of failure it was, in one line. */
  reason?: string
  startedAt?: number
  status: WorkStatus
}

/** WorkEvent is what a run reports as it progresses; reporters consume nothing else. */
export type WorkEvent =
  | { kind: 'planned'; states: readonly WorkState[] }
  | { kind: 'start'; state: WorkState }
  | { kind: 'output'; output: string; state: WorkState }
  | { kind: 'complete'; state: WorkState }
  | { kind: 'done'; interrupted: boolean; states: readonly WorkState[] }

/** WorkRunContext is what a node's runner is handed when the graph admits it. */
export type WorkRunContext = {
  /** Env the command runs with, including the worker budget the graph reserved for it. */
  env: Record<string, string>
  /** Registers how to stop this node early; the graph calls it when the run is interrupted. */
  onCancel: (cancel: () => void) => void
  /** Reports incremental output; the graph records it and emits it. */
  onOutput: (output: string) => void
  /** Worker slots reserved for this node. */
  slots: number
}

/** WorkOutcome is how one node ended. */
export type WorkOutcome = {
  error?: Error
  exitCode: number | null
  /** Output a runner buffered instead of streaming; appended to the state as if streamed. */
  output?: string
}

/** WorkRunOptions configures one graph run. */
export type WorkRunOptions = {
  /** Measured duration per node, for critical-path ordering. Cold start falls back to `cost`. */
  expectedMs?: (name: string) => number | undefined
  jobs?: number
  onEvent?: (event: WorkEvent) => void
  /** Injected so tests observe scheduling without starting real processes. */
  runNode?: (state: WorkState, context: WorkRunContext) => Promise<WorkOutcome>
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

const OUTPUT_LINE_LIMIT = 6
/**
 * Cold-start duration for a node with no measured history. Scaling by `cost` keeps the hand-tuned
 * reservations meaningful on the first run of a lane, before the timings store has anything to say.
 */
const COLD_START_MS_PER_SLOT = 1_000
const INTERRUPTED_REASON = 'interrupted'
/** How long a cancelled process gets to honor SIGTERM before it is killed outright. */
const FORCE_KILL_GRACE_MS = 10_000
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
      const admitted = admit()
      if (running.size === 0) {
        if (admitted === 0) {
          // Nothing runs, nothing can start: what is left needs something this run never provides.
          for (const state of pending.splice(0)) {
            finishWithoutRunning(state, 'dependency cycle or unreachable dependency', emit)
          }
        }
        continue
      }
      await Promise.race([...running.values()].map(node => node.promise))
    }
  } finally {
    stopWatchingInterrupt()
  }
  emit({ kind: 'done', interrupted, states })
  return { interrupted, states }

  function admit(): number {
    let started = 0
    for (let index = 0; index < pending.length;) {
      const state = pending[index]!
      const failedDependency = failedDependencyName(state, states)
      if (failedDependency !== undefined) {
        pending.splice(index, 1)
        finishWithoutRunning(state, `dependency failed: ${failedDependency}`, emit)
        continue
      }
      if (!isReady(state, states) || !resourcesAvailable(state, heldResources)) {
        index += 1
        continue
      }
      // A node whose width does not fit waits for running nodes to release slots rather than
      // letting cheaper nodes jump the queue; with nothing running its width clamps to capacity.
      const slots = Math.min(nodeCost(state.node), capacity)
      if (slots > availableSlots && running.size > 0) {
        break
      }
      pending.splice(index, 1)
      availableSlots -= slots
      for (const resource of state.node.resources ?? []) {
        heldResources.add(resource)
      }
      startNode(state, slots)
      started += 1
    }
    return started
  }

  function startNode(state: WorkState, slots: number): void {
    let cancel = () => {}
    let timedOut = false
    const context: WorkRunContext = {
      env: { ...state.node.run.env, ...budgetEnv(state.node, slots) },
      onCancel: handler => {
        cancel = handler
      },
      onOutput: output => {
        appendOutput(state, output)
        emit({ kind: 'output', output, state })
      },
      slots,
    }
    state.status = 'running'
    state.startedAt = Date.now()
    emit({ kind: 'start', state })
    const timeout = state.node.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true
      cancel()
    }, state.node.timeoutMs)

    const promise = executeNode(state, context, runOne).finally(() => {
      if (timeout !== undefined) {
        clearTimeout(timeout)
      }
      availableSlots += slots
      for (const resource of state.node.resources ?? []) {
        heldResources.delete(resource)
      }
      running.delete(state)
      if (timedOut && state.status === 'failed') {
        state.reason = `timed out after ${formatTimeout(state.node.timeoutMs ?? 0)}`
      }
      if (interrupted && state.status === 'failed') {
        state.reason = INTERRUPTED_REASON
      }
      emit({ kind: 'complete', state })
    })
    running.set(state, { cancel: () => cancel(), promise })
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
      appendOutput(state, errorMessage(outcome.error))
    }
  } catch (error) {
    state.elapsedMs = elapsedMs(state)
    state.exitCode = null
    state.status = 'failed'
    appendOutput(state, errorMessage(error))
  }
}

/** runProcess is the default runner: one child process with its output piped back to the graph. */
async function runProcess(state: WorkState, context: WorkRunContext): Promise<WorkOutcome> {
  let command: CLI.StartedCommand | undefined
  let forceKill: ReturnType<typeof setTimeout> | undefined
  try {
    command = CLI.start(state.node.run.command, {
      args: [...state.node.run.args],
      cwd: state.node.run.cwd,
      env: context.env,
      onOutput: (_stream, chunk) => context.onOutput(String(chunk)),
      stdio: 'pipe',
    })
    const started = command
    context.onCancel(() => {
      started.kill('SIGTERM')
      // A node cancelled for hanging may ignore SIGTERM — the canary's surviving launch process
      // did — and would then hold the lane open through the very mechanism meant to unblock it.
      forceKill = setTimeout(() => started.kill('SIGKILL'), FORCE_KILL_GRACE_MS)
    })
    return await waitForCommand(started)
  } finally {
    if (forceKill !== undefined) {
      clearTimeout(forceKill)
    }
    command?.dispose()
  }
}

async function waitForCommand(command: CLI.StartedCommand): Promise<WorkOutcome> {
  return await new Promise(resolve => {
    let settled = false
    const finish = (outcome: WorkOutcome) => {
      if (settled) {
        return
      }
      settled = true
      resolve(outcome)
    }
    command.onceError(error => {
      finish({ error, exitCode: null })
    })
    command.waitForClose().then(result => {
      finish({ error: command.error, exitCode: result.exitCode })
      return result
    })
  })
}

function finishWithoutRunning(state: WorkState, reason: string, emit: (event: WorkEvent) => void): void {
  state.status = 'skipped'
  state.reason = reason
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
function budgetEnv(node: WorkNode, slots: number): Record<string, string> {
  const keys = node.budgetEnvKeys ?? nestedRunnerBudgetKeys(node.run)
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
} as const
