import type { FixedIosLaunchCapture } from '@expo-host/dev-loop/expo-runner/fixedIosLaunchCommand'
import { type MachineResourceLease, type MachineResourceOwner, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { devLoopRequest } from '@shared/DevLoopControl'
import { Deferred, Expect, settle, Test, until, withCapturedOutput } from '@shared/test'
import { runDevLoopCommand } from '../dev-cli-src/dev-loop/DevLoopCommand'
import { runDevLoopController } from '../dev-cli-src/dev-loop/DevLoopController'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'
import { waitManagedLoopStartupFailureDisposal } from '../dev-cli-src/dev-loop/ManagedLoopAcceptance'
import {
  cleanupManagedLoopAndroidAssets,
  managedLoopAndroidOperations,
  managedLoopAndroidPrefix,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceAndroidTarget'
import {
  admitManagedAndroidAbruptDeath,
  assertManagedLoopBorrowedIosAdmission,
  createManagedIosNativeStopEntry,
  createManagedLoopFaultRecorder,
  createManagedLoopFaultWorker,
  inspectManagedIosNativeStopObservation,
  type ManagedIosNativeStopObservation,
  managedLoopFaultArgs,
  managedLoopFaultOperations,
  observeManagedIosNativeOpenurl,
  rollbackManagedLoopFault,
  startManagedIosNativeFaultWorker,
} from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults'
import type { ManagedIosAsset } from '../dev-cli-src/dev-loop/ManagedLoopAcceptanceIosRuntime'
import {
  type ManagedLoopTargetBorrowingSourceOperations,
  withOwnedBorrowedTargetSourceRegression,
} from '../dev-cli-src/dev-loop/ManagedLoopTargetBorrowing'
import { managedIosRuntimeSourceOperations } from './managed-loop-acceptance-ios-runtime-fixture'

function androidDeathAdmissionFixture() {
  const invocation = Platform.randomUUID()
  const scope = Platform.randomUUID()
  const controller = { pid: 72_001, startedAt: 'original controller', command: 'controller' }
  const emulator = { pid: 72_002, startedAt: 'original emulator', command: 'emulator' }
  const stamp = new Date().toISOString()
  const generation = Platform.randomUUID()
  const physical = Platform.randomUUID()
  const resources: MachineResourceOwner[] = ['android-avd:Private_Pixel', 'android-emulator:emulator-5580'].map(
    name => ({
      name,
      id: physical,
      pid: emulator.pid,
      processStartedAt: emulator.startedAt,
      command: 'owned fixture',
      startedAt: stamp,
      repositoryRoot: Repo.getRoot(),
      retention: {
        processes: [emulator],
        processGroupPid: emulator.pid,
        resourceNames: ['android-avd:Private_Pixel', 'android-emulator:emulator-5580'],
        quarantined: false,
        reason: 'captured',
      },
    }),
  )
  const record: DevLoopReceipt = {
    version: 1,
    session: Platform.randomUUID(),
    checkout: Repo.getRoot(),
    args: ['--android'],
    generation,
    state: 'ready',
    createdAt: stamp,
    updatedAt: stamp,
    controller,
    provenance: 'complete',
    children: [emulator],
    processGroups: [emulator],
    devices: [{
      platform: 'android',
      owned: true,
      id: 'emulator-5580',
      avdName: 'Private_Pixel',
      state: 'booted',
      generation: physical,
      resources,
    }],
    mobileDriverCleanup: 'proved',
  }
  const checkpoint = {
    version: 1,
    invocation,
    scope,
    event: 'ownership-checkpoint',
    sequence: 1,
    session: record.session,
    loopGeneration: generation,
    controller,
    devices: structuredClone(record.devices!),
    children: [emulator],
    processGroups: [emulator],
  }
  const events: unknown[] = [checkpoint]
  const live = new Map([[controller.pid, controller], [emulator.pid, emulator]])
  const owners = new Map(resources.map(owner => [owner.name, owner]))
  const signals: TrackedProcess[] = []
  const options = {
    invocation,
    scope,
    session: record.session,
    eventRoot: Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}/faults/${scope}`),
    signal: (process: TrackedProcess) => {
      signals.push(process)
    },
  }
  const seams = {
    receipt: async () => structuredClone(record),
    readReceiptSync: () => structuredClone(record),
    readEvents: async () => events,
    readOwner: async (options: { name: string }) => owners.get(options.name),
    withCurrentOwners: (async (_options, action) => {
      const value = action()
      if (value !== null && typeof value === 'object' && 'then' in value) {
        Errors.throwUnexpected('Machine-resource admission action must be synchronous.')
      }
      return value
    }) as typeof MachineResources.withCurrentOwners,
    tree: {
      identities: (pids: readonly number[]) =>
        new Map(pids.flatMap(pid => live.has(pid) ? [[pid, live.get(pid)!] as const] : [])),
      descendants: (_pid: number): TrackedProcess[] => [],
      groupMembers: (pid: number): TrackedProcess[] => pid === controller.pid ? [controller] : [emulator],
      processGroupOf: (pid: number) => pid === emulator.pid ? emulator.pid : controller.pid,
      isGroupAlive: (pid: number) => live.has(pid),
      processIsAlive: (pid: number) => live.has(pid),
    },
  }
  return { controller, emulator, record, checkpoint, events, live, owners, resources, signals, options, seams }
}

Test(
  'Android lifecycle holder-death admits only a durable fresh generation and immediate live comparison',
  async () => {
    const f = androidDeathAdmissionFixture()
    await admitManagedAndroidAbruptDeath(f.options, f.seams)
    Expect(f.signals).toEqual([{ pid: 72_001, startedAt: 'original controller', command: 'controller' }])
  },
)

for (const changed of [false, true]) {
  Test(
    `actual registry Android death admission ${
      changed
        ? 'refuses a synchronous receipt change without detached signals'
        : 'admits its synchronous checkpoint comparison'
    }`,
    async () => {
      const f = androidDeathAdmissionFixture()
      const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${f.options.invocation}`)
      const registryRoot = FS.resolvePath('source-registry', root)
      await FS.mkdir(root)
      const leases: MachineResourceLease[] = []
      try {
        for (const owner of f.resources) {
          leases.push(
            await MachineResources.acquire({
              name: owner.name,
              command: 'source death admission',
              repositoryRoot: Repo.getRoot(),
              registryRoot,
            }),
          )
        }
        const retained = await MachineResources.retain({
          owners: leases.map(lease => lease.owner),
          processes: [f.emulator],
          processGroupPid: f.emulator.pid,
          quarantined: false,
          reason: 'source ownership checkpoint',
          registryRoot,
        })
        const resources = await Promise.all(
          f.resources.map(owner => MachineResources.readOwner({ name: owner.name, registryRoot })),
        )
        f.resources.splice(0, f.resources.length, ...resources.map(owner => owner!))
        f.record.devices![0]!.generation = retained.id
        f.checkpoint.devices = structuredClone(f.record.devices!)
        let syncReads = 0
        const seams = {
          ...f.seams,
          readOwner: (options: { name: string }) => MachineResources.readOwner({ ...options, registryRoot }),
          withCurrentOwners: ((options, action) =>
            MachineResources.withCurrentOwners(
              { ...options, registryRoot },
              action,
            )) as typeof MachineResources.withCurrentOwners,
          readReceiptSync: () => {
            syncReads++
            const current = structuredClone(f.record)
            if (changed) {
              current.state = 'stopping'
            }
            return current
          },
        }
        if (changed) {
          await Expect(admitManagedAndroidAbruptDeath(f.options, seams)).rejects.toThrow('publication changed')
          await settle(2)
          Expect(f.signals).toEqual([])
        } else {
          await admitManagedAndroidAbruptDeath(f.options, seams)
          Expect(f.signals).toEqual([f.controller])
        }
        Expect(syncReads).toBe(1)
        await MachineResources.recoverRetained({
          name: f.resources[0]!.name,
          generation: retained.id,
          registryRoot,
          shutdown: async () => true,
        })
      } finally {
        for (const lease of leases) {
          await lease.release()
        }
        await FS.remove(root)
      }
    },
  )
}

for (
  const fault of [
    'missing checkpoint',
    'stale sequence',
    'loop generation',
    'physical generation',
    'opening driver',
    'ownership refusal',
    'controller reuse',
    'lost Android anchor',
    'unknown member',
    'late ancestry',
    'read failure',
  ] as const
) {
  Test(`Android lifecycle holder-death sends zero signals for ${fault}`, async () => {
    const f = androidDeathAdmissionFixture()
    if (fault === 'missing checkpoint') {
      f.events.length = 0
    }
    if (fault === 'stale sequence') {
      f.checkpoint.sequence = 0
    }
    if (fault === 'loop generation') {
      f.record.generation = Platform.randomUUID()
    }
    if (fault === 'physical generation') {
      f.owners.set(f.resources[0]!.name, { ...f.resources[0]!, id: Platform.randomUUID() })
    }
    if (fault === 'opening driver') {
      f.record.mobileDriverCleanup = 'opening'
    }
    if (fault === 'ownership refusal') {
      f.record.ownershipRefusal = { version: 1, generation: f.record.generation, reason: 'unproved' }
    }
    if (fault === 'controller reuse') {
      f.live.set(f.controller.pid, { ...f.controller, startedAt: 'successor' })
    }
    if (fault === 'lost Android anchor') {
      f.live.delete(f.emulator.pid)
    }
    if (fault === 'unknown member') {
      f.seams.tree.groupMembers = () => [f.emulator, { pid: 72_003, startedAt: 'unknown', command: 'qemu' }]
    }
    if (fault === 'late ancestry') {
      const child = { pid: 72_003, startedAt: 'late', command: 'qemu' }
      f.live.set(child.pid, child)
      f.seams.tree.descendants = () => [child]
      f.seams.tree.groupMembers = () => [f.emulator, child]
      f.seams.tree.processGroupOf = () => f.emulator.pid
    }
    if (fault === 'read failure') {
      f.seams.tree.groupMembers = () => Errors.throwHostEnvironment('Read refused')
    }
    await Expect(admitManagedAndroidAbruptDeath(f.options, f.seams)).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
    Expect(f.signals).toEqual([])
    Expect(f.record.devices![0]!.resources![0]!.retention!.processes).toEqual([f.emulator])
  })
}

