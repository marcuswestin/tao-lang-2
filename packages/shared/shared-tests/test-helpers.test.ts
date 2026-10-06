import {
  type CapturedOutput,
  Deferred,
  Describe,
  Expect,
  type FakeTerminal,
  fakeTerminal,
  mkTestDir,
  MockModule,
  reactNativeStubs,
  setClockForTest,
  setReactNativeDevModeForTest,
  settle,
  Test,
  type TestOverrideSlot,
  testOverrideSlot,
  until,
  type UntilOptions,
  withCapturedOutput,
} from '@shared/test'
import { CLI, Errors, FS, HCI, Platform, Time } from '../shared-src/shared'

const diagnosticMode = testOverrideSlot<string | undefined>({
  read: () => Platform.runtimeProcess.env['TAO_VERIFY_NO_TIMEOUTS'],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env['TAO_VERIFY_NO_TIMEOUTS']
    } else {
      Platform.runtimeProcess.env['TAO_VERIFY_NO_TIMEOUTS'] = value
    }
  },
})
type SetTimeoutCall = (...args: Parameters<typeof globalThis.setTimeout>) => ReturnType<typeof globalThis.setTimeout>
const timeoutSlot = testOverrideSlot<SetTimeoutCall>({
  read: () => globalThis.setTimeout,
  write: value => {
    globalThis.setTimeout = value as typeof globalThis.setTimeout
  },
})

Describe('Shared test async helpers', () => {
  Test('Deferred stays pending until the test settles it', async () => {
    const gate = Deferred<string>()
    let settled: string | undefined
    void gate.promise.then(value => {
      settled = value
    })

    await settle()
    Expect(settled).toBeUndefined()
    gate.resolve('released')
    await settle()

    Expect(settled).toBe('released')
  })

  Test('Deferred defaults to a void gate and reports rejection to its awaiter', async () => {
    const gate = Deferred()
    gate.resolve()
    await gate.promise

    const failing = Deferred()
    failing.reject(new Errors.UnexpectedBehaviorError('gate failed'))

    await Expect(failing.promise).rejects.toThrow('gate failed')
  })

  Test('settle advances one chained turn of work per requested turn', async () => {
    const ran: string[] = []
    setTimeout(() => {
      ran.push('first')
      setTimeout(() => ran.push('second'), 0)
    }, 0)

    await settle(2)

    Expect(ran).toEqual(['first', 'second'])
  })

  Test('until returns the value a read produced once the condition holds', async () => {
    let value: string | undefined
    setTimeout(() => {
      value = 'ready'
    }, 0)

    Expect(await until(() => value, { intervalMs: 0 })).toBe('ready')
    Expect(await until(() => value === 'ready')).toBe(true)
  })

  Test('until awaits an async condition and reports its own timeout by description', async () => {
    Expect(await until(async () => await Promise.resolve('read'))).toBe('read')

    // These tiny budgets are what the test is about — proving `until` times out by its own description
    // rather than proving the wait is fast.
    // budget-ok: the timeout value under test.
    const options: UntilOptions = { description: 'the gate to open', timeoutMs: 20, timeoutPolicy: 'bounded' }
    await Expect(until(() => false, options))
      .rejects
      .toThrow('Timed out after 20ms waiting for the gate to open.')
    // budget-ok: same as above, the timeout value is the subject of this assertion.
    await Expect(until(() => undefined, { timeoutMs: 20, timeoutPolicy: 'bounded' }))
      .rejects
      .toThrow('Timed out after 20ms waiting for a test condition.')
  })

  Test('until enforces its own budget on a read whose promise never settles', async () => {
    // Awaiting the read and checking the clock afterwards never reaches the check here: the wait hangs
    // until the runner's anonymous per-test timeout, which is the report `until` exists to replace.
    const stuck = Deferred<boolean>()

    // The 40ms budget is what the test is about — proving `until` abandons a read that never settles
    // instead of hanging on it.
    // budget-ok: the timeout value under test.
    await Expect(until(() => stuck.promise, {
      description: 'a read that never settles',
      timeoutMs: 40, // budget-ok: deliberate timeout-contract fixture.
      timeoutPolicy: 'bounded',
    }))
      .rejects
      .toThrow('Timed out after 40ms waiting for a read that never settles.')

    stuck.resolve(true)
  })

  Test('diagnostic until polls and awaits an asynchronous read without scheduling a deadline', async () => {
    const restoreMode = diagnosticMode.install('true')
    const originalSetTimeout = globalThis.setTimeout
    const delays: Array<number | undefined> = []
    const restoreTimer = timeoutSlot.install((...args) => {
      delays.push(args[1])
      return originalSetTimeout(...args)
    })
    const entered = Deferred()
    const release = Deferred<string>()
    let reads = 0
    const waiting = until<false | string>(() => {
      if (++reads === 1) {
        return false
      }
      entered.resolve()
      return release.promise
    }, {
      intervalMs: 0,
      timeoutMs: 8_123, // budget-ok: verifies the absence of the execution watchdog.
    })
    try {
      await entered.promise
      Expect(delays).toEqual([0])
      release.resolve('released')
      Expect(await waiting).toBe('released')
      Expect(reads).toBe(2)
    } finally {
      release.resolve('cleanup')
      await waiting.catch(() => {})
      restoreTimer()
      restoreMode()
    }
  })

  Test('diagnostic until preserves immediate failure for an exhausted or malformed budget', async () => {
    const restoreMode = diagnosticMode.install('true')
    let reads = 0
    try {
      for (const timeoutMs of [0, -1, NaN]) {
        await Expect(until(() => {
          reads++
          return true
        }, {
          timeoutMs, // budget-ok: verifies the existing exhausted-budget contract.
        })).rejects.toThrow(`Timed out after ${timeoutMs}ms waiting for a test condition.`)
      }
      Expect(reads).toBe(0)
    } finally {
      restoreMode()
    }
  })

  Test('until still surfaces a read that rejects instead of swallowing it into a timeout', async () => {
    await Expect(until(() => Promise.reject(new Errors.UnexpectedBehaviorError('read failed')), {
      // budget-ok: the read rejects synchronously, so this budget is never actually waited out.
      timeoutMs: 1_000,
    }))
      .rejects
      .toThrow('read failed')
  })
})

