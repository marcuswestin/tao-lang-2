import type { MachineResourceOwner } from '@host-control'
import { CLI, Errors, Platform, ProcessTree, type TrackedProcess } from '@shared'
import { Deferred, Expect, Test, until } from '@shared/test'
import type { AgentAndroidOperations } from '../dev-cli-src/simulators/AgentAndroidEmulator'
import {
  type AgentAppDevDevice,
  type AgentAppDevOperations,
  type ManagedChildCapture,
  runAgentAppDev,
} from '../dev-cli-src/simulators/AgentAppDev'

type Device = { deviceTypeIdentifier: string; name: string; state: string; udid: string }
const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-0'

const privatePrefix = 'Tao Managed 11111111-1111-1111-1111-111111111111_22222222-2222-2222-2222-222222222222_'

function androidFixture(borrowed: boolean, failCleanup = false) {
  const avd = borrowed ? 'Developer_Pixel' : 'Tao_Agent_Pixel_1'
  const serial = 'emulator-5588'
  const root: TrackedProcess = { command: 'emulator', pid: 536_880_001, startedAt: 'captured-emulator-kernel' }
  const owners = new Map<string, MachineResourceOwner>()
  const events: AgentAppDevDevice[] = []
  const commands: string[][] = []
  const signals: string[] = []
  const childClose = Deferred<CLI.CommandCloseResult>()
  const emulatorClose = Deferred<CLI.CommandCloseResult>()
  let running = borrowed
  let dispatched = false
  const lease = (name: string) => {
    const owner = {
      command: 'source lease',
      id: `original:${name}`,
      name,
      pid: 1,
      repositoryRoot: '.',
      startedAt: 'source stamp',
    }
    owners.set(name, owner)
    return {
      owner,
      release: async () => {
        if (owners.get(name)?.id === owner.id) {
          owners.delete(name)
        }
      },
    }
  }
  const result = (command: string, args: readonly string[], stdout = ''): CLI.CommandResult => ({
    command,
    args: [...args],
    stdout,
    stderr: '',
    exitCode: 0,
    signal: null,
  })
  const operations: AgentAppDevOperations & AgentAndroidOperations = {
    // budget-ok: all process observations are injected; the short bound exercises refusal without a host wait.
    shutdownTimeoutMs: 10,
    acquireResource: async options => lease(options.name),
    tryAcquireResource: async options => owners.has(options.name) ? undefined : lease(options.name),
    readResourceOwner: async options => owners.get(options.name),
    withCurrentOwners: async (options, action) => {
      Expect(options.owners.every(owner => owners.get(owner.name)?.id === owner.id)).toBe(true)
      return action()
    },
    retainResources: async options => {
      const id = borrowed
        ? 'borrowed-reservation-generation'
        : options.processes.length === 0
        ? 'launch-intent-generation'
        : 'owned-physical-generation'
      const retained: MachineResourceOwner = {
        ...options.owners[0]!,
        id,
        retention: {
          processes: [...options.processes],
          processGroupPid: options.processGroupPid,
          quarantined: options.quarantined,
          reason: options.reason,
          resourceNames: options.owners.map(owner => owner.name),
        },
      }
      for (const original of options.owners) {
        owners.set(original.name, { ...retained, name: original.name, command: original.command })
      }
      return retained
    },
    recoverResources: async options => {
      const owner = owners.get(options.name)!
      Expect(owner.id).toBe(options.generation)
      Expect(await options.shutdown(owner)).toBe(true)
      for (const name of owner.retention!.resourceNames) {
        owners.delete(name)
      }
    },
    launchReservation: borrowed ? undefined : async () => ({
      consolePort: 5588,
      serialLease: lease('android-emulator:emulator-5588'),
    }),
    processTree: {
      descendants: () => [],
      identities: pids => new Map(running && pids.includes(root.pid) ? [[root.pid, root]] : []),
      isGroupAlive: () => running,
      processGroupOf: pid => pid,
      groupMembers: () => running ? [root] : [],
      signalTracked: (_tracked, signal) => signals.push(signal),
    },
    onSignal: () => () => {},
    write: () => {},
    writeError: () => {},
    run: async (command, spec) => {
      const args = [...spec?.args ?? []]
      commands.push([command, ...args])
      if (command === 'emulator') {
        return result(command, args, `${avd}\n`)
      }
      if (command === 'adb' && args[0] === 'devices') {
        return result(command, args, `List of devices attached\n${running ? `${serial}\tdevice\n` : ''}`)
      }
      if (command === 'adb' && args[2] === 'emu' && args[3] === 'avd') {
        return result(command, args, `${avd}\nOK\n`)
      }
      if (command === 'adb' && args[2] === 'shell') {
        return result(command, args, '1\n')
      }
      if (command === 'lsof') {
        return result(command, args, running ? `p${root.pid}\n` : '')
      }
      if (command === 'adb' && args[2] === 'emu' && args[3] === 'kill') {
        if (!failCleanup) {
          running = false
          emulatorClose.resolve({ exitCode: 0, signal: null })
        }
        return result(command, args)
      }
      return Errors.throwUnexpected(`Unexpected source command ${command} ${args.join(' ')}`)
    },
    start: command => {
      if (command === 'emulator') {
        Expect(borrowed).toBe(false)
        running = true
        return {
          pid: root.pid,
          get exitCode() {
            return running ? null : 0
          },
          signalCode: null,
          waitForClose: () => emulatorClose.promise,
          closeOutput: async () => {},
          dispose: () => {},
          kill: signal => {
            signals.push(String(signal))
            return false
          },
        } as CLI.StartedCommand
      }
      dispatched = true
      return { kill: () => false, waitForClose: () => childClose.promise } as CLI.StartedCommand
    },
  }
  const managed: NonNullable<Parameters<typeof runAgentAppDev>[2]> = {
    childEnv: {},
    shouldStop: () => false,
    onChild: async () => {},
    onOutput: () => {},
    onDevice: async device => {
      events.push(structuredClone(device))
    },
  }
  return {
    operations,
    managed,
    events,
    commands,
    owners,
    signals,
    childClose,
    dispatched: () => dispatched,
    running: () => running,
  }
}