function nativeStopSourceFixture() {
  const invocation = Platform.randomUUID()
  const scope = Platform.randomUUID()
  const session = Platform.randomUUID()
  const generation = Platform.randomUUID()
  const actionGeneration = Platform.randomUUID()
  const id = Platform.randomUUID()
  const holder = { pid: 71_001, startedAt: 'holder', command: 'source holder' }
  const supervisor = { pid: 71_002, startedAt: 'supervisor', command: 'source supervisor' }
  const worker = { pid: 71_003, startedAt: 'worker', command: 'sh' }
  const native = { ...worker, command: 'simctl' }
  const owner: MachineResourceOwner = {
    id: Platform.randomUUID(),
    name: `ios-simulator:${id}`,
    pid: holder.pid,
    repositoryRoot: Repo.getRoot(),
    startedAt: 'source acquisition',
    processStartedAt: holder.startedAt,
    command: holder.command,
  }
  const observation: ManagedIosNativeStopObservation = {
    version: 1,
    invocation,
    scope,
    session,
    loopGeneration: generation,
    actionGeneration,
    stage: 'boot',
    id,
    holder,
    owners: [owner],
    supervisor,
    worker,
    native,
    group: supervisor.pid,
    processes: [supervisor, worker],
  }
  const asset: ManagedIosAsset = {
    version: 2,
    invocation,
    scope,
    root: `source/ios-${scope}`,
    name: `Tao Managed ${invocation}_${scope}_1`,
    holder,
    state: 'minted',
    id,
    resources: [owner],
    actions: [{
      stage: 'boot',
      state: 'captured',
      generation: actionGeneration,
      barrier: {
        version: 1,
        generation: actionGeneration,
        supervisor,
        worker,
        workerParentPid: supervisor.pid,
        group: supervisor.pid,
        processes: [supervisor, worker],
        released: true,
        drainProved: false,
      },
    }],
  }
  const receipt: DevLoopReceipt = {
    version: 1,
    session,
    generation,
    checkout: Repo.getRoot(),
    args: [],
    state: 'starting',
    children: [supervisor, worker],
    controller: holder,
    createdAt: 'source',
    updatedAt: 'source',
    devices: [{ platform: 'ios', id, owned: true, state: 'reserved', resources: [owner] }],
  }
  const identities = new Map([holder, supervisor, native].map(process => [process.pid, process]))
  const groups = new Map([[supervisor.pid, supervisor.pid], [worker.pid, supervisor.pid]])
  const tree = {
    identities: (pids: readonly number[]) =>
      new Map(pids.flatMap(pid => identities.has(pid) ? [[pid, identities.get(pid)!] as const] : [])),
    sameProcess: ProcessTree.sameProcess,
    processGroupOf: (pid: number) => groups.get(pid),
    groupMembers: (group: number) => [...identities.values()].filter(process => groups.get(process.pid) === group),
    descendants: (_pid: number) => [native],
  }
  return {
    observation,
    context: { invocation, scope, stage: 'boot' as const, asset, receipt },
    identities,
    groups,
    tree,
  }
}

for (const binding of ['exact', 'wrong-udid', 'not-quiet'] as const) {
  Test(`native private worker ${binding} preserves minted target intent before allocating a replacement child`, () => {
    const f = nativeStopSourceFixture()
    f.context.asset.state = 'prepared'
    let allocations = 0
    const start: typeof CLI.start = (command, spec) => {
      allocations++
      Expect(command).toBe(Platform.runtimeProcess.execPath)
      Expect(spec?.args).toEqual([
        Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts'),
        f.context.invocation,
        f.context.scope,
        'worker',
      ])
      return {} as CLI.StartedCommand
    }
    const replacing = () =>
      startManagedIosNativeFaultWorker({
        invocation: f.context.invocation,
        scope: f.context.scope,
        asset: f.context.asset,
        credentials: '/owned-source/credentials.json',
        shouldStop: () => false,
        spec: {
          env: {
            TAO_AGENT_SIMULATOR_QUIET: binding === 'not-quiet' ? '0' : '1',
            TAO_AGENT_SIMULATOR_UDID: binding === 'wrong-udid' ? Platform.randomUUID() : f.observation.id,
            TAO_DEV_LOOP_WORKER_CREDENTIALS: '/owned-source/credentials.json',
          },
        },
      }, start)
    if (binding === 'exact') {
      replacing()
      Expect(allocations).toBe(1)
    } else {
      Expect(replacing).toThrow('exact prepared managed target')
      Expect(allocations).toBe(0)
    }
  })
}

for (const mode of ['held', 'released-shell', 'launcher', 'completed', 'simctl'] as const) {
  Test(`semantic openurl execution observer ${mode} distinguishes ACK from current native execution`, async () => {
    const f = nativeStopSourceFixture()
    const eventRoot = Repo.resolvePath(`.artifacts/native-stop-source/${f.context.receipt.session}`)
    await FS.mkdir(eventRoot)
    // This is an execution-observer model; it never launches a native command.
    const command = {
      error: undefined,
      exitCode: mode === 'completed' ? 0 : null,
      signalCode: null,
    } as CLI.StartedCommand
    const capture: FixedIosLaunchCapture = {
      stage: 'openurl',
      phase: mode === 'held' ? 'held' : 'released',
      command,
      root: f.observation.worker,
      processes: [f.observation.worker],
    }
    const bootstrap = { pid: 71_009, startedAt: 'bootstrap', command: 'launchd_sim' }
    f.context.asset.state = 'prepared'
    f.context.asset.bootstrap = bootstrap
    f.identities.set(bootstrap.pid, bootstrap)
    f.identities.set(capture.root.pid, {
      ...capture.root,
      command: mode === 'simctl' ? 'simctl' : mode === 'launcher' ? 'xcrun' : 'sh',
    })
    const events: unknown[] = []
    let stopChecks = 0
    let reads = 0
    try {
      await observeManagedIosNativeOpenurl({
        capture,
        invocation: f.context.invocation,
        scope: f.context.scope,
        session: f.context.receipt.session,
        eventRoot,
        generation: () => f.context.receipt.generation,
        shouldStop: () => ++stopChecks > 2,
        asset: async () => f.context.asset,
        receipt: async () => f.context.receipt,
        record: async event => {
          events.push(event)
        },
      }, {
        tree: f.tree,
        readOwner: async () => {
          reads++
          return f.observation.owners[0]
        },
      })
      if (mode === 'simctl') {
        Expect(events).toContainEqual(
          Expect['objectContaining']({ event: 'ios-native-executing', stage: 'openurl', id: f.observation.id }),
        )
        Expect(reads).toBe(1)
        Expect(await FS.readJson(FS.resolvePath('ios-native-execution.json', eventRoot))).toEqual(
          Expect['objectContaining']({ stage: 'openurl', native: Expect['objectContaining']({ command: 'simctl' }) }),
        )
      } else {
        Expect(events).toEqual([])
        Expect(reads).toBe(0)
        Expect(await FS.exists(FS.resolvePath('ios-native-execution.json', eventRoot))).toBe(false)
      }
    } finally {
      await FS.remove(eventRoot)
    }
  })
}

for (const fault of ['inspection', 'sync-record', 'async-record'] as const) {
  Test(`control-API stop still cancels and disposes despite native stop-entry ${fault} failure`, async () => {
    const f = nativeStopSourceFixture()
    const receipt = { ...f.context.receipt, children: [], devices: [], controller: undefined }
    const entered = Deferred<void>()
    let cancelled = false
    const events: unknown[] = []
    const stop = createManagedIosNativeStopEntry({
      ...f.context,
      eventRoot: Repo.resolvePath(`.artifacts/native-stop-source/${receipt.session}`),
      receipt,
      record: event => {
        events.push(event)
        if (fault === 'sync-record') {
          Errors.throwHostEnvironment('source synchronous publication failure')
        }
        return fault === 'async-record'
          ? Promise.reject(new Errors.HostEnvironmentError('source asynchronous publication failure'))
          : Promise.resolve()
      },
    }, { readText: () => Errors.throwHostEnvironment('source observation disappeared') })
    const controller = await runDevLoopController(receipt, {
      onStop: stop.onStop,
      runAppDev: async (_args, _operations, managed) => {
        entered.resolve()
        await Time.pollUntil(() => managed?.shouldStop(), { intervalMs: 25, timeoutMs: 10_000 })
        cancelled = managed?.shouldStop() === true
        return 0
      },
    })
    try {
      await entered.promise
      const stopped = await devLoopRequest<DevLoopReceipt>(await readDevLoopConnection(receipt.session), '/command', {
        action: 'stop',
      })
      await controller.waitForDisposal()
      if (fault === 'inspection') {
        await stop.flush()
      } else {
        await Expect(stop.flush()).rejects.toThrow('publication failure')
      }
      Expect(stopped.state).toBe('stopped')
      Expect(cancelled).toBe(true)
      Expect(events).toContainEqual(Expect['objectContaining']({ event: 'ios-native-stop-entry', proved: false }))
      Expect((await readDevLoopReceipt(receipt.session)).cleanupOutcome).toBe('proved')
    } finally {
      await controller.close()
      await FS.remove(devLoopDirectory(receipt.session))
    }
  })
}

for (const failure of ['sync', 'async'] as const) {
  Test(`native stop-entry ${failure} publication failure cannot throw before cancellation`, async () => {
    const f = nativeStopSourceFixture()
    const error = new Errors.HostEnvironmentError('source publication failure')
    const stop = createManagedIosNativeStopEntry({
      ...f.context,
      eventRoot: '/owned-source',
      record: event => {
        Expect(event).toEqual(Expect['objectContaining']({ proved: true }))
        if (failure === 'sync') {
          throw error
        }
        return Promise.reject(error)
      },
    }, {
      readText: path => JSON.stringify(path.endsWith('asset.json') ? f.context.asset : f.observation),
      tree: f.tree,
    })
    Expect(stop.onStop).not.toThrow()
    await Expect(stop.flush()).rejects.toBe(error)
  })
}

