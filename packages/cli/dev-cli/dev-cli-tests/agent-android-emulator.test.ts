import type { MachineResourceOwner } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, type TrackedProcess } from '@shared'
import { Deferred, Expect, Test, until } from '@shared/test'
import { type AgentAndroidOperations, reserveAndroidEmulator } from '../dev-cli-src/simulators/AgentAndroidEmulator'
import type { AgentAppDevDevice } from '../dev-cli-src/simulators/AgentAppDev'

function fixture() {
  const avds = ['Developer_Pixel']
  const running = new Map([['emulator-5554', 'Developer_Pixel']])
  const held = new Set<string>()
  const starts: string[][] = []
  const stopped: string[] = []
  const signals: string[] = []
  const errors: string[] = []
  const retained: Parameters<NonNullable<AgentAndroidOperations['retainResources']>>[0][] = []
  const ownership: typeof retained = []
  const disposed: string[] = []
  const durable = new Map<string, MachineResourceOwner>()
  const identities = new Map<number, TrackedProcess>()
  const groups = new Set<number>()
  const children = new Map<number, TrackedProcess[]>()
  const processes = new Map<string, {
    exitCode: number | null
    signalCode: 'SIGTERM' | null
    pid: number
    close: ReturnType<typeof Deferred<CLI.CommandCloseResult>>
  }>()
  let nextPort = 5556
  let agentBooted = true
  let graceful = true
  let terminate = true
  let force = true
  let unknownTree = false
  let startupFailure = false
  let holdClose = false
  let generation = 0
  const generations = new Map<string, string>()
  const finish = (serial: string) => {
    const state = processes.get(serial)!
    running.delete(serial)
    identities.delete(state.pid)
    if (!(children.get(state.pid) ?? []).some(child => identities.has(child.pid))) {
      groups.delete(state.pid)
    }
    state.signalCode = 'SIGTERM'
    if (!holdClose) {
      state.close.resolve({ exitCode: null, signal: 'SIGTERM' })
    }
  }
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
    const id = `${name}-${++generation}`
    generations.set(name, id)
    const owner = { command: 'test', id, name, pid: 1, repositoryRoot: '.', startedAt: new Date().toISOString() }
    durable.set(name, owner)
    return {
      owner,
      release: async () => {
        if (generations.get(name) === id) {
          held.delete(name)
        }
      },
    }
  }
  const operations: AgentAndroidOperations = {
    // budget-ok: fake process transitions are immediate; these bounds exercise escalation rather than host timing.
    shutdownTimeoutMs: 10,
    bootTimeoutMs: 30_000,
    bootIntervalMs: 1,
    processIsAlive: pid => identities.has(pid),
    processTree: {
      descendants: pid => {
        if (unknownTree) {
          Errors.throwHostEnvironment('Unknown descendants')
        }
        return (children.get(pid) ?? []).filter(child => identities.get(child.pid)?.startedAt === child.startedAt)
      },
      identities: pids =>
        new Map(pids.flatMap(pid => identities.has(pid) ? [[pid, identities.get(pid)!] as const] : [])),
      isGroupAlive: pid => groups.has(pid),
      processGroupOf: pid => [...children].find(([, values]) => values.some(child => child.pid === pid))?.[0] ?? pid,
      groupMembers: pid =>
        [identities.get(pid), ...(children.get(pid) ?? []).filter(child => identities.has(child.pid))]
          .filter((process): process is TrackedProcess => process !== undefined),
      signalTracked: (tracked, signal) => {
        signals.push(signal)
        for (const expected of tracked) {
          if (
            identities.get(expected.pid)?.startedAt === expected.startedAt
            && (signal === 'SIGTERM' ? terminate : force)
          ) {
            const serial = [...processes].find(([, state]) => state.pid === expected.pid)?.[0]
            if (serial !== undefined) {
              finish(serial)
            }
          }
        }
      },
    },
    readResourceOwner: async options => durable.get(options.name),
    withCurrentOwners: async (options, action) => {
      for (const expected of options.owners) {
        const current = durable.get(expected.name)
        if (
          current?.id !== expected.id || current.pid !== expected.pid
          || current.processStartedAt !== expected.processStartedAt
          || current.repositoryRoot !== expected.repositoryRoot
        ) {
          Errors.throwHostEnvironment(`Android launch resource '${expected.name}' changed ownership before spawn.`)
        }
      }
      return action()
    },
    retainResources: async options => {
      ;(options.reason.includes('shutdown') ? retained : ownership).push(options)
      const id = `retained-generation-${++generation}`
      const owner = {
        ...options.owners[0]!,
        id,
        pid: options.processes[0]?.pid ?? options.owners[0]!.pid,
        processStartedAt: options.processes[0]?.startedAt,
        retention: {
          processes: [...options.processes],
          processGroupPid: options.processGroupPid,
          quarantined: options.quarantined,
          reason: options.reason,
          resourceNames: options.owners.map(owner => owner.name),
        },
      }
      for (const owner of options.owners) {
        generations.set(owner.name, id)
      }
      for (const original of options.owners) {
        durable.set(original.name, { ...owner, name: original.name, command: original.command })
      }
      return owner
    },
    recoverResources: async options => {
      const owner = durable.get(options.name)!
      Expect(owner.id).toBe(options.generation)
      Expect(await options.shutdown(owner)).toBe(true)
      for (const name of owner.retention!.resourceNames) {
        held.delete(name)
        durable.delete(name)
      }
    },
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
        if (graceful) {
          finish(args[1]!)
        }
        return result()
      }
      if (command === 'lsof') {
        const serial = `emulator-${args.find(arg => arg.startsWith('-iTCP:'))?.slice(6)}`
        const pid = processes.get(serial)?.pid
        return result(pid === undefined ? '' : `p${pid}\n`)
      }
      Errors.throwUnexpected(`Unexpected fake command ${command} ${args.join(' ')}`)
    },
    start: (command, spec) => {
      if (command !== 'emulator') {
        Errors.throwUnexpected(`Unexpected fake start ${command}`)
      }
      const args = [...(spec?.args ?? [])]
      starts.push(args)
      const serial = `emulator-${args.includes('-port') ? args[args.indexOf('-port') + 1] : nextPort}`
      nextPort += 2
      running.set(serial, args[args.indexOf('-avd') + 1]!)
      const pid = 2 ** 29 + nextPort
      const state = {
        exitCode: null as number | null,
        signalCode: null as 'SIGTERM' | null,
        pid,
        close: Deferred<CLI.CommandCloseResult>(),
      }
      identities.set(pid, { command: 'emulator', pid, startedAt: `start-${pid}` })
      groups.add(pid)
      processes.set(serial, state)
      if (startupFailure) {
        state.exitCode = 1
      }
      return {
        dispose: () => {
          disposed.push(serial)
        },
        closeOutput: async () => {},
        error: undefined,
        pid,
        waitForClose: () => state.close.promise,
        get exitCode() {
          return state.exitCode
        },
        get signalCode() {
          return state.signalCode
        },
        kill: (signal: Parameters<CLI.StartedCommand['kill']>[0]) => {
          if (signal === 'SIGTERM' ? terminate : force) {
            finish(serial)
          }
          return true
        },
      } as unknown as CLI.StartedCommand
    },
    write: () => {},
    writeError: message => errors.push(message),
  }
  return {
    avds,
    held,
    operations,
    processes,
    errors,
    signals,
    retained,
    ownership,
    durable,
    disposed,
    exitAndReuseSerial: (serial: string, avdName: string) => {
      finish(serial)
      running.set(serial, avdName)
    },
    identities,
    addSurvivingChild: (serial: string) => {
      const parent = processes.get(serial)!
      const child = { command: 'qemu', pid: parent.pid + 100_000, startedAt: 'actual-qemu-start' }
      identities.set(child.pid, child)
      children.set(parent.pid, [child])
      return child
    },
    setShutdown: (options: { graceful?: boolean; terminate?: boolean; force?: boolean; holdClose?: boolean }) => {
      graceful = options.graceful ?? graceful
      terminate = options.terminate ?? terminate
      force = options.force ?? force
      holdClose = options.holdClose ?? holdClose
    },
    failStartup: () => {
      startupFailure = true
    },
    unknownTree: () => {
      unknownTree = true
    },
    running,
    setAgentBooted: (booted: boolean) => {
      agentBooted = booted
    },
    starts,
    stopped,
  }
}

