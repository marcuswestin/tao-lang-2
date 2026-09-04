import { Describe, Expect, Test } from '@shared/test'
import {
  captureStudioDeviceLogs,
  formatLogArgument,
  type StudioDeviceLogConsole,
  type StudioDeviceLogTimers,
} from '../TaoRuntime-src/TR-studio-device-logs'
import type { TaoStudioDeviceLogEntry } from '../TaoRuntime-src/TR-studio-device-protocol'

/** A timer pair a test advances by hand, so the batch window is decided rather than waited on. */
function manualTimers(): StudioDeviceLogTimers & { run(): void } {
  let pending: (() => void) | undefined
  return {
    clearTimeout: () => {
      pending = undefined
    },
    run: () => {
      const callback = pending
      pending = undefined
      callback?.()
    },
    setTimeout: callback => {
      pending = callback
      return 1
    },
  }
}

function harness(): {
  batches: (readonly TaoStudioDeviceLogEntry[])[]
  console: StudioDeviceLogConsole & { seen: string[] }
  restore: () => void
  timers: ReturnType<typeof manualTimers>
} {
  const seen: string[] = []
  const fake: StudioDeviceLogConsole & { seen: string[] } = {
    error: (...args) => seen.push(`error:${args.join(' ')}`),
    log: (...args) => seen.push(`log:${args.join(' ')}`),
    seen,
    warn: (...args) => seen.push(`warn:${args.join(' ')}`),
  }
  const batches: (readonly TaoStudioDeviceLogEntry[])[] = []
  const timers = manualTimers()
  let clock = 0
  const restore = captureStudioDeviceLogs({
    console: fake,
    now: () => ++clock,
    sink: entries => batches.push(entries),
    timers,
  })
  return { batches, console: fake, restore, timers }
}

Describe('Studio device log mirroring', () => {
  Test('batches lines and keeps printing them on the device', () => {
    const run = harness()

    run.console.log?.('first', 2)
    run.console.error?.('boom')
    Expect(run.batches).toEqual([])

    run.timers.run()

    Expect(run.batches.length).toBe(1)
    Expect(run.batches[0]?.map(entry => [entry.level, entry.message])).toEqual([
      ['info', 'first 2'],
      ['error', 'boom'],
    ])
    // Mirroring, not moving: a cable-attached person still sees everything the phone printed.
    Expect(run.console.seen).toEqual(['log:first 2', 'error:boom'])
    run.restore()
  })

  Test('a runaway loop drops lines and says how many rather than exhausting memory', () => {
    const run = harness()

    for (let line = 0; line < 260; line++) {
      run.console.log?.(`line ${line}`)
    }
    run.timers.run()

    const batch = run.batches[0] ?? []
    Expect(batch.length).toBe(201)
    Expect(batch[200]?.message).toBe('[60 device log lines dropped]')
    Expect(batch[200]?.level).toBe('warn')
    run.restore()
  })

  Test('restoring puts the original console back and sends nothing more', () => {
    const run = harness()
    run.console.log?.('before')
    run.restore()

    run.console.log?.('after')
    run.timers.run()

    Expect(run.batches).toEqual([])
    Expect(run.console.seen).toEqual(['log:before', 'log:after'])
  })

  Test('an error argument reads as its message, not as an empty object', () => {
    Expect(formatLogArgument(new TypeError('bad shape'))).toBe('TypeError: bad shape')
    Expect(formatLogArgument('plain')).toBe('plain')
    Expect(formatLogArgument(undefined)).toBe('undefined')
    Expect(formatLogArgument({ a: 1 })).toBe('{"a":1}')
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    Expect(formatLogArgument(cyclic)).toBe('[object Object]')
  })
})