for (
  const refusal of [
    'none',
    'held-shell',
    'launcher',
    'exit',
    'replacement',
    'group',
    'loop',
    'action',
    'command-capture',
    'target',
    'inspection',
    'foreign-member',
  ] as const
) {
  Test(`semantic native stop-entry ${refusal} requires current simctl and exact ownership anchors`, () => {
    const f = nativeStopSourceFixture()
    if (refusal === 'held-shell' || refusal === 'launcher') {
      f.identities.set(f.observation.native.pid, {
        ...f.observation.native,
        command: refusal === 'held-shell' ? 'sh' : 'xcrun',
      })
    }
    if (refusal === 'exit') {
      f.identities.delete(f.observation.native.pid)
    }
    if (refusal === 'replacement') {
      f.identities.set(f.observation.native.pid, { ...f.observation.native, startedAt: 'replacement' })
    }
    if (refusal === 'group') {
      f.groups.set(f.observation.native.pid, 71_099)
    }
    if (refusal === 'command-capture') {
      f.context.asset.actions[0]!.barrier!.worker = { ...f.observation.worker, startedAt: 'other command' }
    }
    if (refusal === 'loop') {
      f.context.receipt.generation = Platform.randomUUID()
    }
    if (refusal === 'action') {
      f.context.asset.actions[0]!.generation = Platform.randomUUID()
    }
    if (refusal === 'target') {
      f.context.asset.id = Platform.randomUUID()
    }
    if (refusal === 'inspection') {
      f.tree.identities = () => Errors.throwHostEnvironment('Source unreadable native kernel')
    }
    if (refusal === 'foreign-member') {
      const stranger = { pid: 71_004, startedAt: 'stranger', command: 'source peer' }
      f.identities.set(stranger.pid, stranger)
      f.groups.set(stranger.pid, f.observation.group)
    }
    const peer = { pid: 71_005, startedAt: 'preserved peer', command: 'source peer' }
    f.identities.set(peer.pid, peer)
    const result = inspectManagedIosNativeStopObservation(f.observation, f.context, f.tree)
    Expect(result.proved).toBe(refusal === 'none')
    Expect(f.identities.get(peer.pid)).toEqual(peer)
    if (refusal === 'none') {
      Expect(result.native?.command).toBe('simctl')
    } else {
      Expect(result.reason).toBeDefined()
    }
  })
}
for (const exitsDuringWalk of [false, true]) {
  Test(
    `semantic native descendant stop-entry ${
      exitsDuringWalk ? 'refuses crossed worker exit' : 'requires guarded captured ancestry'
    }`,
    () => {
      const f = nativeStopSourceFixture()
      const native = { pid: 71_006, startedAt: 'native child', command: 'simctl' }
      f.identities.set(f.observation.worker.pid, { ...f.observation.worker, command: 'xcrun' })
      f.identities.set(native.pid, native)
      f.groups.set(native.pid, f.observation.group)
      f.observation.native = native
      f.observation.processes = [...f.observation.processes, native]
      f.context.asset.actions[0]!.barrier!.processes.push(native)
      f.tree.descendants = () => {
        if (exitsDuringWalk) {
          f.identities.delete(f.observation.worker.pid)
        }
        return [native]
      }
      Expect(inspectManagedIosNativeStopObservation(f.observation, f.context, f.tree).proved).toBe(!exitsDuringWalk)
    },
  )
}

Test(
  'actual private adapter proves failed child cleanup before disposed-holder recovery and waits through failure-before-finally race',
  async () => {
    const invocation = Platform.randomUUID()
    const id = Platform.randomUUID()
    const session = Platform.randomUUID()
    const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`)
    const eventRoot = FS.resolvePath(`faults/${id}`, root)
    await FS.mkdir(eventRoot)
    const gate = FS.resolvePath('release-cleanup', eventRoot)
    const workerPath = FS.resolvePath('finite-source-worker.ts', eventRoot)
    const controlModule = Repo.resolvePath('packages/shared/shared-src/DevLoopControl.ts')
    const storeModule = Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopStore.ts')
    const sharedModule = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const receipt: DevLoopReceipt = {
      version: 1,
      session,
      checkout: await FS.realPath(Repo.getRoot()),
      generation: Platform.randomUUID(),
      state: 'starting',
      args: ['/source-project', '--app', 'DataMVPApp'],
      selection: { projectRoot: '/source-project', appPath: '/source-project/Data MVP.tao', appName: 'DataMVPApp' },
      createdAt: 'stamp',
      updatedAt: 'stamp',
      children: [],
    }
    await writeDevLoopReceipt(receipt)
    await FS.writeText(
      workerPath,
      `
    import { connectDevLoopWorker } from ${JSON.stringify(controlModule)};
    import { Errors, FS, Platform, Time } from ${JSON.stringify(sharedModule)};
    const hooks = await connectDevLoopWorker(Platform.runtimeProcess.env.TAO_DEV_LOOP_WORKER_CREDENTIALS);
    await hooks.emit({ type: 'failed', message: 'Intentionally injected source metro-failure before finally cleanup.' });
    try {
      const released = await Time.pollUntil(async () => await FS.exists(${
        JSON.stringify(gate)
      }) ? true : undefined, { intervalMs: 20, timeoutMs: 10000 });
      if (!released) Errors.throwHostEnvironment('The source cleanup gate timed out.');
    } finally { await hooks.close(); }
    Platform.runtimeProcess.setExitCode(1);
  `,
    )
    const source = `
    import { CLI, Errors, Platform } from ${JSON.stringify(sharedModule)};
    import { runDevLoopController } from ${
      JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopController.ts'))
    };
    import { createManagedLoopFaultWorker } from ${
      JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts'))
    };
    import { readDevLoopReceipt } from ${JSON.stringify(storeModule)};
    const worker = createManagedLoopFaultWorker({ invocation: ${JSON.stringify(invocation)}, id: ${
      JSON.stringify(id)
    }, session: ${JSON.stringify(session)}, scenario: 'metro-failure', eventRoot: ${
      JSON.stringify(eventRoot)
    }, record: async () => {} }, {
      liveOperations: () => ({ acquireResource: async () => { Errors.throwHostEnvironment('Source adapter has no target resources'); }, tryAcquireResource: async () => undefined,
        onSignal: Platform.onProcessSignal, run: CLI.run, write: () => {}, writeError: () => {},
        start: (_fixedCommand, spec) => CLI.start(Platform.runtimeProcess.execPath, { ...spec, args: [${
      JSON.stringify(workerPath)
    }] }) })
    });
    const controller = await runDevLoopController(await readDevLoopReceipt(${
      JSON.stringify(session)
    }), { runAppDev: worker });
    await controller.waitForDisposal();
  `
    const controller = CLI.start(Platform.runtimeProcess.execPath, {
      args: ['--eval', source],
      cwd: Repo.getRoot(),
      detached: true,
      processPolicy: 'test',
      stdio: 'pipe',
      timeoutMs: 15_000,
    })
    let disposed: Promise<DevLoopReceipt> | undefined
    let returned = false
    try {
      const failed = await until(async () => {
        const current = await readDevLoopReceipt(session)
        return current.state === 'failed' ? current : undefined
      }, { description: 'private source worker failure publication' })
      Expect(failed.controllerDisposed).not.toBe(true)
      Expect(failed.provenance).toBe('uncertain')
      Expect(
        ProcessTree.sameProcess(
          ProcessTree.identities([failed.controller!.pid]).get(failed.controller!.pid),
          failed.controller!,
        ),
      ).toBe(true)
      disposed = waitManagedLoopStartupFailureDisposal(failed).then(value => {
        returned = true
        return value
      })
      await Time.sleep(150)
      Expect(returned).toBe(false)
      await FS.writeText(gate, 'owned source gate released\n')
      const closed = await controller.waitForClose()
      Expect(closed.exitCode).toBe(0)
      const completed = await disposed
      Expect(completed.controllerDisposed).toBe(true)
      Expect(completed.provenance).toBe('complete')
      Expect(completed.children).toHaveLength(1)
      Expect(completed.processGroups).toHaveLength(1)
      Expect(ProcessTree.identities(completed.children.map(child => child.pid)).size).toBe(0)
      const recovered = await withCapturedOutput(() => runDevLoopCommand(['stop', '--session', session, '--json']))
      Expect(recovered.result).toBe(0)
      Expect((await readDevLoopReceipt(session)).cleanupOutcome).toBe('proved')
    } finally {
      await FS.writeText(gate, 'owned source final release\n')
      await controller.waitForClose()
      await disposed?.catch(() => {})
      await controller.closeOutput()
      controller.dispose()
      await FS.remove(devLoopDirectory(session))
      await FS.remove(root)
    }
  },
)
import type { AgentAppDevOperations } from '../dev-cli-src/simulators/AgentAppDev'

Test(
  'actual borrowed iOS producer admits its live retained sentinel and refuses failed, foreign, completed or replaced ownership',
  async () => {
    const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${Platform.randomUUID()}`)
    await FS.mkdir(root)
    await FS.chmod(root, 0o700)
    const registryRoot = FS.resolvePath('source-registry', root)
    const owner = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)!
    const own = Platform.randomUUID()
    const peer = Platform.randomUUID()
    const bootstrap: TrackedProcess = { pid: 2 ** 29, startedAt: 'source-sentinel-bootstrap', command: 'launchd_sim' }
    let created = false
    let booted = false
    let mintedName = ''
    let admissionCalls = 0
    let replaceKernel = false
    const commands: string[][] = []
    const scoped = <T extends object>(request: T) => ({ ...request, registryRoot })
    const operations: ManagedLoopTargetBorrowingSourceOperations = {
      runSync: () =>
        Errors.throwUnexpected('The borrowed iOS source fixture must not dispatch synchronous native work.'),
      resources: {
        acquire: request => MachineResources.acquire(scoped(request)),
        tryAcquire: request => MachineResources.tryAcquire(scoped(request)),
        readOwner: request => MachineResources.readOwner(scoped(request)),
        retain: request => MachineResources.retain(scoped(request)),
        recoverRetained: request => MachineResources.recoverRetained(scoped(request)),
        withCurrentOwners: (request, action) => MachineResources.withCurrentOwners(scoped(request), action),
      },
      inventory: async () => ({ processCount: 1, peers: [], resources: [] }),
      tree: {
        ...ProcessTree,
        identities: pids =>
          new Map(pids.flatMap(pid =>
            pid === bootstrap.pid
              ? booted
                ? [[pid, { ...bootstrap, ...(replaceKernel ? { startedAt: 'replacement' } : {}) }] as const]
                : []
              : [...ProcessTree.identities([pid])]
          )),
      },
      start: () => Errors.throwUnexpected('This source producer must not spawn.'),
      run: async (command, spec = {}) => {
        const args = [...spec.args ?? []]
        commands.push([command, ...args])
        Expect(command).toBe('xcrun')
        let stdout = ''
        if (args[1] === 'list') {
          stdout = JSON.stringify({
            devices: {
              'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
                { udid: peer, name: 'Developer iPhone', state: 'Booted', deviceTypeIdentifier: 'iPhone-type' },
                ...(created
                  ? [{
                    udid: own,
                    name: mintedName,
                    deviceTypeIdentifier: 'iPhone-type',
                    state: booted ? 'Booted' : 'Shutdown',
                  }]
                  : []),
              ],
            },
          })
        } else if (args[1] === 'create') {
          created = true
          mintedName = args[2]!
          stdout = own
        } else {
          Expect(args[2]).toBe(own)
          if (args[1] === 'boot') {
            booted = true
          }
          if (args[1] === 'spawn') {
            stdout = String(bootstrap.pid)
          }
          if (args[1] === 'shutdown') {
            booted = false
          }
          if (args[1] === 'delete') {
            created = false
          }
        }
        return { command, args, exitCode: 0, stdout, stderr: '', signal: null }
      },
    }
    try {
      operations.iosRuntime = managedIosRuntimeSourceOperations(operations)
      const evidence = await withOwnedBorrowedTargetSourceRegression('ios', root, async id => {
        const admission = {
          run: operations.run,
          identities: operations.tree.identities,
          evidenceKind: 'source regression' as const,
        }
        const receiptPath = FS.resolvePath('borrowed-ios/receipt.json', root)
        const live = await FS.readJson<Record<string, unknown>>(receiptPath)
        Expect(live['cleanup']).toBe('retained')
        Expect(live['preserved']).toBe(false)
        await assertManagedLoopBorrowedIosAdmission({ artifactRoot: root, id, owner }, admission)
        admissionCalls++
        for (
          const mutation of [
            { cleanup: 'not allocated' },
            { cleanup: 'complete' },
            { preserved: true },
            { detail: 'Failed sentinel cleanup' },
            { unresolved: [{ name: `ios-simulator:${id}`, generation: Platform.randomUUID() }] },
            { id: peer },
            { artifacts: FS.resolvePath('borrowed-ios', Repo.resolvePath('.artifacts/foreign')) },
          ]
        ) {
          await FS.writeJson(receiptPath, { ...live, ...mutation }, { mode: 0o600 })
          await Expect(assertManagedLoopBorrowedIosAdmission({ artifactRoot: root, id, owner }, admission)).rejects
            .toThrow('exact live invocation-created')
        }
        await FS.writeJson(receiptPath, live, { mode: 0o600 })
        replaceKernel = true
        await Expect(assertManagedLoopBorrowedIosAdmission({ artifactRoot: root, id, owner }, admission)).rejects
          .toThrow('bootstrap kernel identity')
        replaceKernel = false
        await Expect(
          assertManagedLoopBorrowedIosAdmission({
            artifactRoot: root,
            id,
            owner: { ...owner, startedAt: 'lost owner' },
          }, admission),
        ).rejects.toThrow('live invocation owner')
        // Source receipts cannot cross the ordinary real-host boundary, even with a valid simulated kernel.
        await Expect(
          assertManagedLoopBorrowedIosAdmission({ artifactRoot: root, id, owner }, {
            ...admission,
            evidenceKind: undefined,
          }),
        ).rejects.toThrow('exact live invocation-created')
        await assertManagedLoopBorrowedIosAdmission({ artifactRoot: root, id, owner }, admission)
        admissionCalls++
      }, operations)
      Expect(admissionCalls).toBe(2)
      Expect(evidence.detail).toBeUndefined()
      Expect(evidence.preserved).toBe(true)
      Expect(evidence.cleanup).toBe('complete')
      Expect(created).toBe(false)
      Expect(
        commands.filter(args => ['boot', 'spawn', 'shutdown', 'delete'].includes(args[2]!)).every(args =>
          args[3] === own
        ),
      ).toBe(true)
      Expect(await MachineResources.listOwners({ registryRoot })).toEqual([])
    } finally {
      await FS.remove(root)
    }
  },
)