Test(
  'owned Android refresh publishes late ancestry and replaces the booted generation before acknowledgement',
  async () => {
    const f = fixture()
    const devices: AgentAppDevDevice[] = []
    const reservation = await reserveAndroidEmulator(f.operations, undefined, false, async device => {
      devices.push(structuredClone(device))
    })
    const previous = devices.at(-1)!
    const child = f.addSurvivingChild(reservation.serial)
    try {
      await reservation.refreshOwnership!()
      const current = devices.at(-1)!
      Expect(current.state).toBe('booted')
      Expect(current.generation).not.toBe(previous.generation)
      Expect(current.resources!.map(owner => owner.id)).toEqual([current.generation, current.generation])
      Expect(current.resources![0]!.retention!.processes.some(process => process.pid === child.pid)).toBe(true)
      Expect(reservation.resources().map(owner => owner.id)).toEqual([current.generation, current.generation])
    } finally {
      f.identities.delete(child.pid)
      await reservation.release()
    }
  },
)

for (const fault of ['physical publication', 'receipt publication', 'lost anchor'] as const) {
  Test(`owned Android refresh refuses ${fault} and preserves physical fences`, async () => {
    const f = fixture()
    let failReceipt = false
    const devices: AgentAppDevDevice[] = []
    const reservation = await reserveAndroidEmulator(f.operations, undefined, false, async device => {
      devices.push(structuredClone(device))
      if (failReceipt && device.state === 'booted') {
        Errors.throwHostEnvironment('Receipt publication denied')
      }
    })
    const previous = devices.at(-1)!.generation
    const retained = f.operations.retainResources!
    if (fault === 'physical publication') {
      let first = true
      f.operations.retainResources = options => {
        if (first) {
          first = false
          Errors.throwHostEnvironment('Physical publication denied')
        }
        return retained(options)
      }
    }
    if (fault === 'receipt publication') {
      failReceipt = true
    }
    if (fault === 'lost anchor') {
      f.identities.delete(f.processes.get(reservation.serial)!.pid)
    }
    await Expect(reservation.refreshOwnership!()).rejects.toMatchObject({ details: { retainsTargetLease: true } })
    if (fault === 'receipt publication') {
      Expect(devices.at(-1)!.state).toBe('retained')
      Expect(devices.at(-1)!.generation).not.toBe(previous)
      Expect(reservation.resources()[0]!.id).toBe(devices.at(-1)!.generation)
    }
    await Expect(reservation.release()).rejects.toThrow('fences are retained')
    Expect(f.signals).toEqual([])
    Expect(f.held.has('android-avd:Tao_Agent_Pixel_1')).toBe(true)
    Expect(f.durable.get('android-avd:Tao_Agent_Pixel_1')!.retention!.quarantined).toBe(true)
  })
}