Describe('Shared test terminal helpers', () => {
  Test('fakeTerminal answers each prompt from its script and records what was written', async () => {
    const terminal: FakeTerminal = fakeTerminal('2\n')

    const choice = await HCI.askChoice({
      message: 'Pick',
      choices: [{ value: 'one' }, { value: 'two' }],
      ...terminal,
    })

    Expect(choice).toBe('two')
    Expect(terminal.outputText()).toContain('Pick')
    Expect(HCI.isInteractive(terminal)).toBe(true)
  })

  Test('fakeTerminal accepts input typed by the test itself', async () => {
    const terminal = fakeTerminal()
    const answer = HCI.askText({ message: 'Name', ...terminal })

    await settle()
    terminal.input.write('the Developer\n')

    Expect(await answer).toBe('the Developer')
  })

  Test('withCapturedOutput records process output and restores the streams afterward', async () => {
    const originalStdout = Platform.runtimeProcess.stdout
    const originalStderr = Platform.runtimeProcess.stderr

    const captured: CapturedOutput<string> = await withCapturedOutput(() => {
      HCI.write('written')
      HCI.writeError('failed')
      return 'result'
    })

    Expect(captured.result).toBe('result')
    Expect(captured.stdout).toBe('written')
    Expect(captured.stderr).toContain('failed')
    Expect(Platform.runtimeProcess.stdout).toBe(originalStdout)
    Expect(Platform.runtimeProcess.stderr).toBe(originalStderr)
  })

  Test('withCapturedOutput restores the streams when the run throws', async () => {
    const originalStdout = Platform.runtimeProcess.stdout

    await Expect(withCapturedOutput(() => {
      HCI.write('partial')
      Errors.throwUnexpected('run failed')
    })).rejects.toThrow('run failed')

    Expect(Platform.runtimeProcess.stdout).toBe(originalStdout)
  })
})

