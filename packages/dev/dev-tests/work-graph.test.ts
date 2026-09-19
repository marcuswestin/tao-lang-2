import { Errors, FS, Platform } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import {
  type WorkCommand,
  WorkGraph,
  type WorkNode,
  type WorkRunResult,
  type WorkState,
} from '../dev-src/repository-tests/WorkGraph'

/**
 * Scheduling is observed through an injected runner: no real processes, and every node finishes
 * exactly when the test says it does, so an ordering assertion cannot pass by being lucky with a
 * sleep.
 */
type NodeSpec = {
  name: string
  cost?: number
  exitCode?: number
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
  options: { expectedMs?: Record<string, number>; jobs?: number } = {},
): ScheduledRun {
  const specsByName = new Map(specs.map(spec => [spec.name, spec]))
  const holds = new Map(specs.map(spec => [spec.name, Deferred()]))
  const environments = new Map<string, Record<string, string>>()
  const commands = new Map<string, WorkCommand>()
  const started: string[] = []
  const states = specs.map(spec => WorkGraph.createState(workNode(spec)))
  let interrupt = () => {}

  const finished = WorkGraph.run(states, {
    expectedMs: name => options.expectedMs?.[name],
    jobs: options.jobs ?? 4,
    runNode: async (state, context) => {
      started.push(state.name)
      environments.set(state.name, context.env)
      commands.set(state.name, context.run)
      let cancelled = false
      context.onCancel(() => {
        cancelled = true
        holds.get(state.name)?.resolve()
      })
      if (specsByName.get(state.name)?.held === true) {
        await holds.get(state.name)?.promise
      }
      return { exitCode: cancelled ? null : specsByName.get(state.name)?.exitCode ?? 0 }
    },
    watchInterrupt: request => {
      interrupt = request
      return () => {}
    },
  })

  return {
    commandOf: name => commands.get(name),
    envOf: name => environments.get(name) ?? {},
    finished,
    interrupt: () => interrupt(),
    release: name => holds.get(name)?.resolve(),
    started,
    stateOf: name => states.find(state => state.name === name)!,
  }
}

Describe('work graph scheduling', () => {
  Test('holds a node until everything it needs has passed', async () => {
    const run = schedule([
      { held: true, name: 'compile' },
      { name: 'test', needs: ['compile'] },
      { name: 'lint' },
    ])
    await settle(2)

    Expect(run.started.toSorted()).toEqual(['compile', 'lint'])
    run.release('compile')
    await run.finished

    Expect(run.started).toEqual(['compile', 'lint', 'test'])
    Expect(run.stateOf('test').status).toBe('passed')
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
    Expect(run.started).toContain('lint')
    Expect(run.started).not.toContain('test')
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
    Expect(waits.every(wait => wait.ms > 0)).toBe(true)
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
    Expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt)
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
      { held: true, name: 'hung-canary', timeoutMs: 20 },
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
      timeoutMs: 1,
    })

    await WorkGraph.run([state], {
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
    const state = WorkGraph.createState({
      name: 'descendant-pipe',
      run: {
        args: ['-c', 'sleep 1 & echo $! > "$1"; exit 0', 'work-graph', descendantPath],
        command: '/bin/sh',
      },
      timeoutMs: 30,
    })
    const startedAt = Date.now()

    await WorkGraph.run([state], { watchInterrupt: () => () => {} })

    const descendantPid = Number((await FS.readText(descendantPath)).trim())
    Expect(Date.now() - startedAt).toBeLessThan(750)
    await until(() => !Platform.processIsAlive(descendantPid), {
      description: 'the timed-out command descendant to exit',
    })
    Expect(state.failure?.kind).toBe('timeout')
  })

  Test('a timeout terminates an escaped descendant process group that retains output', async () => {
    const root = await mkTestDir('tao-work-graph-escaped-tree-')
    const descendantPath = FS.resolvePath('descendant.pid', root)
    const script = `
      import { writeFileSync } from 'node:fs'
      import { spawn } from 'node:child_process'
      const child = spawn('/bin/sh', ['-c', 'trap "" TERM; sleep 3'], {
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
      timeoutMs: 100,
    })
    const startedAt = Date.now()

    await WorkGraph.run([state], { watchInterrupt: () => () => {} })

    const descendantPid = Number((await FS.readText(descendantPath)).trim())
    Expect(Date.now() - startedAt).toBeLessThan(750)
    await until(() => !Platform.processIsAlive(descendantPid), {
      description: 'the escaped timed-out command descendant to exit',
    })
    Expect(state.failure?.kind).toBe('timeout')
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
})
