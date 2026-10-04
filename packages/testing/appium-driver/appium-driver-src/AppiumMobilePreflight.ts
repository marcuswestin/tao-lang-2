import { CLI, Errors, Platform, ProcessTree, Time } from '@shared'

/** Fixed driver discovery uses the same recorded, bounded ownership rules as the server. */
export async function mobileAppiumPreflight(options: {
  command: string
  environment: Record<string, string | undefined>
  signal?: AbortSignal
  onStarted?: (process: CLI.StartedCommand) => Promise<void>
  onStartAttempt?: () => void
  onOwnedCleanup?: () => void
  timeoutMs?: number
}, operations: {
  start: typeof CLI.start
  tree: Pick<
    typeof ProcessTree,
    'identities' | 'descendants' | 'signalTracked' | 'groupMembers' | 'isGroupAlive' | 'processGroupOf'
  >
  processIsAlive?: (pid: number) => boolean
} = { start: CLI.start, tree: ProcessTree }): Promise<string> {
  if (options.signal?.aborted) {
    Errors.throwHostEnvironment('Managed Appium startup was cancelled before driver discovery.')
  }
  let stdout = ''
  options.onStartAttempt?.()
  const child = operations.start(options.command, {
    args: ['driver', 'list', '--installed', '--json'],
    env: options.environment,
    detached: true,
    processPolicy: 'server',
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') {
        stdout = (stdout + chunk.toString('utf8')).slice(-64 * 1024)
      }
    },
  })
  const root = child.pid === undefined ? undefined : operations.tree.identities([child.pid]).get(child.pid)
  if (root === undefined) {
    Errors.throwHostEnvironment('Appium discovery process identity is unproved; startup remains retained.', {
      details: { retainsTargetLease: true },
    })
  }
  let failure: unknown
  try {
    const result = await within(
      (async () => {
        await options.onStarted?.(child)
        return await child.waitForClose()
      })(),
      options.timeoutMs ?? 30_000,
      options.signal,
    )
    if (result.exitCode !== 0 || child.error !== undefined) {
      Errors.throwHostEnvironment('Pinned Appium driver discovery failed.')
    }
  } catch (error) {
    failure = error
  } finally {
    const descendants = operations.tree.descendants(root.pid)
    const tracked = [...descendants, root]
    const processIsAlive = operations.processIsAlive ?? (pid => Platform.signalProcess(pid, 0))
    const groups = new Set([
      root.pid,
      ...descendants.flatMap(process => {
        const group = operations.tree.processGroupOf(process.pid)
        if (group === undefined && processIsAlive(process.pid)) {
          Errors.throwHostEnvironment('Appium discovery descendant group is unreadable; startup remains retained.')
        }
        return group === undefined ? [] : [group]
      }),
    ])
    // The recorded root group must be empty even if its root has already exited.
    operations.tree.signalTracked(tracked, 'SIGTERM')
    try {
      await within(child.waitForClose(), 5_000)
    } catch {
      operations.tree.signalTracked(tracked, 'SIGKILL')
      await within(child.waitForClose(), 5_000)
    }
    await within(child.closeOutput(), 5_000)
    const stopped = await Time.pollUntil(() => {
      const identities = operations.tree.identities(tracked.map(process => process.pid))
      return tracked.every(process => {
          const identity = identities.get(process.pid)
          return identity === undefined ? !processIsAlive(process.pid) : !ProcessTree.sameProcess(identity, process)
        })
          && [...groups].every(group =>
            operations.tree.groupMembers(group).length === 0 && !operations.tree.isGroupAlive(group)
          )
        ? true
        : undefined
    }, { timeoutMs: 5_000, intervalMs: 50 })
    if (stopped !== true) {
      Errors.throwHostEnvironment('Appium driver discovery cleanup is unproved; startup remains retained.', {
        details: { retainsTargetLease: true },
      })
    }
    child.dispose()
    options.onOwnedCleanup?.()
  }
  if (failure !== undefined) {
    throw failure
  }
  return stdout
}

async function within<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        const fail = () =>
          reject(
            new Errors.HostEnvironmentError(
              'Appium driver discovery exceeded its finite startup budget or was cancelled.',
            ),
          )
        timer = setTimeout(fail, timeoutMs)
        abort = fail
        if (signal?.aborted) {
          fail()
        } else {
          signal?.addEventListener('abort', fail, { once: true })
        }
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    if (abort !== undefined) {
      signal?.removeEventListener('abort', abort)
    }
  }
}