for (const borrowed of [false, true]) {
  Test(
    `managed Android ${
      borrowed ? 'borrower has no' : 'owner registers'
    } refresh authority separately from its reservation`,
    async () => {
      const f = androidFixture(borrowed)
      let refresh: (() => Promise<void>) | undefined
      const snapshots: MachineResourceOwner[][] = []
      const running = runAgentAppDev(
        borrowed ? ['--android', '--emulator', 'emulator-5588'] : ['--android'],
        f.operations,
        {
          ...f.managed,
          onAndroidOwnershipRefresh: async callback => {
            refresh = callback
          },
          onReservation: async reservation => {
            Expect('refreshOwnership' in reservation).toBe(false)
            Expect('release' in reservation).toBe(false)
            snapshots.push([...reservation.resources])
          },
        },
      )
      await until(() => f.dispatched() ? true : undefined)
      Expect(typeof refresh).toBe(borrowed ? 'undefined' : 'function')
      if (refresh !== undefined) {
        const previous = snapshots.length
        await refresh()
        Expect(snapshots.length).toBe(previous + 1)
        Expect(f.events.at(-1)!.state).toBe('booted')
      }
      f.childClose.resolve({ exitCode: 0, signal: null })
      Expect(await running).toBe(0)
    },
  )
}

for (const scenario of ['owned', 'borrowed', 'failed cleanup'] as const) {
  Test(`managed Android ${scenario} preserves exact device release metadata without successor adoption`, async () => {
    const borrowed = scenario === 'borrowed'
    const f = androidFixture(borrowed, scenario === 'failed cleanup')
    const holder = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)!
    const running = runAgentAppDev(
      borrowed ? ['--android', '--emulator', 'emulator-5588'] : ['--android'],
      f.operations,
      f.managed,
    )
    await until(() => f.dispatched() ? true : undefined)
    const selected = f.events.find(device => device.state === 'booted')!
    Expect(selected).toBeDefined()
    Expect(selected.generation).toBe(borrowed ? 'borrowed-reservation-generation' : 'owned-physical-generation')
    Expect(selected.holder).toEqual(holder)
    Expect(selected.consolePort).toBe(borrowed ? undefined : 5588)
    Expect(selected.resources!.map(owner => owner.name)).toEqual([
      `android-avd:${borrowed ? 'Developer_Pixel' : 'Tao_Agent_Pixel_1'}`,
      'android-emulator:emulator-5588',
    ])
    f.childClose.resolve({ exitCode: 0, signal: null })
    if (scenario === 'failed cleanup') {
      await Expect(running).rejects.toThrow('cleanup remains unproved')
      Expect(f.events.some(device => device.state === 'released')).toBe(false)
      Expect(f.owners.size).toBe(2)
      Expect(f.running()).toBe(true)
    } else {
      Expect(await running).toBe(0)
      Expect(f.events.filter(device => device.state === 'released')).toEqual([{ ...selected, state: 'released' }])
      Expect(f.events.at(-1)).toEqual({ ...selected, state: 'released' })
      Expect(f.owners.size).toBe(0)
      Expect(f.running()).toBe(borrowed)
      if (borrowed) {
        Expect(f.signals).toEqual([])
        Expect(f.commands.some(args => args[0] === 'adb' && args[4] === 'kill')).toBe(false)
      }
    }
  })
}