function androidOperationsFixture() {
  const invocation = Platform.randomUUID()
  const claims: string[] = []
  const releases: string[] = []
  const commands: string[][] = []
  const leases = new Map<string, MachineResourceLease>()
  const lease = (name: string): MachineResourceLease => {
    const generation = Platform.randomUUID()
    const value: MachineResourceLease = {
      generation,
      owner: {
        id: generation,
        name,
        pid: 12,
        startedAt: 'fixture',
        command: 'source fixture',
        repositoryRoot: Repo.getRoot(),
      },
      assertCurrent: async supplied => {
        Expect(supplied).toBe(generation)
      },
      release: async () => {
        releases.push(name)
      },
    }
    leases.set(name, value)
    return value
  }
  let starts = 0
  let probes = 0
  let secondProbeBusy = false
  const operations: AgentAppDevOperations = {
    acquireResource: async request => {
      claims.push(request.name)
      return lease(request.name)
    },
    tryAcquireResource: async request => {
      claims.push(request.name)
      return lease(request.name)
    },
    onSignal: () => () => {},
    start: () => {
      starts++
      return Errors.throwUnexpected('Source private Android operations must not spawn.')
    },
    write: () => {},
    writeError: () => {},
    run: async (command, spec = {}) => {
      commands.push([command, ...spec.args ?? []])
      probes++
      return {
        command,
        args: [...spec.args ?? []],
        exitCode: secondProbeBusy && probes === 2 ? 0 : 1,
        signal: null,
        stderr: '',
        stdout: secondProbeBusy && probes === 2 ? 'p999\n' : '',
      }
    },
  }
  return {
    invocation,
    claims,
    releases,
    commands,
    operations,
    leases,
    starts: () => starts,
    busyAfterReservation: () => {
      secondProbeBusy = true
    },
  }
}

Test('only the closed private visible Android kind appends the emulator visibility flag', () => {
  const fixture = { root: '/owned-source', appPath: '/owned-source/Data MVP.tao', sourceIdentity: 'source fixture' }
  Expect(managedLoopFaultArgs(fixture, 'android-owned-visible')).toEqual([
    '/owned-source',
    '--app',
    'DataMVPApp',
    '--android',
    '--show-emulator',
  ])
  for (const kind of ['android-owned-normal', 'android-owned-parallel', 'mobile-android-driver-failure'] as const) {
    Expect(managedLoopFaultArgs(fixture, kind)).toEqual(['/owned-source', '--app', 'DataMVPApp', '--android'])
  }
})

Test(
  'fault event publication serializes held writes and exposes only complete sanitized ordered snapshots',
  async () => {
    const started = Deferred()
    const release = Deferred()
    const snapshots: unknown[] = []
    const moves: string[] = []
    const recorder = createManagedLoopFaultRecorder(
      Repo.resolvePath('.artifacts/tests/managed-fault-recorder'),
      'worker',
      {
        write: async (path, content) => {
          snapshots.push(content)
          Expect(path.endsWith('.tmp')).toBe(true)
          if (snapshots.length === 1) {
            started.resolve()
            await release.promise
          }
        },
        move: async (_from, to) => {
          moves.push(to)
        },
      },
    )
    const first = recorder({ event: 'dispatch-start', token: 'must-not-publish' })
    await started.promise
    const second = recorder({ event: 'stop-start' })
    try {
      await settle()
      Expect(snapshots).toHaveLength(1)
      Expect(moves).toEqual([])
    } finally {
      release.resolve()
      await Promise.all([first, second])
    }
    Expect(snapshots).toEqual([[{ event: 'dispatch-start' }], [{ event: 'dispatch-start' }, { event: 'stop-start' }]])
    Expect(moves).toEqual([
      Repo.resolvePath('.artifacts/tests/managed-fault-recorder/worker-events.json'),
      Repo.resolvePath('.artifacts/tests/managed-fault-recorder/worker-events.json'),
    ])
  },
)

Test(
  'combined private admission translates only the simulator pool and allows only its minted borrowed UDID before touching registry',
  async () => {
    const world = androidOperationsFixture()
    const borrowedIos = Platform.randomUUID()
    const unrelated = Platform.randomUUID()
    const baseline = ['android-avd:Tao_Agent_Pixel_1', 'android-emulator:emulator-5554', `ios-simulator:${unrelated}`]
    const guarded = managedLoopAndroidOperations({
      invocation: world.invocation,
      eventRoot: '/source-only',
      baselineResources: baseline,
      operations: world.operations,
      borrowedIos,
      record: async () => {},
    })
    for (const name of [...baseline, `ios-simulator:${Platform.randomUUID()}`, 'tao-agent-android-pool']) {
      await Expect(guarded.acquireResource({ name, command: 'source-only admission', repositoryRoot: Repo.getRoot() }))
        .rejects.toThrow('refuses')
      await Expect(guarded.tryAcquireResource({ name })).rejects.toThrow('refuses')
    }
    Expect(world.claims).toEqual([])
    await guarded.acquireResource({
      name: 'tao-agent-simulator-pool',
      command: 'source-only admission',
      repositoryRoot: Repo.getRoot(),
    })
    await guarded.tryAcquireResource({ name: `ios-simulator:${borrowedIos}` })
    Expect(world.claims).toEqual([
      `tao-agent-simulator-pool:${managedLoopAndroidPrefix(world.invocation)}`,
      `ios-simulator:${borrowedIos}`,
    ])
    Expect(world.releases).toEqual([])
    Expect(world.starts()).toBe(0)
  },
)

