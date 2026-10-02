import * as Errors from './core/Errors'
import * as FS from './FS'
import type { TrackedProcess } from './ProcessTree'

/** The managed loop uses the same actions as the terminal keyboard. */
export type DevLoopActions = {
  stop: () => Promise<void>
  restart: () => Promise<void>
  reload: () => Promise<void>
}

export type DevLoopLifecycle =
  | { type: 'starting' }
  | { type: 'ready'; url: string; targets: readonly { target: string; dispatched: boolean }[] }
  | { type: 'failed'; message: string }
  | { type: 'cleanup-failed'; message: string }

export type DevLoopControlHooks = {
  bind: (actions: DevLoopActions) => () => void
  emit: (event: DevLoopLifecycle) => Promise<void>
  stopRequested?: () => boolean
}

/** Credentials stay in a private file and are never command-line arguments. */
export type DevLoopConnection = {
  origin: string
  token: string
  session: string
  generation?: string
  controller?: TrackedProcess
}
export type DevLoopAction = keyof DevLoopActions
export type DevLoopWorkerCommand = { id: string; generation: string; action: DevLoopAction }

export async function devLoopRequest<T>(connection: DevLoopConnection, path: string, body?: unknown): Promise<T> {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(connection.origin)) {
    Errors.throwHostEnvironment('Managed dev-loop control must use the loopback interface.')
  }
  const response = await fetch(`${connection.origin}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    method: body === undefined ? 'GET' : 'POST',
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => undefined) as { error?: string } | undefined
    Errors.throwHostEnvironment(failure?.error ?? `Managed dev-loop control refused the request (${response.status}).`)
  }
  return await response.json() as T
}

/** One long-poll transport carries typed lifecycle events and command acknowledgements. */
export async function connectDevLoopWorker(
  credentialsPath: string,
): Promise<DevLoopControlHooks & { close: () => Promise<void> }> {
  if (await FS.fileMode(credentialsPath) !== 0o600 || await FS.fileMode(FS.dirname(credentialsPath)) !== 0o700) {
    Errors.throwHostEnvironment('Managed dev-loop credentials must be private.')
  }
  const connection = await FS.readJson<DevLoopConnection>(credentialsPath)
  let actions: DevLoopActions | undefined
  let closed = false
  let generation = ''
  let stopRequested = false
  const waitingForBinding: DevLoopWorkerCommand[] = []
  const dispatch = (command: DevLoopWorkerCommand, active: DevLoopActions): void => {
    void active[command.action]().then(
      () => devLoopRequest(connection, '/worker/ack', { id: command.id, ok: true }),
      error =>
        devLoopRequest(connection, '/worker/ack', { id: command.id, ok: false, message: Errors.formatForUser(error) }),
    ).catch(() => {
      closed = true
    })
  }
  const attached = await devLoopRequest<{ generation: string }>(connection, '/worker/attach', {})
  generation = attached.generation
  const polling = (async () => {
    while (!closed) {
      const command = await devLoopRequest<DevLoopWorkerCommand | null>(connection, '/worker/poll')
      if (closed || command === null) {
        continue
      }
      if (command.action === 'stop') {
        stopRequested = true
      }
      if (command.action === 'stop' && actions === undefined) {
        waitingForBinding.push(command)
        continue
      }
      if (command.generation !== generation && command.action !== 'stop' || actions === undefined) {
        await devLoopRequest(connection, '/worker/ack', {
          id: command.id,
          ok: false,
          message: 'Loop is changing generation.',
        })
        continue
      }
      // A restart waits for its cleanup; polling continues so stop can preempt it.
      dispatch(command, actions)
    }
  })()
  return {
    stopRequested: () => stopRequested,
    bind: next => {
      actions = next
      for (const command of waitingForBinding.splice(0)) {
        dispatch(command, next)
      }
      return () => {
        if (actions === next) {
          actions = undefined
        }
      }
    },
    emit: async event => {
      const reply = await devLoopRequest<{ generation: string }>(connection, '/worker/event', { generation, event })
      generation = reply.generation
    },
    close: async () => {
      closed = true
      await devLoopRequest(connection, '/worker/detach', {})
      await polling
    },
  }
}