for (
  const publication of ['accepted', 'rejected', 'diagnostic rejected', 'asynchronous diagnostic rejected'] as const
) {
  Test(
    `managed iOS boot failure preserves reserved metadata and primary failure when publication is ${publication}`,
    async () => {
      const f = fixture()
      const devices: AgentAppDevDevice[] = []
      const output: string[] = []
      const holder = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)!
      let retained: MachineResourceOwner | undefined
      f.operations.retainResources = async options => {
        retained = { ...options.owners[0]!, id: 'ios-reserved-generation' }
        return retained
      }
      const run = f.operations.run
      f.operations.run = async (command, spec) =>
        spec?.args?.[1] === 'boot'
          ? { command, args: [...spec.args], exitCode: 1, signal: null, stderr: 'Source boot denied', stdout: '' }
          : await run(command, spec)
      await Expect(runAgentAppDev(['--ios'], f.operations, {
        childEnv: {},
        shouldStop: () => false,
        onChild: async () => Errors.throwUnexpected('Failed boot must never dispatch a child.'),
        onOutput: (_stream, chunk) => {
          const text = chunk.toString('utf8')
          output.push(text)
          if (
            publication === 'diagnostic rejected' && text.startsWith('Additional iOS retained publication failure:')
          ) {
            Errors.throwHostEnvironment('Source secondary diagnostic rejected')
          }
          if (
            publication === 'asynchronous diagnostic rejected'
            && text.startsWith('Additional iOS retained publication failure:')
          ) {
            return Promise.reject(
              new Errors.HostEnvironmentError('Source secondary diagnostic asynchronously rejected'),
            )
          }
          return undefined
        },
        onDevice: async device => {
          devices.push(structuredClone(device))
          if (device.state === 'retained' && publication !== 'accepted') {
            Errors.throwHostEnvironment('Source retained callback rejected')
          }
        },
      })).rejects.toThrow('Could not boot Tao Agent iPhone 1: Source boot denied')
      Expect(devices.map(device => device.state)).toEqual(['reserved', 'retained'])
      Expect(devices[1]).toEqual({
        platform: 'ios',
        id: 'AGENT-1',
        owned: true,
        state: 'retained',
        generation: 'ios-reserved-generation',
        resources: [retained!],
        holder,
      })
      Expect(devices[0]!.resources).toEqual([retained!])
      Expect(devices[0]!.holder).toEqual(holder)
      Expect(f.children).toEqual([])
      Expect(f.held.has('ios-simulator:AGENT-1')).toBe(true)
      Expect(f.commands.some(command => command.startsWith('simctl shutdown'))).toBe(false)
      if (publication !== 'accepted') {
        Expect(output.some(line => line.includes('Source retained callback rejected'))).toBe(true)
      }
    },
  )
}

