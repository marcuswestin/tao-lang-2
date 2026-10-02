import { Errors, FS, Http, Platform, Switch } from '@shared'
import type { DevLoopAction, DevLoopConnection, DevLoopLifecycle, DevLoopWorkerCommand } from '@shared/DevLoopControl'
import { ProcessTree } from '@shared/ProcessTree'
import { runAgentAppDev } from '../simulators/AgentAppDev'
import {
  devLoopDirectory,
  type DevLoopReceipt,
  readDevLoopConnection,
  readDevLoopReceipt,
  writeDevLoopConnection,
  writeDevLoopReceipt,
} from './DevLoopStore'

/** A controller survives its launching shell and owns the reservation wrapper. */
export async function runDevLoopController(
  receipt: DevLoopReceipt,
  operations: { runAppDev?: typeof runAgentAppDev; flushOutput?: () => Promise<void>; onStop?: () => void } = {},
): Promise<{ close: () => Promise<void>; waitForWorker: () => Promise<void>; waitForDisposal: () => Promise<void> }> {
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
  const save = async (): Promise<void> => {
    receipt.updatedAt = new Date().toISOString()
    const snapshot = structuredClone(receipt)
    saves = saves.then(async () => {
      if (activeConnection !== undefined && activeConnection.generation !== snapshot.generation) {
        activeConnection = { ...activeConnection, generation: snapshot.generation, controller: snapshot.controller }
        await writeDevLoopConnection(activeConnection)
      }
      await writeDevLoopReceipt(snapshot)
    })
    await saves
  }
  let stopRequested = false
  let wrapper: Promise<void> | undefined
  let attached = false
  let generationStarted = false
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
  const mutate = (action: Exclude<DevLoopAction, 'stop'>): Promise<void> => {
    const result = mutations.then(async () => {
      if (stopRequested) {
        Errors.throwUserInput('The dev loop is stopping or stopped.')
      }
      if (!running) {
        Errors.throwUserInput('The dev-loop controller is disposing; retry after cleanup completes.')
      }
      if (receipt.state !== 'ready' || !attached) {
        Errors.throwUserInput('The dev loop is not ready for this command.')
      }
      if (action === 'restart') {
        receipt.state = 'starting'
        await save()
      }
      await command(action)
    })
    mutations = result.catch(() => {})
    return result
  }
  const stop = async (): Promise<void> => {
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
    queue.length = 0
    for (const request of pending.values()) {
      request.reject(new Errors.UserInputError('The dev loop was stopped.'))
    }
    pending.clear()
    const acknowledged = attached ? command('stop').catch(() => {}) : Promise.resolve()
    await wrapper
    await acknowledged
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
            const liveChildren = receipt.children.filter(identity =>
              ProcessTree.sameProcess(ProcessTree.identities([identity.pid]).get(identity.pid), identity)
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
            await save()
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
  const controller = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
  if (controller === undefined) {
    Errors.throwHostEnvironment('Could not establish the dev-loop controller process identity.')
  }
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
    running = true
    cleanupFailed = false
    generationStarted = false
    receipt.generation = Platform.randomUUID()
    receipt.state = 'starting'
    receipt.children = []
    receipt.devices = []
    receipt.provenance = 'uncertain'
    receipt.cleanupOutcome = 'pending'
    delete receipt.message
    delete receipt.url
    delete receipt.targets
    wrapper = (async () => {
      try {
        await save()
        const code = await (operations.runAppDev ?? runAgentAppDev)(receipt.args, undefined, {
          childEnv: { TAO_DEV_LOOP_WORKER_CREDENTIALS: credentialsPath },
          onChild: async process => {
            const identity = process.pid === undefined
              ? undefined
              : ProcessTree.identities([process.pid]).get(process.pid)
            if (identity === undefined) {
              Errors.throwHostEnvironment('Could not establish the dev-loop child process identity.')
            }
            receipt.children.push(identity)
            await save()
          },
          shouldStop: () => stopRequested,
          onOutput: (_stream, chunk) => append(chunk),
          onDevice: async device => {
            receipt.devices = [
              ...(receipt.devices ?? []).filter(current =>
                current.platform !== device.platform || current.id !== device.id
              ),
              device,
            ]
            await save()
          },
        })
        if (cleanupFailed) {
          receipt.state = 'cleanup-failed'
          receipt.cleanupOutcome = 'retained'
        } else if (code === 0) {
          receipt.state = 'stopped'
          receipt.provenance = 'complete'
          receipt.cleanupOutcome = 'pending'
        } else {
          receipt.state = 'failed'
          receipt.message ??= `The dev-loop worker exited (${code}).`
          receipt.failures = [...(receipt.failures ?? []), receipt.message]
          receipt.cleanupOutcome = 'unknown'
        }
      } catch (error) {
        receipt.state = 'cleanup-failed'
        receipt.message = Errors.formatForUser(error)
        receipt.failures = [...(receipt.failures ?? []), receipt.message]
        receipt.cleanupOutcome = (receipt.devices ?? []).some(device => device.owned && device.state !== 'released')
          ? 'retained'
          : 'unknown'
        append(`${receipt.message}\n`)
      } finally {
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
