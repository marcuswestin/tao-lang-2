import { MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { Deferred, Expect, mkTestDir, Test, until } from '@shared/test'
import {
  type ManagedLoopTargetBorrowingSourceOperations,
  withOwnedBorrowedTargetSourceRegression,
} from '../dev-cli-src/dev-loop/ManagedLoopTargetBorrowing'

import { managedIosRuntimeSourceOperations } from './managed-loop-acceptance-ios-runtime-fixture'

const peer = '11111111-1111-1111-1111-111111111111'
const own = '22222222-2222-2222-2222-222222222222'

async function fixture() {
  // The fixed downloader plan accepts only this checkout's invocation artifact boundary.
  const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${Platform.randomUUID()}`)
  await FS.mkdir(root)
  const registryRoot = FS.resolvePath('registry', root)
  const calls: [string, string[]][] = []
  const identity: TrackedProcess = { pid: 2 ** 29, startedAt: 'sentinel-kernel-start', command: 'launchd_sim' }
  let alive = false
  let created = false
  let state = 'Shutdown'
  let name = ''
  const result = (stdout = '', exitCode = 0): CLI.CommandResult => ({
    command: 'source sentinel',
    args: [],
    exitCode,
    signal: null,
    stderr: '',
    stdout,
  })
  const scope = <T extends object>(options: T) => ({ ...options, registryRoot })
  const operations: ManagedLoopTargetBorrowingSourceOperations = {
    resources: {
      acquire: options => MachineResources.acquire(scope(options)),
      tryAcquire: options => MachineResources.tryAcquire(scope(options)),
      readOwner: options => MachineResources.readOwner(scope(options)),
      retain: options => MachineResources.retain(scope(options)),
      recoverRetained: options => MachineResources.recoverRetained(scope(options)),
      withCurrentOwners: (options, action) => MachineResources.withCurrentOwners(scope(options), action),
    },
    inventory: async () => ({ processCount: 1, peers: [], resources: [] }),
    tree: {
      ...ProcessTree,
      identities: pids =>
        new Map(pids.flatMap(pid => pid === identity.pid && alive ? [[pid, { ...identity }] as const] : [])),
    },
    start: () => Errors.throwUnexpected('The iOS sentinel fixture must not spawn an emulator.'),
    runSync: () => Errors.throwUnexpected('The iOS sentinel fixture must not inspect Android listeners.'),
    run: async (command, spec) => {
      const args = [...spec?.args ?? []]
      calls.push([command, args])
      Expect(command).toBe('xcrun')
      if (args[1] === 'list') {
        return result(JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
              { name: 'Developer iPhone', udid: peer, state: 'Booted', deviceTypeIdentifier: 'iPhone-type' },
              ...(created ? [{ name, udid: own, state, deviceTypeIdentifier: 'iPhone-type' }] : []),
            ],
          },
        }))
      }
      if (args[1] === 'create') {
        created = true
        name = args[2]!
        return result(own)
      }
      Expect(args[2]).toBe(own)
      if (args[1] === 'boot') {
        state = 'Booted'
        alive = true
      }
      if (args[1] === 'spawn') {
        Expect(args.slice(3)).toEqual(['launchctl', 'managerpid'])
        return result(String(identity.pid))
      }
      if (args[1] === 'shutdown') {
        state = 'Shutdown'
        alive = false
      }
      if (args[1] === 'delete') {
        Expect(state).toBe('Shutdown')
        created = false
      }
      return result()
    },
  }
  operations.iosRuntime = managedIosRuntimeSourceOperations(operations)
  return { root, registryRoot, operations, calls, identity, result, state: () => state, exists: () => created }
}

Test(
  'Borrowing sentinel creates its own iOS target, frees its device lease for the borrower, and verifies preservation before cleanup',
  async () => {
    const f = await fixture()
    try {
      let callbackId: string | undefined
      const evidence = await withOwnedBorrowedTargetSourceRegression('ios', f.root, async id => {
        callbackId = id
        Expect(id).toBe(own)
        Expect(f.state()).toBe('Booted')
        Expect(f.calls.some(([, args]) => args[1] === 'shutdown')).toBe(false)
        const borrower = await f.operations.resources.acquire({
          name: `ios-simulator:${id}`,
          command: 'borrowed loop',
          repositoryRoot: f.root,
          waitTimeoutMs: 0,
        })
        await borrower.release()
        Expect(f.state()).toBe('Booted')
      }, f.operations)
      Expect(callbackId).toBe(own)
      Expect(evidence.disposition).toBe('source regression')
      Expect(evidence.preserved).toBe(true)
      Expect(evidence.cleanup).toBe('complete')
      Expect(evidence.detail).toBeUndefined()
      Expect(f.exists()).toBe(false)
      Expect(
        f.calls.filter(([, args]) => ['boot', 'spawn', 'shutdown', 'delete'].includes(args[1]!)).every(([, args]) =>
          args[2] === own
        ),
      ).toBe(true)
      Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
    } finally {
      await FS.remove(f.root)
    }
  },
)

Test('Borrowing sentinel refuses a replaced kernel identity even while the target remains booted', async () => {
  const f = await fixture()
  const signals: number[] = []
  const signalTracked = f.operations.iosRuntime!.tree!.signalTracked
  f.operations.iosRuntime!.tree = {
    ...f.operations.iosRuntime!.tree!,
    signalTracked: (tracked, signal) => {
      signals.push(...tracked.map(process => process.pid))
      signalTracked(tracked, signal)
    },
  }
  try {
    const evidence = await withOwnedBorrowedTargetSourceRegression('ios', f.root, async () => {
      f.identity.startedAt = 'reused-PID-kernel-start'
    }, f.operations)
    Expect(evidence.preserved).toBe(false)
    Expect(evidence.detail).toContain('kernel identity')
    Expect(evidence.cleanup).toBe('retained')
    Expect(evidence.unresolved).toHaveLength(2)
    Expect(evidence.unresolved.map(owner => owner.name)).toContain(`ios-simulator:${own}`)
    Expect(evidence.unresolved.some(owner => owner.name.startsWith('ios-create:Tao Managed '))).toBe(true)
    Expect(f.exists()).toBe(true)
    Expect(f.state()).toBe('Booted')
    Expect(f.calls.some(([, args]) => ['shutdown', 'delete'].includes(args[1]!))).toBe(false)
    Expect(signals).toEqual([])
    Expect(
      (await MachineResources.listOwners({ registryRoot: f.registryRoot })).filter(owner =>
        owner.retention?.quarantined
      ),
    ).toHaveLength(2)
  } finally {
    await FS.remove(f.root)
  }
})

Test('Borrowing sentinel refuses cleanup while the borrower retains its device generation', async () => {
  const f = await fixture()
  let release: (() => Promise<void>) | undefined
  try {
    const evidence = await withOwnedBorrowedTargetSourceRegression('ios', f.root, async id => {
      const borrower = await f.operations.resources.acquire({
        name: `ios-simulator:${id}`,
        command: 'unreleased borrower',
        repositoryRoot: f.root,
        waitTimeoutMs: 0,
      })
      release = borrower.release
    }, f.operations)
    Expect(evidence.cleanup).toBe('retained')
    Expect(evidence.detail).toContain('still holds its device fence')
    Expect(evidence.unresolved).toHaveLength(2)
    Expect(evidence.unresolved.map(owner => owner.name)).toContain(`ios-simulator:${own}`)
    Expect(evidence.unresolved.some(owner => owner.name.startsWith('ios-create:Tao Managed '))).toBe(true)
    Expect(f.calls.some(([, args]) => ['shutdown', 'delete'].includes(args[1]!))).toBe(false)
    Expect(f.state()).toBe('Booted')
  } finally {
    await release?.()
    await FS.remove(f.root)
  }
})

Test(
  'Borrowing sentinel treats unavailable iOS kernel provenance as capability failure and retains its fresh UDID',
  async () => {
    const f = await fixture()
    const signals: number[] = []
    const signalTracked = f.operations.iosRuntime!.tree!.signalTracked
    f.operations.iosRuntime!.tree = {
      ...f.operations.iosRuntime!.tree!,
      signalTracked: (tracked, signal) => {
        signals.push(...tracked.map(process => process.pid))
        signalTracked(tracked, signal)
      },
    }
    const run = f.operations.run
    f.operations.run = async (command, spec) => spec?.args?.[1] === 'spawn' ? f.result('1') : await run(command, spec)
    try {
      let invoked = false
      const evidence = await withOwnedBorrowedTargetSourceRegression('ios', f.root, async () => {
        invoked = true
      }, f.operations)
      Expect(invoked).toBe(false)
      Expect(evidence.preserved).toBe(false)
      Expect(evidence.detail).toContain('unknown bootstrap ownership')
      Expect(evidence.cleanup).toBe('retained')
      Expect(evidence.unresolved).toHaveLength(2)
      Expect(evidence.unresolved.map(owner => owner.name)).toContain(`ios-simulator:${own}`)
      Expect(evidence.unresolved.some(owner => owner.name.startsWith('ios-create:Tao Managed '))).toBe(true)
      Expect(evidence.id).toBe(own)
      Expect(f.exists()).toBe(true)
      Expect(f.state()).toBe('Booted')
      Expect(f.calls.some(([, args]) => ['shutdown', 'delete'].includes(args[1]!))).toBe(false)
      Expect(signals).toEqual([])
      Expect(
        (await MachineResources.listOwners({ registryRoot: f.registryRoot })).filter(owner =>
          owner.retention?.quarantined
        ),
      ).toHaveLength(2)
    } finally {
      await FS.remove(f.root)
    }
  },
)

Test('Borrowing SDK preparation failure keeps its producer fence until independent exact target deletion', async () => {
  const f = await fixture()
  const runtimeRun = f.operations.iosRuntime!.run!
  f.operations.iosRuntime!.run = async (command, spec) =>
    command === 'plutil' ? f.result('foreign.bundle') : await runtimeRun(command, spec)
  const run = f.operations.run
  let heldDuringShutdown = false
  f.operations.run = async (command, spec) => {
    if (spec?.args?.[1] === 'shutdown') {
      heldDuringShutdown =
        (await f.operations.resources.readOwner({ name: `ios-simulator:${own}` }))?.retention?.quarantined === true
    }
    return await run(command, spec)
  }
  try {
    let invoked = false
    const evidence = await withOwnedBorrowedTargetSourceRegression('ios', f.root, async () => {
      invoked = true
    }, f.operations)
    Expect(invoked).toBe(false)
    if (!heldDuringShutdown) {
      Errors.throwUnexpected(
        `Source SDK failure missed retained shutdown: ${evidence.detail}; cleanup=${evidence.cleanup}; stages=${
          f.calls.map(([, args]) => args[1]).join(', ')
        }`,
      )
    }
    Expect(heldDuringShutdown).toBe(true)
    Expect(evidence.detail).toContain('bundle metadata changed')
    Expect(evidence.cleanup).toBe('complete')
    Expect(f.exists()).toBe(false)
    Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})

Test('Borrowing sentinel accepts only fixed platform names before allocating anything', async () => {
  const f = await fixture()
  try {
    await Expect(
      withOwnedBorrowedTargetSourceRegression('emulator-5554' as 'android', f.root, async () => {}, f.operations),
    ).rejects.toBeInstanceOf(Errors.UserInputError)
    Expect(f.calls).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})

Test('Borrowing iOS cleanup preserves and reports a successor generation rotated during shutdown', async () => {
  const f = await fixture()
  const run = f.operations.run
  let successor: string | undefined
  f.operations.run = async (command, spec) => {
    const result = await run(command, spec)
    if (spec?.args?.[1] === 'shutdown') {
      const owner = await f.operations.resources.readOwner({ name: `ios-simulator:${own}` })
      const next = await f.operations.resources.retain({
        owners: [owner!],
        processes: [],
        quarantined: true,
        reason: 'successor rotated during awaited shutdown',
      })
      successor = next.id
    }
    return result
  }
  try {
    const evidence = await withOwnedBorrowedTargetSourceRegression('ios', f.root, async () => {}, f.operations)
    Expect(f.calls.some(([, args]) => args[1] === 'delete')).toBe(false)
    Expect(evidence.cleanup).toBe('retained')
    Expect(successor).toBeDefined()
    Expect(evidence.unresolved).toHaveLength(2)
    Expect(evidence.unresolved.find(owner => owner.name === `ios-simulator:${own}`)).toEqual({
      name: `ios-simulator:${own}`,
      generation: successor!,
    })
    Expect((await f.operations.resources.readOwner({ name: `ios-simulator:${own}` }))?.id).toBe(successor)
  } finally {
    await FS.remove(f.root)
  }
})

Test('Borrowing Android rejected console inspection releases the untransferred port lease', async () => {
  const f = await fixture()
  f.operations.run = async command =>
    command === 'emulator' ? f.result('Developer_Pixel\n') : Errors.throwHostEnvironment('Injected rejected port probe')
  try {
    const evidence = await withOwnedBorrowedTargetSourceRegression(
      'android',
      f.root,
      async () => Errors.throwUnexpected('Rejected probe must not borrow.'),
      f.operations,
    )
    Expect(evidence.detail).toContain('Injected rejected port probe')
    Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})

Test('Borrowing Android capture timeout never resets provenance or signals a replacement PID', async () => {
  const f = await androidFixture()
  const identities = f.operations.tree.identities
  const acquire = f.operations.resources.acquire
  let cleanupStarted = false
  f.operations.resources.acquire = async options => {
    if (options.command === 'owned Android borrowing sentinel cleanup') {
      cleanupStarted = true
    }
    return await acquire(options)
  }
  f.operations.tree = {
    ...f.operations.tree,
    identities: pids => {
      if (cleanupStarted) {
        return identities(pids)
      }
      f.identity.startedAt = 'replacement-after-failed-first-capture'
      return new Map()
    },
  }
  try {
    let invoked = false
    const evidence = await withOwnedBorrowedTargetSourceRegression('android', f.root, async () => {
      invoked = true
    }, f.operations)
    Expect(invoked).toBe(false)
    Expect(f.signalRequests).toEqual([])
    Expect(f.androidCalls.some(([command, args]) => command === 'adb' && args[3] === 'kill')).toBe(false)
    Expect(evidence.cleanup).toBe('retained')
    Expect(evidence.unresolved.some(owner => owner.name === 'android-console-port:5580')).toBe(true)
  } finally {
    await FS.remove(f.root)
  }
})

Test('Borrowing Android shutdown fences rotation during serial inspection before ADB kill or any signal', async () => {
  const f = await androidFixture()
  const run = f.operations.run
  let successor: string | undefined
  f.operations.run = async (command, spec) => {
    const result = await run(command, spec)
    if (command === 'adb' && spec?.args?.[3] === 'avd' && successor === undefined) {
      const cleanup = await f.operations.resources.readOwner({ name: `android-avd:${f.avdName()}` })
      if (cleanup?.command === 'owned Android borrowing sentinel cleanup') {
        const console = await f.operations.resources.readOwner({ name: 'android-console-port:5580' })
        const next = await f.operations.resources.retain({
          owners: [console!],
          processes: console!.retention!.processes,
          processGroupPid: console!.retention!.processGroupPid,
          quarantined: true,
          reason: 'successor rotated during awaited serial inspection',
        })
        successor = next.id
      }
    }
    return result
  }
  try {
    const evidence = await withOwnedBorrowedTargetSourceRegression('android', f.root, async () => {}, f.operations)
    Expect(successor).toBeDefined()
    Expect(f.androidCalls.some(([command, args]) => command === 'adb' && args[3] === 'kill')).toBe(false)
    Expect(f.signalRequests).toEqual([])
    Expect(evidence.cleanup).toBe('retained')
    Expect(
      evidence.unresolved.some(owner => owner.name === 'android-console-port:5580' && owner.generation === successor),
    ).toBe(true)
    Expect((await f.operations.resources.readOwner({ name: 'android-console-port:5580' }))?.id).toBe(successor)
  } finally {
    await FS.remove(f.root)
  }
})

Test('Borrowing Android shutdown rechecks kernel after the final generation await before ADB kill', async () => {
  const f = await androidFixture()
  const acquire = f.operations.resources.acquire
  const readOwner = f.operations.resources.readOwner
  let cleanupStarted = false
  let cleanupConsoleReads = 0
  let replaced = false
  f.operations.resources.acquire = async options => {
    if (options.command === 'owned Android borrowing sentinel cleanup') {
      cleanupStarted = true
    }
    return await acquire(options)
  }
  f.operations.resources.readOwner = async options => {
    const owner = await readOwner(options)
    if (cleanupStarted && options.name === 'android-console-port:5580') {
      cleanupConsoleReads++
      // Initial admission, name/listener pre/post checks, outer shutdown check,
      // then the destructive call's final awaited generation preflight.
      if (cleanupConsoleReads === 7) {
        f.identity.startedAt = 'replacement-during-last-generation-await'
        replaced = true
      }
    }
    return owner
  }
  try {
    const evidence = await withOwnedBorrowedTargetSourceRegression('android', f.root, async () => {}, f.operations)
    Expect(replaced).toBe(true)
    Expect(f.androidCalls.some(([command, args]) => command === 'adb' && args[3] === 'kill')).toBe(false)
    Expect(f.signalRequests).toEqual([])
    Expect(evidence.cleanup).toBe('retained')
    Expect(evidence.detail).toContain('kernel changed before a destructive continuation')
    Expect(evidence.unresolved.some(owner => owner.name === 'android-console-port:5580')).toBe(true)
  } finally {
    await FS.remove(f.root)
  }
})

async function androidFixture() {
  const f = await fixture()
  let avdName = ''
  let serial = 'emulator-5580'
  let created = false
  let alive = false
  const closed = Deferred<CLI.CommandCloseResult>()
  const androidCalls: [string, string[]][] = []
  const signalRequests: string[] = []
  let disposed = 0
  f.identity.command = 'qemu-system-aarch64'
  const finish = () => {
    alive = false
    closed.resolve({ exitCode: null, signal: 'SIGTERM' })
  }
  f.operations.tree = {
    ...ProcessTree,
    identities: pids =>
      new Map(pids.flatMap(pid => pid === f.identity.pid && alive ? [[pid, { ...f.identity }] as const] : [])),
    descendants: () => [],
    processGroupOf: pid => pid,
    isGroupAlive: () => alive,
    signalTracked: (processes, signal) => {
      signalRequests.push(signal)
      Expect(processes.every(process => process.pid === f.identity.pid && process.startedAt === f.identity.startedAt))
        .toBe(true)
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        finish()
      }
    },
  }
  f.operations.run = async (command, spec) => {
    const args = [...spec?.args ?? []]
    androidCalls.push([command, args])
    if (command === 'emulator') {
      return f.result(`Developer_Pixel\n${created ? `${avdName}\n` : ''}`)
    }
    if (command === 'avdmanager') {
      if (args[0] === 'create') {
        avdName = args[3]!
        Expect(avdName.startsWith('Tao_Borrow_')).toBe(true)
        created = true
      } else {
        Expect(args).toEqual(['delete', 'avd', '--name', avdName])
        Expect(alive).toBe(false)
        created = false
      }
      return f.result()
    }
    if (command === 'lsof') {
      return alive ? f.result(`p${f.identity.pid}\n`) : f.result('', 1)
    }
    Expect(command).toBe('adb')
    Expect(args.slice(0, 2)).toEqual(['-s', serial])
    if (args[2] === 'emu' && args[3] === 'avd') {
      return f.result(`${avdName}\nOK\n`)
    }
    if (args[2] === 'emu' && args[3] === 'kill') {
      finish()
      return f.result()
    }
    Expect(args.slice(2)).toEqual(['shell', 'getprop', 'sys.boot_completed'])
    return f.result('1\n')
  }
  f.operations.runSync = (command, spec) => {
    Expect(command).toBe('lsof')
    androidCalls.push([command, [...spec?.args ?? []]])
    return alive ? f.result(`p${f.identity.pid}\n`) : f.result('', 1)
  }
  f.operations.start = (command, spec) => {
    Expect(command).toBe('emulator')
    Expect(spec?.args).toContain('-no-window')
    Expect(spec?.args).toContain(avdName)
    serial = `emulator-${spec!.args![spec!.args!.indexOf('-port') + 1]}`
    Expect(Array.isArray(spec?.stdio)).toBe(true)
    alive = true
    return {
      command,
      args: [...spec?.args ?? []],
      pid: f.identity.pid,
      get exitCode() {
        return alive ? null : 0
      },
      get signalCode() {
        return alive ? null : 'SIGTERM' as const
      },
      closeOutput: async () => {},
      dispose: () => {
        disposed++
      },
      endStdin: () => {},
      onceClose: () => {},
      onceError: () => {},
      waitForClose: () => closed.promise,
      writeStdin: () => true,
      kill: signal => {
        signalRequests.push(`child:${signal}`)
        finish()
        return true
      },
    }
  }
  return { ...f, androidCalls, signalRequests, avdName: () => avdName, alive: () => alive, disposed: () => disposed }
}

Test('Android borrowing skips a historical serial fence and preserves its exact retained generation', async () => {
  const f = await androidFixture()
  try {
    const lease = await f.operations.resources.acquire({
      name: 'android-emulator:emulator-5580',
      command: 'foreign historical serial',
      repositoryRoot: '/foreign',
    })
    const foreign = await f.operations.resources.retain({
      owners: [lease.owner],
      processes: [],
      quarantined: true,
      reason: 'historical foreign custody',
    })
    const retainedPath = FS.resolvePath(`.retentions/${foreign.id}.json`, f.registryRoot)
    const before = await FS.readText(retainedPath)
    const evidence = await withOwnedBorrowedTargetSourceRegression('android', f.root, async id => {
      Expect(id).toBe('emulator-5582')
      Expect((await f.operations.resources.readOwner({ name: foreign.name }))?.id).toBe(foreign.id)
    }, f.operations)
    Expect(evidence.cleanup).toBe('complete')
    Expect(await f.operations.resources.readOwner({ name: foreign.name })).toEqual(foreign)
    Expect(f.androidCalls.some(([command, args]) => command === 'lsof' && args[1] === '-iTCP:5580-5581')).toBe(false)
    Expect(await FS.readText(retainedPath)).toBe(before)
  } finally {
    await FS.remove(f.root)
  }
})

Test('Android borrowing allocates no target when every serial has managed custody', async () => {
  const f = await androidFixture()
  const readOwner = f.operations.resources.readOwner
  f.operations.resources.readOwner = async options =>
    options.name.startsWith('android-emulator:')
      ? {
        command: 'foreign',
        id: 'foreign-generation',
        name: options.name,
        pid: 123,
        repositoryRoot: '/foreign',
        startedAt: 'recorded',
      }
      : await readOwner(options)
  try {
    const evidence = await withOwnedBorrowedTargetSourceRegression('android', f.root, async () => {
      Errors.throwUnexpected('A foreign-fenced serial must never reach the borrower.')
    }, f.operations)
    Expect(evidence.cleanup).toBe('not allocated')
    Expect(f.androidCalls.filter(([command]) => command === 'avdmanager' || command === 'adb')).toEqual([])
    Expect(f.disposed()).toBe(0)
    Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})

Test(
  'Android borrowing retained cleanup disposes its file-backed parent handle and preserves device custody',
  async () => {
    const f = await androidFixture()
    let release: (() => Promise<void>) | undefined
    try {
      const evidence = await withOwnedBorrowedTargetSourceRegression('android', f.root, async id => {
        const lease = await f.operations.resources.acquire({
          name: `android-emulator:${id}`,
          command: 'unfinished borrower',
          repositoryRoot: '/foreign',
        })
        release = lease.release
      }, f.operations)
      Expect(evidence.cleanup).toBe('retained')
      Expect(f.disposed()).toBe(1)
      Expect(f.alive()).toBe(true)
      Expect(f.signalRequests).toEqual([])
      Expect(f.androidCalls.some(([command, args]) => command === 'avdmanager' && args[0] === 'delete')).toBe(false)
      Expect((await f.operations.resources.readOwner({ name: 'android-emulator:emulator-5580' }))?.repositoryRoot)
        .toBe('/foreign')
      Expect((await f.operations.resources.readOwner({ name: 'android-console-port:5580' }))?.retention?.quarantined)
        .toBe(true)
    } finally {
      await release?.()
      await FS.remove(f.root)
    }
  },
)

Test('File-backed retained sentinel output stays writable after its launching parent exits', async () => {
  const root = await mkTestDir('managed-borrowing-file-output-')
  const stdoutPath = FS.resolvePath('sentinel.stdout.log', root)
  const stderrPath = FS.resolvePath('sentinel.stderr.log', root)
  const identityPath = FS.resolvePath('identity.json', root)
  let identity: TrackedProcess | undefined
  const shared = Repo.resolvePath('packages/shared/shared-src/shared.ts')
  // A fixed owned writer proves the fd lifetime using real subprocesses without opening native UI.
  const writer = `import { HCI, Time } from ${JSON.stringify(shared)};
    for (;;) { HCI.writeLine('retained-output'); await Time.sleep(25); }`
  const parent = `import { CLI, FS, Platform, ProcessTree, Time } from ${JSON.stringify(shared)};
    await FS.writeExclusiveFile(${JSON.stringify(stdoutPath)}, '', { mode: 0o600 });
    await FS.writeExclusiveFile(${JSON.stringify(stderrPath)}, '', { mode: 0o600 });
    const stdout = await FS.openAppend(${JSON.stringify(stdoutPath)});
    const stderr = await FS.openAppend(${JSON.stringify(stderrPath)});
    const child = CLI.start(Platform.runtimeProcess.execPath, { args: ['-e', ${JSON.stringify(writer)}],
      detached: true, unref: true, lifetime: { outlivesParent: 'retained target fixture' },
      processPolicy: 'server', stdio: ['ignore', stdout.fd, stderr.fd] });
    await stdout.close(); await stderr.close();
    const identity = await Time.pollUntil(() => ProcessTree.identities([child.pid]).get(child.pid),
      { intervalMs: 25, timeoutMs: 30000 });
    await FS.writeJson(${JSON.stringify(identityPath)}, identity);
    child.dispose();`
  try {
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: ['-e', parent],
      cwd: Repo.getRoot(),
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    Expect(result.exitCode).toBe(0)
    identity = await FS.readJson<TrackedProcess>(identityPath)
    Expect(ProcessTree.sameProcess(ProcessTree.identities([identity.pid]).get(identity.pid), identity)).toBe(true)
    const before = (await FS.readText(stdoutPath)).length
    await until(async () => (await FS.readText(stdoutPath)).length > before)
    Expect(await FS.readText(stdoutPath)).toContain('retained-output')
    Expect(await FS.readText(stderrPath)).toBe('')
    Expect(ProcessTree.sameProcess(ProcessTree.identities([identity.pid]).get(identity.pid), identity)).toBe(true)
  } finally {
    if (identity === undefined && await FS.exists(identityPath)) {
      identity = await FS.readJson<TrackedProcess>(identityPath)
    }
    if (identity !== undefined) {
      ProcessTree.signalTracked([identity], 'SIGKILL')
      const stopped = await Time.pollUntil(
        () =>
          !ProcessTree.sameProcess(ProcessTree.identities([identity!.pid]).get(identity!.pid), identity!)
            ? true
            : undefined,
        { intervalMs: 25, timeoutMs: 30_000 },
      )
      Expect(stopped).toBe(true)
    }
    await FS.remove(root)
  }
})

Test('Android borrowing sentinel retains only its console port while the loop borrows AVD and serial', async () => {
  const f = await androidFixture()
  try {
    const evidence = await withOwnedBorrowedTargetSourceRegression('android', f.root, async id => {
      Expect(id).toBe('emulator-5580')
      Expect(f.alive()).toBe(true)
      const initial = await MachineResources.listOwners({ registryRoot: f.registryRoot })
      Expect(initial.map(owner => owner.name)).toEqual(['android-console-port:5580'])
      Expect(initial[0]?.retention?.processes[0]?.startedAt).toBe(f.identity.startedAt)
      const avd = await f.operations.resources.acquire({
        name: `android-avd:${f.avdName()}`,
        command: 'borrowed AVD',
        repositoryRoot: f.root,
        waitTimeoutMs: 0,
      })
      const serial = await f.operations.resources.acquire({
        name: `android-emulator:${id}`,
        command: 'borrowed serial',
        repositoryRoot: f.root,
        waitTimeoutMs: 0,
      })
      await serial.release()
      await avd.release()
      Expect(f.alive()).toBe(true)
    }, f.operations)
    Expect(evidence.detail).toBeUndefined()
    Expect(evidence.disposition).toBe('source regression')
    Expect(evidence.preserved).toBe(true)
    Expect(evidence.cleanup).toBe('complete')
    Expect(evidence.detail).toBeUndefined()
    Expect(f.alive()).toBe(false)
    Expect(f.androidCalls.some(([command]) => command === 'sdkmanager')).toBe(false)
    Expect(await MachineResources.listOwners({ registryRoot: f.registryRoot })).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})

Test(
  'Android borrowing sentinel refuses a replaced root identity and does not treat a booted serial as ownership',
  async () => {
    const f = await androidFixture()
    try {
      const evidence = await withOwnedBorrowedTargetSourceRegression('android', f.root, async () => {
        f.identity.startedAt = 'replacement-kernel-start'
      }, f.operations)
      Expect(evidence.preserved).toBe(false)
      Expect(evidence.cleanup).toBe('retained')
      Expect(evidence.detail).toBeDefined()
      Expect(f.androidCalls.some(([command, args]) => command === 'avdmanager' && args[0] === 'delete')).toBe(false)
    } finally {
      await FS.remove(f.root)
    }
  },
)
