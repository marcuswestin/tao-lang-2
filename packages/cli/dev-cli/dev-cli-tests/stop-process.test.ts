import { Errors, Platform, type TrackedProcess } from '@shared'
import { Expect, Test } from '@shared/test'
import { stopProcess } from '../dev-cli-src/doctor/StopProcess'

function fixture(
  options: { exit?: 'SIGTERM' | 'SIGKILL'; reused?: boolean; foreign?: boolean; denied?: boolean; leftover?: boolean } =
    {},
) {
  const process: TrackedProcess = { pid: 712345, startedAt: '123:456', command: 'fixture' }
  const signals: string[] = []
  let waits = 0
  let live = true
  return {
    signals,
    waits: () => waits,
    seams: {
      identity: () =>
        live
          ? { ...process, startedAt: options.reused && signals.length > 0 ? '789:0' : process.startedAt }
          : undefined,
      group: () => process.pid,
      members: () =>
        !live
          ? options.leftover ? [{ ...process, pid: 712346 }] : []
          : options.foreign
          ? [process, { ...process, pid: 712346 }]
          : [process],
      descendants: () => [],
      signal: (_pid: number, signal: 'SIGTERM' | 'SIGKILL') => {
        if (options.denied) {
          Errors.throwHostEnvironment('EPERM stopping reviewed process')
        }
        signals.push(signal)
        if (options.exit === signal) {
          live = false
        }
      },
      wait: async () => {
        waits++
      },
    },
  }
}

Test('reviewed process recovery escalates and verifies exit within a fixed budget', async () => {
  const graceful = fixture({ exit: 'SIGTERM' })
  await stopProcess(712345, '123:456', graceful.seams)
  Expect(graceful.signals).toEqual(['SIGTERM'])
  const forced = fixture({ exit: 'SIGKILL' })
  await stopProcess(712345, '123:456', forced.seams)
  Expect(forced.signals).toEqual(['SIGTERM', 'SIGKILL'])
  Expect(forced.waits()).toBe(10)
  const survivor = fixture()
  await Expect(stopProcess(712345, '123:456', survivor.seams)).rejects.toThrow('absence is unproved')
  Expect(survivor.waits()).toBe(50)
})

Test('reviewed process recovery refuses foreign members, reused identities, and denied signals', async () => {
  const foreign = fixture({ foreign: true })
  await Expect(stopProcess(712345, '123:456', foreign.seams)).rejects.toThrow('not an isolated process')
  Expect(foreign.signals).toEqual([])
  const reused = fixture({ reused: true })
  await Expect(stopProcess(712345, '123:456', reused.seams)).rejects.toThrow('was reused')
  Expect(reused.signals).toEqual(['SIGTERM'])
  const denied = fixture({ denied: true })
  await Expect(stopProcess(712345, '123:456', denied.seams)).rejects.toThrow('EPERM')
  Expect(denied.waits()).toBe(0)
  const leftover = fixture({ exit: 'SIGTERM', leftover: true })
  await Expect(stopProcess(712345, '123:456', leftover.seams)).rejects.toThrow('group members remaining')
  Expect(leftover.signals).toEqual(['SIGTERM'])
  await Expect(stopProcess(Platform.runtimeProcess.pid, '123:456', fixture().seams)).rejects.toThrow('reviewed PID')
})