for (
  const scenario of [
    'owned release',
    'borrowed release',
    'shutdown failure',
    'retained callback failure',
    'shutdown output failure',
    'shutdown inspection output failure',
    'shutdown asynchronous output failure',
    'retained asynchronous diagnostic failure',
  ] as const
) {
  Test(`managed iOS ${scenario} preserves the selected ownership history at terminal publication`, async () => {
    const f = fixture()
    const devices: AgentAppDevDevice[] = []
    const output: string[] = []
    const borrowed = scenario === 'borrowed release'
    const failed = scenario !== 'owned release' && scenario !== 'borrowed release'
    const id = borrowed ? 'DEVELOPER' : 'AGENT-1'
    const holder = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)!
    let reserved: MachineResourceOwner | undefined
    const recovered: string[] = []
    f.operations.retainResources = async options => {
      Expect(reserved).toBeUndefined()
      reserved = { ...options.owners[0]!, id: 'selected-ios-generation' }
      return reserved
    }
    f.operations.recoverResources = async options => {
      Expect(options.generation).toBe('selected-ios-generation')
      Expect(options.name).toBe(`ios-simulator:${id}`)
      Expect(await options.shutdown(reserved!)).toBe(true)
      recovered.push(options.generation)
      f.held.delete(options.name)
    }
    const run = f.operations.run
    f.operations.run = async (command, spec) => {
      if (failed && spec?.args?.[1] === 'shutdown') {
        if (scenario === 'shutdown inspection output failure') {
          Errors.throwHostEnvironment('Source shutdown denied during inspection')
        }
        return {
          command,
          args: [...spec.args],
          exitCode: 1,
          signal: null,
          stderr: 'Source shutdown denied',
          stdout: '',
        }
      }
      return await run(command, spec)
    }
    const running = runAgentAppDev(borrowed ? ['--ios', '--simulator', id] : ['--ios'], f.operations, {
      childEnv: {},
      shouldStop: () => false,
      onChild: async () => {},
      onOutput: (_stream, chunk) => {
        const text = chunk.toString('utf8')
        output.push(text)
        if (text.includes('Source shutdown')) {
          if (scenario === 'shutdown asynchronous output failure') {
            return Promise.reject(new Errors.HostEnvironmentError('Source shutdown output rejected'))
          }
          if (scenario === 'shutdown output failure' || scenario === 'shutdown inspection output failure') {
            Errors.throwHostEnvironment('Source shutdown output rejected')
          }
        }
        if (
          scenario === 'retained asynchronous diagnostic failure'
          && text.startsWith('Additional iOS retained publication failure:')
        ) {
          return Promise.reject(
            new Errors.HostEnvironmentError('Source late secondary diagnostic asynchronously rejected'),
          )
        }
        return undefined
      },
      onDevice: async device => {
        devices.push(structuredClone(device))
        if (
          device.state === 'retained'
          && (scenario === 'retained callback failure' || scenario === 'retained asynchronous diagnostic failure')
        ) {
          Errors.throwHostEnvironment('Source late retained callback rejected')
        }
      },
    })
    await waitForChildren(f, 1)
    Expect(devices.map(device => device.state)).toEqual(['reserved', 'booted'])
    Expect(devices[1]!.holder).toEqual(holder)
    Expect(devices[1]!.generation).toBe('selected-ios-generation')
    Expect(devices[1]!.owned).toBe(!borrowed)
    f.children[0]!.close(0)
    if (failed) {
      await Expect(running).rejects.toThrow(
        `Owned simulator ${id} remains quarantined because shutdown was not proved.`,
      )
      Expect(devices.at(-1)).toEqual({
        platform: 'ios',
        id,
        owned: true,
        state: 'retained',
        generation: 'selected-ios-generation',
        resources: [reserved!],
        holder,
      })
      Expect(devices.some(device => device.state === 'released')).toBe(false)
      Expect(f.held.has(`ios-simulator:${id}`)).toBe(true)
      Expect(recovered).toEqual([])
      Expect(f.devices.find(device => device.udid === id)?.state).toBe('Booted')
      Expect(output.some(line => line.includes('Source shutdown denied'))).toBe(true)
      if (scenario === 'retained callback failure' || scenario === 'retained asynchronous diagnostic failure') {
        Expect(output.some(line => line.includes('Source late retained callback rejected'))).toBe(true)
      }
      if (scenario.includes('output failure')) {
        Expect(output.filter(line => line.includes('Source shutdown'))).toHaveLength(1)
      }
    } else {
      Expect(await running).toBe(0)
      Expect(devices.at(-1)).toEqual({
        platform: 'ios',
        id,
        owned: !borrowed,
        state: 'released',
        generation: 'selected-ios-generation',
        resources: [reserved!],
        holder,
      })
      Expect(recovered).toEqual(['selected-ios-generation'])
      Expect(f.held.has(`ios-simulator:${id}`)).toBe(false)
      Expect(f.devices.find(device => device.udid === id)?.state).toBe(borrowed ? 'Booted' : 'Shutdown')
      if (borrowed) {
        Expect(f.commands.some(command => /simctl (create|boot|shutdown)/u.test(command))).toBe(false)
      }
    }
    Expect(f.devices.find(device => device.udid === 'DEVELOPER')?.state).toBe('Booted')
  })
}