Describe('Shared test runner helpers', () => {
  Test(
    'diagnostic runner wrappers omit explicit test and hook deadlines while bounded fixtures retain them',
    async () => {
      const directory = await mkTestDir('runner-explicit-timeouts')
      const file = FS.resolvePath('execution.test.ts', directory)
      const testApi = FS.resolvePath('../shared-src/testing/Test-Bun.ts', import.meta.dir)
      await FS.writeText(
        file,
        [
          `import { AfterAll, AfterEach, Expect, Test } from ${JSON.stringify(testApi)}`,
          `const bounded = process.env.PROBE_BOUNDED === 'true'`,
          `const register = process.env.PROBE_ONLY === 'true' ? Test.only : Test`,
          `const wait = async () => await new Promise(resolve => setTimeout(resolve, 20))`,
          `AfterAll(async () => { await wait(); console.log('AFTER_ALL_FINISHED') }, 1, ...(bounded ? ['bounded'] : []))`,
          `AfterEach(async () => { await wait(); console.log('AFTER_EACH_FINISHED') }, 1, ...(bounded ? ['bounded'] : []))`,
          `register('explicit short deadline', async () => { await wait(); Expect(true).toBe(true); console.log('TEST_FINISHED') }, 1, ...(bounded ? ['bounded'] : []))`,
          `Test.each(['table row'])('explicit table deadline %s', async () => { await wait(); console.log('EACH_FINISHED') }, 1, ...(bounded ? ['bounded'] : []))`,
          `Test.concurrent('explicit concurrent deadline', async () => { await wait(); console.log('CONCURRENT_FINISHED') }, 1, ...(bounded ? ['bounded'] : []))`,
          `Test.skip('skipped diagnostic case', async () => { Expect('SKIP_RAN').toBe('SKIPPED') }, 1)`,
        ].join('\n'),
      )
      async function probe(diagnostic: boolean, bounded = false, only = false) {
        return await CLI.run(Platform.runtimeProcess.execPath, {
          args: ['test', file, '--timeout=0', ...(only ? ['--only'] : [])],
          env: { PROBE_BOUNDED: String(bounded), PROBE_ONLY: String(only), TAO_VERIFY_NO_TIMEOUTS: String(diagnostic) },
          processPolicy: 'test',
          timeoutMs: 30_000,
        })
      }
      const ordinary = await probe(false)
      Expect(ordinary.exitCode).not.toBe(0)
      Expect(ordinary.stderr).toContain('timed out')
      const diagnostic = await probe(true)
      Expect(diagnostic.exitCode).toBe(0)
      Expect(diagnostic.stdout).toContain('TEST_FINISHED')
      Expect(diagnostic.stdout).toContain('AFTER_EACH_FINISHED')
      Expect(diagnostic.stdout).toContain('AFTER_ALL_FINISHED')
      Expect(diagnostic.stdout).toContain('EACH_FINISHED')
      Expect(diagnostic.stdout).toContain('CONCURRENT_FINISHED')
      Expect(diagnostic.stderr).not.toContain('SKIP_RAN')
      const exclusive = await probe(true, false, true)
      Expect(exclusive.exitCode).toBe(0)
      Expect(exclusive.stdout).toContain('TEST_FINISHED')
      const bounded = await probe(true, true)
      Expect(bounded.exitCode).not.toBe(0)
      Expect(bounded.stderr).toContain('timed out')
    },
  )
  Test('setClockForTest pins a fixed reading and restores the real clock', () => {
    const realNow = Date.now()
    const restore = setClockForTest(1_000)

    Expect(Date.now()).toBe(1_000)
    restore()

    Expect(Date.now()).toBeGreaterThanOrEqual(realNow)
  })

  Test('setClockForTest reads a scripted clock on every call', () => {
    let currentTime = 1_000
    const restore = setClockForTest(() => currentTime)

    try {
      Expect(Date.now()).toBe(1_000)
      currentTime = 2_000
      Expect(Date.now()).toBe(2_000)
    } finally {
      restore()
    }
  })

  Test('setClockForTest restores overlapping pins in either order', () => {
    // Install first, install second, restore first, restore second. Snapshot-and-restore exposes the
    // real clock while the second pin is still meant to be active, and then reinstalls the first pin
    // permanently, so every later test reads 1_000 and nothing points at the test that caused it.
    const realNow = Date.now()
    const restoreFirst = setClockForTest(1_000)
    const restoreSecond = setClockForTest(2_000)

    Expect(Date.now()).toBe(2_000)
    restoreFirst()
    Expect(Date.now()).toBe(2_000)
    restoreSecond()

    Expect(Date.now()).not.toBe(1_000)
    Expect(Date.now()).toBeGreaterThanOrEqual(realNow)
  })

  Test('setReactNativeDevModeForTest restores overlapping overrides in either order', () => {
    const wasPresent = '__DEV__' in globalThis
    const wasValue = (globalThis as { __DEV__?: unknown }).__DEV__
    const restoreFirst = setReactNativeDevModeForTest(true)
    const restoreSecond = setReactNativeDevModeForTest(false)

    Expect((globalThis as { __DEV__?: unknown }).__DEV__).toBe(false)
    restoreFirst()
    Expect((globalThis as { __DEV__?: unknown }).__DEV__).toBe(false)
    restoreSecond()

    Expect('__DEV__' in globalThis).toBe(wasPresent)
    Expect((globalThis as { __DEV__?: unknown }).__DEV__).toBe(wasValue)
  })

  Test('testOverrideSlot keeps the newest live install in force under any interleaving', () => {
    let current = 'base'
    const slot: TestOverrideSlot<string> = testOverrideSlot({
      read: () => current,
      write: next => {
        current = next
      },
    })

    const restoreFirst = slot.install('first')
    const restoreSecond = slot.install('second')
    const restoreThird = slot.install('third')
    Expect(current).toBe('third')

    restoreSecond()
    Expect(current).toBe('third')
    restoreThird()
    Expect(current).toBe('first')
    restoreThird()
    Expect(current).toBe('first')
    restoreFirst()
    Expect(current).toBe('base')

    // The base is captured again once the stack empties, so a later install still hands it back.
    slot.install('later')()
    Expect(current).toBe('base')
  })

  Test('testOverrideSlot leaves a value replaced outside the slot alone', () => {
    let current = 'base'
    const slot: TestOverrideSlot<string> = testOverrideSlot({
      read: () => current,
      write: next => {
        current = next
      },
    })
    const restore = slot.install('installed')

    current = 'installed by other machinery'
    restore()

    Expect(current).toBe('installed by other machinery')
  })

  Test('MockModule rejects a relative specifier instead of silently mocking from the helper module', () => {
    Expect(() => MockModule('./local-probe', () => ({ probe: 'mocked' }))).toThrow(
      "MockModule cannot resolve relative specifier './local-probe'",
    )
  })

  Test('withCapturedOutput keeps overlapping captures apart and leaves the streams usable', async () => {
    // Two captures started before either finished used to interleave, and the inner one restored the
    // outer one's sink instead of the real stream, so every later capture silently recorded nothing.
    // The short capture starts first and restores while the long one is still running: unserialized,
    // that hands the long capture's writes to the real stream and then reinstates a dead sink.
    const short = withCapturedOutput(() => {
      Platform.runtimeProcess.stdout.write('short\n')
      return 'short'
    })
    const long = withCapturedOutput(async () => {
      await Time.sleep(20)
      Platform.runtimeProcess.stdout.write('long\n')
      return 'long'
    })
    const [one, two] = await Promise.all([short, long])

    Expect(one.stdout).toBe('short\n')
    Expect(two.stdout).toBe('long\n')

    const after = await withCapturedOutput(() => {
      Platform.runtimeProcess.stdout.write('after\n')
    })
    Expect(after.stdout).toBe('after\n')
  })

  Test('reactNativeStubs names every component after itself and takes overrides', () => {
    const stubs = reactNativeStubs({ Platform: { OS: 'ios' } })

    Expect(stubs['View']).toBe('View')
    Expect(stubs['TextInput']).toBe('TextInput')
    Expect(stubs['Platform']).toEqual({ OS: 'ios' })
    Expect(reactNativeStubs()['Platform']).toBeUndefined()
  })
})
