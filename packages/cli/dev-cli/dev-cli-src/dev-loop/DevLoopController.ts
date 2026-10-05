import { Errors, FS, Http, Platform, Switch } from '@shared'
import type { DevLoopAction, DevLoopConnection, DevLoopLifecycle, DevLoopWorkerCommand } from '@shared/DevLoopControl'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'
import { runManagedMobileFixture } from '../../../../testing/e2e-testing/native/ManagedMobileFixture'
import {
  createManagedMobileGrant,
  type ManagedMobileGrant,
  settleManagedMobileProof,
} from '../../../../testing/e2e-testing/native/ManagedMobileGrant'
import { type AgentAppDevReservation, type ManagedChildCapture, runAgentAppDev } from '../simulators/AgentAppDev'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopConnection,
  writeDevLoopReceipt,
} from './DevLoopStore'

function sameCapturedProcess(current: TrackedProcess | undefined, expected: TrackedProcess): boolean {
  return current?.pid === expected.pid && current.startedAt === expected.startedAt
}

function validCapturedProcess(value: unknown): value is TrackedProcess {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const process = value as Partial<TrackedProcess>
  return Number.isSafeInteger(process.pid) && process.pid! > 0 && process.pid! <= 2_147_483_647
    && typeof process.command === 'string' && process.command.length > 0
    && typeof process.startedAt === 'string' && process.startedAt.length > 0
}

function validateManagedChildCapture(pid: number | undefined, capture: ManagedChildCapture): readonly TrackedProcess[] {
  if (
    capture === null || typeof capture !== 'object' || capture.version !== 1
    || !validCapturedProcess(capture.root) || capture.root.pid !== pid
    || !Array.isArray(capture.members) || capture.members.length !== 2
    || !capture.members.every(validCapturedProcess)
    || new Set(capture.members.map(member => member.pid)).size !== 2
    || !capture.members.some(member => sameCapturedProcess(member, capture.root))
  ) {
    Errors.throwHostEnvironment('The managed child capture does not name its original supervisor and worker.')
  }
  const worker = capture.members.find(member => member.pid !== capture.root.pid)!
  const live = ProcessTree.identities(capture.members.map(member => member.pid))
  if (
    !capture.members.every(member => sameCapturedProcess(live.get(member.pid), member))
    || capture.members.some(member => ProcessTree.processGroupOf(member.pid) !== capture.root.pid)
  ) {
    Errors.throwHostEnvironment('The managed child capture no longer matches its dedicated process group.')
  }
  const descendants = ProcessTree.descendants(capture.root.pid)
  const group = ProcessTree.groupMembers(capture.root.pid)
  if (
    descendants.length !== 1 || !sameCapturedProcess(descendants[0], worker)
    || group.length !== 2 || new Set(group.map(member => member.pid)).size !== 2
    || !capture.members.every(member => group.some(current => sameCapturedProcess(current, member)))
  ) {
    Errors.throwHostEnvironment('The managed child capture has unresolved supervisor or worker membership.')
  }
  return capture.members
}

/** A finite proof observes this only after physical ownership and the receipt have committed. */
export type ManagedLoopOwnershipCheckpoint = Readonly<{
  version: 1
  session: string
  loopGeneration: string
  sequence: number
  controller: TrackedProcess
  devices: NonNullable<DevLoopReceipt['devices']>
  children: TrackedProcess[]
  processGroups: TrackedProcess[]
}>

