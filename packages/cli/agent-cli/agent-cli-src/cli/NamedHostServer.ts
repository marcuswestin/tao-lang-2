import { CLI, Errors, HCI, Platform, ProcessTree, type TrackedProcess } from '@shared'

type ServerLifecycle = {
  start?: typeof CLI.start
  onProcessSignal?: typeof Platform.onProcessSignal
  identities?: typeof ProcessTree.identities
}

/** Keep the named server's wrapper alive until its captured child finishes asynchronous cleanup. */
export async function runNamedHostServer(
  command: string,
  spec: CLI.CommandSpec,
  lifecycle: ServerLifecycle = {},
): Promise<CLI.CommandCloseResult & { error?: Error }> {
  const start = lifecycle.start ?? CLI.start
  const onProcessSignal = lifecycle.onProcessSignal ?? Platform.onProcessSignal
  const identities = lifecycle.identities ?? ProcessTree.identities
  let child: CLI.StartedCommand | undefined
  let captured: TrackedProcess | undefined
  let pendingSignal: Platform.ProcessSignal | undefined
  let initialized = false
  let forwarded = false
  let closed = false
  const inspectChild = (pid: number) => {
    try {
      return identities([pid]).get(pid)
    } catch (error) {
      HCI.logProcessError('host-command', `Could not verify the owned server child: ${Errors.formatForLog(error)}`)
      return undefined
    }
  }
  const forwardOnce = () => {
    if (!initialized || pendingSignal === undefined || forwarded || closed) {
      return
    }
    forwarded = true
    if (
      child !== undefined && captured !== undefined && ProcessTree.sameProcess(inspectChild(captured.pid), captured)
    ) {
      // Server policy signals only this child, with no process-group walk or force-kill timer.
      child.kill(pendingSignal)
    }
  }
  const removeHandlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map(signal =>
    onProcessSignal(signal, () => {
      pendingSignal ??= signal
      forwardOnce()
    })
  )
  try {
    child = start(command, { ...spec, processPolicy: 'server' })
    const inspected = child.pid === undefined ? undefined : inspectChild(child.pid)
    captured = inspected?.pid === child.pid ? inspected : undefined
    initialized = true
    forwardOnce()
    const result = await child.waitForClose()
    closed = true
    await child.closeOutput()
    return { ...result, error: child.error }
  } finally {
    closed = true
    try {
      child?.dispose()
    } finally {
      for (const remove of removeHandlers) {
        remove()
      }
    }
  }
}