function privateSelection(f: ReturnType<typeof fixture>) {
  const events: string[] = []
  f.operations.privateIos = {
    namePrefix: privatePrefix,
    beforeCreate: async () => {
      events.push('intent')
    },
    afterCreate: async device => {
      events.push(`minted:${device.id}`)
    },
  }
  f.operations.prepareOwnedIosRuntime = async ({ device }) => {
    Expect(device.owned).toBe(true)
    Expect(device.state).toBe('booted')
    Expect(f.devices.find(candidate => candidate.udid === device.id)?.state).toBe('Booted')
    Expect(f.held.has(`ios-simulator:${device.id}`)).toBe(true)
    Expect(f.children.some(child => child.env['TAO_AGENT_SIMULATOR_UDID'] === device.id)).toBe(false)
    events.push(`prepared:${device.id}`)
  }
  return events
}

Test('private iOS preparation publishes its supervisor and worker through the managed child callback', async () => {
  const f = fixture()
  privateSelection(f)
  let reserved: MachineResourceOwner | undefined
  f.operations.retainResources = async options => {
    reserved = {
      ...options.owners[0]!,
      id: 'source-private-ios-generation',
      retention: {
        processes: [...options.processes],
        processGroupPid: options.processGroupPid,
        resourceNames: options.owners.map(owner => owner.name),
        quarantined: options.quarantined,
        reason: options.reason,
      },
    }
    return reserved
  }
  f.operations.readResourceOwner = async () => reserved
  f.operations.recoverResources = async options => {
    Expect(await options.shutdown(reserved!)).toBe(true)
    f.held.delete(options.name)
  }
  const root = { pid: 536_881_001, command: 'supervisor', startedAt: 'supervisor-kernel' }
  const worker = { pid: 536_881_002, command: 'worker', startedAt: 'worker-kernel' }
  const capture: ManagedChildCapture = { version: 1, root, members: [root, worker] }
  const child = { pid: root.pid } as CLI.StartedCommand
  const published: unknown[] = []
  const managed: NonNullable<Parameters<typeof runAgentAppDev>[2]> = {
    childEnv: {},
    shouldStop: () => false,
    onOutput: () => {},
    onChild: async (process, snapshot) => {
      published.push([process, snapshot])
    },
  }
  f.operations.prepareOwnedIosRuntime = async input => {
    Expect(input.onChild).toBe(managed.onChild)
    await input.onChild!(child, capture)
  }
  const running = runAgentAppDev(['--ios'], f.operations, managed)
  await waitForChildren(f, 1)
  Expect(published[0]).toEqual([child, capture])
  f.children[0]!.close(0)
  Expect(await running).toBe(0)
  Expect([...f.held]).toEqual([])
})

Test(
  'private iOS provisioning skips ordinary and foreign shutdown devices and runs before child dispatch',
  async () => {
    const f = fixture([{
      deviceTypeIdentifier: 'iPhone-type',
      name: 'Developer iPhone',
      state: 'Shutdown',
      udid: 'FOREIGN',
    }, { deviceTypeIdentifier: 'iPhone-type', name: 'Tao Agent iPhone 1', state: 'Shutdown', udid: 'ORDINARY' }])
    const events = privateSelection(f)
    const running = runAgentAppDev(['--ios'], f.operations)
    await waitForChildren(f, 1)
    Expect(events).toEqual(['intent', 'minted:AGENT-2', 'prepared:AGENT-2'])
    Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AGENT-2')
    Expect(f.commands.some(command => command === 'simctl boot FOREIGN' || command === 'simctl boot ORDINARY')).toBe(
      false,
    )
    f.children[0]!.close(0)
    Expect(await running).toBe(0)
    Expect(
      f.devices.filter(device => ['FOREIGN', 'ORDINARY'].includes(device.udid)).every(device =>
        device.state === 'Shutdown'
      ),
    ).toBe(true)
    Expect([...f.held]).toEqual([])
  },
)