Test(
  'combined fixed worker starts only after published borrowed iOS and owned private Android allocation and preserves authenticated env',
  async () => {
    const world = androidOperationsFixture()
    const id = Platform.randomUUID()
    const session = Platform.randomUUID()
    const borrowedIos = Platform.randomUUID()
    const fixture = { root: '/owned-source', appPath: '/owned-source/Data MVP.tao', sourceIdentity: 'source' }
    const child = {} as CLI.StartedCommand
    const starts: { command: string; spec: CLI.CommandSpec }[] = []
    const published: string[] = []
    let stopping = false
    const credentials = FS.resolvePath('active-control/credentials.json', devLoopDirectory(session))
    const worker = createManagedLoopFaultWorker({
      invocation: world.invocation,
      id,
      session,
      scenario: 'combined-web-failure',
      fixture,
      borrowedIos,
      eventRoot: Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${world.invocation}/faults/${id}`),
      baselineResources: ['android-emulator:emulator-5554'],
      record: async () => {},
    }, {
      liveOperations: () => ({
        ...world.operations,
        start: (command, spec = {}) => {
          starts.push({ command, spec })
          return child
        },
      }),
      runAppDev: async (args, operations, managed) => {
        Expect(args).toEqual(managedLoopFaultArgs(fixture, 'combined-web-failure', borrowedIos))
        const start = () =>
          operations!.start(Repo.resolvePath('tao'), {
            env: managed!.childEnv,
            detached: true,
            stdio: 'pipe',
            onOutput: managed!.onOutput,
          })
        Expect(start).toThrow('both current invocation-owned mobile reservations')
        await managed!.onDevice!({ platform: 'ios', id: borrowedIos, state: 'booted', owned: false })
        Expect(start).toThrow('both current invocation-owned mobile reservations')
        const reservation = await operations!.launchReservation!(`${managedLoopAndroidPrefix(world.invocation)}1`)
        await managed!.onDevice!({
          platform: 'android',
          id: `emulator-${reservation.consolePort}`,
          state: 'booted',
          owned: true,
          avdName: `${managedLoopAndroidPrefix(world.invocation)}1`,
          resources: [reservation.serialLease.owner],
        })
        Expect(start()).toBe(child)
        stopping = true
        Expect(start).toThrow('cancelled before dispatch')
        return 0
      },
    })
    const exit = await worker(managedLoopFaultArgs(fixture, 'combined-web-failure', borrowedIos), undefined, {
      childEnv: { TAO_DEV_LOOP_WORKER_CREDENTIALS: credentials, TAO_AGENT_BROWSER_QUIET: '1' },
      shouldStop: () => stopping,
      onChild: async () => {},
      onOutput: () => {},
      onDevice: async device => {
        published.push(device.platform)
      },
    })
    Expect(exit).toBe(0)
    Expect(published).toEqual(['ios', 'android'])
    Expect(starts).toHaveLength(1)
    Expect(starts[0]!.command).toBe(Platform.runtimeProcess.execPath)
    Expect(starts[0]!.spec.args).toEqual([
      Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts'),
      world.invocation,
      id,
      'worker',
    ])
    Expect(starts[0]!.spec.env?.['TAO_DEV_LOOP_WORKER_CREDENTIALS']).toBe(credentials)
    Expect(starts[0]!.spec.detached).toBe(true)
    Expect(world.releases).toEqual([])
  },
)

for (const outcome of ['preparation-failure', 'publication-failure', 'output-closure-failure'] as const) {
  Test(`private iOS registered finite groups preserve controller cleanup authority after ${outcome}`, async () => {
    const invocation = Platform.randomUUID()
    const id = Platform.randomUUID()
    const session = Platform.randomUUID()
    const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`)
    const eventRoot = FS.resolvePath(`faults/${id}`, root)
    await FS.mkdir(eventRoot)
    const registryRoot = FS.resolvePath('registry', root)
    const owned = Platform.randomUUID()
    const sourceEvidence = FS.resolvePath('source-evidence.json', root)
    const record: DevLoopReceipt = {
      version: 1,
      session,
      checkout: await FS.realPath(Repo.getRoot()),
      generation: Platform.randomUUID(),
      state: 'starting',
      args: ['/source-owned-ios', '--app', 'DataMVPApp', '--ios'],
      selection: { projectRoot: '/source-owned-ios', appPath: '/source-owned-ios/Data MVP.tao', appName: 'DataMVPApp' },
      createdAt: 'stamp',
      updatedAt: 'stamp',
      children: [],
    }
    await writeDevLoopReceipt(record)
    const source = `
      import { CLI, Errors, FS, Platform, ProcessTree, Repo } from ${
      JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))
    };
      import { MachineResources } from ${
      JSON.stringify(Repo.resolvePath('packages/testing/host-control/host-control-src/host-control.ts'))
    };
      import { runDevLoopController } from ${
      JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopController.ts'))
    };
      import { createManagedLoopFaultWorker } from ${
      JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopAcceptanceFaults.ts'))
    };
      import { readDevLoopReceipt } from ${
      JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopStore.ts'))
    };
      import { managedIosRuntimeRealChildSourceOperations, managedIosRuntimeSourceStage } from ${
      JSON.stringify(
        Repo.resolvePath('packages/cli/dev-cli/dev-cli-tests/managed-loop-acceptance-ios-runtime-fixture.ts'),
      )
    };
      let created = false, booted = false, name = '', taoStarts = 0, registered = 0;
      const stages = [], captureFailures = [];
      const bootstrap = {pid: 2 ** 29, startedAt: 'owned-source-ios-bootstrap', command: 'launchd_sim'};
      const result = stdout => ({command: 'source target', args: [], stdout, stderr: '', exitCode: 0, signal: null});
      const scope = options => ({...options, registryRoot: ${JSON.stringify(registryRoot)}});
      const resources = {
        acquire: options => MachineResources.acquire(scope(options)),
        retain: options => MachineResources.retain(scope(options)),
        recoverRetained: options => MachineResources.recoverRetained(scope(options)),
        readOwner: options => MachineResources.readOwner(scope(options)),
        withCurrentOwners: (options, action) => MachineResources.withCurrentOwners(scope(options), action),
      };
      const tree = {...ProcessTree, identities: pids => new Map(pids.flatMap(pid => pid === bootstrap.pid
        ? booted ? [[pid, {...bootstrap}]] : [] : [...ProcessTree.identities([pid])]))};
      const run = async (_command, spec) => {
        const args = spec?.args ?? [];
        if (args[1] === 'list') return result(JSON.stringify({devices: {'com.apple.CoreSimulator.SimRuntime.iOS-source': [
          {udid: '11111111-1111-1111-1111-111111111111', name: 'Preserved source iPhone', state: 'Booted', deviceTypeIdentifier: 'iPhone-type'},
          ...(created ? [{udid: ${
      JSON.stringify(owned)
    }, name, state: booted ? 'Booted' : 'Shutdown', deviceTypeIdentifier: 'iPhone-type'}] : [])]}}));
        if (args[1] === 'create') { created = true; name = args[2]; return result(${JSON.stringify(owned)}); }
        if (args[1] === 'boot') booted = true;
        if (args[1] === 'shutdown') booted = false;
        if (args[1] === 'spawn') return result(String(bootstrap.pid));
        return result('');
      };
      const runtime = managedIosRuntimeRealChildSourceOperations({run, tree, resources}, ${JSON.stringify(eventRoot)});
      const runtimeRun = runtime.run;
      runtime.run = async (command, spec) => command === 'plutil' && spec?.args?.[1] === 'CFBundleIdentifier'
        ? result('injected.invalid.publisher') : await runtimeRun(command, spec);
      const runtimeStart = runtime.start;
      runtime.start = (command, spec) => {
        const stage = managedIosRuntimeSourceStage(command, spec);
        stages.push(stage);
        const child = runtimeStart(command, spec);
        if (${JSON.stringify(outcome)} === 'output-closure-failure' && stage === 'download') {
          const close = child.closeOutput;
          child.closeOutput = async () => { await close(); Errors.throwHostEnvironment('Injected private output closure failure'); };
        }
        return child;
      };
      const worker = createManagedLoopFaultWorker({invocation: ${JSON.stringify(invocation)}, id: ${JSON.stringify(id)},
        session: ${JSON.stringify(session)}, scenario: 'ios-owned-normal', eventRoot: ${JSON.stringify(eventRoot)},
        baselineResources: [], record: async () => {}}, {
        iosRuntime: runtime,
        liveOperations: () => ({acquireResource: resources.acquire,
          tryAcquireResource: options => MachineResources.tryAcquire(scope(options)), retainResources: resources.retain,
          recoverResources: resources.recoverRetained, readResourceOwner: resources.readOwner,
          onSignal: Platform.onProcessSignal, run, write: () => {}, writeError: () => {},
          start: () => { taoStarts++; Errors.throwUnexpected('Private preparation failure must not dispatch Tao'); }}),
      });
      const controller = await runDevLoopController(await readDevLoopReceipt(${JSON.stringify(session)}), {
        runAppDev: (args, operations, managed) => worker(args, operations, {...managed,
          onChild: async (child, capture) => { registered++;
            try { await managed.onChild(child, capture); }
            catch (failure) {
              for (let current = failure, depth = 0; current && depth < 4; current = current.cause, depth++)
                captureFailures.push(current.message ?? String(current));
              throw failure;
            }
            if (${JSON.stringify(outcome)} === 'publication-failure' && registered === 3)
              Errors.throwHostEnvironment('Injected private child publication failure'); },
        }),
      });
      await controller.waitForDisposal();
      await FS.writeJson(${JSON.stringify(sourceEvidence)}, {taoStarts, registered, stages, booted,
        message: (await readDevLoopReceipt(${JSON.stringify(session)})).message, captureFailures});
    `
    const controller = CLI.start(Platform.runtimeProcess.execPath, {
      args: ['--eval', source],
      cwd: Repo.getRoot(),
      detached: true,
      processPolicy: 'test',
      stdio: 'pipe',
      timeoutMs: 30_000,
    })
    try {
      const exited = await controller.waitForClose()
      Expect(exited.exitCode).toBe(0)
      const evidence = await FS.readJson<
        {
          taoStarts: number
          registered: number
          stages: string[]
          booted: boolean
          message?: string
          captureFailures: string[]
        }
      >(
        sourceEvidence,
      )
      Expect(evidence.taoStarts).toBe(0)
      if (evidence.stages.length < 3) {
        Errors.throwUnexpected(
          `Source iOS admission stopped at ${evidence.stages.join(', ')}: ${evidence.message}; ${
            evidence.captureFailures.join('; ')
          }`,
        )
      }
      Expect(evidence.stages).toEqual(
        outcome === 'preparation-failure' ? ['create', 'boot', 'download', 'shutdown'] : ['create', 'boot', 'download'],
      )
      Expect(evidence.registered).toBe(evidence.stages.length)
      const failed = await readDevLoopReceipt(session)
      Expect(failed.controllerDisposed).toBe(true)
      Expect(failed.provenance).toBe(outcome === 'preparation-failure' ? 'complete' : 'uncertain')
      // Every fixed finite command, including the downloader, publishes both original kernels.
      Expect(failed.children).toHaveLength(evidence.registered * 2)
      Expect(failed.processGroups).toHaveLength(evidence.registered)
      Expect(ProcessTree.identities(failed.children.map(child => child.pid)).size).toBe(0)
      Expect(failed.processGroups?.some(group => ProcessTree.isGroupAlive(group.pid))).toBe(false)
      const recovered = await withCapturedOutput(() => runDevLoopCommand(['stop', '--session', session, '--json']))
      if (outcome === 'preparation-failure') {
        Expect(failed.ownershipRefusal).toBeUndefined()
        Expect(failed.devices?.[0]?.state).toBe('released')
        Expect(evidence.booted).toBe(false)
        Expect(recovered.result).toBe(0)
        Expect((await readDevLoopReceipt(session)).cleanupOutcome).toBe('proved')
      } else {
        Expect(failed.ownershipRefusal).toBeDefined()
        Expect(failed.ownershipRefusal?.generation).toBe(failed.generation)
        Expect(failed.ownershipRefusal?.reason).toContain(
          outcome === 'publication-failure'
            ? 'Injected private child publication failure'
            : 'Injected private output closure failure',
        )
        Expect(failed.devices?.[0]?.state).toBe('retained')
        Expect(evidence.booted).toBe(true)
        Expect(recovered.result).toBe(1)
        Expect((await readDevLoopReceipt(session)).cleanupOutcome).not.toBe('proved')
        Expect((await readDevLoopReceipt(session)).ownershipRefusal).toEqual(failed.ownershipRefusal)
        Expect(
          (await MachineResources.readOwner({ name: `ios-simulator:${owned}`, registryRoot }))?.retention?.quarantined,
        ).toBe(true)
      }
    } finally {
      await controller.waitForClose()
      await controller.closeOutput()
      controller.dispose()
      await FS.remove(devLoopDirectory(session))
      await FS.remove(root)
    }
  })
}

