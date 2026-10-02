import { Errors, FS, Time } from '@shared'
import { ProcessTree } from '@shared/ProcessTree'
import { devLoopDirectory, type DevLoopReceipt, readDevLoopConnection, readDevLoopReceipt } from './DevLoopStore'

/** Called under the session recovery lock after process and device cleanup has been proved. */
export async function disposeDeadDevLoopConnection(
  receipt: DevLoopReceipt,
  identities: typeof ProcessTree.identities = ProcessTree.identities,
): Promise<DevLoopReceipt> {
  const saved = await readDevLoopReceipt(receipt.session)
  if (
    saved.generation !== receipt.generation
    || (saved.controller !== undefined && !ProcessTree.sameProcess(saved.controller, receipt.controller!))
  ) {
    Errors.throwHostEnvironment('The dev-loop owner changed during private control cleanup.')
  }
  const current = receipt.controller === undefined
    ? undefined
    : identities([receipt.controller.pid]).get(receipt.controller.pid)
  if (receipt.controller !== undefined && ProcessTree.sameProcess(current, receipt.controller)) {
    Errors.throwHostEnvironment('The old dev-loop controller is still alive; private control cleanup is not proved.')
  }
  const directory = FS.resolvePath('active-control', devLoopDirectory(receipt.session))
  if (await FS.exists(directory)) {
    const connection = await readDevLoopConnection(receipt.session).catch(() => undefined)
    if (
      connection === undefined || connection.generation !== receipt.generation || receipt.controller === undefined
      || !ProcessTree.sameProcess(connection.controller, receipt.controller)
    ) {
      const message =
        'Private control ownership is unproved; credentials and the receipt are retained for investigation.'
      return {
        ...receipt,
        state: 'cleanup-failed',
        cleanupOutcome: 'retained',
        message,
        failures: [...(receipt.failures ?? []), message],
      }
    }
    await FS.remove(directory)
  }
  return { ...receipt, controllerDisposed: true, cleanupOutcome: 'proved' }
}

type RecoveryOperations = {
  identities: typeof ProcessTree.identities
  descendants: typeof ProcessTree.descendants
  signal: typeof ProcessTree.signalTracked
  sleep: typeof Time.sleep
  now: () => number
}

const liveOperations: RecoveryOperations = {
  identities: ProcessTree.identities,
  descendants: ProcessTree.descendants,
  signal: ProcessTree.signalTracked,
  sleep: Time.sleep,
  now: Date.now,
}

/** Recovery signals only recorded identities and descendants of still-proven owned parents. */
export async function recoverDevLoopProcesses(
  receipt: DevLoopReceipt,
  operations: RecoveryOperations = liveOperations,
): Promise<DevLoopReceipt> {
  const tracked = [...receipt.children]
  const current = operations.identities(tracked.map(process => process.pid))
  for (const process of tracked.slice()) {
    if (!ProcessTree.sameProcess(current.get(process.pid), process)) {
      continue
    }
    for (const descendant of operations.descendants(process.pid)) {
      if (!tracked.some(previous => previous.pid === descendant.pid && previous.startedAt === descendant.startedAt)) {
        tracked.push(descendant)
      }
    }
  }
  operations.signal(tracked, 'SIGTERM')
  const wait = async (): Promise<boolean> => {
    const deadline = operations.now() + 5_000
    while (true) {
      const live = operations.identities(tracked.map(process => process.pid))
      if (!tracked.some(process => ProcessTree.sameProcess(live.get(process.pid), process))) {
        return true
      }
      if (operations.now() >= deadline) {
        return false
      }
      await operations.sleep(50)
    }
  }
  let stopped = await wait()
  if (!stopped) {
    operations.signal(tracked, 'SIGKILL')
    stopped = await wait()
  }
  const devicesProved = (receipt.devices ?? []).every(device => !device.owned || device.state === 'released')
  const complete = stopped && receipt.provenance === 'complete' && devicesProved
  return {
    ...receipt,
    children: tracked,
    state: complete ? 'stopped' : 'cleanup-failed',
    cleanupOutcome: complete ? 'proved' : !devicesProved ? 'retained' : 'unknown',
    failures: complete
      ? receipt.failures ?? []
      : [
        ...(receipt.failures ?? []),
        'Complete descendant or device cleanup remains unproved; records and resource fences are retained.',
      ],
    updatedAt: new Date().toISOString(),
    message: complete
      ? undefined
      : 'Recorded owned processes were stopped where their identities matched. Complete descendant or device cleanup remains unproved; records and resource fences are retained.',
  }
}
