import { CLI, Errors, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'

type DiagnosticCause = { name?: string; message?: string; code?: string; errno?: number | string; syscall?: string }
type Probe = { outcome: 'alive' | 'absent' | 'inconclusive'; causes?: DiagnosticCause[] }
export type ManagedLoopProcessGroupDiagnostic = {
  evidenceKind: 'real host' | 'source regression'
  invocation: string
  runtime: { platform: string; bun?: string }
  fence?: { process: TrackedProcess; group: number }
  aliveProbe?: Probe
  reapedProbe?: Probe
  acknowledged: boolean
  naturalExitProved: boolean
  closureProved: boolean
  outputClosed: boolean
  disposed: boolean
  failures: { stage: string; causes: DiagnosticCause[] }[]
}
export type ManagedLoopProcessGroupDiagnosticSourceOperations = {
  start: typeof CLI.start
  identities: typeof ProcessTree.identities
  groupOf: typeof ProcessTree.processGroupOf
  members: typeof ProcessTree.groupMembers
  processIsAlive: (pid: number) => boolean
  probe: (group: number) => boolean
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const operations: ManagedLoopProcessGroupDiagnosticSourceOperations = {
  start: CLI.start,
  identities: ProcessTree.identities,
  groupOf: ProcessTree.processGroupOf,
  members: ProcessTree.groupMembers,
  processIsAlive: Platform.processIsAlive,
  probe: group => Platform.signalProcess(-group, 0),
  now: Time.nowMs,
  sleep: Time.sleep,
}

/** Fixed AVD-free host diagnostic; callers cannot select a PID, executable, signal, or lifetime. */
export async function runManagedLoopProcessGroupDiagnostic(
  invocation: string,
): Promise<ManagedLoopProcessGroupDiagnostic> {
  return await diagnose(invocation, operations, false)
}

/** Injected observations are always source evidence, including when a real owned child is used. */
export async function runManagedLoopProcessGroupDiagnosticSourceRegression(
  invocation: string,
  source: ManagedLoopProcessGroupDiagnosticSourceOperations,
): Promise<ManagedLoopProcessGroupDiagnostic> {
  return await diagnose(invocation, source, true)
}

async function diagnose(
  invocation: string,
  ops: ManagedLoopProcessGroupDiagnosticSourceOperations,
  source: boolean,
): Promise<ManagedLoopProcessGroupDiagnostic> {
  const receipt: ManagedLoopProcessGroupDiagnostic = {
    evidenceKind: source ? 'source regression' : 'real host',
    invocation,
    runtime: { platform: Platform.hostPlatform, bun: Platform.runtimeBunVersion },
    acknowledged: false,
    naturalExitProved: false,
    closureProved: false,
    outputClosed: false,
    disposed: false,
    failures: [],
  }
  const deadline = ops.now() + 180_000
  let child: CLI.StartedCommand | undefined
  let ready = ''
  let closed: CLI.CommandCloseResult | undefined
  let closeError: unknown
  let closeFailed = false
  let admitted = false
  const remaining = (): number => Math.max(0, deadline - ops.now())
  const poll = async <T>(read: () => T) =>
    await Time.pollUntil(read, {
      intervalMs: 100,
      timeoutMs: remaining(),
      now: ops.now,
      sleep: ops.sleep,
    })
  const failure = (stage: string, error: unknown): void => {
    if (receipt.failures.length < 8) {
      receipt.failures.push({ stage, causes: boundedCauses(error) })
    }
  }
  const probe = (group: number): Probe => {
    try {
      return { outcome: ops.probe(group) ? 'alive' : 'absent' }
    } catch (error) {
      return { outcome: 'inconclusive', causes: boundedCauses(error) }
    }
  }
  const stable = (process: TrackedProcess, group: number): boolean => {
    const current = ops.identities([process.pid]).get(process.pid)
    if (!ProcessTree.sameProcess(current, process) || ops.groupOf(process.pid) !== group) {
      return false
    }
    const members = ops.members(group)
    return members.length === 1 && members[0]!.pid === process.pid
      && ProcessTree.sameProcess(members[0], process)
      && ProcessTree.sameProcess(ops.identities([process.pid]).get(process.pid), process)
      && ops.groupOf(process.pid) === group
      && child?.exitCode === null && child.signalCode === null && child.error === undefined
  }
  try {
    child = ops.start(Platform.runtimeProcess.execPath, {
      args: [Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopProcessGroupDiagnosticChild.ts')],
      detached: true,
      processPolicy: 'server',
      stdio: ['pipe', 'pipe', 'pipe'],
      onOutput: (stream, chunk) => {
        if (stream === 'stdout') {
          ready = (ready + chunk.toString('utf8')).slice(0, 64)
        }
      },
    })
    void child.waitForClose().then(result => {
      closed = result
    }, error => {
      closeFailed = true
      closeError = error
    })
    const captured = await poll(() => {
      if (child!.error !== undefined) {
        throw child!.error
      }
      if (closed !== undefined || closeFailed || child!.exitCode !== null || child!.signalCode !== null) {
        return { process: undefined }
      }
      if (child!.pid === undefined || ready.trim() !== 'owned-group-ready') {
        return undefined
      }
      const process = ops.identities([child!.pid]).get(child!.pid)
      return process === undefined ? undefined : { process }
    })
    const process = captured?.process
    if (process === undefined || child.pid !== process.pid || !stable(process, process.pid)) {
      Errors.throwHostEnvironment(
        'The fixed diagnostic child did not publish stable private kernel and group ownership.',
      )
    }
    receipt.fence = { process: { ...process, command: 'invocation-owned diagnostic child' }, group: process.pid }
    receipt.aliveProbe = probe(process.pid)
    admitted = receipt.aliveProbe.outcome === 'alive' && stable(process, process.pid)
    if (!admitted) {
      Errors.throwHostEnvironment('The fixed diagnostic child alive observation remained inconclusive.')
    }
  } catch (error) {
    failure('capture and alive observation', error)
  } finally {
    // Even an unavailable capture must let this exact child exit; never signal or dispose a live handle.
    if (child !== undefined) {
      try {
        if (child.exitCode === null && child.signalCode === null && child.error === undefined) {
          receipt.acknowledged = child.writeStdin('finish\n')
          child.endStdin()
        }
      } catch (error) {
        failure('acknowledgement', error)
      }
      try {
        const result = await poll(() => {
          if (closeFailed) {
            throw closeError
          }
          return closed
        })
        const exited = result?.exitCode === 0 && result.signal === null
        const absent = exited && child.pid !== undefined && await poll(() => {
          const current = ops.identities([child!.pid!]).get(child!.pid!)
          if (current !== undefined) {
            if (receipt.fence !== undefined && !ProcessTree.sameProcess(current, receipt.fence.process)) {
              Errors.throwHostEnvironment('The diagnostic captured PID was reused before natural-exit proof.')
            }
            return undefined
          }
          return !ops.processIsAlive(child!.pid!) ? true : undefined
        })
        receipt.naturalExitProved = absent === true
        if (!receipt.naturalExitProved) {
          Errors.throwHostEnvironment('The diagnostic child natural exit was not proved within the parent budget.')
        }
      } catch (error) {
        failure('natural exit', error)
      }
      if (receipt.naturalExitProved && receipt.fence !== undefined) {
        try {
          const { process, group } = receipt.fence
          const absent = (): boolean => {
            const current = ops.identities([process.pid]).get(process.pid)
            if (current !== undefined && !ProcessTree.sameProcess(current, process)) {
              receipt.naturalExitProved = false
              Errors.throwHostEnvironment('The diagnostic captured PID was reused during group-closure proof.')
            }
            return current === undefined && !ops.processIsAlive(process.pid)
              && ops.members(group).length === 0
          }
          const observed = await poll(() => {
            if (!absent()) {
              return undefined
            }
            const observation = probe(group)
            return absent() ? observation : { outcome: 'inconclusive' as const }
          })
          receipt.reapedProbe = observed
          receipt.closureProved = admitted && observed?.outcome === 'absent' && receipt.failures.length === 0
          if (!receipt.closureProved) {
            Errors.throwHostEnvironment('The diagnostic group closure observation remains inconclusive.')
          }
        } catch (error) {
          failure('reaped group observation', error)
        }
      }
      if (receipt.naturalExitProved) {
        try {
          let settled = false
          let rejected = false
          let outputError: unknown
          void child.closeOutput().then(() => {
            settled = true
          }, error => {
            settled = true
            rejected = true
            outputError = error
          })
          await poll(() => settled ? true : undefined)
          if (!settled) {
            Errors.throwHostEnvironment('The diagnostic output capture did not close within the parent budget.')
          }
          if (rejected) {
            throw outputError
          }
          receipt.outputClosed = true
        } catch (error) {
          receipt.closureProved = false
          failure('output capture', error)
        }
        try {
          const current = child.pid === undefined ? undefined : ops.identities([child.pid]).get(child.pid)
          if (
            !receipt.naturalExitProved || child.pid === undefined || current !== undefined
            || ops.processIsAlive(child.pid)
          ) {
            receipt.naturalExitProved = false
            Errors.throwHostEnvironment('The diagnostic PID absence was not preserved before closed-handle disposal.')
          }
          child.dispose()
          receipt.disposed = true
        } catch (error) {
          receipt.closureProved = false
          failure('closed handle disposal', error)
        }
      }
    }
  }
  return receipt
}

function boundedCauses(error: unknown): DiagnosticCause[] {
  const result: DiagnosticCause[] = []
  const seen = new Set<object>()
  for (let depth = 0; depth < 4 && error !== undefined; depth++) {
    if (typeof error !== 'object' || error === null) {
      result.push({ message: typeof error === 'string' ? error.slice(0, 1024) : typeof error })
      break
    }
    if (seen.has(error)) {
      break
    }
    seen.add(error)
    const read = (key: string): unknown => {
      try {
        return (error as Record<string, unknown>)[key]
      } catch {
        return undefined
      }
    }
    const cause: DiagnosticCause = {}
    for (const key of ['name', 'message', 'code', 'syscall'] as const) {
      const value = read(key)
      if (typeof value === 'string') {
        cause[key] = value.slice(0, key === 'message' ? 1024 : 128)
      }
    }
    const errno = read('errno')
    if (typeof errno === 'string') {
      cause.errno = errno.slice(0, 128)
    } else if (typeof errno === 'number' && Number.isFinite(errno)) {
      cause.errno = errno
    }
    result.push(cause)
    error = read('cause')
  }
  return result
}
