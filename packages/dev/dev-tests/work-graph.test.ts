import { Errors } from '@shared'
import { Deferred, Describe, Expect, settle, Test, until } from '@shared/test'
import { type WorkCommand, WorkGraph, type WorkNode, type WorkState } from '../dev-src/repository-tests/WorkGraph'

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
  mutatesTree?: boolean
  needs?: readonly string[]
  priority?: number
  resources?: readonly string[]
  run?: WorkNode['run']
  timeoutMs?: number
  workerPool?: string
}

type ScheduledRun = {
  commandOf: (name: string) => WorkCommand | undefined
  envOf: (name: string) => Record<string, string>
  finished: Promise<{ interrupted: boolean; states: readonly WorkState[] }>
  interrupt: () => void
  release: (name: string) => void
  started: string[]
  stateOf: (name: string) => WorkState
}

function workNode(spec: NodeSpec): WorkNode {
  return {
    cost: spec.cost,
    mutatesTree: spec.mutatesTree,
    name: spec.name,
    needs: spec.needs,
    priority: spec.priority,
    resources: spec.resources,
    run: spec.run ?? { args: [spec.name], command: 'true' },
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

  Test('runs every tree-mutating node before anything that reads the tree', async () => {
    const run = schedule([
      { name: 'typecheck' },
      { held: true, mutatesTree: true, name: 'fix-dprint' },
      { held: true, mutatesTree: true, name: 'fix-tao' },
      { name: 'repo-lint' },
    ], { jobs: 4 })
    await settle(2)

    Expect(run.started.toSorted()).toEqual(['fix-dprint', 'fix-tao'])
    run.release('fix-dprint')
    run.release('fix-tao')
    await run.finished

    Expect(run.started.slice(0, 2).toSorted()).toEqual(['fix-dprint', 'fix-tao'])
    Expect(run.started.slice(2).toSorted()).toEqual(['repo-lint', 'typecheck'])
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

  Test('hands a nested runner the worker budget the graph reserved for it', async () => {
    const run = schedule([
      { cost: 4, name: 'dev-test', run: { args: ['test'], command: './dev' } },
      { cost: 3, name: 'tao-apps', run: { args: ['test', 'Apps'], command: './tao' } },
      { name: 'repo-lint', run: { args: ['_repo-lint'], command: 'just' } },
    ], { jobs: 8 })
    await run.finished

    Expect(run.envOf('dev-test')[WorkGraph.BUDGET_ENV_KEYS.devTest]).toBe('4')
    Expect(run.envOf('tao-apps')[WorkGraph.BUDGET_ENV_KEYS.taoTest]).toBe('3')
    Expect(run.envOf('repo-lint')[WorkGraph.BUDGET_ENV_KEYS.devTest]).toBeUndefined()
    Expect(run.envOf('repo-lint')[WorkGraph.BUDGET_ENV_KEYS.taoTest]).toBeUndefined()
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
    const run = schedule([{ cost: 12, name: 'dev-test', run: { args: ['test'], command: './dev' } }], { jobs: 2 })
    await run.finished

    Expect(run.envOf('dev-test')[WorkGraph.BUDGET_ENV_KEYS.devTest]).toBe('2')
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
