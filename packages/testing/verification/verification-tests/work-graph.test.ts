import { Errors, FS, Platform, ProcessTree, type TrackedProcess } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import {
  type WorkCommand,
  WorkGraph,
  type WorkNode,
  type WorkRunOptions,
  type WorkRunResult,
  type WorkState,
} from '../verification-src/WorkGraph'

async function publishedProcess(path: string): Promise<TrackedProcess | undefined> {
  if (!await FS.isFile(path)) {
    return undefined
  }
  const text = (await FS.readText(path)).trim()
  if (!/^\d+$/.test(text)) {
    return undefined
  }
  const pid = Number(text)
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return undefined
  }
  return ProcessTree.identities([pid]).get(pid)
}

/** Arm the short silence bound only after the fixture has a live descendant holding its pipe. */
async function assertDescendantTimeout(
  state: WorkState,
  descendantPath: string,
  releasePath: string,
  idleMs: number,
): Promise<void> {
  const parentPath = FS.resolvePath('parent.pid', FS.dirname(descendantPath))
  const owned: TrackedProcess[] = []
  let completed = false
  const finished = WorkGraph.run([state], { timeoutPolicy: 'bounded', watchInterrupt: () => () => {} })
  void finished.then(() => completed = true, () => completed = true)
  try {
    const parent = await until(() => publishedProcess(parentPath), {
      description: 'the fixture parent to publish a valid PID with a live identity',
    })
    owned.push(parent)
    const tracked = await until(
      async () => state.fullOutput.includes('ready\n') && await publishedProcess(descendantPath),
      {
        description: 'the descendant to publish a valid PID with a live identity and announce readiness',
      },
    )
    const pid = tracked.pid
    owned.push(tracked)
    // The next and final output is the child's acknowledgement. It resets the real graph timer
    // to this short bound, without charging interpreter startup against the behavior under test.
    state.node.idleTimeoutMs = idleMs
    await FS.writeText(releasePath, '')
    await until(() => completed, {
      description: 'graph cancellation to finish before the descendant can exit naturally',
      timeoutMs: 10_000, // budget-ok: independent cancellation guard; fixture descendants live for 300s.
    })
    await finished
    Expect(state.fullOutput).toContain('armed\n')
    Expect(state.failure?.kind).toBe('timeout')
    await until(() => !ProcessTree.sameProcess(ProcessTree.identities([pid]).get(pid), tracked), {
      description: 'the timed-out descendant to stop running, including an unreaped Linux zombie',
    })
  } finally {
    // Cleanup is independent of the graph cancellation being tested and covers both owned groups.
    for (const process of owned) {
      if (ProcessTree.sameProcess(ProcessTree.identities([process.pid]).get(process.pid), process)) {
        ProcessTree.signalTracked(ProcessTree.descendants(process.pid), 'SIGKILL')
        if (ProcessTree.processGroupOf(process.pid) === process.pid) {
          ProcessTree.signalGroup(process.pid, 'SIGKILL')
        }
        ProcessTree.signalTracked([process], 'SIGKILL')
      }
    }
    await until(() => completed, { description: 'the forcibly cleaned fixture processes and graph to settle' })
    await finished
  }
}

/**
 * Scheduling is observed through an injected runner: no real processes, and every node finishes
 * exactly when the test says it does, so an ordering assertion cannot pass by being lucky with a
 * sleep.
 */
type NodeSpec = {
  name: string
  cost?: number
  exitCode?: number
  exitOnCancel?: boolean
  /** Whether the node waits for the test to release it before finishing. */
  held?: boolean
  idleTimeoutMs?: number
  needs?: readonly string[]
  priority?: number
  resources?: readonly string[]
  run?: WorkNode['run']
  serial?: boolean
  timeoutMs?: number
  workerPool?: string
}

type ScheduledRun = {
  commandOf: (name: string) => WorkCommand | undefined
  cancellationGraceOf: (name: string) => number | undefined
  envOf: (name: string) => Record<string, string>
  finished: Promise<WorkRunResult>
  interrupt: () => void
  release: (name: string) => void
  started: string[]
  stateOf: (name: string) => WorkState
}

function workNode(spec: NodeSpec): WorkNode {
  return {
    cost: spec.cost,
    idleTimeoutMs: spec.idleTimeoutMs,
    name: spec.name,
    needs: spec.needs,
    priority: spec.priority,
    resources: spec.resources,
    run: spec.run ?? { args: [spec.name], command: 'true' },
    serial: spec.serial,
    timeoutMs: spec.timeoutMs,
    workerPool: spec.workerPool,
  }
}

function schedule(
  specs: readonly NodeSpec[],
  options: {
    expectedMs?: Record<string, number>
    jobs?: number
    slotBroker?: WorkRunOptions['slotBroker']
    stopOnFailure?: (state: WorkState) => boolean | Promise<boolean>
  } = {},
): ScheduledRun {
  const specsByName = new Map(specs.map(spec => [spec.name, spec]))
  const holds = new Map(specs.map(spec => [spec.name, Deferred()]))
  const environments = new Map<string, Record<string, string>>()
  const commands = new Map<string, WorkCommand>()
  const cancellationGraces = new Map<string, number | undefined>()
  const started: string[] = []
  const states = specs.map(spec => WorkGraph.createState(workNode(spec)))
  let interrupt = () => {}

  const finished = WorkGraph.run(states, {
    timeoutPolicy: 'bounded',
    expectedMs: name => options.expectedMs?.[name],
    jobs: options.jobs ?? 4,
    runNode: async (state, context) => {
      started.push(state.name)
      environments.set(state.name, context.env)
      commands.set(state.name, context.run)
      let cancelled = false
      context.onCancel(graceMs => {
        cancelled = true
        cancellationGraces.set(state.name, graceMs)
        context.onOutput(`${state.name} stopped\n`)
        holds.get(state.name)?.resolve()
      })
      if (specsByName.get(state.name)?.held === true) {
        await holds.get(state.name)?.promise
      }
      return {
        exitCode: cancelled
          ? specsByName.get(state.name)?.exitOnCancel === true ? 0 : null
          : specsByName.get(state.name)?.exitCode ?? 0,
      }
    },
    slotBroker: options.slotBroker,
    stopOnFailure: options.stopOnFailure,
    watchInterrupt: request => {
      interrupt = request
      return () => {}
    },
  })

  return {
    commandOf: name => commands.get(name),
    cancellationGraceOf: name => cancellationGraces.get(name),
    envOf: name => environments.get(name) ?? {},
    finished,
    interrupt: () => interrupt(),
    release: name => holds.get(name)?.resolve(),
    started,
    stateOf: name => states.find(state => state.name === name)!,
  }
}

