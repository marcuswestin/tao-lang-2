import { CLI, Errors, Platform } from '@shared'
import { ProcessTree } from '@shared/ProcessTree'
import { Deferred, Expect, Test, until } from '@shared/test'
import {
  type AgentAppDevDevice,
  type AgentAppDevOperations,
  appDevReservation,
  runAgentAppDev,
} from '../dev-cli-src/simulators/AgentAppDev'

Test('managed reservation refuses a stale kernel identity even while its registry generation matches', async () => {
  const identity = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
    ?? Errors.throwUnexpected('Expected the test process kernel identity.')
  const owner = {
    id: 'retained',
    name: 'android-emulator:emulator-5554',
    pid: identity.pid,
    processStartedAt: identity.startedAt,
    command: 'test',
    repositoryRoot: '.',
    startedAt: '',
  }
  await appDevReservation('android', 'emulator-5554', [owner], async () => owner).assertCurrent()
  const stale = { ...owner, processStartedAt: `${identity.startedAt}-previous` }
  await Expect(
    appDevReservation('android', 'emulator-5554', [stale], async () => stale).assertCurrent(),
  ).rejects.toThrow('lost its process identity')
  await Expect(
    appDevReservation('android', 'emulator-5554', [owner], async () => ({ ...owner, id: 'rotated' })).assertCurrent(),
  ).rejects.toThrow('changed ownership')
})

Test('managed iOS keeps a durable fence before boot and releases it only after verified shutdown', async () => {
  let state = 'Shutdown'
  let retained = false
  let recovered = false
  const closed = Deferred<{ exitCode: number; signal: null }>()
  const devices: AgentAppDevDevice[] = []
  const commands: string[] = []
  const lease = {
    owner: { id: 'original', name: 'ios-simulator:OWNED', pid: 1, command: 'test', repositoryRoot: '.', startedAt: '' },
    release: async () => {},
  }
  const operations: AgentAppDevOperations = {
    acquireResource: async () => lease,
    tryAcquireResource: async () => lease,
    onSignal: () => () => {},
    write: () => {},
    writeError: () => {},
    retainResources: async options => {
      Expect(state).toBe('Shutdown')
      Expect(options.quarantined).toBe(true)
      retained = true
      return { ...lease.owner, id: 'retained-generation' }
    },
    recoverResources: async options => {
      Expect(state).toBe('Shutdown')
      Expect(options.generation).toBe('retained-generation')
      Expect(await options.shutdown(lease.owner)).toBe(true)
      recovered = true
    },
    run: async (_command, spec) => {
      const args = spec?.args ?? []
      commands.push(args.join(' '))
      if (args[1] === 'boot') {
        Expect(retained).toBe(true)
        state = 'Booted'
      }
      if (args[1] === 'shutdown') {
        state = 'Shutdown'
      }
      return {
        command: 'xcrun',
        args: [],
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: args[1] === 'list'
          ? JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.iOS-26': [{ name: 'Tao Agent iPhone 1', udid: 'OWNED', state }],
            },
          })
          : '',
      }
    },
    start: () => ({ waitForClose: () => closed.promise, kill: () => true }) as unknown as CLI.StartedCommand,
  }
  const running = runAgentAppDev(['--ios'], operations, {
    childEnv: {},
    onChild: async () => {},
    onOutput: () => {},
    shouldStop: () => false,
    onDevice: async device => {
      devices.push(device)
    },
  })
  await until(() => devices.some(device => device.state === 'booted') ? true : undefined, {
    description: 'reserved managed simulator boot',
  })
  Expect(recovered).toBe(false)
  closed.resolve({ exitCode: 0, signal: null })
  Expect(await running).toBe(0)
  Expect(recovered).toBe(true)
  Expect(devices.at(-1)?.state).toBe('released')
  Expect(commands.filter(command => command.includes('shutdown'))).toEqual(['simctl shutdown OWNED'])
})

Test('failed managed simulator boot keeps its durable generation quarantined', async () => {
  let released = false
  const devices: AgentAppDevDevice[] = []
  const lease = {
    owner: { id: 'lease', name: 'ios-simulator:OWNED', pid: 1, command: 'test', repositoryRoot: '.', startedAt: '' },
    release: async () => {
      released = true
    },
  }
  const operations: AgentAppDevOperations = {
    acquireResource: async options =>
      options.name === 'tao-agent-simulator-pool' ? { ...lease, release: async () => {} } : lease,
    tryAcquireResource: async () => lease,
    onSignal: () => () => {},
    write: () => {},
    writeError: () => {},
    retainResources: async () => ({ ...lease.owner, id: 'retained-generation' }),
    run: async (_command, spec) => ({
      command: 'xcrun',
      args: [],
      signal: null,
      exitCode: spec?.args?.[1] === 'boot' ? 1 : 0,
      stderr: 'boot refused',
      stdout: JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-26': [{
            name: 'Tao Agent iPhone 1',
            udid: 'OWNED',
            state: 'Shutdown',
          }],
        },
      }),
    }),
    start: () => Errors.throwUnexpected('Expected no child after boot failure.'),
  }
  await Expect(runAgentAppDev(['--ios'], operations, {
    childEnv: {},
    onChild: async () => {},
    onOutput: () => {},
    shouldStop: () => false,
    onDevice: async device => {
      devices.push(device)
    },
  })).rejects.toThrow('Could not boot')
  Expect(released).toBe(false)
  Expect(devices.at(-1)).toEqual({
    platform: 'ios',
    id: 'OWNED',
    owned: true,
    state: 'retained',
    generation: 'retained-generation',
  })
})