for (
  const scenario of [
    'android-owned-normal',
    'android-owned-parallel',
    'android-owned-visible',
    'ios-owned-normal',
    'ios-owned-parallel',
    'ios-owned-visible',
    'mobile-ios-driver-failure',
  ] as const
) {
  Test(`real controller undefined-operations launch reaches the protected ${scenario} worker`, async () => {
    const invocation = Platform.randomUUID()
    const id = Platform.randomUUID()
    const root = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${invocation}`)
    const eventRoot = FS.resolvePath(`faults/${id}`, root)
    const fixture = {
      root: '/owned-source',
      appPath: '/owned-source/Data MVP.tao',
      sourceIdentity: 'source regression',
    }
    const record: DevLoopReceipt = {
      version: 1,
      session: Platform.randomUUID(),
      checkout: await FS.realPath(Repo.getRoot()),
      args: managedLoopFaultArgs(fixture, scenario),
      selection: { appName: 'DataMVPApp', projectRoot: fixture.root, appPath: fixture.appPath },
      generation: Platform.randomUUID(),
      state: 'starting',
      createdAt: 'stamp',
      updatedAt: 'stamp',
      children: [],
    }
    let entered = 0
    const worker = createManagedLoopFaultWorker({
      invocation,
      id,
      session: record.session,
      scenario,
      eventRoot,
      baselineResources: ['android-avd:Tao_Agent_Pixel_1', 'android-emulator:emulator-5554'],
      record: async () => {},
    }, {
      iosRuntime: {
        run: async () => ({
          command: 'source iOS discovery',
          args: [],
          stdout: JSON.stringify({ devices: {} }),
          stderr: '',
          exitCode: 0,
          signal: null,
        }),
      },
      runAppDev: async (args, operations, managed) => {
        entered++
        Expect(args).toEqual(record.args)
        Expect(managed?.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']).toBe(
          FS.resolvePath('active-control/credentials.json', devLoopDirectory(record.session)),
        )
        Expect(typeof managed?.onChild).toBe('function')
        Expect(operations?.start).toBe(CLI.start)
        Expect(operations?.onSignal).toBe(Platform.onProcessSignal)
        if (scenario.startsWith('android-')) {
          Expect(operations?.avdPrefix).toBe(managedLoopAndroidPrefix(invocation))
          Expect(typeof operations?.launchReservation).toBe('function')
        } else {
          Expect(operations?.privateIos?.namePrefix).toBe(`Tao Managed ${invocation}_${id}_`)
          Expect(typeof operations?.prepareOwnedIosRuntime).toBe('function')
        }
        // Exercise the real controller callback boundary; no process/target runtime starts here.
        return 0
      },
    })
    const controller = await runDevLoopController(record, { runAppDev: worker })
    try {
      await controller.waitForDisposal()
      Expect(entered).toBe(1)
      Expect(record.message ?? '').not.toContain('Expected the private managed fault worker context')
    } finally {
      await controller.close()
      await FS.remove(devLoopDirectory(record.session))
      await FS.remove(root)
    }
  })
}

Test(
  'private worker still refuses missing or foreign managed capability before runtime and target acquisition',
  async () => {
    const world = androidOperationsFixture()
    const id = Platform.randomUUID()
    const session = Platform.randomUUID()
    const eventRoot = Repo.resolvePath(`.artifacts/host-acceptance/managed-loops/${world.invocation}/faults/${id}`)
    let entered = 0
    const worker = createManagedLoopFaultWorker({
      invocation: world.invocation,
      id,
      session,
      scenario: 'android-owned-normal',
      eventRoot,
      baselineResources: ['android-emulator:emulator-5554'],
      record: async () => {},
    }, {
      liveOperations: () => world.operations,
      runAppDev: async () => {
        entered++
        return 0
      },
    })
    await Expect(worker([])).rejects.toThrow('private managed fault worker context')
    await Expect(
      worker([], undefined, {
        childEnv: { TAO_DEV_LOOP_WORKER_CREDENTIALS: '/foreign/credentials.json' },
        onChild: async () => {},
        shouldStop: () => false,
        onOutput: () => {},
      }),
    ).rejects.toThrow('private managed fault worker context')
    Expect(entered).toBe(0)
    Expect(world.claims).toEqual([])
    Expect(world.starts()).toBe(0)
  },
)

Test(
  'private Android adapters refuse stale ordinary baseline names before registry acquisition or process control',
  async () => {
    const world = androidOperationsFixture()
    const prefix = managedLoopAndroidPrefix(world.invocation)
    const peers = [`android-avd:${prefix}1`, 'android-avd:Tao_Agent_Pixel_1', 'android-emulator:emulator-5554']
    const guarded = managedLoopAndroidOperations({
      invocation: world.invocation,
      eventRoot: Repo.resolvePath('.artifacts/tests/source-private-android'),
      baselineResources: peers,
      operations: world.operations,
      record: async () => {},
    })
    for (const name of peers) {
      await Expect(guarded.acquireResource({ name, command: 'source test', repositoryRoot: Repo.getRoot() })).rejects
        .toThrow('preserved baseline resource')
      await Expect(guarded.tryAcquireResource({ name })).rejects.toThrow('preserved baseline resource')
    }
    Expect(world.claims).toEqual([])
    Expect(world.releases).toEqual([])
    Expect(world.commands).toEqual([])
    Expect(world.starts()).toBe(0)
  },
)

Test(
  'private Android launch skips preserved serials and transfers a probed exclusive pair without releasing it',
  async () => {
    const world = androidOperationsFixture()
    const prefix = managedLoopAndroidPrefix(world.invocation)
    const guarded = managedLoopAndroidOperations({
      invocation: world.invocation,
      eventRoot: Repo.resolvePath('.artifacts/tests/source-private-android'),
      baselineResources: ['android-emulator:emulator-5554', 'android-emulator:emulator-5580'],
      operations: world.operations,
      record: async () => {},
    })
    await guarded.acquireResource({
      name: `tao-agent-android-pool:${prefix}`,
      command: 'source selection',
      repositoryRoot: Repo.getRoot(),
    })
    const reservation = await guarded.launchReservation!(`${prefix}1`)
    Expect(reservation.consolePort).toBe(5582)
    Expect(reservation.serialLease.owner.name).toBe('android-emulator:emulator-5582')
    Expect(world.claims).toEqual([`tao-agent-android-pool:${prefix}`, 'android-emulator:emulator-5582'])
    Expect(world.commands.map(command => command[2])).toEqual(['-iTCP:5582-5583', '-iTCP:5582-5583'])
    Expect(world.releases).toEqual([])
  },
)

Test(
  'private Android launch releases a pair occupied during reservation and transfers only the next re-proved pair',
  async () => {
    const world = androidOperationsFixture()
    world.busyAfterReservation()
    const prefix = managedLoopAndroidPrefix(world.invocation)
    const guarded = managedLoopAndroidOperations({
      invocation: world.invocation,
      eventRoot: Repo.resolvePath('.artifacts/tests/source-private-android'),
      baselineResources: [],
      operations: world.operations,
      record: async () => {},
    })
    const reservation = await guarded.launchReservation!(`${prefix}1`)
    Expect(reservation.consolePort).toBe(5582)
    Expect(world.releases).toEqual(['android-emulator:emulator-5580'])
    Expect(world.claims).toEqual(['android-emulator:emulator-5580', 'android-emulator:emulator-5582'])
  },
)

Test('private Android partial reservation failure releases its own untransferred lease without spawning', async () => {
  const world = androidOperationsFixture()
  const prefix = managedLoopAndroidPrefix(world.invocation)
  const guarded = managedLoopAndroidOperations({
    invocation: world.invocation,
    eventRoot: Repo.resolvePath('.artifacts/tests/source-private-android'),
    baselineResources: [],
    operations: world.operations,
    record: async () => {
      Errors.throwHostEnvironment('Owned durable reservation publication unavailable')
    },
  })
  await Expect(guarded.launchReservation!(`${prefix}1`)).rejects.toThrow('durable reservation publication unavailable')
  Expect(world.claims).toEqual(['android-emulator:emulator-5580'])
  Expect(world.releases).toEqual(['android-emulator:emulator-5580'])
  Expect(world.starts()).toBe(0)
})

Test('private Android asset uncertainty retains the AVD journal without acquisition, deletion or signals', async () => {
  const invocation = Platform.randomUUID()
  const root = Repo.resolvePath(`.artifacts/tests/${invocation}`)
  await FS.mkdir(root)
  const prefix = managedLoopAndroidPrefix(invocation)
  const avdName = `${prefix}1`
  const fixture = {
    root: FS.resolvePath('source', root),
    appPath: FS.resolvePath('source/Data MVP.tao', root),
    sourceIdentity: 'source-only',
  }
  const receipt: DevLoopReceipt = {
    version: 1,
    session: Platform.randomUUID(),
    checkout: Repo.getRoot(),
    args: [],
    generation: 'retained',
    state: 'cleanup-failed',
    createdAt: 'stamp',
    updatedAt: 'stamp',
    cleanupOutcome: 'retained',
    children: [],
    selection: { appName: 'DataMVPApp', projectRoot: fixture.root, appPath: fixture.appPath },
  }
  let claims = 0
  let mutators = 0
  await FS.writeJson(FS.resolvePath('android-assets.json', root), [{
    avdName,
    path: 'source-fixture-not-a-host-avd',
    owner: root,
    purpose: 'source regression',
    cleanupCondition: 'test cleanup',
    state: 'created',
  }])
  try {
    await Expect(
      cleanupManagedLoopAndroidAssets(
        { session: receipt.session, artifactRoot: root, baselineResources: [], fixture },
        root,
        {
          receipt: async () => receipt,
          identities: () => new Map(),
          readOwner: async () => {
            mutators++
            return undefined
          },
          tryAcquire: async () => {
            claims++
            return undefined
          },
          run: async () => {
            mutators++
            return Errors.throwUnexpected('Unproved assets must not reach host tooling.')
          },
        },
      ),
    ).rejects.toThrow('assets remain retained')
    Expect(claims).toBe(0)
    Expect(mutators).toBe(0)
    const assets = await FS.readJson<{ state: string }[]>(FS.resolvePath('android-assets.json', root))
    Expect(assets[0]!.state).toBe('retained')
  } finally {
    await FS.remove(root)
  }
})

for (
  const deletion of [
    'proved',
    'failed',
    'guard-finalizer-failure',
    'intent-publication-failure',
    'child-publication-failure',
    'output-close-failure',
  ] as const
) {
  Test(
    `private Android asset ${deletion} deletion uses a fresh generation and releases only proved cleanup`,
    async () => {
      const world = androidOperationsFixture()
      const root = Repo.resolvePath(`.artifacts/tests/${world.invocation}`)
      await FS.mkdir(root)
      const name = `${managedLoopAndroidPrefix(world.invocation)}1`
      const fixture = {
        root: FS.resolvePath('source', root),
        appPath: FS.resolvePath('source/Data MVP.tao', root),
        sourceIdentity: 'source-only',
      }
      const receipt: DevLoopReceipt = {
        version: 1,
        session: Platform.randomUUID(),
        checkout: Repo.getRoot(),
        args: [],
        generation: 'closed',
        state: 'stopped',
        createdAt: 'stamp',
        updatedAt: 'stamp',
        cleanupOutcome: 'proved',
        children: [],
        selection: { appName: 'DataMVPApp', projectRoot: fixture.root, appPath: fixture.appPath },
        devices: [{
          platform: 'android',
          id: 'emulator-5582',
          owned: true,
          state: 'released',
          avdName: name,
          generation: 'released-device-generation',
          resources: ['android-avd:' + name, 'android-emulator:emulator-5582'].map(resourceName => ({
            id: 'released-device-generation',
            name: resourceName,
            pid: 44,
            startedAt: 'closed',
            command: 'owned released target',
            repositoryRoot: Repo.getRoot(),
          })),
        }],
      }
      const events: string[] = []
      const deletionChild = { pid: 92_001, startedAt: 'owned-deletion-child', command: 'owned AVD deletion' }
      let childLive = false
      let retained: MachineResourceOwner | undefined
      let journal:
        | { deletion?: { state: string; resource: MachineResourceOwner; child?: typeof deletionChild } }
        | undefined
      await world.operations.acquireResource({
        name: `android-avd:${name}`,
        command: 'source-exclusive-cleanup',
        repositoryRoot: root,
      })
      const lease = world.leases.get(`android-avd:${name}`)!
      const currentOwners = new Map<string, MachineResourceOwner>()
      lease.assertCurrent = async generation => {
        Expect(generation).toBe(lease.generation)
        events.push('generation')
      }
      lease.release = async () => {
        events.push('release')
      }
      await FS.writeJson(FS.resolvePath('android-assets.json', root), [{
        avdName: name,
        path: 'source-fixture-not-a-host-avd',
        owner: root,
        purpose: 'source regression',
        cleanupCondition: 'test cleanup',
        state: 'created',
      }])
      try {
        const cleanup = cleanupManagedLoopAndroidAssets(
          {
            session: receipt.session,
            artifactRoot: root,
            baselineResources: ['android-avd:Tao_Agent_Pixel_1', 'android-emulator:emulator-5554'],
            fixture,
          },
          root,
          {
            receipt: async () => receipt,
            identities: () => new Map(childLive ? [[deletionChild.pid, deletionChild]] : []),
            groupAlive: () => childLive,
            readOwner: async request => currentOwners.get(request.name),
            tryAcquire: async request => {
              Expect([`android-avd:${name}`, 'android-emulator:emulator-5582']).toContain(request.name)
              events.push('acquire')
              if (request.name !== lease.owner.name) {
                await world.operations.tryAcquireResource!(request)
              }
              const acquired = request.name === lease.owner.name ? lease : world.leases.get(request.name)
              currentOwners.set(request.name, acquired!.owner)
              return acquired
            },
            withCurrentOwners: async (request, action) => {
              Expect(retained?.id).not.toBe(lease.owner.id)
              Expect(request.owners).toEqual([retained, { ...retained!, name: 'android-emulator:emulator-5582' }])
              events.push('guard')
              const result = action()
              if (deletion === 'guard-finalizer-failure') {
                Errors.throwHostEnvironment('Owned registry finalizer failure after synchronous spawn')
              }
              return result
            },
            start: (command, spec = {}) => {
              Expect(journal?.deletion?.state).toBe('intent')
              Expect(journal?.deletion?.resource).toEqual(retained)
              Expect(retained?.retention?.quarantined).toBe(true)
              Expect(retained?.retention?.processes).toEqual([])
              childLive = true
              events.push(command)
              Expect(spec.args).toEqual(['delete', 'avd', '--name', name])
              const exitCode = deletion === 'failed' ? 1 : 0
              return {
                command,
                pid: deletionChild.pid,
                args: [...spec.args ?? []],
                exitCode,
                signalCode: null,
                closeOutput: async () => {
                  if (deletion === 'output-close-failure') {
                    Errors.throwHostEnvironment('Injected cleanup output close failure')
                  }
                },
                dispose: () => {
                  events.push('disposed')
                },
                endStdin: () => {},
                kill: () => false,
                onceClose: listener => listener(exitCode, null),
                onceError: () => {},
                waitForClose: async () => {
                  Expect(journal?.deletion?.child).toEqual(deletionChild)
                  childLive = false
                  return { exitCode, signal: null }
                },
                writeStdin: () => false,
              }
            },
            run: async (command, spec = {}) => {
              events.push(command)
              if (command === 'avdmanager') {
                Expect(spec.args).toEqual(['delete', 'avd', '--name', name])
              }
              return {
                command,
                args: [...spec.args ?? []],
                exitCode: command === 'avdmanager' && deletion === 'failed' ? 1 : 0,
                signal: null,
                stdout: command === 'adb' ? 'List of devices attached\n' : '',
                stderr: '',
              }
            },
            retain: async request => {
              Expect(request.owners.map(owner => owner.name)).toEqual([
                lease.owner.name,
                'android-emulator:emulator-5582',
              ])
              Expect(request.quarantined).toBe(true)
              events.push(request.processes.length === 0 ? 'retain-unknown' : 'retain-child')
              retained = {
                ...lease.owner,
                id: Platform.randomUUID(),
                retention: {
                  processes: [...request.processes],
                  processGroupPid: request.processGroupPid,
                  quarantined: true,
                  reason: request.reason,
                  resourceNames: [lease.owner.name, 'android-emulator:emulator-5582'],
                },
              }
              for (const owner of request.owners) {
                currentOwners.set(owner.name, { ...retained, name: owner.name })
              }
              return retained
            },
            recover: async request => {
              Expect(request.generation).toBe(retained!.id)
              events.push('recover')
              Expect(await request.shutdown(retained!)).toBe(true)
            },
            writeAssets: async (path, assets) => {
              journal = structuredClone(assets[0])
              if (deletion === 'intent-publication-failure' && journal?.deletion?.state === 'intent') {
                Errors.throwHostEnvironment('Injected deletion intent journal unavailable')
              }
              if (deletion === 'child-publication-failure' && journal?.deletion?.state === 'spawned') {
                Errors.throwHostEnvironment('Injected deletion child journal unavailable')
              }
              await FS.writeJson(path, assets)
            },
          },
        )
        if (deletion !== 'proved') {
          await Expect(cleanup).rejects.toThrow('assets remain retained')
        } else {
          await cleanup
        }
        Expect(events.filter(event => !['generation', 'adb', 'lsof'].includes(event))).toEqual(
          deletion === 'intent-publication-failure'
            ? ['acquire', 'acquire', 'retain-unknown']
            : [
              'acquire',
              'acquire',
              'retain-unknown',
              'guard',
              'avdmanager',
              ...(deletion === 'child-publication-failure' ? [] : ['retain-child']),
              'disposed',
              ...(deletion === 'proved' ? ['emulator', 'recover', 'emulator'] : []),
            ],
        )
        Expect(events).not.toContain('release')
        Expect(retained?.retention?.quarantined).toBe(true)
        if (deletion === 'child-publication-failure' || deletion === 'intent-publication-failure') {
          Expect(retained?.retention?.processes).toEqual([])
          Expect(events).not.toContain('recover')
        }
        const assets = await FS.readJson<{ state: string }[]>(FS.resolvePath('android-assets.json', root))
        Expect(assets[0]!.state).toBe(
          deletion !== 'proved' ? deletion === 'intent-publication-failure' ? 'created' : 'retained' : 'removed',
        )
      } finally {
        await FS.remove(root)
      }
    },
  )
}

for (const state of ['unreadable', 'foreign', 'reused-launcher', 'valid'] as const) {
  Test(`pending fixed helper ${state} rollback grants control only to its captured launcher`, async () => {
    const fixture = { root: '/owned-source', appPath: '/owned-source/Data MVP.tao', sourceIdentity: 'source fixture' }
    const launcher = { pid: 93_001, startedAt: 'owned-start', command: 'fixed owned launcher' }
    const foreign = { pid: 93_002, startedAt: 'foreign-start', command: 'unrelated peer' }
    const session = Platform.randomUUID()
    const receipt: DevLoopReceipt = {
      version: 1,
      session,
      checkout: await FS.realPath(Repo.getRoot()),
      args: [],
      selection: { appName: 'DataMVPApp', projectRoot: fixture.root, appPath: fixture.appPath },
      generation: 'owned-generation',
      state: 'ready',
      controller: state === 'foreign' ? foreign : launcher,
      children: state === 'foreign' ? [foreign] : [],
      createdAt: 'stamp',
      updatedAt: 'stamp',
      cleanupOutcome: 'pending',
    }
    const signals: number[] = []
    const commands: string[][] = []
    let live = true
    const result = await rollbackManagedLoopFault({ session, fixture, launcher }, {
      receipt: async () => {
        if (state === 'unreadable') {
          Errors.throwHostEnvironment('Injected receipt read failure')
        }
        return receipt
      },
      identities: pids =>
        new Map(
          live
            ? pids.map(pid => [
              pid,
              pid === launcher.pid
                ? state === 'reused-launcher' ? { ...launcher, startedAt: 'replacement' } : launcher
                : foreign,
            ])
            : [],
        ),
      signal: (identity, owned) => {
        Expect(owned).toEqual([launcher])
        signals.push(identity.pid)
      },
      run: async (command, spec = {}) => {
        commands.push([...spec.args ?? []])
        live = false
        receipt.state = 'stopped'
        receipt.cleanupOutcome = 'proved'
        return { command, args: [...spec.args ?? []], stdout: '', stderr: '', exitCode: 0, signal: null }
      },
    })
    Expect(result.proved).toBe(state === 'valid')
    Expect(signals).toEqual(state === 'foreign' || state === 'unreadable' ? [launcher.pid] : [])
    Expect(commands).toEqual(state === 'valid' ? [['dev-loop', 'stop', '--session', session, '--json']] : [])
  })
}

Test(
  'interrupted deletion keeps a durable unknown-child quarantine after owner death while independent assets clean up',
  async () => {
    const invocation = Platform.randomUUID()
    const root = Repo.resolvePath(`.artifacts/tests/${invocation}`)
    const registryRoot = FS.resolvePath('registry', root)
    await FS.mkdir(root)
    const names = [1, 2].map(slot => `${managedLoopAndroidPrefix(invocation)}${slot}`)
    const fixture = {
      root: '/source-fixture',
      appPath: '/source-fixture/Data MVP.tao',
      sourceIdentity: 'source fixture',
    }
    const receipt: DevLoopReceipt = {
      version: 1,
      session: Platform.randomUUID(),
      checkout: Repo.getRoot(),
      args: [],
      state: 'stopped',
      generation: 'closed',
      cleanupOutcome: 'proved',
      children: [],
      createdAt: 'stamp',
      updatedAt: 'stamp',
      selection: { appName: 'DataMVPApp', projectRoot: fixture.root, appPath: fixture.appPath },
      devices: names.map((avdName, index) => ({
        platform: 'android',
        id: `emulator-${5582 + index * 2}`,
        avdName,
        owned: true,
        state: 'released',
        generation: `released-${index}`,
        resources: [`android-avd:${avdName}`, `android-emulator:emulator-${5582 + index * 2}`].map(name => ({
          name,
          id: `released-${index}`,
          pid: 44,
          startedAt: 'closed',
          command: 'closed source target',
          repositoryRoot: Repo.getRoot(),
        })),
      })),
    }
    const child = { pid: 94_001, startedAt: 'independent-owned-delete', command: 'source cleanup child' }
    let live = false
    const deleted: string[] = []
    await FS.writeJson(
      FS.resolvePath('android-assets.json', root),
      names.map(avdName => ({
        avdName,
        path: 'source fixture without physical AVD',
        owner: root,
        state: 'created',
        purpose: 'source regression',
        cleanupCondition: 'exact closure only',
      })),
    )
    try {
      await Expect(
        cleanupManagedLoopAndroidAssets(
          { session: receipt.session, artifactRoot: root, fixture, baselineResources: [] },
          root,
          {
            receipt: async () => receipt,
            identities: () => new Map(live ? [[child.pid, child]] : []),
            groupAlive: () => live,
            readOwner: request => MachineResources.readOwner({ ...request, registryRoot }),
            tryAcquire: request => MachineResources.tryAcquire({ ...request, registryRoot }),
            retain: request => MachineResources.retain({ ...request, registryRoot }),
            recover: request => MachineResources.recoverRetained({ ...request, registryRoot }),
            withCurrentOwners: (request, action) => {
              if (request.owners[0]!.name === `android-avd:${names[0]}`) {
                Errors.throwHostEnvironment('Injected invocation interruption after durable unknown-child quarantine')
              }
              return MachineResources.withCurrentOwners({ ...request, registryRoot }, action)
            },
            start: (command, spec = {}) => {
              Expect(spec.args).toEqual(['delete', 'avd', '--name', names[1]!])
              deleted.push(names[1]!)
              live = true
              return {
                command,
                args: [...spec.args ?? []],
                pid: child.pid,
                exitCode: 0,
                signalCode: null,
                waitForClose: async () => {
                  live = false
                  return { exitCode: 0, signal: null }
                },
                closeOutput: async () => {},
                dispose: () => {},
                endStdin: () => {},
                kill: () => false,
                onceClose: listener => listener(0, null),
                onceError: () => {},
                writeStdin: () => false,
              }
            },
            run: async (command, spec = {}) => ({
              command,
              args: [...spec.args ?? []],
              exitCode: 0,
              signal: null,
              stdout: '',
              stderr: '',
            }),
          },
        ),
      ).rejects.toThrow('assets remain retained')
      Expect(deleted).toEqual([names[1]!])
      const retained = await MachineResources.readOwner({ name: `android-avd:${names[0]}`, registryRoot })
      Expect(retained?.retention?.quarantined).toBe(true)
      Expect(retained?.retention?.processes).toEqual([])
      const reclaimed = await MachineResources.tryAcquire({
        name: `android-avd:${names[0]}`,
        registryRoot,
        processIdentity: async () => ({ evidence: 'gone' }),
      })
      Expect(reclaimed).toBeUndefined()
      Expect(await MachineResources.readOwner({ name: `android-avd:${names[1]}`, registryRoot })).toBeUndefined()
      const assets = await FS.readJson<{ state: string }[]>(FS.resolvePath('android-assets.json', root))
      Expect(assets.map(asset => asset.state)).toEqual(['retained', 'removed'])
    } finally {
      await FS.remove(root)
    }
  },
)

Test(
  'controlled Metro fault reaches the named real startup boundary after compile and preserves the injected phase',
  async () => {
    const events: unknown[] = []
    const operations = managedLoopFaultOperations('metro-failure', async event => {
      events.push(event)
    }, () => false)
    await operations.beforePhase!('compile', () => false)
    await Expect(operations.beforePhase!('metro', () => false)).rejects.toThrow(
      'metro-failure at the real metro operations boundary',
    )
    Expect(events).toEqual([
      { event: 'phase', phase: 'compile', scenario: 'metro-failure' },
      { event: 'phase', phase: 'metro', scenario: 'metro-failure' },
    ])
  },
)

Test('controlled dispatch fault refuses at dispatch while earlier real phases remain available', async () => {
  const events: unknown[] = []
  const operations = managedLoopFaultOperations('dispatch-failure', async event => {
    events.push(event)
  }, () => false)
  await operations.beforePhase!('compile', () => false)
  await operations.beforePhase!('metro', () => false)
  await Expect(operations.beforePhase!('dispatch', () => false)).rejects.toThrow(
    'dispatch-failure at the real dispatch operations boundary',
  )
  Expect(events).toEqual([
    { event: 'phase', phase: 'compile', scenario: 'dispatch-failure' },
    { event: 'phase', phase: 'metro', scenario: 'dispatch-failure' },
    { event: 'phase', phase: 'dispatch', scenario: 'dispatch-failure' },
  ])
})

for (const phase of ['compile', 'metro', 'dispatch'] as const) {
  Test(`finite ${phase} pause drains only after canonical public stop is observed`, async () => {
    const entered = Deferred<void>()
    const events: unknown[] = []
    let stopping = false
    let resolved = false
    const operations = managedLoopFaultOperations(`pause-${phase}`, async event => {
      events.push(event)
      entered.resolve()
    }, () => stopping)
    const waiting = operations.beforePhase!(phase, () => false).then(() => {
      resolved = true
    })
    await entered.promise
    await settle()
    Expect(resolved).toBe(false)
    stopping = true
    await waiting
    Expect(resolved).toBe(true)
    Expect(events).toEqual([
      { event: 'phase', phase, scenario: `pause-${phase}` },
      { event: 'pause-cancelled', phase },
    ])
  })
}

Test('intentional cleanup inspection failure occurs after the independent real services-closed boundary', async () => {
  const events: unknown[] = []
  const operations = managedLoopFaultOperations('cleanup-failure', async event => {
    events.push(event)
  }, () => false)
  await Expect(operations.afterCleanup!()).rejects.toThrow('after independent real service shutdown')
  Expect(events).toEqual([{ event: 'services-closed', scenario: 'cleanup-failure' }])
})