Describe('work graph scheduling', () => {
  Test('cancels running peers after a definite failure and drains before finishing', async () => {
    const releasedSlots: number[] = []
    const run = schedule([
      { exitCode: 1, name: 'failed', priority: 2 },
      { exitOnCancel: true, held: true, name: 'active', priority: 1 },
      { name: 'pending' },
    ], {
      jobs: 2,
      slotBroker: {
        tryAcquire: async slots => ({
          release: async () => {
            releasedSlots.push(slots)
          },
          slots,
        }),
        waitForAvailability: async () => {},
      },
      stopOnFailure: state => state.name === 'failed',
    })

    await until(() => run.stateOf('pending').status === 'skipped', {
      description: 'the pending node to be skipped after a definite failure',
    })
    Expect(run.started).toEqual(['failed', 'active'])
    await until(() => run.stateOf('active').status === 'skipped', {
      description: 'the active peer to finish as incomplete after cancellation',
    })
    Expect(run.stateOf('pending').reason).toBe('not run after definite failure: failed')
    Expect(run.stateOf('pending').failure?.kind).toBe('fail-fast')
    const result = await run.finished
    Expect(result.haltedBy).toBe('failed')
    Expect(result.interrupted).toBe(false)
    Expect(run.stateOf('failed').status).toBe('failed')
    Expect(run.stateOf('active').status).toBe('skipped')
    Expect(run.stateOf('active').failure?.kind).toBe('fail-fast')
    Expect(run.stateOf('active').reason).toBe('canceled after definite failure: failed')
    Expect(run.stateOf('active').fullOutput).toContain('active stopped')
    Expect(run.cancellationGraceOf('active')).toBe(3_000)
    Expect(run.started).toEqual(['failed', 'active'])
    Expect(releasedSlots).toEqual([1, 1])
  })

  Test('holds admissions while an asynchronous failure classification is pending', async () => {
    const classification = Deferred()
    const run = schedule([
      { exitCode: 1, name: 'failed', priority: 2 },
      { held: true, name: 'active', priority: 1 },
      { name: 'pending' },
    ], {
      jobs: 2,
      stopOnFailure: async () => {
        await classification.promise
        return true
      },
    })

    await until(() => run.stateOf('failed').status === 'failed', {
      description: 'the failure awaiting classification',
    })
    run.release('active')
    await until(() => run.stateOf('active').status === 'passed', {
      description: 'the active node to finish during classification',
    })
    Expect(run.started).toEqual(['failed', 'active'])
    classification.resolve()
    await run.finished
    Expect(run.stateOf('pending').status).toBe('skipped')
  })

  Test('preserves a timeout that started before another node confirmed fail-fast', async () => {
    const classification = Deferred<boolean>()
    const run = schedule([
      { exitCode: 1, name: 'failure', priority: 1 },
      { held: true, name: 'timed-out-peer', timeoutMs: 20 }, // budget-ok: timeout is under test.
    ], {
      jobs: 2,
      stopOnFailure: state => state.name === 'failure' ? classification.promise : false,
    })

    await until(() => run.stateOf('failure').status === 'failed', {
      description: 'the definite failure to await classification',
    })
    await until(() => run.stateOf('timed-out-peer').status === 'failed', {
      description: 'the peer timeout to begin before fail-fast is confirmed',
    })
    classification.resolve(true)
    const result = await run.finished

    Expect(result.haltedBy).toBe('failure')
    Expect(run.stateOf('timed-out-peer').failure?.kind).toBe('timeout')
    Expect(run.stateOf('timed-out-peer').reason).toBe('timed out after 20ms')
  })

  Test('skips everything downstream of a failure and keeps independent nodes running', async () => {
    const run = schedule([
      { exitCode: 1, name: 'compile' },
      { name: 'test', needs: ['compile'] },
      { name: 'report', needs: ['test'] },
      { name: 'lint' },
    ])
    await run.finished

    Expect(run.stateOf('compile').status).toBe('failed')
    Expect(run.stateOf('compile').failure?.kind).toBe('nonzero-exit')
    Expect(run.stateOf('test').status).toBe('skipped')
    Expect(run.stateOf('test').failure?.kind).toBe('dependency')
    Expect(run.stateOf('test').reason).toBe('dependency failed: compile')
    Expect(run.stateOf('report').status).toBe('skipped')
    Expect(run.stateOf('report').reason).toBe('dependency failed: test')
    Expect(run.stateOf('lint').status).toBe('passed')
  })

  Test('rescans nodes whose dependency became skipped later in the same admission pass', async () => {
    const run = schedule([
      { exitCode: 1, name: 'compile' },
      { name: 'report', needs: ['test'], priority: 10 },
      { name: 'test', needs: ['compile'] },
    ], { jobs: 1 })

    await run.finished

    Expect(run.stateOf('compile').status).toBe('failed')
    Expect(run.stateOf('test').status).toBe('skipped')
    Expect(run.stateOf('report').status).toBe('skipped')
    Expect(run.stateOf('report').reason).toBe('dependency failed: test')
  })

  Test('never runs two nodes that hold the same named resource at once', async () => {
    const run = schedule([
      { held: true, name: 'native', resources: ['gui'] },
      { held: true, name: 'canary', resources: ['gui'] },
      { held: true, name: 'browser' },
    ], { jobs: 4 })
    await settle(2)

    // The second `gui` node waits for the resource, and waiting for it costs no worker slot:
    // the unrelated browser lane starts anyway.
    Expect(run.started.toSorted()).toEqual(['browser', 'native'])
    run.release('native')
    await until(() => run.started.includes('canary'), { description: 'the second gui node to start' })
    Expect(run.stateOf('native').status).toBe('passed')

    run.release('canary')
    run.release('browser')
    await run.finished
    Expect(run.started.toSorted()).toEqual(['browser', 'canary', 'native'])
  })

  Test('runs every writer a node declared an edge to before that node reads the tree', async () => {
    const run = schedule([
      { name: 'typecheck', needs: ['fix-dprint', 'fix-tao'] },
      { held: true, name: 'fix-dprint' },
      { held: true, name: 'fix-tao' },
      { name: 'repo-lint', needs: ['fix-dprint', 'fix-tao'] },
    ], { jobs: 4 })
    await settle(2)

    Expect(run.started.toSorted()).toEqual(['fix-dprint', 'fix-tao'])
    run.release('fix-dprint')
    await settle(2)
    // One writer down is not enough: a reader that declared both edges waits for both.
    Expect(run.started.toSorted()).toEqual(['fix-dprint', 'fix-tao'])

    run.release('fix-tao')
    await run.finished

    Expect(run.started.slice(0, 2).toSorted()).toEqual(['fix-dprint', 'fix-tao'])
    Expect(run.started.slice(2).toSorted()).toEqual(['repo-lint', 'typecheck'])
  })

  Test('starts a reader while a writer it declared no edge to is still running', async () => {
    const run = schedule([
      { held: true, name: 'fix-dprint' },
      { held: true, name: 'fix-tao' },
      { name: 'typecheck', needs: ['fix-dprint'] },
      { name: 'tao-check', needs: ['fix-dprint', 'fix-tao'] },
    ], { jobs: 4 })
    await settle(2)

    Expect(run.started.toSorted()).toEqual(['fix-dprint', 'fix-tao'])
    run.release('fix-dprint')
    await until(() => run.started.includes('typecheck'), {
      description: 'the TypeScript reader to start while the Tao fixer is still running',
    })

    // This is the case the old whole-run barrier hid: the TypeScript gates have no relationship
    // with `./tao fix` at all, and holding them behind it made the lane serial behind the slowest
    // fixer. A reader that does declare the edge still waits.
    Expect(run.stateOf('fix-tao').status).toBe('running')
    Expect(run.started).not.toContain('tao-check')

    run.release('fix-tao')
    await run.finished

    Expect(run.stateOf('typecheck').status).toBe('passed')
    Expect(run.started.indexOf('tao-check')).toBeGreaterThan(run.started.indexOf('typecheck'))
  })

  Test('records what held each node that did not start at once, and nothing for one that never waited', async () => {
    const run = schedule([
      { held: true, name: 'fix-dprint' },
      { held: true, name: 'fix-tao' },
      { name: 'tao-check', needs: ['fix-tao'] },
    ], { jobs: 4 })
    await settle(2)

    run.release('fix-dprint')
    await until(() => run.stateOf('fix-dprint').status === 'passed', {
      description: 'the first writer to finish, which is when the graph re-scans',
    })
    run.release('fix-tao')
    await run.finished

    const waits = run.stateOf('tao-check').waits ?? []
    Expect(waits.some(wait => wait.kind === 'dependency' && wait.detail === 'fix-tao')).toBe(true)
    // Both writers were admitted in the first pass, so neither ever waited for anything.
    Expect(run.stateOf('fix-dprint').waits).toBeUndefined()
    Expect(run.stateOf('fix-tao').waits).toBeUndefined()
  })

  Test('holds one slot for a serial node however wide it declares itself, and starts it first', async () => {
    const run = schedule([
      { held: true, name: 'cheap' },
      { cost: 8, held: true, name: 'unshardable-suite', serial: true },
    ], {
      // `cheap` is declared first and has the longer remaining path, so only the serial rule can
      // put the unshardable suite ahead of it.
      expectedMs: { cheap: 5_000, 'unshardable-suite': 100 },
      jobs: 2,
    })
    await settle(2)

    // A serial node cannot use more than one core however long it runs, so the run packs the rest
    // around it rather than reserving eight slots it cannot occupy.
    Expect(run.started).toEqual(['unshardable-suite', 'cheap'])
    Expect(run.stateOf('unshardable-suite').slots).toBe(1)

    run.release('unshardable-suite')
    run.release('cheap')
    const result = await run.finished

    Expect(result.capacity).toBe(2)
  })

  Test('holds the queue for a node too wide to fit rather than letting cheap ones jump it', async () => {
    const run = schedule([
      { held: true, name: 'blocker', priority: 1 },
      { cost: 2, held: true, name: 'wide' },
      { name: 'cheap' },
    ], { jobs: 2 })
    await settle(2)

    Expect(run.started).toEqual(['blocker'])
    run.release('blocker')
    await until(() => run.started.includes('wide'), { description: 'the wide node to be admitted' })

    // The whole point of the head-of-line hold: a wide node is not starved by cheap ones, so the
    // cheap node is still waiting even though a slot for it exists nowhere in the run.
    Expect(run.started).toEqual(['blocker', 'wide'])
    run.release('wide')
    await run.finished

    Expect(run.started).toEqual(['blocker', 'wide', 'cheap'])
  })

  Test('starts a higher-priority node first, whatever the measured durations say', async () => {
    const run = schedule([
      { name: 'cheap' },
      { name: 'jest', priority: 4 },
      { name: 'tao-cli', priority: 2 },
    ], {
      // `cheap` has by far the longest remaining path and still goes last: priority is the pin a
      // measurement is not allowed to overrule.
      expectedMs: { cheap: 9_000, jest: 100, 'tao-cli': 100 },
      jobs: 1,
    })
    await run.finished

    Expect(run.started).toEqual(['jest', 'tao-cli', 'cheap'])
  })

  Test('starts the longest remaining path first, measured durations included', async () => {
    const run = schedule([
      { name: 'quick' },
      { name: 'parser-gen' },
      { name: 'tao-check', needs: ['parser-gen'] },
    ], {
      // parser-gen is the shortest node and still outranks quick, because tao-check waits on it.
      expectedMs: { 'parser-gen': 100, quick: 500, 'tao-check': 900 },
      jobs: 1,
    })
    await run.finished

    Expect(run.started).toEqual(['parser-gen', 'tao-check', 'quick'])
  })

  Test('hands the one nested runner the worker budget the graph reserved for it', async () => {
    const run = schedule([
      { cost: 3, name: 'tao-apps', run: { args: ['test', 'Apps'], command: './tao' } },
      { name: 'repo-lint', run: { args: ['_repo-lint'], command: 'just' } },
      { cost: 4, name: 'dev-test', run: { args: ['test'], command: './dev' } },
    ], { jobs: 8 })
    await run.finished

    Expect(WorkGraph.BUDGET_ENV_KEYS.taoTest).toBe('TAO_TEST_JOBS')
    Expect(run.envOf('tao-apps')[WorkGraph.BUDGET_ENV_KEYS.taoTest]).toBe('3')
    Expect(run.envOf('repo-lint')[WorkGraph.BUDGET_ENV_KEYS.taoTest]).toBeUndefined()
    // `./dev test` is a top-level lane now — suites and shards are ordinary nodes of the one graph,
    // so no gate starts a second scheduler and there is no second budget to divide the machine with.
    Expect(run.envOf('dev-test')).toEqual({})
    Expect(Object.keys(WorkGraph.BUDGET_ENV_KEYS)).toEqual(['taoTest'])
  })

  Test('numbers the members of a worker pool in admission order and builds their commands from it', async () => {
    const smoke = (name: string): NodeSpec => ({
      held: true,
      name,
      run: ({ workerIndex }) => ({ args: ['--worker', String(workerIndex)], command: './dev' }),
      workerPool: 'studio-smoke',
    })
    const run = schedule([
      smoke('launch'),
      smoke('real-app'),
      { name: 'lint', run: ({ workerIndex }) => ({ args: [String(workerIndex)], command: 'true' }) },
      smoke('native'),
    ], { jobs: 4 })
    await settle(2)

    // Every member holds an index no other member holds, and a node outside the pool gets none.
    const indices = ['launch', 'real-app', 'native'].map(name => run.commandOf(name)?.args[1])
    Expect(indices.toSorted()).toEqual(['0', '1', '2'])
    Expect(run.commandOf('lint')?.args).toEqual(['undefined'])
    for (const name of ['launch', 'real-app', 'native']) {
      run.release(name)
    }
    await run.finished
  })

  Test('exports the clamped width, never more slots than the run owns', async () => {
    const run = schedule([{ cost: 12, name: 'tao-apps', run: { args: ['test', 'Apps'], command: './tao' } }], {
      jobs: 2,
    })
    await run.finished

    Expect(run.envOf('tao-apps')[WorkGraph.BUDGET_ENV_KEYS.taoTest]).toBe('2')
    Expect(run.stateOf('tao-apps').slots).toBe(2)
  })

  Test('kills a node that outlives its timeout and keeps the rest of the run alive', async () => {
    const run = schedule([
      // This is the timeout under test — the node is held forever and the test proves it gets killed
      // for outliving this tiny budget, not that the run is fast.
      { held: true, name: 'hung-canary', timeoutMs: 20 }, // budget-ok: timeout value under test.
      { name: 'report', needs: ['hung-canary'] },
      { held: true, name: 'browser' },
    ])
    await until(() => run.stateOf('hung-canary').status === 'failed', {
      description: 'the hung node to be killed by its timeout',
    })

    run.release('browser')
    const { interrupted } = await run.finished
    Expect(interrupted).toBe(false)
    Expect(run.stateOf('hung-canary').reason).toBe('timed out after 20ms')
    Expect(run.stateOf('hung-canary').failure?.kind).toBe('timeout')
    Expect(run.stateOf('report').status).toBe('skipped')
    Expect(run.stateOf('report').reason).toBe('dependency failed: hung-canary')
    Expect(run.stateOf('browser').status).toBe('passed')
  })

  Test('kills a node that goes quiet for longer than its idle bound', async () => {
    const run = schedule([
      // budget-ok: this is the idle timeout under test — the node is held forever and the test proves
      // it gets killed for going quiet past this tiny budget, not that the run is fast.
      { held: true, idleTimeoutMs: 20, name: 'silent-suite' },
      { held: true, name: 'browser' },
    ])
    await until(() => run.stateOf('silent-suite').status === 'failed', {
      description: 'the silent node to be killed by its idle bound',
    })

    run.release('browser')
    const { interrupted } = await run.finished

    // A runaway that allocates without printing produces no output at all, so the wall-clock bound
    // — necessarily much larger — would be the only other thing that ever noticed it.
    Expect(interrupted).toBe(false)
    Expect(run.stateOf('silent-suite').reason).toBe('timed out after 20ms with no output')
    Expect(run.stateOf('silent-suite').failure?.kind).toBe('timeout')
    Expect(run.stateOf('browser').status).toBe('passed')
  })

  Test('a child that exits zero only after cancellation still records its timeout', async () => {
    const state = WorkGraph.createState({
      name: 'masked-timeout',
      run: { args: [], command: 'ignored' },
      // This is the timeout under test — the run never resolves on its own, so the test proves the
      // timeout still records once cancellation masks the exit code, not that it is fast.
      timeoutMs: 1, // budget-ok: timeout value under test.
    })

    await WorkGraph.run([state], {
      timeoutPolicy: 'bounded',
      runNode: async (_state, context) =>
        await new Promise(resolve => {
          context.onCancel(() => resolve({ exitCode: 0 }))
        }),
      watchInterrupt: () => () => {},
    })

    Expect(state.status).toBe('failed')
    Expect(state.failure?.kind).toBe('timeout')
  })

  Test('a timeout terminates descendants that retain the command output pipe', async () => {
    const root = await mkTestDir('tao-work-graph-process-tree-')
    const descendantPath = FS.resolvePath('descendant.pid', root)
    const releasePath = FS.resolvePath('release', root)
    const state = WorkGraph.createState({
      name: 'descendant-pipe',
      run: {
        args: [
          '-c',
          'echo $$ > "$3"; sleep 300 & echo $! > "$1"; echo ready; while [ ! -f "$2" ]; do sleep 0.01; done; echo armed; while :; do sleep 300; done',
          'work-graph',
          descendantPath,
          releasePath,
          FS.resolvePath('parent.pid', root),
        ],
        command: '/bin/sh',
      },
      idleTimeoutMs: 30_000,
    })
    await assertDescendantTimeout(state, descendantPath, releasePath, 30)
  })

  Test('a timeout terminates an escaped descendant process group that retains output', async () => {
    const root = await mkTestDir('tao-work-graph-escaped-tree-')
    const descendantPath = FS.resolvePath('descendant.pid', root)
    const releasePath = FS.resolvePath('release', root)
    const script = `
      import { writeFileSync } from 'node:fs'
      import { spawn } from 'node:child_process'
      writeFileSync(${JSON.stringify(FS.resolvePath('parent.pid', root))}, String(process.pid))
      const child = spawn('/bin/sh', [
        '-c',
        'trap "" TERM; echo ready; while [ ! -f "$1" ]; do sleep 0.01; done; echo armed; sleep 300',
        'escaped-child',
        ${JSON.stringify(releasePath)},
      ], {
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      writeFileSync(${JSON.stringify(descendantPath)}, String(child.pid))
      child.unref()
      await new Promise(() => {})
    `
    const state = WorkGraph.createState({
      name: 'escaped-descendant-pipe',
      run: { args: ['-e', script], command: process.execPath },
      idleTimeoutMs: 30_000,
    })
    await assertDescendantTimeout(state, descendantPath, releasePath, 100)
  })

  Test('a retained child cannot orphan a new child from its termination handler', async () => {
    const root = await mkTestDir('work-graph-late-child-')
    const release = FS.resolvePath('release', root)
    const state = WorkGraph.createState({
      name: 'late-child',
      run: {
        command: '/bin/sh',
        args: [
          '-c',
          `sh -c 'trap "trap \\\"\\\" TERM; sleep 300 & echo late:\\$!; exit 0" TERM; echo held:$$; while :; do :; done' & echo parent:$$; while [ ! -f ${
            JSON.stringify(release)
          } ]; do sleep 0.01; done; exit 7`,
        ],
      },
      timeoutMs: 30_000,
    })
    let finished = false
    let group: number | undefined
    const run = WorkGraph.run([state], { timeoutPolicy: 'bounded', watchInterrupt: () => () => {} })
      .finally(() => {
        finished = true
      })
    try {
      await until(() => state.fullOutput.includes('held:') && state.fullOutput.includes('parent:'), {
        timeoutPolicy: 'bounded',
      })
      group = Number(/parent:(\d+)/.exec(state.fullOutput)?.[1])
      await FS.writeText(release, '')
      const latePid = await until(() => Number(/late:(\d+)/.exec(state.fullOutput)?.[1]) || undefined, {
        timeoutPolicy: 'bounded',
      })
      await until(() => finished, { description: 'late child teardown', timeoutPolicy: 'bounded' })
      await run
      Expect(state.exitCode).toBe(7)
      Expect(ProcessTree.identities([latePid]).has(latePid)).toBe(false)
    } finally {
      await FS.writeText(release, '')
      if (group !== undefined) {
        ProcessTree.signalGroup(group, 'SIGKILL')
      }
      await run
      await FS.remove(root)
    }
  })

  Test(
    'a failed command tears down inherited-pipe and redirected descendants after preserving its verdict',
    async () => {
      const root = await mkTestDir('tao-work-graph-failed-descendants-')
      const parentPath = FS.resolvePath('parent.pid', root)
      const inheritedPath = FS.resolvePath('inherited.pid', root)
      const redirectedPath = FS.resolvePath('redirected.pid', root)
      const releasePath = FS.resolvePath('release', root)
      const childScript = `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`
      const script = `
      import { existsSync, writeFileSync } from 'node:fs'
      import { spawn } from 'node:child_process'
      writeFileSync(${JSON.stringify(parentPath)}, String(process.pid))
      const childScript = ${JSON.stringify(childScript)}
      const inherited = spawn(process['execPath'], ['-e', childScript], {
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      const redirected = spawn(process['execPath'], ['-e', childScript], {
        detached: true,
        stdio: 'ignore',
      })
      writeFileSync(${JSON.stringify(inheritedPath)}, String(inherited.pid))
      writeFileSync(${JSON.stringify(redirectedPath)}, String(redirected.pid))
      inherited.unref()
      redirected.unref()
      process['stdout'].write('suite ready\\n')
      const poll = setInterval(() => {
        if (existsSync(${JSON.stringify(releasePath)})) {
          clearInterval(poll)
          process['stdout'].write('suite verdict: deliberate failure\\n')
          process['exit'](7)
        }
      }, 10)
    `
      const state = WorkGraph.createState({
        name: 'failed-suite-with-descendants',
        run: { args: ['-e', script], command: Platform.runtimeProcess.execPath },
      })
      const finished = WorkGraph.run([state], { timeoutPolicy: 'bounded', watchInterrupt: () => () => {} })
      const owned: TrackedProcess[] = []
      try {
        const parent = await until(() => publishedProcess(parentPath), {
          description: 'failed suite parent to publish a process identity',
        })
        owned.push(parent)
        for (const path of [inheritedPath, redirectedPath]) {
          owned.push(
            await until(() => publishedProcess(path), {
              description: 'failed suite descendant to publish a process identity',
            })!,
          )
        }
        await until(() => state.fullOutput.includes('suite ready\n'), {
          description: 'failed suite to publish its release handshake',
        })
        await FS.writeText(releasePath, '')
        const result = await finished

        Expect(state.status).toBe('failed')
        Expect(state.exitCode).toBe(7)
        Expect(state.failure?.kind).toBe('nonzero-exit')
        Expect(state.fullOutput).toContain('suite verdict: deliberate failure')
        Expect(state.fullOutput).toContain('Owned child processes outlived the command (')
        Expect(state.fullOutput).toContain('terminated 2.')
        for (const process of owned.slice(1)) {
          Expect(ProcessTree.sameProcess(ProcessTree.identities([process.pid]).get(process.pid), process)).toBe(false)
        }
        Expect(WorkGraph.exitCodeFor(result)).toBe(1)
      } finally {
        await FS.writeText(releasePath, '')
        for (const process of owned) {
          if (ProcessTree.sameProcess(ProcessTree.identities([process.pid]).get(process.pid), process)) {
            ProcessTree.signalTracked(ProcessTree.descendants(process.pid), 'SIGKILL')
            if (ProcessTree.processGroupOf(process.pid) === process.pid) {
              ProcessTree.signalGroup(process.pid, 'SIGKILL')
            }
            ProcessTree.signalTracked([process], 'SIGKILL')
          }
        }
        await finished
        await FS.remove(root)
      }
    },
  )

  Test('a successful command with a lingering owned child fails explicitly and is cleaned up', async () => {
    const root = await mkTestDir('tao-work-graph-success-with-descendant-')
    const parentPath = FS.resolvePath('parent.pid', root)
    const descendantPath = FS.resolvePath('descendant.pid', root)
    const releasePath = FS.resolvePath('release', root)
    const script = `
      import { existsSync, writeFileSync } from 'node:fs'
      import { spawn } from 'node:child_process'
      writeFileSync(${JSON.stringify(parentPath)}, String(process.pid))
      const child = spawn(process['execPath'], ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
      })
      writeFileSync(${JSON.stringify(descendantPath)}, String(child.pid))
      child.unref()
      process['stdout'].write('suite ready\\n')
      const poll = setInterval(() => {
        if (existsSync(${JSON.stringify(releasePath)})) {
          clearInterval(poll)
          process['stdout'].write('suite verdict: success\\n')
          process['exit'](0)
        }
      }, 10)
    `
    const state = WorkGraph.createState({
      name: 'successful-suite-with-descendant',
      run: { args: ['-e', script], command: Platform.runtimeProcess.execPath },
    })
    const finished = WorkGraph.run([state], { timeoutPolicy: 'bounded', watchInterrupt: () => () => {} })
    const owned: TrackedProcess[] = []
    try {
      owned.push(
        await until(() => publishedProcess(parentPath), {
          description: 'successful suite parent to publish a process identity',
        })!,
      )
      owned.push(
        await until(() => publishedProcess(descendantPath), {
          description: 'successful suite descendant to publish a process identity',
        })!,
      )
      await until(() => state.fullOutput.includes('suite ready\n'), {
        description: 'successful suite to publish its release handshake',
      })
      await FS.writeText(releasePath, '')
      const result = await finished

      Expect(state.status).toBe('failed')
      Expect(state.exitCode).toBe(1)
      Expect(state.failure?.kind).toBe('nonzero-exit')
      Expect(state.fullOutput).toContain('suite verdict: success')
      Expect(state.fullOutput).toContain('Owned child processes outlived the command (')
      Expect(state.fullOutput).toContain('terminated 1.')
      Expect(ProcessTree.sameProcess(ProcessTree.identities([owned[1]!.pid]).get(owned[1]!.pid), owned[1]!)).toBe(false)
      Expect(WorkGraph.exitCodeFor(result)).toBe(1)
    } finally {
      await FS.writeText(releasePath, '')
      for (const process of owned) {
        if (ProcessTree.sameProcess(ProcessTree.identities([process.pid]).get(process.pid), process)) {
          ProcessTree.signalTracked(ProcessTree.descendants(process.pid), 'SIGKILL')
          if (ProcessTree.processGroupOf(process.pid) === process.pid) {
            ProcessTree.signalGroup(process.pid, 'SIGKILL')
          }
          ProcessTree.signalTracked([process], 'SIGKILL')
        }
      }
      await finished
      await FS.remove(root)
    }
  })

  Test('a healthy command without descendants passes without teardown diagnostics', async () => {
    const state = WorkGraph.createState({
      name: 'healthy-command',
      run: { args: ['-e', "process['stdout'].write('healthy\\n')"], command: Platform.runtimeProcess.execPath },
    })

    const result = await WorkGraph.run([state], { timeoutPolicy: 'bounded', watchInterrupt: () => () => {} })

    Expect(state.status).toBe('passed')
    Expect(state.fullOutput).toContain('healthy\n')
    Expect(state.fullOutput).not.toContain('Owned child processes outlived the command')
    Expect(WorkGraph.exitCodeFor(result)).toBe(0)
  })

  Test('a failed command without descendants keeps its exit code and output without teardown diagnostics', async () => {
    const state = WorkGraph.createState({
      name: 'failed-command-without-descendants',
      run: {
        args: ['-e', "process['stdout'].write('suite verdict: deliberate failure\\n'); process['exit'](7)"],
        command: Platform.runtimeProcess.execPath,
      },
    })

    const result = await WorkGraph.run([state], { timeoutPolicy: 'bounded', watchInterrupt: () => () => {} })

    Expect(state.status).toBe('failed')
    Expect(state.exitCode).toBe(7)
    Expect(state.failure?.kind).toBe('nonzero-exit')
    Expect(state.fullOutput).toContain('suite verdict: deliberate failure\n')
    Expect(state.fullOutput).not.toContain('Owned child processes outlived the command')
    Expect(WorkGraph.exitCodeFor(result)).toBe(1)
  })

  Test('fail-fast stops an owned process tree and leaves an unrelated process alone', async () => {
    const root = await mkTestDir('tao-work-graph-fail-fast-tree-')
    const peerPath = FS.resolvePath('peer.pid', root)
    const descendantPath = FS.resolvePath('descendant.pid', root)
    const continuePath = FS.resolvePath('continue', root)
    const unrelated = Bun.spawn(['/bin/sh', '-c', 'while :; do sleep 1; done'], {
      detached: true,
      stderr: 'ignore',
      stdin: 'ignore',
      stdout: 'ignore',
    })
    const unrelatedIdentity = await until(
      () => ProcessTree.identities([unrelated.pid]).get(unrelated.pid),
      { description: 'the unrelated process to have a tracked identity' },
    )
    const peer = WorkGraph.createState({
      name: 'peer',
      run: {
        args: [
          '-c',
          'echo $$ > "$1"; trap "" TERM; sleep 300 & echo $! > "$2"; echo peer-ready; while [ ! -f "$3" ]; do sleep 0.01; done; while :; do sleep 300; done',
          'fail-fast-peer',
          peerPath,
          descendantPath,
          continuePath,
        ],
        command: '/bin/sh',
      },
    })
    const failure = WorkGraph.createState(workNode({
      name: 'failure',
      priority: 1,
      run: {
        args: [
          '-c',
          'while [ ! -f "$1" ] || [ ! -f "$2" ]; do sleep 0.01; done; echo definite-failure; exit 1',
          'fail-fast',
          peerPath,
          continuePath,
        ],
        command: '/bin/sh',
      },
    }))
    let interrupt = () => {}
    let finished = false
    const running = WorkGraph.run([failure, peer], {
      jobs: 2,
      stopOnFailure: state => state.name === 'failure',
      watchInterrupt: callback => {
        interrupt = callback
        return () => {}
      },
    })
    void running.then(() => finished = true, () => finished = true)
    try {
      const peerProcess = await until(() => publishedProcess(peerPath), {
        description: 'the running peer to publish its process identity',
      })
      const descendantProcess = await until(() => publishedProcess(descendantPath), {
        description: 'the peer descendant to publish its process identity',
      })
      await FS.writeText(continuePath, '')
      const result = await running
      Expect(result.haltedBy).toBe('failure')
      Expect(result.interrupted).toBe(false)
      Expect(peer.fullOutput).toContain('peer-ready')
      Expect(peer.status).toBe('skipped')
      Expect(peer.failure?.kind).toBe('fail-fast')
      Expect(ProcessTree.sameProcess(ProcessTree.identities([peerProcess!.pid]).get(peerProcess!.pid), peerProcess))
        .toBe(false)
      Expect(
        ProcessTree.sameProcess(
          ProcessTree.identities([descendantProcess!.pid]).get(descendantProcess!.pid),
          descendantProcess,
        ),
      ).toBe(false)
      Expect(ProcessTree.sameProcess(ProcessTree.identities([unrelated.pid]).get(unrelated.pid), unrelatedIdentity))
        .toBe(true)
    } finally {
      await FS.writeText(continuePath, '')
      if (!finished) {
        interrupt()
      }
      await running
      const currentUnrelated = ProcessTree.identities([unrelated.pid]).get(unrelated.pid)
      if (ProcessTree.sameProcess(currentUnrelated, unrelatedIdentity)) {
        ProcessTree.signalTracked(ProcessTree.descendants(unrelated.pid), 'SIGKILL')
        ProcessTree.signalGroup(unrelated.pid, 'SIGKILL')
        ProcessTree.signalTracked([unrelatedIdentity], 'SIGKILL')
      }
      await unrelated.exited
      await FS.remove(root)
    }
  })

  Test('a command that cannot be spawned fails the node without throwing out of the run', async () => {
    const state = WorkGraph.createState({
      name: 'unspawnable',
      run: { args: [], command: 'definitely-not-a-real-command-xyz' },
    })

    await WorkGraph.run([state], { timeoutPolicy: 'bounded', watchInterrupt: () => () => {} })

    Expect(state.status).toBe('failed')
    Expect(state.failure?.kind).toBe('process-error')
    Expect(state.exitCode).toBeNull()
    // The process never started, so there is nothing to have measured; absent, never a false `0`.
    Expect(state.cpuMs).toBeUndefined()
  })

  // PID-reuse safety moved with the code: `ProcessTree.signalTracked` now owns it, and
  // `packages/shared/shared-tests/process-supervision.test.ts` proves a stale identity is skipped
  // while a still-matching one is signalled.

  Test('an interrupt stops the running children, skips the rest, and fails the run', async () => {
    const run = schedule([
      { held: true, name: 'test' },
      { name: 'typecheck' },
      { name: 'repo-lint' },
    ], { jobs: 1 })
    await settle(2)
    Expect(run.started).toEqual(['test'])

    run.interrupt()
    const result = await run.finished

    Expect(result.interrupted).toBe(true)
    Expect(run.stateOf('test').status).toBe('failed')
    Expect(run.stateOf('test').reason).toBe('interrupted')
    Expect(run.stateOf('test').failure?.kind).toBe('interrupted')
    Expect(run.stateOf('typecheck').status).toBe('skipped')
    Expect(run.stateOf('typecheck').reason).toBe('interrupted')
    Expect(run.started).toEqual(['test'])
    Expect(WorkGraph.exitCodeFor(result)).toBe(1)
  })

  Test('does not rewrite a child that completed successfully while an interrupt was in flight', async () => {
    const state = WorkGraph.createState(workNode({ name: 'cleanup-aware' }))
    let interrupt = () => {}
    let finish = () => {}
    const finished = WorkGraph.run([state], {
      timeoutPolicy: 'bounded',
      jobs: 1,
      runNode: async (_state, context) =>
        await new Promise(resolve => {
          finish = () => resolve({ exitCode: 0 })
          context.onCancel(finish)
        }),
      watchInterrupt: callback => {
        interrupt = callback
        return () => {}
      },
    })
    await until(() => state.status === 'running', { description: 'cleanup-aware child to start' })

    interrupt()
    const result = await finished

    Expect(result.interrupted).toBe(true)
    Expect(state.status).toBe('passed')
    Expect(state.failure).toBeUndefined()
    Expect(WorkGraph.exitCodeFor(result)).toBe(1)
  })

  Test('releases a reservation that arrives after interruption without starting its node', async () => {
    const state = WorkGraph.createState(workNode({ name: 'late-admission' }))
    const admission = Deferred<{ release: () => Promise<void>; slots: number } | undefined>()
    let interrupt = () => {}
    let released = false
    let starts = 0
    const finished = WorkGraph.run([state], {
      timeoutPolicy: 'bounded',
      jobs: 1,
      runNode: async () => {
        starts += 1
        return { exitCode: 0 }
      },
      slotBroker: {
        tryAcquire: async () => await admission.promise,
        waitForAvailability: async () => {},
      },
      watchInterrupt: callback => {
        interrupt = callback
        return () => {}
      },
    })
    await settle(2)

    interrupt()
    admission.resolve({
      release: async () => {
        released = true
      },
      slots: 1,
    })
    const result = await finished

    Expect(result.interrupted).toBe(true)
    Expect(state.status).toBe('skipped')
    Expect(starts).toBe(0)
    Expect(released).toBe(true)
  })

  Test('does not finish until a running node has released its machine reservation', async () => {
    const state = WorkGraph.createState(workNode({ name: 'release-drain' }))
    const release = Deferred()
    let releaseStarted = false
    let graphFinished = false
    const finished = WorkGraph.run([state], {
      timeoutPolicy: 'bounded',
      jobs: 1,
      runNode: async () => ({ exitCode: 0 }),
      slotBroker: {
        tryAcquire: async () => ({
          release: async () => {
            releaseStarted = true
            await release.promise
          },
          slots: 1,
        }),
        waitForAvailability: async () => {},
      },
      watchInterrupt: () => () => {},
    }).then(result => {
      graphFinished = true
      return result
    })

    await until(() => releaseStarted, { description: 'the broker release to start' })
    await settle(2)
    Expect(graphFinished).toBe(false)

    release.resolve()
    await finished
    Expect(graphFinished).toBe(true)
  })

  Test('reports once when a ready node is waiting for machine capacity', async () => {
    const state = WorkGraph.createState(workNode({ name: 'capacity-waiter' }))
    const events: string[] = []
    let attempts = 0

    await WorkGraph.run([state], {
      timeoutPolicy: 'bounded',
      jobs: 1,
      onEvent: event => events.push(event.kind),
      runNode: async () => ({ exitCode: 0 }),
      slotBroker: {
        tryAcquire: async () =>
          ++attempts < 3
            ? undefined
            : { release: async () => {}, slots: 1 },
        waitForAvailability: async () => {},
      },
      watchInterrupt: () => () => {},
    })

    Expect(events.filter(kind => kind === 'waiting')).toEqual(['waiting'])
    Expect(state.status).toBe('passed')
    Expect(state.reason).toBeUndefined()
  })

  Test("carries the broker's explanation onto the node that is waiting for the machine", async () => {
    const state = WorkGraph.createState(workNode({ name: 'capacity-waiter' }))
    const reasons: string[] = []
    let attempts = 0
    const broker = {
      tryAcquire: async () => ++attempts < 3 ? undefined : { release: async () => {}, slots: 1 },
      waitForAvailability: async () => {},
      // A lane that changes why it is blocked reports both, rather than the first one forever.
      get waitReason() {
        return attempts < 2
          ? 'another lane is confirming exclusively (verify in other-worktree)'
          : 'this lane holds 2 of its 2 slots; 9 lanes are registered'
      },
    }

    await WorkGraph.run([state], {
      timeoutPolicy: 'bounded',
      jobs: 1,
      onEvent: event => {
        if (event.kind === 'waiting') {
          reasons.push(event.reason)
        }
      },
      runNode: async () => ({ exitCode: 0 }),
      slotBroker: broker,
      watchInterrupt: () => () => {},
    })

    Expect(reasons).toEqual([
      'waiting for machine capacity: another lane is confirming exclusively (verify in other-worktree)',
      'waiting for machine capacity: this lane holds 2 of its 2 slots; 9 lanes are registered',
    ])
    Expect(state.status).toBe('passed')
  })

  Test('asks the broker again when external capacity returns before a local node finishes', async () => {
    const firstDone = Deferred()
    const capacityChanged = Deferred()
    const states = ['local-long-runner', 'capacity-waiter'].map(name => WorkGraph.createState(workNode({ name })))
    const started: string[] = []
    let capacityAvailable = false

    const finished = WorkGraph.run(states, {
      timeoutPolicy: 'bounded',
      jobs: 2,
      runNode: async state => {
        started.push(state.name)
        if (state.name === 'local-long-runner') {
          await firstDone.promise
        }
        return { exitCode: 0 }
      },
      slotBroker: {
        tryAcquire: async () =>
          started.length === 0 || capacityAvailable
            ? { release: async () => {}, slots: 1 }
            : undefined,
        waitForAvailability: async () => await capacityChanged.promise,
      },
      watchInterrupt: () => () => {},
    })
    await until(() => started.includes('local-long-runner'), { description: 'the local node to start' })

    capacityAvailable = true
    capacityChanged.resolve()
    await until(() => started.includes('capacity-waiter'), {
      description: 'the broker-blocked node to be admitted while the local node still runs',
    })
    firstDone.resolve()
    await finished

    Expect(started).toEqual(['local-long-runner', 'capacity-waiter'])
  })

  Test('cancels and drains running nodes when a later broker admission fails', async () => {
    const states = ['first', 'second'].map(name => WorkGraph.createState(workNode({ name })))
    let admissions = 0
    let cancellations = 0

    const finished = WorkGraph.run(states, {
      timeoutPolicy: 'bounded',
      jobs: 2,
      runNode: async (_state, context) =>
        await new Promise(resolve => {
          context.onCancel(() => {
            cancellations += 1
            resolve({ exitCode: null })
          })
        }),
      slotBroker: {
        tryAcquire: async () => {
          admissions += 1
          if (admissions === 2) {
            Errors.throwHostEnvironment('registry lock timed out')
          }
          return { release: async () => {}, slots: 1 }
        },
        waitForAvailability: async () => {},
      },
      watchInterrupt: () => () => {},
    })

    await Expect(finished).rejects.toThrow('registry lock timed out')
    Expect(cancellations).toBe(1)
    Expect(states.map(state => state.status)).toEqual(['failed', 'skipped'])
    Expect(states[0]?.failure?.kind).toBe('interrupted')
  })

  Test('reports every node exactly once, in the order the graph reached it', async () => {
    const events: string[] = []
    const states = ['a', 'b'].map(name => WorkGraph.createState(workNode({ name })))
    await WorkGraph.run(states, {
      timeoutPolicy: 'bounded',
      jobs: 1,
      onEvent: event => events.push(`${event.kind}${'state' in event ? ` ${event.state.name}` : ''}`),
      runNode: async () => ({ exitCode: 0 }),
      watchInterrupt: () => () => {},
    })

    Expect(events.filter(event => event.startsWith('planned'))).toEqual(['planned'])
    Expect(events.filter(event => event.startsWith('start'))).toEqual(['start a', 'start b'])
    Expect(events.filter(event => event.startsWith('complete'))).toEqual(['complete a', 'complete b'])
    Expect(events.at(-1)).toBe('done')
  })

  Test('an unrequested width takes the machine up to the cap, never below one slot', () => {
    Expect(WorkGraph.defaultCapacity(4)).toBe(4)
    Expect(WorkGraph.defaultCapacity(12)).toBe(12)
    Expect(WorkGraph.defaultCapacity(18)).toBe(WorkGraph.DEFAULT_WIDTH_CAP)
    Expect(WorkGraph.defaultCapacity(0)).toBe(1)
  })
})