Test('explicit borrowed iOS selection never invokes private creation or SDK preparation', async () => {
  const f = fixture()
  const events = privateSelection(f)
  const running = runAgentAppDev(['--ios', '--simulator', 'DEVELOPER'], f.operations)
  await waitForChildren(f, 1)
  f.children[0]!.close(0)
  Expect(await running).toBe(0)
  Expect(events).toEqual([])
  Expect(f.commands.some(command => /simctl (create|shutdown)/u.test(command))).toBe(false)
})

Test('private runtime failure after selection shuts down its minted target and never dispatches Tao', async () => {
  const f = fixture()
  privateSelection(f)
  f.operations.prepareOwnedIosRuntime = async () => Errors.throwHostEnvironment('Source SDK preparation failed')
  await Expect(runAgentAppDev(['--ios'], f.operations)).rejects.toThrow('Source SDK preparation failed')
  Expect(f.children).toEqual([])
  Expect(f.commands).toContain('simctl shutdown AGENT-1')
  Expect([...f.held]).toEqual([])
})

Test('unknown private SDK child retains the selected fence and never shuts down or dispatches', async () => {
  const f = fixture()
  privateSelection(f)
  f.operations.prepareOwnedIosRuntime = async () =>
    Errors.throwHostEnvironment('Source child closure unknown', { details: { retainsTargetLease: true } })
  await Expect(runAgentAppDev(['--ios'], f.operations)).rejects.toThrow('Source child closure unknown')
  Expect(f.children).toEqual([])
  Expect(f.commands.some(command => command.startsWith('simctl shutdown'))).toBe(false)
  Expect([...f.held]).toEqual(['ios-simulator:AGENT-1'])
})

for (const publication of ['accepted', 'rejected'] as const) {
  Test(`private SDK original ownership refusal survives finally with retained publication ${publication}`, async () => {
    const f = fixture()
    privateSelection(f)
    f.operations.retainResources = async options => ({ ...options.owners[0]!, id: 'original-sdk-target-generation' })
    const cause = new Errors.HostEnvironmentError('Original downloader output stream closure failed.')
    const refusal = new Errors.HostEnvironmentError('Original downloader custody refused.', {
      cause,
      details: { retainsTargetLease: true, originalKernel: 'captured downloader kernel' },
    })
    f.operations.prepareOwnedIosRuntime = async () => {
      throw refusal
    }
    const events: AgentAppDevDevice[] = []
    const diagnostics: string[] = []
    const result = await runAgentAppDev(['--ios'], f.operations, {
      childEnv: {},
      shouldStop: () => false,
      onChild: async () => Errors.throwUnexpected('Refused preparation must never dispatch a child.'),
      onOutput: (_stream, chunk) => diagnostics.push(chunk.toString('utf8')),
      onDevice: async device => {
        events.push(device)
        if (device.state === 'retained' && publication === 'rejected') {
          Errors.throwHostEnvironment('Secondary retained device publication failed.')
        }
      },
    }).catch(error => error)
    Expect(result).toBe(refusal)
    Expect(result.cause).toBe(cause)
    Expect(result.details?.['retainsTargetLease']).toBe(true)
    Expect(result.details?.['originalKernel']).toBe('captured downloader kernel')
    Expect(events.at(-1)?.state).toBe('retained')
    Expect(events.some(device => device.state === 'released')).toBe(false)
    Expect(f.children).toEqual([])
    Expect(f.commands.some(command => command.startsWith('simctl shutdown'))).toBe(false)
    Expect([...f.held]).toEqual(['ios-simulator:AGENT-1'])
    Expect(diagnostics.some(message => message.includes('Secondary retained device publication failed'))).toBe(
      publication === 'rejected',
    )
  })
}

Test('private iOS mint publication failure refuses name-only adoption and never boots the target', async () => {
  const f = fixture()
  privateSelection(f)
  f.operations.privateIos!.afterCreate = async () => Errors.throwHostEnvironment('Source UDID publication failed')
  await Expect(runAgentAppDev(['--ios'], f.operations)).rejects.toThrow('Source UDID publication failed')
  Expect(f.children).toEqual([])
  Expect(f.commands.some(command => command.startsWith('simctl boot'))).toBe(false)
  Expect([...f.held]).toEqual([])
})