/** A controller survives its launching shell and owns the reservation wrapper. */
export async function runDevLoopController(
  receipt: DevLoopReceipt,
  operations: {
    runAppDev?: typeof runAgentAppDev
    flushOutput?: () => Promise<void>
    onStop?: () => void
    mobileFixture?: typeof runManagedMobileFixture
    writeReceipt?: typeof writeDevLoopReceipt
    onOwnershipCheckpoint?: (checkpoint: ManagedLoopOwnershipCheckpoint) => Promise<void>
  } = {},
): Promise<{ close: () => Promise<void>; waitForWorker: () => Promise<void>; waitForDisposal: () => Promise<void> }> {
  if (receipt.ownershipRefusal) {
    Errors.throwHostEnvironment('The managed loop has a retained ownership refusal; restart is refused.', {
      details: { retainsTargetLease: true },
    })
  }
  const directory = devLoopDirectory(receipt.session)
  receipt.logPath ??= `.artifacts/dev-loops/${receipt.session}/loop.log`
  receipt.warnings ??= []
  receipt.failures ??= []
  const log = await FS.openAppend(FS.resolvePath('loop.log', directory))
  let writes = Promise.resolve()
  const append = (chunk: string | Buffer): void => {
    writes = writes.then(async () => {
      if (typeof chunk === 'string') {
        await log.write(chunk)
      } else {
        await log.write(chunk)
      }
    })
  }
  let saves = Promise.resolve()
  let activeConnection: DevLoopConnection | undefined
  let captureRefused = false
  const captureProcesses = (): boolean => {
    let complete = (receipt.processGroups?.length ?? 0) > 0
    const physicalGroups = new Set(
      (receipt.devices ?? []).flatMap(device =>
        (device.resources ?? []).flatMap(owner =>
          owner.retention?.processGroupPid === undefined
            ? []
            : [owner.retention.processGroupPid]
        )
      ),
    )
    for (const root of receipt.processGroups ?? []) {
      // Physical ancestry belongs to the producer; a receipt observer cannot extend it.
      if (physicalGroups.has(root.pid)) {
        complete &&= !(receipt.devices ?? []).some(device =>
          device.platform === 'android' && device.owned && device.state !== 'released'
          && (device.state !== 'booted' || device.resources?.some(owner => owner.retention?.quarantined))
        )
        continue
      }
      const live = ProcessTree.identities([root.pid]).get(root.pid)
      if (!ProcessTree.sameProcess(live, root)) {
        const unexplained = live !== undefined || ProcessTree.isGroupAlive(root.pid)
        captureRefused ||= unexplained
        complete &&= !unexplained
        continue
      }
      if (ProcessTree.processGroupOf(root.pid) !== root.pid) {
        complete = false
        captureRefused = true
      }
      for (const descendant of ProcessTree.descendants(root.pid)) {
        if (
          !receipt.children.some(record => record.pid === descendant.pid && record.startedAt === descendant.startedAt)
        ) {
          receipt.children.push(descendant)
        }
        // An escaped group must be durably named before a root can be called complete.
        if (
          ProcessTree.processGroupOf(descendant.pid) === descendant.pid
          && !receipt.processGroups?.some(record =>
            record.pid === descendant.pid && record.startedAt === descendant.startedAt
          )
        ) {
          receipt.processGroups?.push(descendant)
        }
      }
      for (const member of ProcessTree.groupMembers(root.pid)) {
        if (!receipt.children.some(record => record.pid === member.pid && record.startedAt === member.startedAt)) {
          complete = false
          captureRefused = true
        }
      }
    }
    receipt.provenance = complete && !captureRefused && !receipt.ownershipRefusal ? 'complete' : 'uncertain'
    return complete && !captureRefused && receipt.ownershipRefusal === undefined
  }
  const save = async (): Promise<void> => {
    if (receipt.ownershipRefusal) {
      receipt.provenance = 'uncertain'
      receipt.cleanupOutcome = 'retained'
    }
    receipt.updatedAt = new Date().toISOString()
    const snapshot = structuredClone(receipt)
    saves = saves.catch(() => {}).then(async () => {
      if (activeConnection !== undefined && activeConnection.generation !== snapshot.generation) {
        activeConnection = { ...activeConnection, generation: snapshot.generation, controller: snapshot.controller }
        await writeDevLoopConnection(activeConnection)
      }
      await (operations.writeReceipt ?? writeDevLoopReceipt)(snapshot)
    })
    await saves
  }
  const recordOwnershipRefusal = async (error: unknown, generation = receipt.generation): Promise<void> => {
    if (!(error instanceof Errors.HostEnvironmentError) || error.details?.['retainsTargetLease'] !== true) {
      return
    }
    receipt.ownershipRefusal ??= { version: 1, generation, reason: Errors.formatForUser(error) }
    receipt.provenance = 'uncertain'
    receipt.cleanupOutcome = 'retained'
    receipt.failures = [...new Set([...receipt.failures ?? [], receipt.ownershipRefusal.reason])]
    await save()
  }
  let stopRequested = false
  let wrapper: Promise<void> | undefined
  let attached = false
  let generationStarted = false
  let authorizedGeneration = receipt.generation
  let cleanupFailed = false
  let running = false
  let poll: ((command: DevLoopWorkerCommand | null) => void) | undefined
  const queue: DevLoopWorkerCommand[] = []
  const pending = new Map<string, { resolve: () => void; reject: (error: unknown) => void }>()
  const command = (action: DevLoopAction): Promise<void> => {
    const value = { id: Platform.randomUUID(), generation: receipt.generation, action }
    const result = new Promise<void>((resolve, reject) => {
      pending.set(value.id, { resolve, reject })
    })
    if (poll !== undefined) {
      const deliver = poll
      poll = undefined
      deliver(value)
    } else {
      queue.push(value)
    }
    return result
  }
  const token = `${Platform.randomUUID()}${Platform.randomUUID()}`
  let credentialsPath = ''
  let mutations = Promise.resolve()
  let lifecycleCommandActive = false
  let refreshAndroidOwnership: (() => Promise<void>) | undefined
  let checkpointSequence = 0
  const reservations = new Map<'ios' | 'android', AgentAppDevReservation>()
  let proof: { grant: ManagedMobileGrant; completed: Promise<unknown> } | undefined
  const drainProof = async (): Promise<void> => {
    proof?.grant.revoke()
    if (proof !== undefined) {
      await settleManagedMobileProof(proof.completed, proof.grant.externalCancellationSignal).catch(async error => {
        if (error instanceof Errors.HostEnvironmentError && error.details?.['retainsTargetLease'] === true) {
          await recordOwnershipRefusal(error)
          receipt.mobileDriverCleanup = 'retained'
          await save()
        }
      })
    }
    if (receipt.mobileDriverCleanup === 'opening' || receipt.mobileDriverCleanup === 'retained') {
      Errors.throwHostEnvironment(
        'Managed mobile driver cleanup is unproved; target mutation is blocked and reservations remain retained.',
      )
    }
  }
  const refreshOwnership = async (checkpoint = true, closing = false): Promise<void> => {
    const generation = receipt.generation
    try {
      if ((!closing && stopRequested) || receipt.ownershipRefusal) {
        Errors.throwHostEnvironment('Managed ownership refresh requires an active unrefused loop.')
      }
      await refreshAndroidOwnership?.()
      captureProcesses()
      await save()
      if ((!closing && stopRequested) || receipt.generation !== generation) {
        Errors.throwHostEnvironment('Managed ownership refresh was cancelled after publication.', {
          details: { retainsTargetLease: true },
        })
      }
      if (
        checkpoint && operations.onOwnershipCheckpoint !== undefined && receipt.state === 'ready'
        && receipt.provenance === 'complete' && receipt.controller !== undefined
        && receipt.mobileDriverCleanup !== 'opening' && receipt.mobileDriverCleanup !== 'retained'
      ) {
        await operations.onOwnershipCheckpoint(structuredClone({
          version: 1,
          session: receipt.session,
          loopGeneration: generation,
          sequence: ++checkpointSequence,
          controller: receipt.controller,
          devices: receipt.devices ?? [],
          children: receipt.children,
          processGroups: receipt.processGroups ?? [],
        }))
        if (stopRequested || receipt.generation !== generation) {
          Errors.throwHostEnvironment('Managed checkpoint acknowledgement lost its active loop generation.', {
            details: { retainsTargetLease: true },
          })
        }
      }
    } catch (cause) {
      const failure = new Errors.HostEnvironmentError(
        'Managed ownership publication was refused; fences remain retained.',
        {
          cause,
          details: { retainsTargetLease: true },
        },
      )
      await recordOwnershipRefusal(failure, generation).catch(() => {})
      throw failure
    }
  }
  const mutate = (action: Exclude<DevLoopAction, 'stop'>): Promise<void> => {
    proof?.grant.revoke()
    const result = mutations.then(async () => {
      if (stopRequested) {
        Errors.throwUserInput('The dev loop is stopping or stopped.')
      }
      if (!running) {
        Errors.throwUserInput('The dev-loop controller is disposing; retry after cleanup completes.')
      }
      await drainProof()
      if (stopRequested || !running) {
        Errors.throwUserInput('The dev loop is stopping or stopped.')
      }
      if (receipt.state !== 'ready' || !attached) {
        Errors.throwUserInput('The dev loop is not ready for this command.')
      }
      await refreshOwnership()
      if (action === 'restart') {
        receipt.state = 'starting'
        await save()
      }
      lifecycleCommandActive = true
      try {
        await command(action)
      } finally {
        lifecycleCommandActive = false
      }
    })
    mutations = result.catch(() => {})
    return result
  }
  const stop = async (): Promise<void> => {
    proof?.grant.revoke()
    operations.onStop?.()
    if (receipt.state === 'stopped') {
      return
    }
    if (!running) {
      Errors.throwHostEnvironment(receipt.message ?? 'The dev-loop worker ended without proved cleanup.')
    }
    stopRequested = true
    receipt.state = 'stopping'
    await save()
    let driverFailure: unknown
    try {
      await drainProof()
    } catch (error) {
      driverFailure = error
    }
    queue.length = 0
    for (const request of pending.values()) {
      request.reject(new Errors.UserInputError('The dev loop was stopped.'))
    }
    pending.clear()
    const acknowledged = attached ? command('stop').catch(() => {}) : Promise.resolve()
    await wrapper
    await acknowledged
    if (driverFailure !== undefined) {
      throw driverFailure
    }
    if ((receipt as DevLoopReceipt).state !== 'stopped') {
      Errors.throwHostEnvironment(receipt.message ?? 'Dev-loop cleanup was not proved.')
    }
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    fetch: async request => {
      const respond = async (): Promise<Response> => {
        if (request.headers.get('authorization') !== `Bearer ${token}`) {
          return Http.jsonResponse({ error: 'Unauthorized' }, 401)
        }
        const path = new URL(request.url).pathname
        try {
          if (path === '/status' && request.method === 'GET') {
            const result = mutations.then(async () => {
              // Status waits for an active finite proof without revoking its input authority.
              if (running && !stopRequested && receipt.state === 'ready') {
                await drainProof()
                await refreshOwnership()
              } else {
                captureProcesses()
                await save()
              }
            })
            mutations = result.catch(() => {})
            await result
            return Http.jsonResponse(receipt)
          }
          if (path === '/worker/poll' && request.method === 'GET') {
            if (poll !== undefined) {
              return Http.jsonResponse({ error: 'Worker already polling' }, 409)
            }
            const next = queue.shift() ?? await new Promise<DevLoopWorkerCommand | null>(resolve => {
              poll = resolve
            })
            return Http.jsonResponse(next)
          }
          if (request.method !== 'POST') {
            return Http.jsonResponse({ error: 'Unknown operation' }, 404)
          }
          const body = await request.json() as {
            action?: DevLoopAction
            id?: string
            ok?: boolean
            message?: string
            generation?: string
            event?: DevLoopLifecycle
            target?: 'ios' | 'android'
            artifactRoot?: string
          }
          if (path === '/mobile-acceptance') {
            if ((body.target !== 'ios' && body.target !== 'android') || typeof body.artifactRoot !== 'string') {
              return Http.jsonResponse(
                { error: 'Expected one finite mobile fixture target and artifact directory.' },
                400,
              )
            }
            const target = body.target
            const artifactRoot = FS.resolvePath(body.artifactRoot)
            const result = mutations.then(async () => {
              await drainProof()
              if (stopRequested || !running || receipt.state !== 'ready' || !attached) {
                Errors.throwUserInput('The dev loop is not ready for managed mobile interaction.')
              }
              await refreshOwnership()
              if (
                !FS.pathIsWithin(artifactRoot, FS.resolvePath('.artifacts', receipt.checkout))
                || FS.pathIsWithin(artifactRoot, FS.resolvePath('.artifacts/dev-loops', receipt.checkout))
              ) {
                Errors.throwUserInput(
                  'Managed mobile evidence must use a checkout artifact directory outside private loop records.',
                )
              }
              const reservation = reservations.get(target)
              const runtime = receipt.targets?.find(value => value.target === target && value.dispatched)?.mobile
              if (
                reservation === undefined || runtime === undefined || runtime.appName !== 'DataMVPApp'
                || receipt.selection?.appName !== runtime.appName
                || runtime.projectRoot !== receipt.selection.projectRoot
                || runtime.session !== receipt.session || runtime.loopGeneration !== receipt.generation
                || runtime.checkout !== receipt.checkout
              ) {
                Errors.throwHostEnvironment(
                  'The selected managed mobile target has no current Data MVP runtime identity.',
                )
              }
              const loopGeneration = receipt.generation
              const grant = createManagedMobileGrant({
                identity: {
                  session: receipt.session,
                  checkout: receipt.checkout,
                  loopGeneration,
                  target: { platform: target, id: reservation.id },
                  runtime,
                  resources: reservation.resources.map(owner => ({ name: owner.name, generation: owner.id })),
                },
                assertOwnerCurrent: reservation.assertCurrent,
                assertLoopCurrent: async () => {
                  if (
                    !running || stopRequested || receipt.state !== 'ready' || receipt.generation !== loopGeneration
                    || receipt.targets?.find(value => value.target === target)?.mobile?.nonce !== runtime.nonce
                  ) {
                    Errors.throwHostEnvironment('The managed mobile loop or runtime generation changed.')
                  }
                  const live = ProcessTree.identities([controller.pid]).get(controller.pid)
                  if (!ProcessTree.sameProcess(live, controller)) {
                    Errors.throwHostEnvironment('The managed mobile reservation holder identity changed.')
                  }
                },
              })
              receipt.mobileDriverCleanup = 'opening'
              receipt.mobileDriverProcesses = []
              await save()
              const completed = (operations.mobileFixture ?? runManagedMobileFixture)({
                grant,
                artifactRoot,
                ...(receipt.devices?.some(device =>
                    device.platform === target && device.id === reservation.id && device.owned
                  )
                  ? {
                    assertOwnedDiagnosticTargetCurrent: async () => {
                      await grant.assertRequestCurrent()
                      const durable = await readDevLoopReceipt(receipt.session)
                      const device = durable?.devices?.find(value =>
                        value.platform === target && value.id === reservation.id
                      )
                      if (
                        durable?.generation !== loopGeneration || durable.state !== 'ready'
                        || !ProcessTree.sameProcess(durable.controller, controller)
                        || durable.targets?.find(value => value.target === target)?.mobile?.nonce !== runtime.nonce
                        || device?.owned !== true || device.state !== 'booted'
                        || device.resources?.length !== reservation.resources.length
                        || reservation.resources.some(owner =>
                          !device.resources?.some(current => current.name === owner.name && current.id === owner.id)
                        )
                      ) {
                        Errors.throwHostEnvironment(
                          'Managed handshake diagnostics require the current durable owned target and resource generations.',
                        )
                      }
                      await grant.assertRequestCurrent()
                    },
                  }
                  : {}),
                onDriverProcess: async process => {
                  const identity = process.pid === undefined
                    ? undefined
                    : ProcessTree.identities([process.pid]).get(process.pid)
                  if (identity === undefined) {
                    Errors.throwHostEnvironment('Could not record managed mobile driver process identity.')
                  }
                  receipt.mobileDriverProcesses = [identity, ...ProcessTree.descendants(identity.pid)]
                  if (ProcessTree.processGroupOf(identity.pid) !== identity.pid) {
                    Errors.throwHostEnvironment('Managed mobile driver did not establish a dedicated process group.')
                  }
                  receipt.processGroups = [...(receipt.processGroups ?? []), identity]
                  receipt.children.push(...receipt.mobileDriverProcesses)
                  await save()
                },
                onCleanup: async proved => {
                  receipt.mobileDriverCleanup = proved ? 'proved' : 'retained'
                  await save()
                },
                beforeDriverCleanup: async () => {
                  captureProcesses()
                  await save()
                },
              })
              const activeProof = { grant, completed }
              proof = activeProof
              const clearProof = () => {
                if (proof === activeProof) {
                  proof = undefined
                }
              }
              completed.then(clearProof, clearProof)
              const deadline = setTimeout(() => grant.revoke(), 120_000)
              try {
                return await settleManagedMobileProof(completed, grant.externalCancellationSignal)
              } catch (error) {
                if (error instanceof Errors.HostEnvironmentError && error.details?.['retainsTargetLease'] === true) {
                  await recordOwnershipRefusal(error)
                  receipt.mobileDriverCleanup = 'retained'
                  await save()
                }
                throw error
              } finally {
                clearTimeout(deadline)
                grant.revoke()
              }
            })
            mutations = result.then(() => {}, () => {})
            return Http.jsonResponse(await result)
          }
          if (path === '/worker/attach') {
            if (attached) {
              return Http.jsonResponse({ error: 'Worker already attached' }, 409)
            }
            attached = true
            if (stopRequested) {
              void command('stop').catch(() => {})
            }
            return Http.jsonResponse({ generation: receipt.generation })
          }
          if (path === '/worker/detach') {
            attached = false
            poll?.(null)
            poll = undefined
            return Http.jsonResponse({ ok: true })
          }
          if (path === '/worker/ack') {
            const waiting = body.id === undefined ? undefined : pending.get(body.id)
            if (waiting !== undefined) {
              pending.delete(body.id!)
              if (body.ok) {
                waiting.resolve()
              } else {
                waiting.reject(new Errors.HostEnvironmentError(body.message ?? 'Dev-loop action failed.'))
              }
            }
            return Http.jsonResponse({ ok: true })
          }
          if (path === '/worker/event') {
            if (body.generation !== receipt.generation || body.event === undefined) {
              return Http.jsonResponse({ error: 'Stale generation' }, 409)
            }
            const event = body.event
            const physicalIdentities = (receipt.devices ?? []).flatMap(device =>
              (device.resources ?? []).flatMap(owner => owner.retention?.processes ?? [])
            )
            const liveChildren = receipt.children.filter(identity =>
              !physicalIdentities.some(physical => sameCapturedProcess(identity, physical))
              && ProcessTree.sameProcess(ProcessTree.identities([identity.pid]).get(identity.pid), identity)
            )
            for (const identity of liveChildren) {
              for (const descendant of ProcessTree.descendants(identity.pid)) {
                if (
                  !receipt.children.some(record =>
                    record.pid === descendant.pid && record.startedAt === descendant.startedAt
                  )
                ) {
                  receipt.children.push(descendant)
                }
              }
            }
            Switch.on(event, 'type', {
              starting: () => {
                if (generationStarted) {
                  receipt.generation = Platform.randomUUID()
                }
                authorizedGeneration = receipt.generation
                generationStarted = true
                if (!stopRequested) {
                  receipt.state = 'starting'
                }
              },
              ready: ready => {
                if (!stopRequested) {
                  receipt.state = 'ready'
                  receipt.url = ready.url
                  receipt.targets = ready.targets
                  receipt.provenance = captureProcesses() ? 'complete' : 'uncertain'
                }
              },
              failed: failed => {
                receipt.state = 'failed'
                receipt.message = failed.message
                receipt.failures = [...(receipt.failures ?? []), failed.message]
              },
              'cleanup-failed': failed => {
                receipt.state = 'cleanup-failed'
                receipt.message = failed.message
                receipt.failures = [...(receipt.failures ?? []), failed.message]
                receipt.cleanupOutcome = 'retained'
                cleanupFailed = true
              },
            })
            if (event.type === 'ready' && !stopRequested) {
              const publishReady = async (): Promise<void> => {
                await drainProof()
                if (receipt.ownershipRefusal) {
                  await save()
                } else {
                  await refreshOwnership()
                }
              }
              // A lifecycle command already owns the queue and waits for this event acknowledgement.
              if (lifecycleCommandActive) {
                await publishReady()
              } else {
                const result = mutations.then(publishReady)
                mutations = result.catch(() => {})
                await result
              }
            } else {
              await save()
            }
            return Http.jsonResponse({ generation: receipt.generation })
          }
          if (
            path === '/command' && (body.action === 'stop' || body.action === 'restart' || body.action === 'reload')
          ) {
            if (body.action === 'stop') {
              await stop()
            } else {
              await mutate(body.action)
            }
            return Http.jsonResponse(receipt)
          }
          return Http.jsonResponse({ error: 'Unknown operation' }, 404)
        } catch (error) {
          return Http.jsonResponse({ error: Errors.formatForUser(error) }, 409)
        }
      }
      const response = await respond()
      // Each long poll has its own connection; terminal drain must not wait on an idle keep-alive socket.
      response.headers.set('connection', 'close')
      return response
    },
  })
  const controller: TrackedProcess =
    ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
      ?? Errors.throwHostEnvironment('Could not establish the dev-loop controller process identity.')
  receipt.controller = controller
  activeConnection = {
    origin: `http://127.0.0.1:${server.port}`,
    token,
    session: receipt.session,
    generation: receipt.generation,
    controller,
  }
  credentialsPath = await writeDevLoopConnection(activeConnection)
  delete receipt.controllerDisposed
  await save()

  function start(): void {
    if (receipt.ownershipRefusal) {
      Errors.throwHostEnvironment('The managed loop has a retained ownership refusal; restart is refused.', {
        details: { retainsTargetLease: true },
      })
    }
    running = true
    cleanupFailed = false
    generationStarted = false
    receipt.generation = Platform.randomUUID()
    const startGeneration = receipt.generation
    authorizedGeneration = startGeneration
    receipt.state = 'starting'
    receipt.children = []
    receipt.processGroups = []
    receipt.devices = []
    refreshAndroidOwnership = undefined
    reservations.clear()
    receipt.provenance = 'uncertain'
    receipt.cleanupOutcome = 'pending'
    delete receipt.message
    delete receipt.url
    delete receipt.targets
    const publishCapture = async (
      process: Parameters<NonNullable<Parameters<typeof runAgentAppDev>[2]>['onChild']>[0],
      capture: ManagedChildCapture,
      assertCurrent: () => Promise<void>,
      generation = startGeneration,
    ): Promise<void> => {
      try {
        const snapshot = structuredClone(capture)
        await assertCurrent()
        const members = validateManagedChildCapture(process.pid, snapshot)
        for (const member of members) {
          if (!receipt.children.some(current => sameCapturedProcess(current, member))) {
            receipt.children.push(member)
          }
        }
        if (!receipt.processGroups?.some(current => sameCapturedProcess(current, snapshot.root))) {
          receipt.processGroups?.push(snapshot.root)
        }
        await save()
        await assertCurrent()
        validateManagedChildCapture(process.pid, snapshot)
      } catch (cause) {
        const failure = new Errors.HostEnvironmentError(
          'Could not durably publish the managed child capture; fences remain retained.',
          { cause, details: { retainsTargetLease: true } },
        )
        append(`${Errors.formatForLog(failure)}\n`)
        await recordOwnershipRefusal(failure, generation).catch(() => {})
        throw failure
      }
    }
    wrapper = (async () => {
      try {
        await save()
        const code = await (operations.runAppDev ?? runAgentAppDev)(receipt.args, undefined, {
          childEnv: { TAO_DEV_LOOP_WORKER_CREDENTIALS: credentialsPath },
          onChild: async (process, capture) => {
            if (capture !== undefined) {
              const assertActive = async (): Promise<void> => {
                if (!running || stopRequested || receipt.generation !== startGeneration) {
                  Errors.throwHostEnvironment('The managed child capture no longer belongs to the active generation.')
                }
              }
              await publishCapture(process, capture, assertActive)
              return
            }
            const identity = process.pid === undefined
              ? undefined
              : ProcessTree.identities([process.pid]).get(process.pid)
            if (identity === undefined) {
              Errors.throwHostEnvironment('Could not establish the dev-loop child process identity.')
            }
            receipt.children.push(identity)
            if (ProcessTree.processGroupOf(identity.pid) !== identity.pid) {
              Errors.throwHostEnvironment('The managed worker did not establish a dedicated process group.')
            }
            receipt.processGroups?.push(identity)
            await save()
          },
          onCleanupChild: async (process, capture, reservation) => {
            const cleanupGeneration = authorizedGeneration
            const target = { ...reservation, resources: structuredClone(reservation.resources) }
            const assertCleanupCurrent = async (): Promise<void> => {
              const assertReceipt = (current: DevLoopReceipt): void => {
                const device = current.devices?.find(value =>
                  value.platform === target.platform && value.id === target.id
                )
                if (
                  !running || current.generation !== cleanupGeneration || authorizedGeneration !== cleanupGeneration
                  || current.ownershipRefusal
                  || !ProcessTree.sameProcess(current.controller, controller)
                  || target.platform !== 'ios' || device?.owned !== true
                  || !ProcessTree.sameProcess(device.holder, controller)
                  || !['booted', 'retained'].includes(device.state)
                  || target.resources.length !== 1 || target.resources[0]?.name !== `ios-simulator:${target.id}`
                  || device.resources?.length !== target.resources.length
                  || target.resources.some(owner =>
                    !device.resources?.some(expected =>
                      expected.name === owner.name && expected.id === owner.id && expected.pid === owner.pid
                      && expected.processStartedAt === owner.processStartedAt
                      && expected.repositoryRoot === owner.repositoryRoot && owner.repositoryRoot === receipt.checkout
                      && owner.pid === controller.pid
                    )
                  )
                ) {
                  Errors.throwHostEnvironment(
                    'Managed shutdown capture lost its current controller, target or resource generation.',
                  )
                }
              }
              assertReceipt(receipt)
              if (!ProcessTree.sameProcess(ProcessTree.identities([controller.pid]).get(controller.pid), controller)) {
                Errors.throwHostEnvironment('Managed shutdown capture lost its controller kernel identity.')
              }
              await target.assertCurrent()
              assertReceipt(await readDevLoopReceipt(receipt.session))
              assertReceipt(receipt)
            }
            await publishCapture(process, capture, assertCleanupCurrent, cleanupGeneration)
          },
          shouldStop: () => stopRequested,
          onReservation: async reservation => {
            reservations.set(reservation.platform, reservation)
          },
          onAndroidOwnershipRefresh: async refresh => {
            refreshAndroidOwnership = refresh
          },
          beforeTargetCleanup: async () => {
            await drainProof()
            if (receipt.ownershipRefusal) {
              if (refreshAndroidOwnership !== undefined) {
                Errors.throwHostEnvironment('Refused Android ownership cannot authorize physical target cleanup.', {
                  details: { retainsTargetLease: true },
                })
              }
              captureProcesses()
              await save()
            } else {
              await refreshOwnership(false, true)
            }
            const deviceGroups = new Set(
              (receipt.devices ?? []).flatMap(device =>
                (device.resources ?? []).flatMap(owner =>
                  owner.retention?.processGroupPid === undefined ? [] : [owner.retention.processGroupPid]
                )
              ),
            )
            if (
              (receipt.processGroups ?? []).some(group =>
                !deviceGroups.has(group.pid) && ProcessTree.isGroupAlive(group.pid)
              )
            ) {
              Errors.throwHostEnvironment(
                'Managed worker or driver descendants remain alive; physical targets are retained.',
              )
            }
          },
          onOutput: (_stream, chunk) => append(chunk),
          onDevice: async device => {
            for (const owner of device.resources ?? []) {
              for (const process of owner.retention?.processes ?? []) {
                if (
                  !receipt.children.some(record => record.pid === process.pid && record.startedAt === process.startedAt)
                ) {
                  receipt.children.push(process)
                }
              }
              const group = owner.retention?.processGroupPid
              const root = owner.retention?.processes.find(process => process.pid === group)
              if (
                root !== undefined
                && !receipt.processGroups?.some(record =>
                  record.pid === root.pid && record.startedAt === root.startedAt
                )
              ) {
                receipt.processGroups?.push(root)
              }
            }
            receipt.devices = [
              ...(receipt.devices ?? []).filter(current => current.platform !== device.platform),
              device,
            ]
            await save()
          },
        })
        if (receipt.ownershipRefusal) {
          receipt.ownershipRefusal.terminal = { exitCode: code, signal: null }
          receipt.state = 'cleanup-failed'
          receipt.cleanupOutcome = 'retained'
        } else if (cleanupFailed) {
          receipt.state = 'cleanup-failed'
          receipt.cleanupOutcome = 'retained'
        } else if (code === 0) {
          receipt.state = 'stopped'
          receipt.provenance =
            !receipt.ownershipRefusal && ((receipt.processGroups?.length ?? 0) === 0 || captureProcesses())
              ? 'complete'
              : 'uncertain'
          receipt.cleanupOutcome = 'pending'
        } else {
          receipt.state = 'failed'
          receipt.message ??= `The dev-loop worker exited (${code}).`
          receipt.failures = [...(receipt.failures ?? []), receipt.message]
          receipt.cleanupOutcome = 'unknown'
        }
      } catch (error) {
        await recordOwnershipRefusal(error, startGeneration)
        receipt.state = 'cleanup-failed'
        receipt.message = Errors.formatForUser(error)
        receipt.failures = [...(receipt.failures ?? []), receipt.message]
        receipt.cleanupOutcome = (receipt.devices ?? []).some(device => device.owned && device.state !== 'released')
          ? 'retained'
          : 'unknown'
        append(`${receipt.message}\n`)
      } finally {
        // A request can exhaust its short drain budget while independently bounded driver
        // deletion/server shutdown still runs. Keep this holder alive for that cleanup window.
        const closingProof = proof
        if (closingProof !== undefined) {
          closingProof.grant.revoke()
          await settleManagedMobileProof(closingProof.completed, closingProof.grant.externalCancellationSignal, 60_000)
            .catch(async error => {
              if (error instanceof Errors.HostEnvironmentError && error.details?.['retainsTargetLease'] === true) {
                await recordOwnershipRefusal(error, startGeneration)
                receipt.mobileDriverCleanup = 'retained'
                receipt.state = 'cleanup-failed'
                receipt.cleanupOutcome = 'retained'
              }
            })
        }
        running = false
        attached = false
        poll?.(null)
        poll = undefined
        for (const request of pending.values()) {
          request.reject(new Errors.HostEnvironmentError('The dev-loop worker ended.'))
        }
        pending.clear()
        await writes
        await operations.flushOutput?.()
        await save()
      }
    })()
  }
  // This private process has no parent-lifetime or idle-output bound.
  const removeSignals = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal =>
    Platform.onProcessSignal(signal, () => {
      void stop().catch(error => {
        append(`${Errors.formatForUser(error)}\n`)
      })
    })
  )
  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> =>
    disposal ??= (async () => {
      // Graceful close drains the stop receipt response; forcing connections closed would lose its acknowledgement.
      await server.stop(false)
      await writes
      await saves
      await log.close()
      for (const remove of removeSignals) {
        remove()
      }
      await FS.withFileMutationLock(FS.resolvePath('recovery.lock', directory), directory, async () => {
        const saved = await readDevLoopReceipt(receipt.session)
        if (saved.generation !== receipt.generation || !ProcessTree.sameProcess(saved.controller, controller)) {
          return
        }
        const connection = await readDevLoopConnection(receipt.session)
        if (
          connection.token !== token || connection.generation !== receipt.generation
          || !ProcessTree.sameProcess(connection.controller, controller)
        ) {
          return
        }
        await FS.remove(FS.resolvePath('active-control', directory))
        receipt.controllerDisposed = true
        if (receipt.state === 'stopped') {
          receipt.cleanupOutcome = 'proved'
        }
        await save()
      })
    })()
  start()
  const completed = wrapper!.finally(dispose)
  return {
    waitForWorker: async () => {
      await wrapper
    },
    waitForDisposal: async () => {
      await completed
    },
    close: async () => {
      await completed
    },
  }
}