Test(
  'owned Android cancellation after physical commit publishes its generation before refusing acknowledgement',
  async () => {
    const f = fixture()
    const committed = Deferred<void>()
    const releasePublication = Deferred<void>()
    let refreshing = false
    let stopped = false
    const devices: AgentAppDevDevice[] = []
    const reservation = await reserveAndroidEmulator(f.operations, undefined, false, async device => {
      devices.push(structuredClone(device))
      if (refreshing && device.state === 'booted') {
        committed.resolve()
        await releasePublication.promise
      }
    }, () => stopped)
    const previous = devices.at(-1)!.generation
    refreshing = true
    const result = reservation.refreshOwnership!().catch(error => error)
    await committed.promise
    stopped = true
    releasePublication.resolve()
    const error = await result
    Expect(error.details.retainsTargetLease).toBe(true)
    Expect(devices.at(-1)!.state).toBe('retained')
    Expect(devices.at(-1)!.generation).not.toBe(previous)
    Expect(reservation.resources()[0]!.id).toBe(devices.at(-1)!.generation)
    await reservation.release().catch(() => {})
    Expect(f.signals).toEqual([])
  },
)

Test(
  'owned Android serializes refresh publication and final cleanup behind its outstanding receipt acknowledgement',
  async () => {
    const f = fixture()
    const committed = Deferred<void>()
    const acknowledged = Deferred<void>()
    let pause = false
    let first = true
    let publications = 0
    const reservation = await reserveAndroidEmulator(f.operations, undefined, false, async device => {
      if (pause && device.state === 'booted') {
        publications++
        if (first) {
          first = false
          committed.resolve()
          await acknowledged.promise
        }
      }
    })
    pause = true
    const refresh = reservation.refreshOwnership!()
    await committed.promise
    const next = reservation.refreshOwnership!()
    const cleanup = reservation.release()
    Expect(publications).toBe(1)
    Expect(f.stopped).toEqual([])
    acknowledged.resolve()
    await refresh
    await next
    await cleanup
    Expect(publications).toBe(3)
    Expect(f.stopped).toEqual([reservation.serial])
  },
)

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

Test('leases stay fenced until the authoritative child close completes, even after ADB disappears', async () => {
  const f = fixture()
  const reservation = await reserveAndroidEmulator(f.operations)
  f.setShutdown({ holdClose: true })
  const releasing = reservation.release()
  await until(() => f.stopped.length === 1)
  Expect(f.running.has(reservation.serial)).toBe(false)
  Expect(f.held.has(`android-avd:${reservation.avdName}`)).toBe(true)
  Expect(f.held.has(`android-emulator:${reservation.serial}`)).toBe(true)
  f.processes.get(reservation.serial)!.close.resolve({ exitCode: null, signal: 'SIGTERM' })
  await releasing
  Expect([...f.held]).toEqual([])
  Expect(f.retained).toEqual([])
})

Test('owned emulator shutdown escalates through TERM and KILL and joins concurrent release', async () => {
  const f = fixture()
  // budget-ok: this case proves escalation and ownership release, not scheduler-dependent close delivery.
  f.operations.shutdownTimeoutMs = 1_000
  const reservation = await reserveAndroidEmulator(f.operations)
  f.setShutdown({ graceful: false, terminate: false })
  await Promise.all([reservation.release(), reservation.release()])
  Expect(f.stopped).toEqual([reservation.serial])
  Expect(f.signals).toEqual(['SIGTERM', 'SIGKILL'])
  Expect([...f.held]).toEqual([])
  Expect(f.retained).toEqual([])
})

Test('failed startup and boot timeout use the same bounded shutdown and release only after close', async () => {
  for (const failure of ['exit', 'timeout']) {
    const f = fixture()
    // budget-ok: prove cleanup after close, allowing the scheduler to deliver the fake close reaction.
    f.operations.shutdownTimeoutMs = 1_000
    if (failure === 'exit') {
      f.failStartup()
    } else {
      f.setAgentBooted(false)
      // budget-ok: injected fake boot failure, with no real host startup to await.
      f.operations.bootTimeoutMs = 10
    }
    f.setShutdown({ graceful: false, terminate: false })
    await Expect(reserveAndroidEmulator(f.operations)).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(f.signals).toEqual(['SIGTERM', 'SIGKILL'])
    Expect([...f.held]).toEqual([])
    Expect(f.retained).toEqual([])
  }
})

