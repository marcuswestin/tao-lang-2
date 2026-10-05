import { CLI, Errors, FS, Platform, Repo, Time } from '@shared'
import { connectDevLoopWorker, type DevLoopControlHooks, devLoopRequest } from '@shared/DevLoopControl'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'
import { Deferred, Expect, mkTestDir, settle, Test, testOverrideSlot, until, withCapturedOutput } from '@shared/test'
import { runManagedMobileFixture } from '../../../testing/e2e-testing/native/ManagedMobileFixture'
import type { ManagedMobileGrant } from '../../../testing/e2e-testing/native/ManagedMobileGrant'
import { acknowledgeDevLoopController, runDevLoopCommand } from '../dev-cli-src/dev-loop/DevLoopCommand'
import { runDevLoopController } from '../dev-cli-src/dev-loop/DevLoopController'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopConnection,
  writeDevLoopReceipt,
} from '../dev-cli-src/dev-loop/DevLoopStore'
import type {
  AgentAppDevReservation,
  ManagedChildCapture,
  runAgentAppDev,
} from '../dev-cli-src/simulators/AgentAppDev'

Test('managed poll heartbeats and abandoned-request cleanup keep stop deliverable exactly once', async () => {
  const record = receipt()
  const attach = Deferred<void>()
  const ended = Deferred<number>()
  let stopCalls = 0
  let cancelled = 0
  const heartbeats: (() => void)[] = []
  const controller = await runDevLoopController(record, {
    schedulePollHeartbeat: expire => {
      heartbeats.push(expire)
      return () => {
        cancelled++
      }
    },
    runAppDev: async (_args, _operations, managed) => {
      await attach.promise
      const hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
      hooks.bind({
        stop: async () => {
          stopCalls++
          ended.resolve(0)
        },
        restart: async () => {},
        reload: async () => {},
      })
      await hooks.emit({ type: 'ready', url: 'fixture', targets: [] })
      const code = await ended.promise
      await hooks.close()
      return code
    },
  })
  try {
    const connection = await readDevLoopConnection(record.session)
    const idle = devLoopRequest(connection, '/worker/poll')
    await until(() => heartbeats.length === 1, { description: 'the idle poll heartbeat' })
    heartbeats[0]!()
    Expect(await idle).toBe(null)
    const abort = new AbortController()
    const abandoned = devLoopRequest(connection, '/worker/poll', undefined, { signal: abort.signal })
    const rejected = abandoned.then(() => false, () => true)
    await until(() => heartbeats.length === 2, { description: 'the abandoned worker poll' })
    abort.abort()
    Expect(await rejected).toBe(true)
    await until(() => cancelled === 2, { description: 'the abandoned poll resolver to clear' })
    attach.resolve()
    await until(async () => (await readDevLoopReceipt(record.session)).state === 'ready', {
      description: 'the reattached managed worker',
    })
    const stopped = await Promise.all([
      devLoopRequest<DevLoopReceipt>(connection, '/command', { action: 'stop' }),
      devLoopRequest<DevLoopReceipt>(connection, '/command', { action: 'stop' }),
    ])
    Expect(stopped.map(value => value.state)).toEqual(['stopped', 'stopped'])
    Expect(stopCalls).toBe(1)
    await controller.waitForDisposal()
    Expect((await readDevLoopReceipt(record.session)).cleanupOutcome).toBe('proved')
  } finally {
    attach.resolve()
    ended.resolve(0)
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test(
  'status waits behind finite interaction, refreshes inline, and the next grant uses the committed Android generation',
  async () => {
    const record = receipt()
    record.selection = { appName: 'DataMVPApp', appPath: '/app/DataMVP.tao', projectRoot: '/app' }
    const ended = Deferred<number>()
    const entered = Deferred<void>()
    const releaseInteraction = Deferred<void>()
    const grants: ManagedMobileGrant[] = []
    const events: string[] = []
    let physicalGeneration = 0
    let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
    const root = { pid: 73_001, startedAt: 'owned emulator root', command: 'emulator' }
    const controller = await runDevLoopController(record, {
      onOwnershipCheckpoint: async checkpoint => {
        events.push(`checkpoint:${checkpoint.sequence}`)
        const durable = await readDevLoopReceipt(record.session)
        Expect(durable.devices![0]!.generation).toBe(checkpoint.devices[0]!.generation)
      },
      runAppDev: async (_args, _operations, managed) => {
        hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
        hooks.bind({
          stop: async () => {
            ended.resolve(0)
          },
          reload: async () => {},
          restart: async () => {},
        })
        await hooks.emit({ type: 'starting' })
        const refresh = async () => {
          const generation = `physical-${++physicalGeneration}`
          const resources = ['android-avd:Owned', 'android-emulator:emulator-5580'].map(name => ({
            name,
            id: generation,
            pid: root.pid,
            processStartedAt: root.startedAt,
            startedAt: 'acquired',
            repositoryRoot: record.checkout,
            command: 'fixture',
            retention: {
              processGroupPid: root.pid,
              processes: [root],
              resourceNames: ['android-avd:Owned', 'android-emulator:emulator-5580'],
              quarantined: false,
              reason: 'owned capture',
            },
          }))
          events.push(`physical:${generation}`)
          // These callbacks must commit inline; putting them behind the caller's queue deadlocks status.
          await managed!.onDevice!({
            platform: 'android',
            id: 'emulator-5580',
            owned: true,
            state: 'booted',
            generation,
            avdName: 'Owned',
            resources,
          })
          await managed!.onReservation!({
            platform: 'android',
            id: 'emulator-5580',
            resources,
            assertCurrent: async () => {},
          })
          events.push(`receipt:${generation}`)
        }
        await refresh()
        await managed!.onAndroidOwnershipRefresh!(refresh)
        const scope = hooks.identity!()
        await hooks.emit({
          type: 'ready',
          url: 'http://127.0.0.1:8081',
          targets: [{
            target: 'android',
            dispatched: true,
            mobile: {
              session: record.session,
              checkout: record.checkout,
              loopGeneration: scope.generation,
              kind: 'companion',
              appId: 'com.devtao.studio.companion',
              devUrl: 'taostudiocompanion://dev',
              projectRoot: '/app',
              appName: 'DataMVPApp',
              sourceRevision: 'source',
              compiledRevision: 'compiled',
              nonce: 'nonce',
            },
          }],
        })
        const code = await ended.promise
        await managed!.beforeTargetCleanup!()
        await managed!.onDevice!({ ...record.devices![0]!, state: 'released' })
        await hooks.close()
        return code
      },
      mobileFixture: async options => {
        grants.push(options.grant)
        events.push('interaction')
        if (grants.length === 1) {
          entered.resolve()
          await releaseInteraction.promise
          Expect(options.grant.signal.aborted).toBe(false)
        }
        events.push('driver-cleanup')
        await options.onCleanup(true)
        return {
          identity: options.grant.identity,
          workspaceName: 'source ordering fixture',
          screenshots: [],
          driverClosed: true,
          targetReservationPreserved: true,
        }
      },
    })
    try {
      await until(() => record.state === 'ready' ? true : undefined, {
        description: 'Android generation ordering fixture ready',
      })
      const connection = await readDevLoopConnection(record.session)
      await Expect(devLoopRequest(connection, '/firebase-sync', {
        target: 'ios',
        artifactRoot: Repo.resolvePath('.artifacts/refresh-generation-fixture'),
      })).rejects.toThrow('restricted to Apps/Firebase Live Acceptance')
      Expect(grants.length).toBe(0)
      const interaction = devLoopRequest(connection, '/mobile-acceptance', {
        target: 'android',
        artifactRoot: Repo.resolvePath('.artifacts/refresh-generation-fixture'),
      })
      await entered.promise
      const atInteraction = physicalGeneration
      const status = devLoopRequest<DevLoopReceipt>(connection, '/status')
      await settle()
      Expect(physicalGeneration).toBe(atInteraction)
      Expect(grants[0]!.signal.aborted).toBe(false)
      releaseInteraction.resolve()
      await interaction
      const current = await status
      Expect(current.devices![0]!.generation).toBe(`physical-${atInteraction + 1}`)
      Expect(events.indexOf('driver-cleanup')).toBeLessThan(events.indexOf(`physical:physical-${atInteraction + 1}`))
      await devLoopRequest(connection, '/mobile-acceptance', {
        target: 'android',
        artifactRoot: Repo.resolvePath('.artifacts/refresh-generation-fixture'),
      })
      Expect(grants[1]!.identity.resources.map(resource => resource.generation)).toEqual([
        `physical-${atInteraction + 2}`,
        `physical-${atInteraction + 2}`,
      ])
      await devLoopRequest(connection, '/command', { action: 'stop' })
      await controller.waitForDisposal()
    } finally {
      releaseInteraction.resolve()
      ended.resolve(0)
      await controller.close()
      await FS.remove(devLoopDirectory(record.session))
    }
  },
)

for (const mutation of ['reload', 'restart', 'stop'] as const) {
  Test(`managed ${mutation} revokes a delayed proof before queue drain and waits for driver cleanup`, async () => {
    const record = receipt()
    record.selection = { appName: 'DataMVPApp', appPath: '/app/DataMVP.tao', projectRoot: '/app' }
    const ended = Deferred<number>()
    const entered = Deferred<void>()
    const revoked = Deferred<void>()
    const cleanup = Deferred<void>()
    let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
    let liveGrant: ManagedMobileGrant | undefined
    const events: string[] = []
    const controller = await runDevLoopController(record, {
      runAppDev: async (_args, _operations, managed) => {
        hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
        hooks.bind({
          stop: async () => {
            events.push('stop')
            ended.resolve(0)
          },
          reload: async () => {
            events.push('reload')
          },
          restart: async () => {
            events.push('restart')
            await hooks!.emit({ type: 'starting' })
          },
        })
        await hooks.emit({ type: 'starting' })
        await managed!.onReservation!({ platform: 'ios', id: 'OWNED', resources: [], assertCurrent: async () => {} })
        const scope = hooks.identity!()
        await hooks.emit({
          type: 'ready',
          url: 'http://127.0.0.1:8081',
          targets: [{
            target: 'ios',
            dispatched: true,
            mobile: {
              session: record.session,
              checkout: record.checkout,
              loopGeneration: scope.generation,
              kind: 'companion',
              appId: 'com.devtao.studio.companion',
              devUrl: 'taostudiocompanion://dev',
              projectRoot: '/app',
              appName: 'DataMVPApp',
              sourceRevision: 'source',
              compiledRevision: 'compiled',
              nonce: 'nonce',
            },
          }],
        })
        const code = await ended.promise
        await managed!.beforeTargetCleanup!()
        await hooks.close()
        return code
      },
      mobileFixture: async options => {
        liveGrant = options.grant
        events.push('proof')
        options.grant.signal.addEventListener('abort', () => {
          events.push('revoked')
          revoked.resolve()
        }, { once: true })
        entered.resolve()
        await revoked.promise
        await cleanup.promise
        events.push('driver-closed')
        await options.onCleanup(true)
        return Errors.throwHostEnvironment('fixture interrupted')
      },
    })
    try {
      await until(() => record.state === 'ready' ? true : undefined, { description: 'managed mobile ready receipt' })
      const connection = await readDevLoopConnection(record.session)
      const proof = devLoopRequest(connection, '/mobile-acceptance', {
        target: 'ios',
        artifactRoot: Repo.resolvePath('.artifacts/mobile-fixture-test'),
      }).catch(error => error)
      await until(() => liveGrant ?? undefined, { description: 'controller finite mobile fixture entry' })
      await entered.promise
      const mutationRequest = devLoopRequest(connection, '/command', { action: mutation })
      await until(() => liveGrant?.signal.aborted ? true : undefined, {
        description: 'queued mutation grant revocation',
      })
      await revoked.promise
      Expect(liveGrant?.externalCancellationSignal.aborted).toBe(true)
      Expect(events).toEqual(['proof', 'revoked'])
      cleanup.resolve()
      await proof
      await mutationRequest
      Expect(events.slice(0, 4)).toEqual(['proof', 'revoked', 'driver-closed', mutation])
      if (mutation !== 'stop') {
        await devLoopRequest(connection, '/command', { action: 'stop' })
      }
      await controller.waitForDisposal()
    } finally {
      liveGrant?.revoke()
      cleanup.resolve()
      ended.resolve(0)
      await controller.close()
      await FS.remove(devLoopDirectory(record.session))
    }
  })
}

Test(
  'normal fixture cleanup outlives the controller cancellation grace and preserves the primary creation failure',
  async () => {
    const root = await mkTestDir('controller-normal-mobile-cleanup-')
    const record = receipt()
    record.selection = { appName: 'DataMVPApp', appPath: '/app/DataMVP.tao', projectRoot: '/app' }
    const ended = Deferred<number>()
    const entered = Deferred<void>()
    const cleanup = Deferred<void>()
    const primary = new Errors.HostEnvironmentError('Driver creation returned no session identity.', {
      cause: new Errors.HostEnvironmentError('POST /session failed.'),
      details: { retainsTargetLease: true },
    })
    let fixtureFailure: unknown
    let liveGrant: ManagedMobileGrant | undefined
    const controller = await runDevLoopController(record, {
      runAppDev: async (_args, _operations, managed) => {
        const hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
        hooks.bind({
          stop: async () => {
            ended.resolve(0)
          },
          reload: async () => {},
          restart: async () => {},
        })
        await hooks.emit({ type: 'starting' })
        await managed!.onReservation!({ platform: 'ios', id: 'OWNED', resources: [], assertCurrent: async () => {} })
        const scope = hooks.identity!()
        await hooks.emit({
          type: 'ready',
          url: 'http://127.0.0.1:8081',
          targets: [{
            target: 'ios',
            dispatched: true,
            mobile: {
              session: record.session,
              checkout: record.checkout,
              loopGeneration: scope.generation,
              kind: 'companion',
              appId: 'com.devtao.studio.companion',
              devUrl: 'taostudiocompanion://dev',
              projectRoot: '/app',
              appName: 'DataMVPApp',
              sourceRevision: 'source',
              compiledRevision: 'compiled',
              nonce: 'nonce',
            },
          }],
        })
        try {
          await ended.promise
          await managed!.beforeTargetCleanup!()
          return 0
        } finally {
          await hooks.close()
        }
      },
      mobileFixture: async options => {
        liveGrant = options.grant
        return await runManagedMobileFixture(options, {
          startServer: async () => ({
            url: 'http://127.0.0.1:4723',
            logs: () => '',
            close: async () => {
              entered.resolve()
              await cleanup.promise
            },
          }),
          resources: () => ({
            leases: {
              acquire: async () => Errors.throwUnexpected('This source fixture cannot acquire driver resources.'),
              tryAcquire: async () => undefined,
            },
            serverReservations: () => ({
              reserve: async () => Errors.throwUnexpected('This source fixture cannot reserve a server port.'),
            }),
            releaseAfterCleanup: async () => Errors.throwUnexpected('Uncertain creation cannot release fences.'),
          }),
          controller: () => ({
            openSession: async () => {
              throw primary
            },
            close: async () => {},
          }),
        }).catch(error => {
          fixtureFailure = error
          throw error
        })
      },
    })
    try {
      await until(() => record.state === 'ready' ? true : undefined, { description: 'normal mobile cleanup ready' })
      const connection = await readDevLoopConnection(record.session)
      const request = devLoopRequest(connection, '/mobile-acceptance', { target: 'ios', artifactRoot: root })
        .catch(error => error)
      await entered.promise
      // budget-ok: Hold this controlled cleanup beyond the controller's existing 5s cancellation grace.
      await Time.sleep(6_000)
      Expect(liveGrant?.signal.aborted).toBe(true)
      Expect(liveGrant?.externalCancellationSignal.aborted).toBe(false)
      cleanup.resolve()
      const failure = await request
      Expect(Errors.messageOf(failure)).toContain('Managed mobile driver cleanup is unproved')
      Expect(Errors.messageOf(failure)).not.toContain('finite grace period')
      if (!(fixtureFailure instanceof Errors.HostEnvironmentError)) {
        Errors.throwUnexpected('Expected the completed fixture creation failure.')
      }
      Expect(fixtureFailure.cause).toBe(primary)
      Expect(fixtureFailure.details?.['originalFailure']).toEqual([
        { name: 'HostEnvironmentError', message: 'Driver creation returned no session identity.' },
        { name: 'HostEnvironmentError', message: 'POST /session failed.' },
      ])
      Expect(fixtureFailure.details?.['driverClosed']).toBe(true)
      Expect(fixtureFailure.details?.['serverClosed']).toBe(true)
      Expect(fixtureFailure.details?.['driverResourcesReleased']).toBe(false)
      Expect(record.mobileDriverCleanup).toBe('retained')
    } finally {
      cleanup.resolve()
      ended.resolve(0)
      await controller.close()
      await FS.remove(devLoopDirectory(record.session))
      await FS.remove(root)
    }
  },
)

function receipt(): DevLoopReceipt {
  const stamp = new Date().toISOString()
  return {
    version: 1,
    session: Platform.randomUUID(),
    checkout: FS.realPathSync(Repo.getRoot()),
    args: [],
    generation: Platform.randomUUID(),
    state: 'starting',
    createdAt: stamp,
    updatedAt: stamp,
    children: [],
  }
}

type CaptureObservation = {
  live: Map<number, TrackedProcess>
  descendants: TrackedProcess[]
  members: TrackedProcess[] | Error
  groups: Map<number, number>
}
const captureObservations = new Map<number, CaptureObservation>()
const originalCaptureInspectors = {
  identities: ProcessTree.identities,
  descendants: ProcessTree.descendants,
  groupMembers: ProcessTree.groupMembers,
  processGroupOf: ProcessTree.processGroupOf,
}
const captureInspectorSlot = testOverrideSlot({
  read: () => ({
    identities: ProcessTree.identities,
    descendants: ProcessTree.descendants,
    groupMembers: ProcessTree.groupMembers,
    processGroupOf: ProcessTree.processGroupOf,
  }),
  write: value => Object.assign(ProcessTree, value),
  equals: (left, right) =>
    Object.keys(left).every(key => left[key as keyof typeof left] === right[key as keyof typeof right]),
})
const captureInspectors: typeof originalCaptureInspectors = {
  identities: pids => {
    const result = originalCaptureInspectors.identities(pids.filter(pid => !captureObservations.has(pid)))
    for (const pid of pids) {
      const value = captureObservations.get(pid)?.live.get(pid)
      if (value !== undefined) {
        result.set(pid, value)
      }
    }
    return result
  },
  descendants: pid => captureObservations.get(pid)?.descendants ?? originalCaptureInspectors.descendants(pid),
  groupMembers: pid => {
    const members = captureObservations.get(pid)?.members
    if (members instanceof Error) {
      return Errors.throwHostEnvironment('Unresolved source group member.', { cause: members })
    }
    return members ?? originalCaptureInspectors.groupMembers(pid)
  },
  processGroupOf: pid => captureObservations.get(pid)?.groups.get(pid) ?? originalCaptureInspectors.processGroupOf(pid),
}
let nextCapturePid = 536_882_000

async function capturedController(writeReceipt: typeof writeDevLoopReceipt = writeDevLoopReceipt) {
  const record = receipt()
  const root: TrackedProcess = { pid: nextCapturePid++, command: 'source supervisor', startedAt: Platform.randomUUID() }
  const worker: TrackedProcess = { pid: nextCapturePid++, command: 'source worker', startedAt: Platform.randomUUID() }
  const capture: ManagedChildCapture = { version: 1, root, members: [root, worker] }
  const observation: CaptureObservation = {
    live: new Map([[root.pid, root], [worker.pid, worker]]),
    descendants: [worker],
    members: [root, worker],
    groups: new Map([[root.pid, root.pid], [worker.pid, root.pid]]),
  }
  captureObservations.set(root.pid, observation)
  captureObservations.set(worker.pid, observation)
  const restore = captureInspectorSlot.install(captureInspectors)
  const ended = Deferred<number>()
  const ready = Deferred<NonNullable<Parameters<typeof runAgentAppDev>[2]>>()
  const controller = await runDevLoopController(record, {
    writeReceipt,
    runAppDev: async (_args, _operations, managed) => {
      ready.resolve(managed!)
      return ended.promise
    },
  })
  const managed = await ready.promise
  return {
    record,
    root,
    worker,
    capture,
    observation,
    controller,
    managed,
    child: { pid: root.pid } as CLI.StartedCommand,
    end: (code: number) => ended.resolve(code),
    finish: async () => {
      ended.resolve(1)
      try {
        await controller.close()
      } finally {
        restore()
        captureObservations.delete(root.pid)
        captureObservations.delete(worker.pid)
        await FS.remove(devLoopDirectory(record.session))
      }
    },
  }
}

for (const stage of ['android', 'save'] as const) {
  Test(`ownership refresh keeps the ${stage} cause in its private log and refuses later commands`, async () => {
    let failSave = false
    const f = await capturedController(async record => {
      if (failSave && !record.ownershipRefusal && record.state === 'ready') {
        failSave = false
        Errors.throwHostEnvironment('Injected receipt publication failure.')
      }
      await writeDevLoopReceipt(record)
    })
    const hooks = await connectDevLoopWorker(f.managed.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
    try {
      await hooks.emit({ type: 'ready', url: 'fixture', targets: [] })
      await f.managed.onAndroidOwnershipRefresh!(async () => {
        if (stage === 'android') {
          Errors.throwHostEnvironment('Injected Darwin inspection failure.', {
            details: { darwinInspection: { inspection: 'identities', failureKind: 'helper-exit' } },
          })
        }
      })
      failSave = stage === 'save'
      const connection = await readDevLoopConnection(f.record.session)
      await Expect(devLoopRequest(connection, '/status')).rejects.toThrow(
        'Managed ownership publication was refused; fences remain retained.',
      )
      const logPath = FS.resolvePath('loop.log', devLoopDirectory(f.record.session))
      const log = await FS.readText(logPath)
      Expect(await FS.fileMode(logPath)).toBe(0o600)
      Expect(log).toContain(`Managed ownership refresh failed at ${stage}:`)
      Expect(log).toContain(
        stage === 'android'
          ? 'Injected Darwin inspection failure.'
          : 'Injected receipt publication failure.',
      )
      if (stage === 'android') {
        Expect(log).toContain('"darwinInspection":{"inspection":"identities","failureKind":"helper-exit"}')
      }
      const refused = await readDevLoopReceipt(f.record.session)
      Expect(refused.ownershipRefusal?.generation).toBe(f.record.generation)
      Expect(refused.provenance).toBe('uncertain')
      Expect(refused.cleanupOutcome).toBe('retained')
      Expect(JSON.stringify(refused)).not.toContain('Injected')
      await Expect(devLoopRequest(connection, '/command', { action: 'reload' })).rejects.toThrow(
        'Managed ownership publication was refused; fences remain retained.',
      )
    } finally {
      await hooks.close()
      await f.finish().catch(() => {})
    }
  })
}

Test(
  'Firebase startup guard rejects durable simulator, runtime, controller, and selection drift before POST',
  async () => {
    const record = receipt()
    const projectRoot = Repo.resolvePath('Apps/Firebase Live Acceptance')
    record.selection = {
      appName: 'FirebaseLiveAcceptance',
      appPath: FS.resolvePath('App.tao', projectRoot),
      projectRoot,
    }
    const ended = Deferred<number>()
    let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
    let posts = 0
    const controller = await runDevLoopController(record, {
      runAppDev: async (_args, _operations, managed) => {
        hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
        hooks.bind({
          stop: async () => {
            ended.resolve(0)
          },
          reload: async () => {},
          restart: async () => {},
        })
        await hooks.emit({ type: 'starting' })
        const owner = record.controller!
        const resource = {
          name: 'ios-simulator:SIM-FIREBASE',
          id: 'owned-generation',
          pid: owner.pid,
          processStartedAt: owner.startedAt,
          repositoryRoot: record.checkout,
          startedAt: 'acquired',
          command: 'source simulator reservation',
        }
        await managed!.onReservation!({
          platform: 'ios',
          id: 'SIM-FIREBASE',
          resources: [resource],
          assertCurrent: async () => {},
        })
        const device = {
          platform: 'ios' as const,
          id: 'SIM-FIREBASE',
          owned: true,
          state: 'booted' as const,
          holder: owner,
          resources: [resource],
        }
        await managed!.onDevice!(device)
        await hooks.emit({
          type: 'ready',
          url: 'http://127.0.0.1:8081',
          targets: [{
            target: 'ios',
            dispatched: true,
            mobile: {
              session: record.session,
              checkout: record.checkout,
              loopGeneration: hooks.identity!().generation,
              kind: 'companion',
              appId: 'com.devtao.studio.companion',
              devUrl: 'taostudiocompanion://dev',
              projectRoot,
              appName: 'FirebaseLiveAcceptance',
              sourceRevision: 'source',
              compiledRevision: 'compiled',
              nonce: 'nonce',
            },
          }],
        })
        const code = await ended.promise
        await managed!.onDevice!({ ...device, state: 'released' })
        await hooks.close()
        return code
      },
      mobileFixture: async options => {
        const guard = options.assertFirebaseStartupCurrent
        Expect(guard).toBeDefined()
        Expect(options.assertOwnedDiagnosticTargetCurrent).toBeDefined()
        await guard!()
        posts++
        const original = await readDevLoopReceipt(record.session)
        const mutations: Array<(value: DevLoopReceipt) => void> = [
          value => {
            value.controller!.startedAt = 'replacement-controller'
          },
          value => {
            value.devices![0]!.resources![0]!.id = 'successor-resource'
          },
          value => {
            value.targets = [{
              ...value.targets![0]!,
              mobile: { ...value.targets![0]!.mobile!, nonce: 'successor-nonce' },
            }]
          },
          value => {
            value.targets = [{
              ...value.targets![0]!,
              mobile: { ...value.targets![0]!.mobile!, appId: 'unrelated.app' },
            }]
          },
          value => {
            value.targets = [{
              ...value.targets![0]!,
              mobile: { ...value.targets![0]!.mobile!, sourceRevision: 'changed-source' },
            }]
          },
          value => {
            value.targets = [{
              ...value.targets![0]!,
              mobile: { ...value.targets![0]!.mobile!, compiledRevision: 'changed-build' },
            }]
          },
          value => {
            value.selection!.projectRoot = '/unrelated/project'
          },
        ]
        for (const mutate of mutations) {
          const changed = structuredClone(original)
          mutate(changed)
          await writeDevLoopReceipt(changed)
          await Expect(guard!()).rejects.toThrow()
          Expect(posts).toBe(1)
          await writeDevLoopReceipt(original)
        }
        await options.onCleanup(true)
        return {
          identity: options.grant.identity,
          workspaceName: 'guarded Firebase fixture',
          screenshots: [],
          driverClosed: true,
          targetReservationPreserved: true,
        }
      },
    })
    try {
      await until(() => record.state === 'ready' ? true : undefined, { description: 'Firebase simulator ready' })
      const connection = await readDevLoopConnection(record.session)
      await devLoopRequest(connection, '/firebase-sync', {
        target: 'ios',
        artifactRoot: Repo.resolvePath('.artifacts/firebase-startup-guard-test'),
      })
      Expect(posts).toBe(1)
      await devLoopRequest(connection, '/command', { action: 'stop' })
      await controller.waitForDisposal()
    } finally {
      ended.resolve(0)
      await hooks?.close()
      await controller.close()
      await FS.remove(devLoopDirectory(record.session))
    }
  },
)

Test('explicit capture refusal survives later stable capture and a clean wrapper exit', async () => {
  const f = await capturedController()
  const originalGeneration = f.record.generation
  try {
    const error = await f.managed.onChild(f.child, { ...f.capture, members: [f.root, f.root] }).catch(error => error)
    Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
    const refused = await readDevLoopReceipt(f.record.session)
    Expect(refused.ownershipRefusal?.generation).toBe(originalGeneration)
    Expect(refused.provenance).toBe('uncertain')
    await f.managed.onChild(f.child, f.capture)
    f.observation.live.clear()
    f.observation.members = []
    f.observation.descendants = []
    await f.managed.beforeTargetCleanup!()
    f.end(0)
    await f.controller.waitForDisposal()
    const closed = await readDevLoopReceipt(f.record.session)
    Expect(closed.state).toBe('cleanup-failed')
    Expect(closed.cleanupOutcome).toBe('retained')
    Expect(closed.provenance).toBe('uncertain')
    Expect(closed.ownershipRefusal?.generation).toBe(originalGeneration)
    Expect(closed.ownershipRefusal?.terminal).toEqual({ exitCode: 0, signal: null })
    Expect(closed.failures).toContain(closed.ownershipRefusal!.reason)
  } finally {
    await f.finish()
  }
})

Test('worker lifecycle observation cannot extend producer-owned Android ancestry', async () => {
  const f = await capturedController()
  const resource = {
    id: 'physical',
    name: 'android-avd:Owned',
    command: 'source ownership',
    startedAt: 'acquired',
    pid: f.root.pid,
    processStartedAt: f.root.startedAt,
    repositoryRoot: f.record.checkout,
    retention: {
      processes: [f.root],
      processGroupPid: f.root.pid,
      resourceNames: ['android-avd:Owned'],
      quarantined: false,
      reason: 'producer capture',
    },
  }
  const device = {
    platform: 'android' as const,
    owned: true,
    state: 'booted' as const,
    id: 'emulator-5580',
    avdName: 'Owned',
    generation: 'physical',
    resources: [resource],
  }
  let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
  try {
    await f.managed.onDevice!(device)
    await f.managed.onAndroidOwnershipRefresh!(async () => {})
    hooks = await connectDevLoopWorker(f.managed.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
    await hooks.emit({ type: 'starting' })
    await hooks.emit({
      type: 'ready',
      url: 'http://127.0.0.1:8081',
      targets: [{ target: 'android', dispatched: true }],
    })
    Expect(f.record.children).toEqual([f.root])
    Expect(f.record.devices![0]!.resources![0]!.retention!.processes).toEqual([f.root])
    // The fake kernel still reports this child, but only the physical producer can admit it.
    Expect(f.observation.descendants).toEqual([f.worker])
    f.observation.live.clear()
    f.observation.members = []
    f.observation.descendants = []
    await f.managed.onDevice!({ ...device, state: 'released' })
    await hooks.close()
    hooks = undefined
    f.end(0)
    await f.controller.waitForDisposal()
  } finally {
    await hooks?.close()
    await f.finish()
  }
})

Test('durable ownership refusal cannot be erased by a later complete receipt or successor generation', async () => {
  const record = receipt()
  const generation = record.generation
  record.ownershipRefusal = { version: 1, generation, reason: 'Original downloader closure was refused.' }
  try {
    await writeDevLoopReceipt(record)
    const overwrite = {
      ...record,
      generation: Platform.randomUUID(),
      state: 'stopped' as const,
      provenance: 'complete' as const,
      cleanupOutcome: 'proved' as const,
    }
    delete overwrite.ownershipRefusal
    await writeDevLoopReceipt(overwrite)
    const saved = await readDevLoopReceipt(record.session)
    Expect(saved.ownershipRefusal).toEqual({
      version: 1,
      generation,
      reason: 'Original downloader closure was refused.',
    })
    Expect(saved.cleanupOutcome).toBe('retained')
    Expect(saved.provenance).toBe('uncertain')
    Expect(saved.state).toBe('cleanup-failed')
    await Expect(
      runDevLoopController(saved, {
        runAppDev: async () => Errors.throwUnexpected('Refused generation must never start'),
      }),
    )
      .rejects.toThrow('restart is refused')
  } finally {
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('ordinary transient process uncertainty remains recoverable without an explicit refusal latch', async () => {
  const record = receipt()
  try {
    record.provenance = 'uncertain'
    await writeDevLoopReceipt(record)
    record.provenance = 'complete'
    record.state = 'stopped'
    record.cleanupOutcome = 'proved'
    await writeDevLoopReceipt(record)
    const saved = await readDevLoopReceipt(record.session)
    Expect(saved.ownershipRefusal).toBeUndefined()
    Expect(saved.provenance).toBe('complete')
    Expect(saved.cleanupOutcome).toBe('proved')
    Expect(saved.state).toBe('stopped')
  } finally {
    await FS.remove(devLoopDirectory(record.session))
  }
})

for (
  const fault of [
    'version',
    'duplicate',
    'invalid-pid',
    'wrong-root',
    'root-replaced',
    'worker-replaced',
    'wrong-group',
    'wrong-worker',
    'unknown-group',
    'extra-member',
  ] as const
) {
  Test(`managed gated child capture refuses ${fault} before publishing either process`, async () => {
    const f = await capturedController()
    let capture = structuredClone(f.capture)
    let child = f.child
    if (fault === 'version') {
      capture = { ...capture, version: 2 } as unknown as ManagedChildCapture
    }
    if (fault === 'duplicate') {
      capture = { ...capture, members: [f.root, f.root] }
    }
    if (fault === 'invalid-pid') {
      capture = { ...capture, members: [f.root, { ...f.worker, pid: -1 }] }
    }
    if (fault === 'wrong-root') {
      child = { pid: f.worker.pid } as CLI.StartedCommand
    }
    if (fault === 'root-replaced') {
      f.observation.live.set(f.root.pid, { ...f.root, startedAt: 'replacement' })
    }
    if (fault === 'worker-replaced') {
      f.observation.live.set(f.worker.pid, { ...f.worker, pid: f.root.pid })
    }
    if (fault === 'wrong-group') {
      f.observation.groups.set(f.worker.pid, f.worker.pid)
    }
    if (fault === 'wrong-worker') {
      f.observation.descendants = [{ ...f.worker, startedAt: 'another-worker' }]
    }
    if (fault === 'unknown-group') {
      f.observation.members = new Errors.HostEnvironmentError('Source member unreadable')
    }
    if (fault === 'extra-member') {
      f.observation.members = [f.root, f.worker, { ...f.worker, pid: f.worker.pid + 1 }]
    }
    try {
      const failure = await f.managed.onChild(child, capture).catch(error => error)
      Expect(failure instanceof Errors.HostEnvironmentError).toBe(true)
      Expect((failure as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
      Expect(f.record.children).toEqual([])
      Expect(f.record.processGroups).toEqual([])
      Expect((await readDevLoopReceipt(f.record.session)).children).toEqual([])
    } finally {
      await f.finish()
    }
  })
}

Test('managed gated capture clones both originals and resolves only after root-only receipt publication', async () => {
  const saving = Deferred<void>()
  const release = Deferred<void>()
  const f = await capturedController(async record => {
    if (record.children.length === 2) {
      saving.resolve()
      await release.promise
    }
    await writeDevLoopReceipt(record)
  })
  let published = false
  try {
    const capture = structuredClone(f.capture)
    const pending = f.managed.onChild(f.child, capture).then(() => {
      published = true
    })
    await saving.promise
    capture.root.startedAt = 'mutated caller snapshot'
    Expect(published).toBe(false)
    Expect((await readDevLoopReceipt(f.record.session)).children).toEqual([])
    release.resolve()
    await pending
    const saved = await readDevLoopReceipt(f.record.session)
    Expect(saved.children).toEqual([f.root, f.worker])
    Expect(saved.processGroups).toEqual([f.root])
    await f.managed.onChild(f.child, f.capture)
    Expect(f.record.children).toEqual([f.root, f.worker])
    Expect(f.record.processGroups).toEqual([f.root])
  } finally {
    release.resolve()
    await f.finish()
  }
})

Test('managed child publication without a capture retains its existing single-root behavior', async () => {
  const f = await capturedController()
  try {
    await f.managed.onChild(f.child)
    const saved = await readDevLoopReceipt(f.record.session)
    Expect(saved.children).toEqual([f.root])
    Expect(saved.processGroups).toEqual([f.root])
  } finally {
    await f.finish()
  }
})

for (const change of ['root-reused', 'worker-exited', 'extra-member', 'group-changed'] as const) {
  Test(
    `managed gated capture refuses ${change} during publication while preserving its original receipt facts`,
    async () => {
      const saving = Deferred<void>()
      const release = Deferred<void>()
      const f = await capturedController(async record => {
        if (record.children.length === 2) {
          saving.resolve()
          await release.promise
        }
        await writeDevLoopReceipt(record)
      })
      try {
        const pending = f.managed.onChild(f.child, f.capture).catch(error => error)
        await saving.promise
        if (change === 'root-reused') {
          f.observation.live.set(f.root.pid, { ...f.root, startedAt: 'successor-supervisor-kernel' })
        }
        if (change === 'worker-exited') {
          f.observation.live.delete(f.worker.pid)
        }
        if (change === 'extra-member') {
          f.observation.members = [f.root, f.worker, { ...f.worker, pid: f.worker.pid + 1 }]
        }
        if (change === 'group-changed') {
          f.observation.groups.set(f.worker.pid, f.worker.pid)
        }
        release.resolve()
        const failure = await pending
        Expect(failure instanceof Errors.HostEnvironmentError).toBe(true)
        Expect((failure as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
        Expect(f.record.children).toEqual([f.root, f.worker])
        const saved = await readDevLoopReceipt(f.record.session)
        Expect(saved.children).toEqual([f.root, f.worker])
        Expect(saved.processGroups).toEqual([f.root])
      } finally {
        release.resolve()
        await f.finish()
      }
    },
  )
}

for (const cancellation of ['successor', 'stop', 'stop-during-save'] as const) {
  Test(`managed gated capture refuses ${cancellation} without authorizing native input`, async () => {
    const saving = Deferred<void>()
    const release = Deferred<void>()
    const f = await capturedController(async record => {
      if (
        cancellation === 'stop-during-save'
        && record.children.length === 2
      ) {
        saving.resolve()
        await release.promise
      }
      await writeDevLoopReceipt(record)
    })
    let closing: Promise<void> | undefined
    try {
      if (cancellation === 'successor') {
        f.record.generation = Platform.randomUUID()
      }
      if (cancellation === 'stop') {
        closing = devLoopRequest(await readDevLoopConnection(f.record.session), '/command', { action: 'stop' }).then(
          () => {},
          () => {},
        )
        await until(() => f.managed.shouldStop() ? true : undefined, {
          description: 'capture cancellation before publication',
        })
      }
      const pending = f.managed.onChild(f.child, f.capture).catch(error => error)
      if (cancellation === 'stop-during-save') {
        await saving.promise
        closing = devLoopRequest(await readDevLoopConnection(f.record.session), '/command', { action: 'stop' }).then(
          () => {},
          () => {},
        )
        await until(() => f.managed.shouldStop() ? true : undefined, {
          description: 'capture cancellation while publication is pending',
        })
        release.resolve()
      }
      const failure = await pending
      Expect(failure instanceof Errors.HostEnvironmentError).toBe(true)
      Expect((failure as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
      if (cancellation !== 'stop-during-save') {
        Expect(f.record.children).toEqual([])
      } else {
        Expect((await readDevLoopReceipt(f.record.session)).children).toEqual([f.root, f.worker])
      }
    } finally {
      release.resolve()
      await f.finish()
      await closing
    }
  })
}

Test('managed gated capture publication failure rejects acknowledgement and retains the capture facts', async () => {
  const f = await capturedController(async record => {
    if (record.children.length === 2) {
      return Errors.throwHostEnvironment('Source receipt publication failed')
    }
    await writeDevLoopReceipt(record)
  })
  try {
    const failure = await f.managed.onChild(f.child, f.capture).catch(error => error)
    Expect(failure instanceof Errors.HostEnvironmentError).toBe(true)
    Expect((failure as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
    Expect(Errors.formatForUser((failure as Errors.HostEnvironmentError).cause)).toContain(
      'Source receipt publication failed',
    )
    Expect(f.record.children).toEqual([f.root, f.worker])
    Expect((await readDevLoopReceipt(f.record.session)).children).toEqual([])
  } finally {
    await Expect(f.finish()).rejects.toThrow('Source receipt publication failed')
  }
})

async function ownedCleanupTarget(f: Awaited<ReturnType<typeof capturedController>>, recordResourceStart = true) {
  const owner = f.record.controller!
  const device = {
    platform: 'ios' as const,
    id: 'OWNED',
    owned: true,
    state: 'booted' as const,
    holder: owner,
    resources: [{
      name: 'ios-simulator:OWNED',
      id: 'physical-reservation',
      pid: owner.pid,
      ...(recordResourceStart ? { processStartedAt: owner.startedAt } : {}),
      repositoryRoot: f.record.checkout,
      startedAt: 'acquired',
      command: 'source simulator reservation',
    }],
  }
  const reservation: AgentAppDevReservation = {
    platform: 'ios',
    id: device.id,
    resources: structuredClone(device.resources),
    assertCurrent: async () => {},
  }
  await f.managed.onReservation!(reservation)
  await f.managed.onDevice!(device)
  return { device, reservation }
}

for (const phase of ['stop', 'startup-failed', 'stop-during-save', 'restart-then-stop'] as const) {
  Test(`managed shutdown capture publishes and releases its owned target after ${phase}`, async () => {
    const saving = Deferred<void>()
    const release = Deferred<void>()
    const f = await capturedController(async record => {
      if (phase === 'stop-during-save' && record.children.length === 2) {
        saving.resolve()
        await release.promise
      }
      await writeDevLoopReceipt(record)
    })
    let closing: Promise<unknown> | undefined
    let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
    try {
      const { device, reservation } = await ownedCleanupTarget(f, phase !== 'stop')
      const initialGeneration = f.record.generation
      if (phase === 'startup-failed' || phase === 'restart-then-stop') {
        hooks = await connectDevLoopWorker(f.managed.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
        hooks.bind({ stop: async () => {}, reload: async () => {}, restart: async () => {} })
        await hooks.emit({ type: 'starting' })
        if (phase === 'startup-failed') {
          await hooks.emit({ type: 'failed', message: 'Source startup failed before target dispatch.' })
          Expect((await readDevLoopReceipt(f.record.session)).state).toBe('failed')
        } else {
          await hooks.emit({ type: 'starting' })
          Expect(f.record.generation).not.toBe(initialGeneration)
        }
      }
      const requestStop = async () => {
        closing = devLoopRequest(await readDevLoopConnection(f.record.session), '/command', { action: 'stop' })
          .catch(() => {})
        await until(() => f.managed.shouldStop() ? true : undefined, {
          description: 'shutdown capture stop request',
        })
      }
      if (phase === 'stop' || phase === 'restart-then-stop') {
        await requestStop()
        if (phase === 'stop') {
          await f.managed.onDevice!({ ...device, state: 'retained' })
        }
      }
      const pending = f.managed.onCleanupChild!(f.child, f.capture, reservation)
      if (phase === 'stop-during-save') {
        await saving.promise
        Expect((await readDevLoopReceipt(f.record.session)).children).toEqual([])
        await requestStop()
        release.resolve()
      }
      await pending
      const published = await readDevLoopReceipt(f.record.session)
      Expect(published.children).toEqual([f.root, f.worker])
      Expect(published.processGroups).toEqual([f.root])
      Expect(published.ownershipRefusal).toBeUndefined()
      f.observation.live.clear()
      f.observation.members = []
      f.observation.descendants = []
      await f.managed.beforeTargetCleanup!()
      await f.managed.onDevice!({ ...device, state: 'released' })
      await hooks?.close()
      hooks = undefined
      f.end(phase === 'startup-failed' ? 1 : 0)
      await f.controller.waitForDisposal()
      await closing
      const closed = await readDevLoopReceipt(f.record.session)
      Expect(closed.devices![0]!.state).toBe('released')
      Expect(closed.children).toEqual([f.root, f.worker])
      Expect(closed.ownershipRefusal).toBeUndefined()
      Expect(closed.state).toBe(phase === 'startup-failed' ? 'failed' : 'stopped')
      if (phase === 'startup-failed') {
        Expect(closed.message).toBe('Source startup failed before target dispatch.')
      } else {
        Expect(closed.cleanupOutcome).toBe('proved')
      }
    } finally {
      release.resolve()
      await hooks?.close()
      await f.finish()
      await closing
    }
  })
}

for (
  const fault of [
    'superseded-before',
    'superseded-during',
    'borrowed',
    'foreign-target',
    'resource-changed',
    'current-owner-changed',
    'controller-replaced',
    'process-replaced',
    'prior-refusal',
    'publication-failed',
  ] as const
) {
  Test(`managed shutdown capture retains its target and refusal after ${fault}`, async () => {
    const during = ['superseded-during', 'resource-changed', 'controller-replaced', 'process-replaced'].includes(fault)
    const saving = Deferred<void>()
    const release = Deferred<void>()
    let publicationFailed = false
    const f = await capturedController(async record => {
      if (record.children.length === 2 && !record.ownershipRefusal) {
        if (fault === 'publication-failed' && !publicationFailed) {
          publicationFailed = true
          return Errors.throwHostEnvironment('Source shutdown receipt publication failed.')
        }
        if (during) {
          saving.resolve()
          await release.promise
        }
      }
      await writeDevLoopReceipt(record)
    })
    try {
      const { device, reservation } = await ownedCleanupTarget(f)
      const generation = f.record.generation
      let target = reservation
      let replaceDurableAuthority = false
      if (fault === 'resource-changed' || fault === 'controller-replaced') {
        target = {
          ...reservation,
          assertCurrent: async () => {
            if (!replaceDurableAuthority) {
              return
            }
            const saved = await readDevLoopReceipt(f.record.session)
            if (fault === 'resource-changed') {
              saved.devices![0]!.resources = [{ ...device.resources[0]!, id: 'successor-reservation' }]
            } else {
              saved.controller = { ...saved.controller!, startedAt: 'successor controller' }
            }
            await writeDevLoopReceipt(saved)
          },
        }
      }
      if (fault === 'superseded-before') {
        f.record.generation = Platform.randomUUID()
      }
      if (fault === 'borrowed') {
        await f.managed.onDevice!({ ...device, owned: false })
      }
      if (fault === 'foreign-target') {
        target = { ...reservation, id: 'FOREIGN' }
      }
      if (fault === 'current-owner-changed') {
        target = {
          ...reservation,
          assertCurrent: async () => Errors.throwHostEnvironment('Source physical reservation was replaced.'),
        }
      }
      if (fault === 'prior-refusal') {
        f.record.ownershipRefusal = { version: 1, generation, reason: 'Original native capture was refused.' }
        await writeDevLoopReceipt(f.record)
      }
      const pending = f.managed.onCleanupChild!(f.child, f.capture, target).catch(error => error)
      if (during) {
        await saving.promise
        if (fault === 'superseded-during') {
          f.record.generation = Platform.randomUUID()
        }
        if (fault === 'process-replaced') {
          f.observation.live.set(f.root.pid, { ...f.root, startedAt: 'replacement cleanup supervisor' })
        }
        // The reservation assertion changes only the durable authority on the recheck.
        replaceDurableAuthority = true
        release.resolve()
      }
      const failure = await pending
      Expect(failure).toBeInstanceOf(Errors.HostEnvironmentError)
      Expect((failure as Errors.HostEnvironmentError).details?.['retainsTargetLease']).toBe(true)
      const refused = await readDevLoopReceipt(f.record.session)
      Expect(refused.ownershipRefusal?.generation).toBe(generation)
      Expect(refused.cleanupOutcome).toBe('retained')
      Expect(refused.children).toEqual(during || fault === 'publication-failed' ? [f.root, f.worker] : [])
      if (fault === 'prior-refusal') {
        Expect(refused.ownershipRefusal?.reason).toBe('Original native capture was refused.')
      }
      await f.managed.onDevice!({ ...device, state: 'retained' })
      f.end(0)
      await f.controller.waitForDisposal()
      const closed = await readDevLoopReceipt(f.record.session)
      Expect(closed.state).toBe('cleanup-failed')
      Expect(closed.cleanupOutcome).toBe('retained')
      Expect(closed.devices![0]!.state).toBe('retained')
      Expect(closed.ownershipRefusal?.terminal).toEqual({ exitCode: 0, signal: null })
      if (fault === 'publication-failed') {
        Expect(await FS.readText(FS.resolvePath('loop.log', devLoopDirectory(f.record.session))))
          .toContain('Source shutdown receipt publication failed.')
      }
    } finally {
      release.resolve()
      await f.finish()
    }
  })
}

for (
  const fault of [
    undefined,
    'borrowed',
    'loop-generation',
    'resource-generation',
    'target-id',
    'owned-bit',
    'device-state',
    'controller-identity',
    'runtime-nonce',
  ] as const
) {
  Test(
    `managed diagnostic authority ${fault ?? 'accepts the durable owned target'} before unproved identity capture`,
    async () => {
      const record = receipt()
      record.selection = { appName: 'DataMVPApp', appPath: '/app/DataMVP.tao', projectRoot: '/app' }
      const ended = Deferred<number>()
      let checked = false
      let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
      const resources = ['android-avd:owned', 'android-emulator-5554'].map(name => ({
        name,
        id: 'retained-generation',
        pid: process.pid,
        command: 'source fixture',
        repositoryRoot: record.checkout,
        startedAt: new Date().toISOString(),
      }))
      const controller = await runDevLoopController(record, {
        runAppDev: async (_args, _operations, managed) => {
          hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
          hooks.bind({
            stop: async () => {
              ended.resolve(0)
            },
            reload: async () => {},
            restart: async () => {},
          })
          await hooks.emit({ type: 'starting' })
          await managed!.onReservation!({
            platform: 'android',
            id: 'emulator-5554',
            resources,
            assertCurrent: async () => {},
          })
          await managed!.onDevice!({
            platform: 'android',
            id: 'emulator-5554',
            owned: fault !== 'borrowed',
            state: 'booted',
            resources,
          })
          const scope = hooks.identity!()
          await hooks.emit({
            type: 'ready',
            url: 'http://127.0.0.1:8081',
            targets: [{
              target: 'android',
              dispatched: true,
              mobile: {
                session: record.session,
                checkout: record.checkout,
                loopGeneration: scope.generation,
                kind: 'expo-go',
                appId: 'host.exp.exponent',
                devUrl: 'exp://127.0.0.1:8081',
                projectRoot: '/app',
                appName: 'DataMVPApp',
                sourceRevision: 'source',
                compiledRevision: 'compiled',
                nonce: 'nonce',
              },
            }],
          })
          const code = await ended.promise
          await managed!.beforeTargetCleanup!()
          await managed!.onDevice!({
            platform: 'android',
            id: 'emulator-5554',
            owned: fault !== 'borrowed',
            state: 'released',
            resources,
          })
          await hooks.close()
          return code
        },
        mobileFixture: async options => {
          try {
            const original = await readDevLoopReceipt(record.session)
            const altered = structuredClone(original)
            if (fault === 'borrowed') {
              Expect(options.assertOwnedDiagnosticTargetCurrent).toBeUndefined()
            } else {
              Expect(options.assertOwnedDiagnosticTargetCurrent).toBeDefined()
              if (fault === 'loop-generation') {
                altered.generation = Platform.randomUUID()
              }
              if (fault === 'resource-generation') {
                altered.devices![0]!.resources = [{ ...resources[0]!, id: 'foreign' }, resources[1]!]
              }
              if (fault === 'target-id') {
                altered.devices![0]!.id = 'emulator-9999'
              }
              if (fault === 'owned-bit') {
                altered.devices![0]!.owned = false
              }
              if (fault === 'device-state') {
                altered.devices![0]!.state = 'released'
              }
              if (fault === 'controller-identity') {
                altered.controller = { ...altered.controller!, startedAt: 'reused' }
              }
              if (fault === 'runtime-nonce') {
                altered.targets = altered.targets!.map(target => ({
                  ...target,
                  mobile: { ...target.mobile!, nonce: 'foreign' },
                }))
              }
              await writeDevLoopReceipt(altered)
              try {
                if (fault === undefined) {
                  await options.assertOwnedDiagnosticTargetCurrent!()
                } else {
                  await Expect(options.assertOwnedDiagnosticTargetCurrent!()).rejects.toThrow(
                    'current durable owned target',
                  )
                }
              } finally {
                await writeDevLoopReceipt(original)
              }
            }
            checked = true
            return Errors.throwHostEnvironment('source fixture ends after diagnostic authority check')
          } finally {
            // This assertion fixture never creates a driver, including when a mutation fails.
            await options.onCleanup(true)
          }
        },
      })
      try {
        await until(() => record.state === 'ready' ? true : undefined, { description: 'diagnostic owned target ready' })
        const connection = await readDevLoopConnection(record.session)
        await Expect(
          devLoopRequest(connection, '/mobile-acceptance', {
            target: 'android',
            artifactRoot: Repo.resolvePath('.artifacts/mobile-diagnostic-test'),
          }),
        ).rejects.toThrow('source fixture ends')
        Expect(checked).toBe(true)
        await devLoopRequest(connection, '/command', { action: 'stop' })
        await controller.waitForDisposal()
      } finally {
        ended.resolve(0)
        await controller.close()
        await FS.remove(devLoopDirectory(record.session))
      }
    },
  )
}

Test('managed controller acknowledges startup, fences generations and keeps the session across restart', async () => {
  const record = receipt()
  record.warnings = ['Visible browser requested.']
  let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
  const ended = Deferred<number>()
  let reloads = 0
  const controller = await runDevLoopController(record, {
    runAppDev: async (_args, _operations, managed) => {
      hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
      hooks.bind({
        stop: async () => {
          ended.resolve(0)
        },
        reload: async () => {
          reloads++
        },
        restart: async () => {
          await hooks!.emit({ type: 'starting' })
        },
      })
      await hooks.emit({ type: 'starting' })
      const code = await ended.promise
      await hooks.close()
      return code
    },
  })
  try {
    const connection = await readDevLoopConnection(record.session)
    Expect(await FS.fileMode(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(0o700)
    Expect(await FS.fileMode(FS.resolvePath('active-control/credentials.json', devLoopDirectory(record.session)))).toBe(
      0o600,
    )
    await until(() => hooks ?? undefined, { description: 'managed worker attachment' })
    const initial = await devLoopRequest<DevLoopReceipt>(connection, '/status')
    Expect(initial.state).toBe('starting')
    const unauthorized = await fetch(`${connection.origin}/status`)
    Expect(unauthorized.status).toBe(401)
    await hooks!.emit({ type: 'ready', url: 'http://127.0.0.1:8081', targets: [{ target: 'web', dispatched: true }] })
    await devLoopRequest(connection, '/command', { action: 'reload' })
    Expect(reloads).toBe(1)
    const restarted = await devLoopRequest<DevLoopReceipt>(connection, '/command', { action: 'restart' })
    Expect(restarted.session).toBe(initial.session)
    Expect(restarted.generation).not.toBe(initial.generation)
    Expect(restarted.state).toBe('starting')
    const stale = await fetch(`${connection.origin}/worker/event`, {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ generation: initial.generation, event: { type: 'ready', url: 'stale', targets: [] } }),
    })
    Expect(stale.status).toBe(409)
    Expect((await devLoopRequest<DevLoopReceipt>(connection, '/status')).state).toBe('starting')
    const stopped = await devLoopRequest<DevLoopReceipt>(connection, '/command', { action: 'stop' })
    Expect(stopped.state).toBe('stopped')
    Expect(stopped.logPath).toBe(`.artifacts/dev-loops/${record.session}/loop.log`)
    Expect(stopped.warnings).toEqual(['Visible browser requested.'])
    Expect(stopped.cleanupOutcome).toBe('pending')
    Expect(stopped.failures).toEqual([])
    const saved = await FS.readText(FS.resolvePath('receipt.json', devLoopDirectory(record.session)))
    Expect(saved).not.toContain(connection.token)
    Expect(saved).not.toContain('credentials')
    await controller.waitForDisposal()
    Expect((await readDevLoopReceipt(record.session)).cleanupOutcome).toBe('proved')
    Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(false)
  } finally {
    ended.resolve(0)
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('managed cleanup failure remains terminal and prevents restart', async () => {
  const record = receipt()
  const ended = Deferred<void>()
  let hooks: (DevLoopControlHooks & { close: () => Promise<void> }) | undefined
  const controller = await runDevLoopController(record, {
    runAppDev: async (_args, _operations, managed) => {
      hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
      hooks.bind({
        stop: async () => {
          ended.resolve()
        },
        reload: async () => {},
        restart: async () => {},
      })
      await hooks.emit({ type: 'cleanup-failed', message: 'Owned device shutdown was not proved.' })
      await ended.promise
      await hooks.close()
      return 0
    },
  })
  try {
    await until(async () => (await readDevLoopReceipt(record.session)).state === 'cleanup-failed' ? true : undefined, {
      description: 'durable cleanup failure',
    })
    const connection = await readDevLoopConnection(record.session)
    await Expect(devLoopRequest(connection, '/command', { action: 'restart' })).rejects.toThrow('not ready')
    await Expect(devLoopRequest(connection, '/command', { action: 'stop' })).rejects.toThrow('not proved')
    Expect((await readDevLoopReceipt(record.session)).state).toBe('cleanup-failed')
    Expect((await readDevLoopReceipt(record.session)).cleanupOutcome).toBe('retained')
    Expect((await readDevLoopReceipt(record.session)).failures).toEqual(['Owned device shutdown was not proved.'])
  } finally {
    ended.resolve()
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('stop preempts a pending restart and waits for wrapper cleanup', async () => {
  const record = receipt()
  const ended = Deferred<number>()
  const restartBegan = Deferred<void>()
  const finishRestart = Deferred<void>()
  const cleanup = Deferred<void>()
  let hooks: Awaited<ReturnType<typeof connectDevLoopWorker>> | undefined
  const controller = await runDevLoopController(record, {
    runAppDev: async (_args, _operations, managed) => {
      hooks = await connectDevLoopWorker(managed!.childEnv['TAO_DEV_LOOP_WORKER_CREDENTIALS']!)
      hooks.bind({
        stop: async () => {
          ended.resolve(0)
        },
        reload: async () => {},
        restart: async () => {
          restartBegan.resolve()
          await finishRestart.promise
        },
      })
      await hooks.emit({ type: 'ready', url: 'http://127.0.0.1:8081', targets: [] })
      const code = await ended.promise
      await cleanup.promise
      await hooks.close()
      return code
    },
  })
  try {
    await until(async () => (await readDevLoopReceipt(record.session)).state === 'ready' ? true : undefined, {
      description: 'managed ready generation',
    })
    const connection = await readDevLoopConnection(record.session)
    const restarting = devLoopRequest(connection, '/command', { action: 'restart' }).then(
      () => 'success',
      () => 'cancelled',
    )
    await restartBegan.promise
    let stopCompleted = false
    const stopping = devLoopRequest<DevLoopReceipt>(connection, '/command', { action: 'stop' }).then(value => {
      stopCompleted = true
      return value
    })
    await ended.promise
    Expect(stopCompleted).toBe(false)
    cleanup.resolve()
    Expect((await stopping).state).toBe('stopped')
    Expect(await restarting).toBe('cancelled')
  } finally {
    ended.resolve(0)
    finishRestart.resolve()
    cleanup.resolve()
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('stop preserves an already completed worker failure', async () => {
  const record = receipt()
  const controller = await runDevLoopController(record, { runAppDev: async () => 1 })
  try {
    await controller.waitForWorker()
    await controller.waitForDisposal()
    Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(false)
    Expect((await readDevLoopReceipt(record.session)).state).toBe('failed')
    Expect((await readDevLoopReceipt(record.session)).cleanupOutcome).toBe('unknown')
    Expect((await readDevLoopReceipt(record.session)).failures).toEqual(['The dev-loop worker exited (1).'])
  } finally {
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('terminal disposal preserves active credentials and receipt owned by a newer generation', async () => {
  const record = receipt()
  const flushing = Deferred<void>()
  const release = Deferred<void>()
  const controller = await runDevLoopController(record, {
    runAppDev: async () => 1,
    flushOutput: async () => {
      flushing.resolve()
      await release.promise
    },
  })
  try {
    await flushing.promise
    const generation = Platform.randomUUID()
    // Publish the newer owner after the old wrapper flush, before its disposal inspects ownership.
    await FS.withFileMutationLock(
      FS.resolvePath('recovery.lock', devLoopDirectory(record.session)),
      devLoopDirectory(record.session),
      async () => {
        release.resolve()
        await controller.waitForWorker()
        await writeDevLoopReceipt({ ...record, generation })
        await writeDevLoopConnection({ session: record.session, origin: 'http://127.0.0.1:1', token: generation })
      },
    )
    await controller.waitForDisposal()
    Expect((await readDevLoopReceipt(record.session)).generation).toBe(generation)
    Expect((await readDevLoopConnection(record.session)).token).toBe(generation)
  } finally {
    release.resolve()
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

Test('stop preserves a terminal failure while its receipt and output are still flushing', async () => {
  const record = receipt()
  const flushing = Deferred<void>()
  const release = Deferred<void>()
  const stopObserved = Deferred<void>()
  const controller = await runDevLoopController(record, {
    runAppDev: async () => 1,
    flushOutput: async () => {
      flushing.resolve()
      await release.promise
    },
    onStop: () => {
      stopObserved.resolve()
    },
  })
  try {
    await flushing.promise
    const connection = await readDevLoopConnection(record.session)
    const stopping = devLoopRequest(connection, '/command', { action: 'stop' }).then(() => 'success', () => 'failed')
    await stopObserved.promise
    release.resolve()
    Expect(await stopping).toBe('failed')
    await controller.waitForWorker()
    Expect((await readDevLoopReceipt(record.session)).state).toBe('failed')
  } finally {
    release.resolve()
    await controller.close()
    await FS.remove(devLoopDirectory(record.session))
  }
})

for (const failure of [false, true]) {
  Test(
    `terminal controller naturally exits and removes active credentials after ${
      failure ? 'worker failure' : 'the stop response drains'
    }`,
    async () => {
      const record = receipt()
      await writeDevLoopReceipt(record)
      const source = `
      import * as Platform from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/Platform.ts'))};
      import { runDevLoopController } from ${
        JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopController.ts'))
      };
      import { connectDevLoopWorker } from ${
        JSON.stringify(Repo.resolvePath('packages/shared/shared-src/DevLoopControl.ts'))
      };
      import { readDevLoopReceipt } from ${
        JSON.stringify(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/DevLoopStore.ts'))
      };
      const controller = await runDevLoopController(await readDevLoopReceipt(${JSON.stringify(record.session)}), {
        runAppDev: async (_args, _operations, managed) => {
          ${
        failure ? 'return 1;' : `
          const hooks = await connectDevLoopWorker(managed.childEnv.TAO_DEV_LOOP_WORKER_CREDENTIALS);
          let finish;
          const stopped = new Promise(resolve => { finish = resolve; });
          hooks.bind({ stop: async () => finish(), restart: async () => {}, reload: async () => {} });
          await hooks.emit({ type: 'ready', url: 'fixture', targets: [] });
          await stopped;
          await hooks.close();
          return 0;`
      }
        }
      });
      await controller.waitForDisposal();
      Platform.runtimeConsole.info('disposed');
    `
      const exited = CLI.run(Platform.runtimeProcess.execPath, {
        args: ['--eval', source],
        cwd: Repo.getRoot(),
        processPolicy: 'test',
        timeoutMs: 5_000, // budget-ok: bound a hung child that must exit naturally; this is a liveness proof, not a speed assertion.
      })
      try {
        if (!failure) {
          await Promise.race([
            until(async () => (await readDevLoopReceipt(record.session)).state === 'ready' ? true : undefined, {
              description: 'subprocess managed ready state',
            }),
            exited.then(result => {
              Errors.throwHostEnvironment(`Controller exited before ready: ${result.stderr}`)
            }),
          ])
          await withCapturedOutput(async () => {
            Expect(await runDevLoopCommand(['stop', '--session', record.session, '--json'])).toBe(0)
          })
          const saved = await readDevLoopReceipt(record.session)
          Expect(saved.state).toBe('stopped')
          Expect(saved.controllerDisposed).toBe(true)
        }
        const result = await exited
        Expect(result.exitCode).toBe(0)
        Expect(result.stdout.trim()).toBe('disposed')
        const saved = await readDevLoopReceipt(record.session)
        if (failure) {
          const acknowledged = await acknowledgeDevLoopController(record.session, { exitCode: 0 })
          Expect(acknowledged.session).toBe(record.session)
          Expect(acknowledged.state).toBe('failed')
          Expect(acknowledged.controllerDisposed).toBe(true)
        }
        Expect(saved.state).toBe(failure ? 'failed' : 'stopped')
        Expect(saved.controllerDisposed).toBe(true)
        Expect(await FS.exists(FS.resolvePath('active-control', devLoopDirectory(record.session)))).toBe(false)
        Expect(await FS.isFile(FS.resolvePath('loop.log', devLoopDirectory(record.session)))).toBe(true)
      } finally {
        await exited
        await FS.remove(devLoopDirectory(record.session))
      }
    },
  )
}