Test(
  'parallel private iOS loops mint distinct targets while foreign shutdown inventory remains unchanged',
  async () => {
    const f = fixture([{
      deviceTypeIdentifier: 'iPhone-type',
      name: 'Developer iPhone',
      state: 'Shutdown',
      udid: 'FOREIGN',
    }])
    privateSelection(f)
    const first = runAgentAppDev(['--ios'], {
      ...f.operations,
      privateIos: { ...f.operations.privateIos!, namePrefix: privatePrefix },
    })
    await waitForChildren(f, 1)
    const second = runAgentAppDev(['--ios'], {
      ...f.operations,
      privateIos: { ...f.operations.privateIos!, namePrefix: privatePrefix.replace('22222222', '33333333') },
    })
    await waitForChildren(f, 2)
    Expect(f.children.map(child => child.env['TAO_AGENT_SIMULATOR_UDID'])).toEqual(['AGENT-1', 'AGENT-2'])
    f.children.forEach(child => child.close(0))
    Expect(await first).toBe(0)
    Expect(await second).toBe(0)
    Expect(f.devices.find(device => device.udid === 'FOREIGN')?.state).toBe('Shutdown')
    Expect(f.commands.some(command => command === 'simctl boot FOREIGN' || command === 'simctl shutdown FOREIGN')).toBe(
      false,
    )
  },
)