Test('unconfirmed child termination hands both fences to the actual surviving process', async () => {
  const f = fixture()
  const reservation = await reserveAndroidEmulator(f.operations)
  f.setShutdown({ graceful: false, terminate: false, force: false })
  await reservation.release()
  Expect(f.retained).toHaveLength(1)
  const retention = f.retained[0]!
  Expect(retention.owners.map(owner => owner.name)).toEqual([
    `android-avd:${reservation.avdName}`,
    `android-emulator:${reservation.serial}`,
  ])
  Expect(retention.processes).toEqual([{
    command: 'emulator',
    pid: f.processes.get(reservation.serial)!.pid,
    startedAt: `start-${f.processes.get(reservation.serial)!.pid}`,
  }])
  Expect(retention.quarantined).toBe(false)
  Expect(f.held.size).toBe(2)
  Expect(f.errors[0]).toContain('--generation retained-generation')
  const next = await reserveAndroidEmulator(f.operations)
  Expect(next.avdName).toBe('Tao_Agent_Pixel_2')
  f.setShutdown({ graceful: true })
  await next.release()
  Expect(f.held.size).toBe(2)
})

Test('unknown descendants refuse physical cleanup and quarantine both fences without signalling', async () => {
  const f = fixture()
  const reservation = await reserveAndroidEmulator(f.operations)
  f.unknownTree()
  await Expect(reservation.release()).rejects.toMatchObject({ details: { retainsTargetLease: true } })
  const retained = f.durable.get(`android-avd:${reservation.avdName}`)!.retention!
  Expect(retained.quarantined).toBe(true)
  Expect(retained.processes.map(process => process.pid)).toEqual([f.processes.get(reservation.serial)!.pid])
  Expect(f.held.size).toBe(2)
  Expect(f.signals).toEqual([])
  Expect(f.stopped).toEqual([])
  Expect(f.running.has(reservation.serial)).toBe(true)
})

Test('a closed emulator launcher transfers both fences to its actual surviving descendant', async () => {
  const f = fixture()
  const reservation = await reserveAndroidEmulator(f.operations)
  const child = f.addSurvivingChild(reservation.serial)
  f.setShutdown({ terminate: false, force: false })
  await reservation.release()
  Expect(f.processes.get(reservation.serial)!.signalCode).toBe('SIGTERM')
  Expect(f.retained[0]!.processes).toEqual([child])
  Expect(f.retained[0]!.processGroupPid).toBe(f.processes.get(reservation.serial)!.pid)
  Expect(f.retained[0]!.quarantined).toBe(false)
  Expect(f.held.size).toBe(2)
})

Test('ADB failure escalates through the owned child and a spawn exception releases the unused AVD', async () => {
  const f = fixture()
  // budget-ok: this case proves shutdown authority, not scheduler-dependent escalation timing.
  f.operations.shutdownTimeoutMs = 1_000
  const reservation = await reserveAndroidEmulator(f.operations)
  const run = f.operations.run
  f.operations.run = async (command, spec) => {
    if (command === 'adb' && spec?.args?.[3] === 'kill') {
      Errors.throwHostEnvironment('ADB shutdown unavailable')
    }
    return await run(command, spec)
  }
  await reservation.release()
  Expect(f.signals).toEqual(['SIGTERM'])
  Expect([...f.held]).toEqual([])

  const spawn = fixture()
  spawn.operations.start = () => Errors.throwHostEnvironment('Cannot spawn emulator')
  await Expect(reserveAndroidEmulator(spawn.operations)).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
  Expect([...spawn.held]).toEqual([])
  Expect(spawn.retained).toEqual([])
})

Test('shutdown never sends ADB kill to a reused serial or an unowned console listener', async () => {
  const reused = fixture()
  const reservation = await reserveAndroidEmulator(reused.operations)
  reused.exitAndReuseSerial(reservation.serial, 'Replacement_Pixel')
  await reservation.release()
  Expect(reused.stopped).toEqual([])
  Expect(reused.running.get(reservation.serial)).toBe('Replacement_Pixel')
  Expect(reused.disposed).toEqual([reservation.serial])

  for (const mode of ['foreign-listener', 'wrong-avd', 'listener-unavailable']) {
    const f = fixture()
    // budget-ok: concurrent source fixtures may delay close delivery; this case tests authority, not escalation timing.
    f.operations.shutdownTimeoutMs = 1_000
    const own = await reserveAndroidEmulator(f.operations)
    const run = f.operations.run
    f.operations.run = async (command, spec) => {
      const original = await run(command, spec)
      if (command === 'lsof') {
        return mode === 'listener-unavailable'
          ? { ...original, exitCode: 1 }
          : { ...original, stdout: 'p987654321\n' }
      }
      if (mode === 'wrong-avd' && command === 'adb' && spec?.args?.[3] === 'avd') {
        return { ...original, stdout: 'Replacement_Pixel\nOK\n' }
      }
      return original
    }
    await own.release()
    Expect(f.stopped).toEqual([])
    Expect(f.signals).toEqual(['SIGTERM'])
    Expect(f.retained).toEqual([])
  }
})

Test('an asynchronous real spawn error releases the unused AVD after authoritative close', async () => {
  const f = fixture()
  let missingAtReturn = false
  let disposed = false
  let child: CLI.StartedCommand | undefined
  f.operations.start = (_command, spec) => {
    child = CLI.start(Repo.resolvePath(`.artifacts/missing-emulator-${Platform.randomUUID()}`), spec)
    missingAtReturn = child.pid === undefined && child.error === undefined
    const dispose = child.dispose
    child.dispose = () => {
      disposed = true
      dispose()
    }
    return child
  }
  await Expect(reserveAndroidEmulator(f.operations)).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
  Expect(missingAtReturn).toBe(true)
  Expect(child!.pid).toBeUndefined()
  Expect(child!.error).toBeDefined()
  Expect([...f.held]).toEqual([])
  Expect(f.retained).toEqual([])
  Expect(disposed).toBe(true)
})

