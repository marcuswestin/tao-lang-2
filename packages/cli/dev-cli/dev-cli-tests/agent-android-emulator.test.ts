import { CLI, Errors } from '@shared'
import { Expect, Test } from '@shared/test'
import { type AgentAndroidOperations, reserveAndroidEmulator } from '../dev-cli-src/simulators/AgentAndroidEmulator'

function fixture() {
  const avds = ['Developer_Pixel']
  const running = new Map([['emulator-5554', 'Developer_Pixel']])
  const held = new Set<string>()
  const starts: string[][] = []
  const stopped: string[] = []
  const processes = new Map<string, { exitCode: number | null; signalCode: 'SIGTERM' | null }>()
  let nextPort = 5556
  let agentBooted = true
  const result = (stdout = ''): CLI.CommandResult => ({
    args: [],
    command: 'fake',
    exitCode: 0,
    signal: null,
    stderr: '',
    stdout,
  })
  const lease = (name: string) => {
    if (held.has(name)) {
      Errors.throwHostEnvironment(`Already leased ${name}`)
    }
    held.add(name)
    return {
      owner: { command: 'test', id: name, name, pid: 1, repositoryRoot: '.', startedAt: new Date().toISOString() },
      release: async () => {
        held.delete(name)
      },
    }
  }
  const operations: AgentAndroidOperations = {
    acquireResource: async options => lease(options.name),
    tryAcquireResource: async options => held.has(options.name) ? undefined : lease(options.name),
    run: async (command, spec) => {
      const args = spec?.args ?? []
      if (command === 'emulator' && args[0] === '-list-avds') {
        return result(`${avds.join('\n')}\n`)
      }
      if (command === 'avdmanager' && args[0] === 'create') {
        avds.push(args[args.indexOf('--name') + 1]!)
        return result()
      }
      if (command === 'adb' && args[0] === 'devices') {
        return result(
          `List of devices attached\n${[...running.keys()].map(serial => `${serial}\tdevice`).join('\n')}\n`,
        )
      }
      if (command === 'adb' && args[2] === 'emu' && args[3] === 'avd') {
        return result(`${running.get(args[1]!) ?? ''}\nOK\n`)
      }
      if (command === 'adb' && args[2] === 'shell') {
        return result(args[1] === 'emulator-5554' || agentBooted ? '1\n' : '0\n')
      }
      if (command === 'adb' && args[2] === 'emu' && args[3] === 'kill') {
        stopped.push(args[1]!)
        running.delete(args[1]!)
        processes.get(args[1]!)!.signalCode = 'SIGTERM'
        return result()
      }
      Errors.throwUnexpected(`Unexpected fake command ${command} ${args.join(' ')}`)
    },
    start: (command, spec) => {
      if (command !== 'emulator') {
        Errors.throwUnexpected(`Unexpected fake start ${command}`)
      }
      const args = [...(spec?.args ?? [])]
      starts.push(args)
      const serial = `emulator-${nextPort}`
      nextPort += 2
      running.set(serial, args[args.indexOf('-avd') + 1]!)
      const state = { exitCode: null as number | null, signalCode: null as 'SIGTERM' | null }
      processes.set(serial, state)
      return {
        closeOutput: async () => {},
        error: undefined,
        get exitCode() {
          return state.exitCode
        },
        get signalCode() {
          return state.signalCode
        },
        kill: () => {
          running.delete(serial)
          state.signalCode = 'SIGTERM'
          return true
        },
      } as unknown as CLI.StartedCommand
    },
    write: () => {},
    writeError: () => {},
  }
  return {
    avds,
    held,
    operations,
    running,
    setAgentBooted: (booted: boolean) => {
      agentBooted = booted
    },
    starts,
    stopped,
  }
}

Test('agent Android sessions use distinct windowless AVDs, stop only owned emulators, and reuse the pool', async () => {
  const f = fixture()
  const first = await reserveAndroidEmulator(f.operations)
  const second = await reserveAndroidEmulator(f.operations)
  Expect([first.avdName, second.avdName]).toEqual(['Tao_Agent_Pixel_1', 'Tao_Agent_Pixel_2'])
  Expect([first.serial, second.serial]).toEqual(['emulator-5556', 'emulator-5558'])
  Expect(f.starts.every(args => args.includes('-no-window') && args.includes('-no-audio'))).toBe(true)
  Expect(f.running.get('emulator-5554')).toBe('Developer_Pixel')
  await first.release()
  await second.release()
  Expect(f.stopped).toEqual(['emulator-5556', 'emulator-5558'])
  const reused = await reserveAndroidEmulator(f.operations)
  Expect(reused.avdName).toBe('Tao_Agent_Pixel_1')
  await reused.release()
  Expect(f.avds).toEqual(['Developer_Pixel', 'Tao_Agent_Pixel_1', 'Tao_Agent_Pixel_2'])
  Expect([...f.held]).toEqual([])
})

Test('an explicitly selected developer Android emulator is reserved without restarting or stopping it', async () => {
  const f = fixture()
  const borrowed = await reserveAndroidEmulator(f.operations, 'emulator-5554', true)
  Expect(borrowed.autoStarted).toBe(false)
  Expect(borrowed.avdName).toBe('Developer_Pixel')
  Expect(f.starts).toEqual([])
  await borrowed.release()
  Expect(f.stopped).toEqual([])
  Expect(f.running.get('emulator-5554')).toBe('Developer_Pixel')
  Expect([...f.held]).toEqual([])
})

Test('the Android serial is leased while the emulator is still booting', async () => {
  const f = fixture()
  f.setAgentBooted(false)
  const opening = reserveAndroidEmulator(f.operations)
  for (let attempt = 0; attempt < 50 && !f.held.has('android-emulator:emulator-5556'); attempt++) {
    await Promise.resolve()
  }
  Expect(f.held.has('android-emulator:emulator-5556')).toBe(true)
  f.setAgentBooted(true)
  const opened = await opening
  await opened.release()
  Expect([...f.held]).toEqual([])
})
