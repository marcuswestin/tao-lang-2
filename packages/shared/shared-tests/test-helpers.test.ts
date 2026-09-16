import {
  type CapturedOutput,
  Deferred,
  Describe,
  Expect,
  type FakeTerminal,
  fakeTerminal,
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
import { Errors, HCI, Platform, Time } from '../shared-src/shared'

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
    Expect(await gate.promise).toBe('released')
  })

  Test('Deferred defaults to a void gate and reports rejection to its awaiter', async () => {
    const gate = Deferred()
    gate.resolve()
    await gate.promise

    const failing = Deferred()
    failing.reject(new Error('gate failed'))

    await Expect(failing.promise).rejects.toThrow('gate failed')
  })

  Test('settle runs already-queued work before the test asserts', async () => {
    const ran: string[] = []
    setTimeout(() => ran.push('first'), 0)

    Expect(ran).toEqual([])
    await settle()

    Expect(ran).toEqual(['first'])
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

    const options: UntilOptions = { description: 'the gate to open', timeoutMs: 20 }
    await Expect(until(() => false, options))
      .rejects
      .toThrow('Timed out after 20ms waiting for the gate to open.')
    await Expect(until(() => undefined, { timeoutMs: 20 }))
      .rejects
      .toThrow('Timed out after 20ms waiting for a test condition.')
  })

  Test('until enforces its own budget on a read whose promise never settles', async () => {
    // Awaiting the read and checking the clock afterwards never reaches the check here: the wait hangs
    // until the runner's anonymous per-test timeout, which is the report `until` exists to replace.
    const stuck = Deferred<boolean>()
    const startedMs = Time.nowMs()

    await Expect(until(() => stuck.promise, { description: 'a read that never settles', timeoutMs: 40 }))
      .rejects
      .toThrow('Timed out after 40ms waiting for a read that never settles.')

    Expect(Time.nowMs() - startedMs).toBeLessThan(2_000)
    stuck.resolve(true)
  })

  Test('until abandons a read still running when the budget runs out', async () => {
    // A read that settles long after the budget is the same failure as one that never settles, and it
    // is the one a timing assertion can pin: checking the clock only after the read returns reports the
    // timeout a whole read late, so the 60ms budget would be spent nearer 400ms.
    const startedMs = Time.nowMs()

    await Expect(until(async () => {
      await Time.sleep(400)
      return false
    }, { description: 'a slow read', intervalMs: 0, timeoutMs: 60 }))
      .rejects
      .toThrow('Timed out after 60ms waiting for a slow read.')

    Expect(Time.nowMs() - startedMs).toBeLessThan(250)
  })

  Test('until still surfaces a read that rejects instead of swallowing it into a timeout', async () => {
    await Expect(until(() => Promise.reject(new Errors.UnexpectedBehaviorError('read failed')), {
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
    terminal.input.write('Ro\n')

    Expect(await answer).toBe('Ro')
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

  Test('MockModule replaces a module specifier for later imports', async () => {
    MockModule('tao-shared-test-module-probe', () => ({ probe: 'mocked' }))

    const mocked = await import('tao-shared-test-module-probe' as string) as { probe: string }

    Expect(mocked.probe).toBe('mocked')
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
    Expect(Object.keys(reactNativeStubs()).length).toBe(9)
  })
})