Test('startup publishes durable child and serial ownership before release or parent exit', async () => {
  const f = fixture()
  const start = f.operations.start
  f.operations.start = (command, spec) => {
    Expect(f.ownership).toHaveLength(1)
    Expect(f.durable.get('android-avd:Tao_Agent_Pixel_1')!.retention!.quarantined).toBe(true)
    Expect(f.durable.get('android-avd:Tao_Agent_Pixel_1')!.retention!.processes).toEqual([])
    return start(command, spec)
  }
  const reservation = await reserveAndroidEmulator(f.operations)
  Expect(f.ownership).toHaveLength(4)
  Expect(f.ownership[0]!.processes).toEqual([])
  Expect(f.ownership[0]!.quarantined).toBe(true)
  Expect(f.ownership[3]!.processes.map(process => process.pid)).toEqual([f.processes.get(reservation.serial)!.pid])
  Expect(f.ownership[3]!.owners.map(owner => owner.name)).toEqual([
    `android-avd:${reservation.avdName}`,
    `android-emulator:${reservation.serial}`,
  ])
  const owner = f.durable.get(`android-avd:${reservation.avdName}`)!
  Expect(owner.pid).toBe(f.processes.get(reservation.serial)!.pid)
  Expect(owner.retention!.resourceNames).toEqual([
    `android-avd:${reservation.avdName}`,
    `android-emulator:${reservation.serial}`,
  ])
  Expect(f.durable.get(`android-emulator:${reservation.serial}`)!.id).toBe(owner.id)
  await reservation.release()
  Expect([...f.held]).toEqual([])
})

Test(
  'fixed Android launch publishes its preheld serial and console intent before spawn without reacquiring',
  async () => {
    const f = fixture()
    const devices: { id: string; consolePort?: number; generation?: string }[] = []
    const acquired: string[] = []
    const acquire = f.operations.acquireResource
    f.operations.acquireResource = async options => {
      acquired.push(options.name)
      return await acquire(options)
    }
    f.operations.launchReservation = async avdName => {
      Expect(avdName).toBe('Tao_Agent_Pixel_1')
      return {
        consolePort: 5580,
        serialLease: await f.operations.acquireResource({
          name: 'android-emulator:emulator-5580',
          command: 'fixture',
          repositoryRoot: Repo.getRoot(),
        }),
      }
    }
    const start = f.operations.start
    f.operations.start = (command, spec) => {
      const avd = f.durable.get('android-avd:Tao_Agent_Pixel_1')!
      const serial = f.durable.get('android-emulator:emulator-5580')!
      Expect(avd.id).toBe(serial.id)
      Expect(avd.retention!.resourceNames).toEqual([avd.name, serial.name])
      Expect(avd.retention!.processes).toEqual([])
      Expect(avd.retention!.reason).toContain('console pair 5580/5581')
      Expect(devices[0]).toMatchObject({ id: 'emulator-5580', consolePort: 5580, generation: avd.id })
      Expect(spec!.args).toContain('-port')
      Expect(spec!.args?.[spec!.args.indexOf('-port') + 1]).toBe('5580')
      return start(command, spec)
    }
    const reservation = await reserveAndroidEmulator(f.operations, undefined, false, async device => {
      devices.push(device)
    })
    Expect(reservation.serial).toBe('emulator-5580')
    Expect(acquired.filter(name => name === 'android-emulator:emulator-5580')).toHaveLength(1)
    await reservation.release()
    Expect(f.stopped).toEqual(['emulator-5580'])
    Expect([...f.held]).toEqual([])
    Expect(f.durable.has(`android-avd:${reservation.avdName}`)).toBe(false)
    Expect(f.durable.has('android-emulator:emulator-5580')).toBe(false)
  },
)

Test('fixed Android launch refuses a different observed serial without acquiring or signaling it', async () => {
  const f = fixture()
  f.operations.launchReservation = async () => ({
    consolePort: 5580,
    serialLease: await f.operations.acquireResource({
      name: 'android-emulator:emulator-5580',
      command: 'fixture',
      repositoryRoot: Repo.getRoot(),
    }),
  })
  const start = f.operations.start
  f.operations.start = (command, spec) =>
    start(command, {
      ...spec,
      args: spec!.args!.filter((arg, index, args) => arg !== '-port' && args[index - 1] !== '-port'),
    })
  await Expect(reserveAndroidEmulator(f.operations)).rejects.toThrow('changed serial while booting')
  Expect(f.held.has('android-emulator:emulator-5556')).toBe(false)
  Expect(f.stopped).toEqual([])
  Expect(f.signals).toEqual([])
  Expect(f.durable.get('android-avd:Tao_Agent_Pixel_1')!.retention!.quarantined).toBe(true)
  Expect(f.durable.get('android-emulator:emulator-5580')!.id)
    .toBe(f.durable.get('android-avd:Tao_Agent_Pixel_1')!.id)
  Expect(f.running.get('emulator-5556')).toBe('Tao_Agent_Pixel_1')
})