function fixture(initial: Device[] = [{
  deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
  name: 'Developer iPhone',
  state: 'Booted',
  udid: 'DEVELOPER',
}]) {
  const devices = [...initial]
  const held = new Set<string>()
  const commands: string[] = []
  const children: Array<{ close: (code: number) => void; env: Record<string, string> }> = []
  const result = (stdout = ''): CLI.CommandResult => ({
    args: [],
    command: 'xcrun',
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
  const operations: AgentAppDevOperations = {
    acquireResource: async options => lease(options.name),
    tryAcquireResource: async options => held.has(options.name) ? undefined : lease(options.name),
    onSignal: () => () => {},
    run: async (_command, spec) => {
      const args = spec?.args ?? []
      commands.push(args.join(' '))
      if (args[1] === 'list') {
        return result(JSON.stringify({ devices: { [runtime]: devices } }))
      }
      if (args[1] === 'create') {
        const udid = `AGENT-${devices.length}`
        devices.push({ deviceTypeIdentifier: args[3]!, name: args[2]!, state: 'Shutdown', udid })
        return result(`${udid}\n`)
      }
      if (args[1] === 'boot' || args[1] === 'shutdown') {
        devices.find(device => device.udid === args[2])!.state = args[1] === 'boot' ? 'Booted' : 'Shutdown'
      }
      return result()
    },
    start: (_command, spec) => {
      let close!: (code: number) => void
      const finished = new Promise<{ exitCode: number; signal: null }>(resolve => {
        close = code => resolve({ exitCode: code, signal: null })
      })
      children.push({ close, env: spec?.env as Record<string, string> })
      return { kill: () => {}, waitForClose: () => finished } as unknown as CLI.StartedCommand
    },
    write: () => {},
    writeError: () => {},
  }
  return { children, commands, devices, held, operations }
}

async function waitForChildren(f: ReturnType<typeof fixture>, count: number): Promise<void> {
  for (let attempt = 0; attempt < 30 && f.children.length < count; attempt++) {
    await Promise.resolve()
  }
  Expect(f.children.length).toBe(count)
}

Test('parallel agent dev loops reserve separate managed simulators and reuse them after shutdown', async () => {
  const f = fixture()
  const first = runAgentAppDev(['Apps/HNReader', '--ios'], f.operations)
  await waitForChildren(f, 1)
  const second = runAgentAppDev(['Apps/HNReader', '--ios'], f.operations)
  await waitForChildren(f, 2)
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AGENT-1')
  Expect(f.children[1]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AGENT-2')
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_QUIET']).toBe('1')
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_VISIBLE']).toBe('0')
  Expect(f.devices.find(device => device.udid === 'DEVELOPER')?.state).toBe('Booted')
  f.children[0]!.close(0)
  f.children[1]!.close(0)
  Expect(await first).toBe(0)
  Expect(await second).toBe(0)
  Expect(f.commands.filter(command => command.startsWith('simctl shutdown '))).toEqual([
    'simctl shutdown AGENT-1',
    'simctl shutdown AGENT-2',
  ])
  const third = runAgentAppDev(['--ios'], f.operations)
  await waitForChildren(f, 3)
  Expect(f.children[2]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AGENT-1')
  f.children[2]!.close(0)
  Expect(await third).toBe(0)
  Expect(f.commands.filter(command => command.startsWith('simctl create ')).length).toBe(2)
  Expect([...f.held]).toEqual([])
})

Test('an explicitly selected developer simulator is reserved but never shut down by agent app-dev', async () => {
  const f = fixture()
  const running = runAgentAppDev(['--ios', '--simulator', 'DEVELOPER', '--show-simulator'], f.operations)
  await waitForChildren(f, 1)
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('DEVELOPER')
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_VISIBLE']).toBe('1')
  f.children[0]!.close(0)
  Expect(await running).toBe(0)
  Expect(f.commands.some(command => command.startsWith('simctl shutdown'))).toBe(false)
  Expect(f.commands.some(command => command.startsWith('simctl create'))).toBe(false)
})

Test('a free shut-down iPhone is borrowed before creating another device and restored on exit', async () => {
  const f = fixture([
    { deviceTypeIdentifier: 'iPhone-17', name: 'Developer iPhone', state: 'Booted', udid: 'DEVELOPER' },
    { deviceTypeIdentifier: 'iPhone-17', name: 'iPhone 17 Pro', state: 'Shutdown', udid: 'AVAILABLE' },
  ])
  const running = runAgentAppDev(['--ios'], f.operations)
  await waitForChildren(f, 1)
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('AVAILABLE')
  f.children[0]!.close(0)
  Expect(await running).toBe(0)
  Expect(f.commands.some(command => command.startsWith('simctl create'))).toBe(false)
  Expect(f.commands.includes('simctl shutdown AVAILABLE')).toBe(true)
  Expect(f.devices.find(device => device.udid === 'DEVELOPER')?.state).toBe('Booted')
})

Test('an agent dev loop without --ios does not reserve or inherit a simulator target', async () => {
  const f = fixture()
  const running = runAgentAppDev(['Apps/HNReader'], f.operations)
  await waitForChildren(f, 1)
  Expect(f.children[0]!.env['TAO_AGENT_SIMULATOR_UDID']).toBe('')
  Expect(f.children[0]!.env['TAO_AGENT_ANDROID_SERIAL']).toBe('')
  Expect(f.children[0]!.env['TAO_AGENT_BROWSER_QUIET']).toBe('1')
  Expect(f.commands).toEqual([])
  f.children[0]!.close(0)
  Expect(await running).toBe(0)
})

Test(
  'app-dev passes its internal private Android pool and prelaunch reservation through before starting a child',
  async () => {
    const f = fixture()
    f.operations.avdPrefix = 'Tao_Acceptance_Unit_'
    let selected: string | undefined
    f.operations.launchReservation = async avdName => {
      selected = avdName
      Errors.throwHostEnvironment('Fixture reservation rejected before spawn')
    }
    const run = f.operations.run
    f.operations.run = async (command, spec) => {
      if (command === 'adb' && spec?.args?.[0] === 'devices') {
        return { ...await run(command, spec), stdout: 'List of devices attached\n' }
      }
      return await run(command, spec)
    }
    await Expect(runAgentAppDev(['--android'], f.operations)).rejects.toThrow(
      'Fixture reservation rejected before spawn',
    )
    Expect(selected).toBe('Tao_Acceptance_Unit_1')
    Expect(f.children).toEqual([])
    Expect([...f.held]).toEqual([])
  },
)

Test('agent web dev selects owned Chrome and only requests a window explicitly', async () => {
  const f = fixture()
  const hidden = runAgentAppDev(['--web'], f.operations)
  await waitForChildren(f, 1)
  Expect(f.children[0]!.env['TAO_AGENT_BROWSER_QUIET']).toBe('1')
  Expect(f.children[0]!.env['TAO_AGENT_BROWSER_VISIBLE']).toBe('0')
  f.children[0]!.close(0)
  Expect(await hidden).toBe(0)
  const visible = runAgentAppDev(['--web', '--show-browser'], f.operations)
  await waitForChildren(f, 2)
  Expect(f.children[1]!.env['TAO_AGENT_BROWSER_VISIBLE']).toBe('1')
  f.children[1]!.close(0)
  Expect(await visible).toBe(0)
})