Test(
  'fixed Android pre-spawn admission refuses either fence rotated during reserved publication without touching successors',
  async () => {
    for (const changed of ['android-avd:Tao_Agent_Pixel_1', 'android-emulator:emulator-5580']) {
      const f = fixture()
      f.operations.launchReservation = async () => ({
        consolePort: 5580,
        serialLease: await f.operations.acquireResource({
          name: 'android-emulator:emulator-5580',
          command: 'fixture',
          repositoryRoot: Repo.getRoot(),
        }),
      })
      let successor: MachineResourceOwner | undefined
      let recovered = false
      const recover = f.operations.recoverResources!
      f.operations.recoverResources = async options => {
        recovered = true
        return await recover(options)
      }
      let failure: unknown
      try {
        await reserveAndroidEmulator(f.operations, undefined, false, async device => {
          if (device.state === 'reserved' && successor === undefined) {
            successor = { ...f.durable.get(changed)!, id: 'successor-during-reserved-publication' }
            f.durable.set(changed, successor)
          }
        })
      } catch (error) {
        failure = error
      }
      Expect(f.starts).toEqual([])
      Expect(f.stopped).toEqual([])
      Expect(f.signals).toEqual([])
      Expect(Errors.asError(failure).message).toContain('changed ownership before spawn')
      Expect(recovered).toBe(false)
      Expect(f.durable.get(changed)).toEqual(successor)
      Expect(f.held.has('android-avd:Tao_Agent_Pixel_1')).toBe(true)
      Expect(f.held.has('android-emulator:emulator-5580')).toBe(true)
      Expect(f.durable.get('android-avd:Tao_Agent_Pixel_1')!.retention!.quarantined).toBe(true)
      Expect(f.durable.get('android-emulator:emulator-5580')!.retention!.quarantined).toBe(true)
    }
  },
)

Test(
  'fixed Android captures its child inside admission so a failed finalizer still performs owned physical cleanup',
  async () => {
    const f = fixture()
    const admission = f.operations.withCurrentOwners!
    f.operations.launchReservation = async () => ({
      consolePort: 5580,
      serialLease: await f.operations.acquireResource({
        name: 'android-emulator:emulator-5580',
        command: 'fixture',
        repositoryRoot: Repo.getRoot(),
      }),
    })
    f.operations.withCurrentOwners = async (options, action) => {
      await admission(options, action)
      Errors.throwHostEnvironment('Injected admission finalizer failure after spawn')
    }
    await Expect(reserveAndroidEmulator(f.operations)).rejects.toThrow(
      'Injected admission finalizer failure after spawn',
    )
    Expect(f.starts).toHaveLength(1)
    Expect(f.stopped).toEqual(['emulator-5580'])
    Expect(f.disposed).toEqual(['emulator-5580'])
    Expect([...f.held]).toEqual([])
  },
)

Test('fixed Android startup failure keeps both prepublished fences when physical shutdown is unproved', async () => {
  const f = fixture()
  f.failStartup()
  f.unknownTree()
  f.setShutdown({ graceful: false, terminate: false, force: false })
  f.operations.launchReservation = async () => ({
    consolePort: 5580,
    serialLease: await f.operations.acquireResource({
      name: 'android-emulator:emulator-5580',
      command: 'fixture',
      repositoryRoot: Repo.getRoot(),
    }),
  })
  await Expect(reserveAndroidEmulator(f.operations)).rejects.toThrow('Android emulator exited before it booted')
  const avd = f.durable.get('android-avd:Tao_Agent_Pixel_1')!
  Expect(avd.retention!.quarantined).toBe(true)
  Expect(avd.retention!.resourceNames).toEqual([avd.name, 'android-emulator:emulator-5580'])
  Expect(f.durable.get('android-emulator:emulator-5580')!.id).toBe(avd.id)
  Expect([...f.held].sort()).toEqual(['android-avd:Tao_Agent_Pixel_1', 'android-emulator:emulator-5580'])
})

Test('fixed Android malformed console reservation releases its preheld serial without spawning', async () => {
  const f = fixture()
  f.operations.launchReservation = async () => ({
    consolePort: 5581,
    serialLease: await f.operations.acquireResource({
      name: 'android-emulator:emulator-5581',
      command: 'fixture',
      repositoryRoot: Repo.getRoot(),
    }),
  })
  await Expect(reserveAndroidEmulator(f.operations)).rejects.toThrow('valid console pair')
  Expect(f.starts).toEqual([])
  Expect([...f.held]).toEqual([])
})

for (const fault of ['output', 'stop', 'recovery', 'serial-release', 'avd-release', 'publication'] as const) {
  Test(`Android boot failure publishes durable released ownership only after proved cleanup; ${fault}`, async () => {
    const f = fixture()
    const artifact = Repo.resolvePath(`.artifacts/tests/android-startup-publication/${Platform.randomUUID()}`)
    const receiptPath = FS.resolvePath('device.json', artifact)
    const events: string[] = []
    let lastPublished: AgentAppDevDevice | undefined
    let outputObserved: AgentAppDevDevice | undefined
    f.setAgentBooted(false)
    // budget-ok: fixture boot status never changes; only the real startup/cleanup path is under test.
    f.operations.bootTimeoutMs = 1
    f.operations.launchReservation = async () => {
      const serialLease = await f.operations.acquireResource({
        name: 'android-emulator:emulator-5580',
        command: 'fixture',
        repositoryRoot: Repo.getRoot(),
      })
      if (fault === 'serial-release') {
        serialLease.release = async () => Errors.throwHostEnvironment('Injected serial release failure')
      }
      return { consolePort: 5580, serialLease }
    }
    if (fault === 'stop') {
      f.unknownTree()
      f.setShutdown({ graceful: false, terminate: false, force: false })
    }
    if (fault === 'recovery') {
      f.operations.recoverResources = async () => Errors.throwHostEnvironment('Injected recovery failure')
    }
    if (fault === 'avd-release') {
      const acquire = f.operations.acquireResource
      f.operations.acquireResource = async options => {
        const lease = await acquire(options)
        if (options.name.startsWith('android-avd:')) {
          lease.release = async () => Errors.throwHostEnvironment('Injected AVD release failure')
        }
        return lease
      }
    }
    const start = f.operations.start
    f.operations.start = (command, spec) => {
      const child = start(command, spec)
      child.closeOutput = async () => {
        events.push('output')
        outputObserved = JSON.parse(await FS.readText(receiptPath)) as AgentAppDevDevice
        if (fault === 'output') {
          Errors.throwHostEnvironment('Injected output disposal failure')
        }
      }
      return child
    }
    await FS.mkdir(artifact)
    try {
      await Expect(reserveAndroidEmulator(f.operations, undefined, false, async device => {
        if (device.state === 'released') {
          events.push('released')
          Expect(f.stopped).toEqual(['emulator-5580'])
          Expect([...f.held]).toEqual([])
          Expect(f.durable.has('android-avd:Tao_Agent_Pixel_1')).toBe(false)
          Expect(f.durable.has('android-emulator:emulator-5580')).toBe(false)
          if (fault === 'publication') {
            Errors.throwHostEnvironment('Injected receipt publication failure')
          }
        }
        await FS.writeText(receiptPath, JSON.stringify(device))
        lastPublished = device
      })).rejects.toThrow('did not boot within three minutes')
      Expect(f.disposed).toEqual(['emulator-5580'])
      Expect(events.at(-1)).toBe('output')
      if (fault === 'output') {
        Expect(events).toEqual(['released', 'output'])
        Expect(outputObserved?.state).toBe('released')
        Expect(outputObserved?.generation).toBe(lastPublished!.generation)
        Expect(outputObserved?.generation).toBeDefined()
        Expect(outputObserved?.id).toBe('emulator-5580')
        Expect(outputObserved?.avdName).toBe('Tao_Agent_Pixel_1')
        Expect(outputObserved?.consolePort).toBe(5580)
        Expect(outputObserved?.resources?.map(owner => owner.name)).toEqual([
          'android-avd:Tao_Agent_Pixel_1',
          'android-emulator:emulator-5580',
        ])
        Expect(outputObserved?.resources?.every(owner => owner.id === outputObserved!.generation)).toBe(true)
        Expect(f.errors.join('\n')).toContain('Injected output disposal failure')
      } else {
        Expect(lastPublished?.state).not.toBe('released')
        Expect(outputObserved?.state).not.toBe('released')
        Expect(events.includes('released')).toBe(fault === 'publication')
        Expect(f.errors.join('\n')).toContain('Android cleanup failed while preserving the startup failure')
        if (fault === 'stop' || fault === 'recovery') {
          Expect([...f.held].sort()).toEqual(['android-avd:Tao_Agent_Pixel_1', 'android-emulator:emulator-5580'])
          Expect(f.durable.get('android-avd:Tao_Agent_Pixel_1')!.retention).toBeDefined()
        }
        if (fault === 'publication') {
          Expect([...f.held]).toEqual([])
          Expect(f.durable.has('android-avd:Tao_Agent_Pixel_1')).toBe(false)
          Expect(f.durable.has('android-emulator:emulator-5580')).toBe(false)
        }
      }
      Expect(f.running.get('emulator-5554')).toBe('Developer_Pixel')
      Expect(f.stopped.includes('emulator-5554')).toBe(false)
    } finally {
      await FS.remove(artifact)
    }
  })
}

Test('startup failure remains primary when retention or output cleanup also fails', async () => {
  const f = fixture()
  f.failStartup()
  f.setShutdown({ graceful: false, terminate: false, force: false })
  const retain = f.operations.retainResources!
  f.operations.retainResources = options => {
    if (options.reason.includes('shutdown')) {
      Errors.throwHostEnvironment('Retention registry denied')
    }
    return retain(options)
  }
  const start = f.operations.start
  f.operations.start = (command, spec) => {
    const child = start(command, spec)
    child.closeOutput = async () => Errors.throwHostEnvironment('Output flush failed')
    return child
  }
  let primary: unknown
  try {
    await reserveAndroidEmulator(f.operations)
  } catch (error) {
    primary = error
  }
  Expect(primary).toBeInstanceOf(Errors.HostEnvironmentError)
  Expect(Errors.asError(primary).message).toContain('Android emulator exited before it booted')
  Expect(f.errors.join('\n')).toContain('Retention registry denied')
  Expect(f.errors.join('\n')).toContain('Output flush failed')
  Expect(f.errors.join('\n')).toContain('"processes":')
  Expect(f.disposed).toHaveLength(1)
  Expect(f.durable.get('android-avd:Tao_Agent_Pixel_1')!.retention).toBeDefined()
})

Test('failed serial ownership publication refuses cleanup and reports unproved physical publication', async () => {
  const f = fixture()
  const retain = f.operations.retainResources!
  f.operations.retainResources = async options => {
    if (options.owners.some(owner => owner.name.startsWith('android-emulator:'))) {
      Errors.throwHostEnvironment('Serial publication failed')
    }
    return await retain(options)
  }
  await Expect(reserveAndroidEmulator(f.operations)).rejects.toMatchObject({ message: 'Serial publication failed' })
  Expect(f.stopped).toEqual([])
  Expect(f.signals).toEqual([])
  Expect(f.held.has('android-avd:Tao_Agent_Pixel_1')).toBe(true)
  Expect(f.held.has('android-emulator:emulator-5556')).toBe(true)
  Expect(f.errors.join('\n')).toContain('Serial publication failed')
  Expect(f.disposed).toEqual(['emulator-5556'])
})

Test('retention disposes real CLI pipes before the owning worker exits and leaves its child recoverable', async () => {
  const result = await CLI.run(Platform.runtimeProcess.execPath, {
    args: [
      `--tsconfig=${Repo.resolvePath('packages/cli/dev-cli/tsconfig.json')}`,
      '-e',
      `
const {CLI, Errors, Platform, ProcessTree} = await import(${
        JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))
      });
const {reserveAndroidEmulator} = await import(${
        JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/simulators/AgentAndroidEmulator.ts'))
      });
const avdName = 'Tao_Agent_Pixel_1';
let child;
let disposed = false;
let published;
let shutdownRetention = false;
let running = false;
const lease = name => ({owner: {command: 'test', id: Platform.randomUUID(), name, pid: Platform.runtimeProcess.pid, repositoryRoot: '.', startedAt: new Date().toISOString()}, release: async () => {}});
const result = stdout => ({args: [], command: 'fixture', exitCode: 0, signal: null, stdout, stderr: ''});
const operations = {
  bootTimeoutMs: 1000,
  bootIntervalMs: 1,
  shutdownTimeoutMs: 10,
  processTree: {...ProcessTree, signalTracked: () => {}},
  acquireResource: async options => lease(options.name),
  tryAcquireResource: async options => lease(options.name),
  readResourceOwner: async options => ({...published, name: options.name}),
  withCurrentOwners: async (options, action) => {
    if (options.owners.some(owner => owner.id !== published.id)) Errors.throwUnexpected('Stale fixture admission');
    return action();
  },
  retainResources: async options => {
    shutdownRetention ||= options.reason.includes('shutdown');
    published = { ...options.owners[0], id: Platform.randomUUID(), pid: options.processes[0]?.pid ?? options.owners[0].pid, processStartedAt: options.processes[0]?.startedAt, retention: {processes: options.processes, quarantined: options.quarantined, reason: options.reason, resourceNames: options.owners.map(owner => owner.name)}};
    return published;
  },
  recoverResources: async () => { Errors.throwUnexpected('Unexpected recovery'); },
  start: () => {
    running = true;
    child = CLI.start(Platform.runtimeProcess.execPath, {args: ['-e', "setInterval(() => {}, 100)"], detached: true, processPolicy: 'server', stdio: 'pipe', unref: true});
    const identity = ProcessTree.identities([child.pid]).get(child.pid);
    Platform.runtimeConsole.info(JSON.stringify({child: identity}));
    const dispose = child.dispose;
    child.dispose = () => {disposed = true; dispose();};
    child.kill = () => false;
    return child;
  },
  run: async (command, spec) => {
    const args = spec?.args ?? [];
    if (command === 'emulator') return result(${JSON.stringify('Tao_Agent_Pixel_1\n')});
    if (command === 'lsof') return result('');
    if (args[0] === 'devices') return result(running ? ${
        JSON.stringify('List of devices attached\nemulator-5590\tdevice\n')
      } : ${JSON.stringify('List of devices attached\n')});
    if (args[3] === 'avd') return result(${JSON.stringify('Tao_Agent_Pixel_1\nOK\n')});
    if (args[2] === 'shell') return result(${JSON.stringify('1\n')});
    return result('');
  },
  write: () => {}, writeError: () => {},
};
const reservation = await reserveAndroidEmulator(operations);
await reservation.release();
Platform.runtimeConsole.info(JSON.stringify({disposed, shutdownRetention, ownedNames: published.retention.resourceNames}));
`,
    ],
    processPolicy: 'test',
    timeoutMs: 30_000,
  })
  const lines = result.stdout.trim().split(/\r?\n/u)
  const child = JSON.parse(lines[0] ?? '{}').child as TrackedProcess | undefined
  try {
    if (result.exitCode !== 0) {
      Errors.throwUnexpected(`Android worker failed: ${result.stderr}; output: ${result.stdout}`)
    }
    Expect(result.stderr).toBe('')
    Expect(result.exitCode).toBe(0)
    Expect(result.error).toBeUndefined()
    Expect(JSON.parse(lines[1] ?? '{}')).toEqual({
      disposed: true,
      shutdownRetention: true,
      ownedNames: ['android-avd:Tao_Agent_Pixel_1', 'android-emulator:emulator-5590'],
    })
    Expect(child).toBeDefined()
    Expect(ProcessTree.identities([child!.pid]).get(child!.pid)?.startedAt).toBe(child!.startedAt)
  } finally {
    if (child !== undefined) {
      ProcessTree.signalTracked([child], 'SIGKILL')
      await until(() => ProcessTree.identities([child.pid]).get(child.pid)?.startedAt !== child.startedAt)
    }
  }
})
