import {
  CLI,
  Errors,
  HCI,
  Platform,
  ProcessLifetime,
  ProcessTree,
  Repo,
  ResourceInventory,
  Time,
  type TrackedProcess,
} from '@shared'

export type StudioProcessTree =
  & Pick<
    CLI.StartedCommand,
    'closeOutput' | 'dispose' | 'exitCode' | 'kill' | 'onceClose' | 'onceError' | 'signalCode' | 'waitForClose'
  >
  & {
    isRunning: () => boolean
    assertCleanup?: () => void
  }

export type StudioProcessTreeSpec = Pick<CLI.CommandSpec, 'args' | 'cwd' | 'env' | 'onOutput'> & {
  onError?: (error: Error) => void
  /** Resolve when the process exits even if a descendant still holds its captured output pipes. */
  settleOnExit?: boolean
  stdio?: Platform.SpawnOptions['stdio']
  /** Explicit registry location for installed projects or tests; source runs use the machine-local index. */
  resourceIndexRoot?: string
  /** Controlled ownership-write failures in lifecycle regressions; no command-line surface. */
  beforeLaunchPublication?: (root: TrackedProcess) => void | Promise<void>
  beforeShutdownSnapshot?: (root: TrackedProcess) => void
}

export type WaitForStudioProcessTreeClose = () => Promise<CLI.CommandCloseResult>

const defaultStopTimeoutMs = 3_000

/**
 * Starts a command in its own process group so its complete subprocess tree can be stopped. The
 * child runs behind the shared lifetime link (`ProcessLifetime`): its launch registration is the
 * admission token, so the tool starts only once its kernel identity is recorded, and it dies with
 * this process however this process ends.
 */
export async function startStudioProcessTree(
  command: string,
  spec: StudioProcessTreeSpec = {},
): Promise<StudioProcessTree> {
  const stdio = spec.stdio ?? ['ignore', 'pipe', 'pipe']
  const owner = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
  if (owner === undefined) {
    Errors.throwHostEnvironment('Cannot capture ownership before launching the process.')
  }
  let registration: string | undefined = ResourceInventory.beginLaunch({
    owner,
    checkout: Repo.tryGetRoot(spec.cwd) ?? spec.cwd ?? Platform.runtimeProcess.cwd(),
    command,
    indexRoot: spec.resourceIndexRoot,
  })
  const child = ProcessLifetime.spawnLinked(command, registration, {
    args: spec.args,
    cwd: spec.cwd,
    env: spec.env,
    stdio,
  })
  child.on('error', error => spec.onError?.(error))
  child.once('exit', () => ProcessLifetime.release(child))
  let rootIdentity: TrackedProcess | undefined
  const owned = new Map<number, TrackedProcess>()
  let shutdownCaptured = false
  let uncertain = false
  const reportRegistrationFailure = (error: unknown) => {
    HCI.writeErrorLine(
      `Resource tracking incomplete: ${Errors.formatForUser(error)}. Inspect tao resources before cleanup.`,
    )
  }
  const persist = () => {
    if (registration !== undefined) {
      if (rootIdentity !== undefined) {
        spec.beforeShutdownSnapshot?.(rootIdentity)
      }
      ResourceInventory.updateProcess(registration, {
        children: [...owned.values()].filter(process => process.pid !== child.pid),
        provenance: uncertain ? 'uncertain' : 'complete',
        indexRoot: spec.resourceIndexRoot,
      })
    }
  }
  const markUncertain = () => {
    uncertain = true
    persist()
  }
  const liveOwned = (): TrackedProcess[] => {
    const identities = ProcessTree.identities([...owned.keys()])
    // macOS may omit a just-exited child until its parent reaps it. Treat unreadable live PIDs
    // as pending, allowing the bounded wait to drain; signalTracked still refuses to signal them.
    // Linux procfs is definitive and reports an unreaped zombie as gone, which kill(pid, 0) would
    // call alive forever under a container init that never reaps orphans.
    return [...owned.values()].filter(expected => {
      const current = identities.get(expected.pid)
      return current === undefined
        ? Platform.hostPlatform === 'darwin' && Platform.processIsAlive(expected.pid)
        : ProcessTree.sameProcess(current, expected)
    })
  }
  const captureForStop = () => {
    if (rootIdentity === undefined || child.pid === undefined) {
      Errors.throwHostEnvironment('No captured launch identity is available for shutdown.')
    }
    const root = ProcessTree.identities([child.pid]).get(child.pid)
    if (!ProcessTree.sameProcess(root, rootIdentity)) {
      // Without a live ancestry root, an escaped descendant cannot be discovered safely.
      if (!shutdownCaptured) {
        markUncertain()
      }
      return
    }
    const descendants = ProcessTree.descendants(child.pid)
    const members = ProcessTree.groupMembers(child.pid)
    if (
      ProcessTree.processGroupOf(child.pid) !== child.pid
      || !ProcessTree.sameProcess(ProcessTree.identities([child.pid]).get(child.pid), rootIdentity)
    ) {
      Errors.throwHostEnvironment('Launch identity changed during descendant capture.')
    }
    for (const process of [...descendants, ...members]) {
      owned.set(process.pid, process)
    }
    persist()
    shutdownCaptured = true
  }
  // A root that exited by itself needs no signal: what is still verifiable is its process group.
  // Survivors are recorded like a stop capture, so the record stays visible until they are gone.
  const captureNaturalExit = () => {
    if (shutdownCaptured || uncertain || child.pid === undefined) {
      return
    }
    if (child.exitCode === null && child.signalCode === null) {
      return
    }
    try {
      if (ProcessTree.sameProcess(ProcessTree.identities([child.pid]).get(child.pid), rootIdentity!)) {
        return
      }
      const members = ProcessTree.groupMembers(child.pid)
      for (const process of members) {
        owned.set(process.pid, process)
      }
      if (members.length !== 0) {
        persist()
      }
      shutdownCaptured = true
    } catch (error) {
      reportRegistrationFailure(error)
    }
  }
  const retireRegistration = () => {
    if (registration === undefined || child.pid === undefined) {
      return
    }
    try {
      captureNaturalExit()
      if (!shutdownCaptured) {
        markUncertain()
        return
      }
      // Escaped descendants are checked separately from the launch's original group.
      if (uncertain || liveOwned().length !== 0 || ProcessTree.groupMembers(child.pid).length !== 0) {
        return
      }
      ResourceInventory.retireProcess(registration, { indexRoot: spec.resourceIndexRoot })
      registration = undefined
    } catch (error) {
      reportRegistrationFailure(error)
    }
  }
  if (child.pid !== undefined) {
    try {
      const identities = ProcessTree.identities([Platform.runtimeProcess.pid, child.pid])
      const process = identities.get(child.pid)
      if (process !== undefined) {
        rootIdentity = process
        owned.set(process.pid, process)
        await spec.beforeLaunchPublication?.(process)
        ResourceInventory.publishLaunch(registration, {
          process,
          processGroup: child.pid,
          indexRoot: spec.resourceIndexRoot,
        })
      } else {
        Errors.throwHostEnvironment('Could not capture the launched process identity.')
      }
    } catch (error) {
      // Publication failure refuses readiness. The pre-launch intent remains discoverable,
      // while rollback signals only identities tied to this actual spawn.
      await rollbackUnpublishedLaunch(child, rootIdentity).catch(reportRegistrationFailure)
      Errors.throwHostEnvironment('Process launch ownership could not be published; launch refused.', { cause: error })
    }
  } else {
    ProcessLifetime.destroyChannel(child)
    child.stdout?.destroy()
    child.stderr?.destroy()
    Errors.throwHostEnvironment('The process did not publish a launch identity; its intent remains unverified.')
  }
  child.stdout?.on('data', chunk => spec.onOutput?.('stdout', Buffer.from(chunk)))
  child.stderr?.on('data', chunk => spec.onOutput?.('stderr', Buffer.from(chunk)))
  let releaseCompletion = () => {}
  const close = new Promise<CLI.CommandCloseResult>(resolve => {
    releaseCompletion = Platform.onChildProcessClose(
      child,
      (exitCode, signal) => {
        retireRegistration()
        resolve({ exitCode, signal })
      },
      child.stdio[3] === undefined || child.stdio[3] === null ? [] : [child.stdio[3]],
    )
  })
  const completion = spec.settleOnExit === true
    ? new Promise<CLI.CommandCloseResult>(resolve => {
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    : close
  try {
    // The channel stays open after admission: it is the link that stops the tree when this
    // process dies, and `release` closes it once the child has exited on its own.
    await ProcessLifetime.admit(child, registration)
  } catch (error) {
    await rollbackUnpublishedLaunch(child, rootIdentity).catch(reportRegistrationFailure)
    Errors.throwHostEnvironment('The private process admission channel failed; launch refused.', { cause: error })
  }
  return {
    assertCleanup() {
      captureNaturalExit()
      if (uncertain || !shutdownCaptured) {
        Errors.throwHostEnvironment('Descendant cleanup remains uncertain; its resource record was retained.')
      }
      retireRegistration()
    },
    async closeOutput() {
      child.stdout?.destroy()
      child.stderr?.destroy()
    },
    dispose() {
      retireRegistration()
      releaseCompletion()
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.removeAllListeners()
    },
    get exitCode() {
      return child.exitCode
    },
    kill(signal = 'SIGTERM') {
      try {
        captureForStop()
        const captured = liveOwned()
        ProcessTree.signalTracked(captured, signal)
        return captured.length !== 0
      } catch (error) {
        try {
          markUncertain()
        } catch (recordError) {
          reportRegistrationFailure(recordError)
        }
        reportRegistrationFailure(error)
        return false
      }
    },
    isRunning() {
      const pid = child.pid
      if (pid === undefined) {
        return false
      }
      return liveOwned().length !== 0 || ProcessTree.groupMembers(pid).length !== 0
    },
    onceClose(listener) {
      void close.then(result => listener(result.exitCode, result.signal))
    },
    onceError(listener) {
      child.once('error', listener)
    },
    get signalCode() {
      return child.signalCode
    },
    waitForClose: () => completion,
  }
}

/** Sends TERM to the process group, escalates to KILL after a bound, and waits for cleanup. */
export async function stopStudioProcessTree(
  command: StudioProcessTree,
  options: {
    sleep?: (milliseconds: number) => Promise<void>
    timeoutMs?: number
    waitForClose?: () => Promise<unknown>
  } = {},
): Promise<void> {
  const waitForClose = options.waitForClose ?? finalizeStudioProcessTree(command)
  const closed = waitForClose().then(() => true)
  command.kill('SIGTERM')
  const sleep = options.sleep ?? Time.sleep
  const timeoutMs = options.timeoutMs ?? defaultStopTimeoutMs
  const gracefullyClosed = await waitForStudioProcessGroupExit(command, sleep, timeoutMs)
  if (!gracefullyClosed) {
    command.kill('SIGKILL')
  }
  // A root exit alone cannot release ownership of surviving descendants.
  const fullyStopped = gracefullyClosed || await waitForStudioProcessGroupExit(command, sleep, timeoutMs)
  if (!fullyStopped) {
    Errors.throwHostEnvironment(
      'Process-group cleanup is incomplete; retain its resource record and inspect tao resources.',
    )
  }
  const outputClosed = await Promise.race([closed, sleep(timeoutMs).then(() => false)])
  if (!outputClosed) {
    Errors.throwHostEnvironment(
      'Process output did not close after shutdown; retain its resource record and inspect tao resources.',
    )
  }
  command.assertCleanup?.()
}

/** Admission rollback owns the actual spawn even if its final provenance write failed. */
async function rollbackUnpublishedLaunch(
  child: ReturnType<typeof Platform.spawn>,
  root: TrackedProcess | undefined,
): Promise<void> {
  try {
    if (root === undefined) {
      Errors.throwHostEnvironment('Launch identity is unavailable; preserve its unverified intent.')
    }
    const tracked = [root]
    if (ProcessTree.sameProcess(ProcessTree.identities([root.pid]).get(root.pid), root)) {
      const descendants = ProcessTree.descendants(root.pid)
      if (!ProcessTree.sameProcess(ProcessTree.identities([root.pid]).get(root.pid), root)) {
        Errors.throwHostEnvironment('Launch identity changed during rollback capture; preserve its unverified intent.')
      }
      tracked.push(...descendants)
    }
    ProcessTree.signalTracked(tracked, 'SIGTERM')
    for (let waited = 0; waited < defaultStopTimeoutMs; waited += 25) {
      const identities = ProcessTree.identities(tracked.map(process => process.pid))
      const pending = tracked.filter(process => {
        const current = identities.get(process.pid)
        return current === undefined
          ? Platform.hostPlatform === 'darwin' && Platform.processIsAlive(process.pid)
          : ProcessTree.sameProcess(current, process)
      })
      if (pending.length === 0) {
        return
      }
      if (waited >= 250) {
        ProcessTree.signalTracked(pending, 'SIGKILL')
      }
      await Time.sleep(25)
    }
    Errors.throwHostEnvironment('Refused launch rollback is unproved; preserve its discovery intent.')
  } finally {
    ProcessLifetime.destroyChannel(child)
    child.stdout?.destroy()
    child.stderr?.destroy()
  }
}

/** Makes waiting and releasing a process tree idempotent. */
export function finalizeStudioProcessTree(command: StudioProcessTree): WaitForStudioProcessTreeClose {
  let finalizing: Promise<CLI.CommandCloseResult> | undefined
  return () => {
    finalizing ??= (async () => {
      try {
        return await command.waitForClose()
      } finally {
        await command.closeOutput()
        command.dispose()
      }
    })()
    return finalizing
  }
}

export function processGroupKillSpec(
  pid: number,
  signal: Platform.ProcessSignal,
): { args: string[]; command: string } {
  return { args: [`-${signal.replace(/^SIG/, '')}`, '--', `-${pid}`], command: '/bin/kill' }
}

async function waitForStudioProcessGroupExit(
  command: StudioProcessTree,
  sleep: (milliseconds: number) => Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let waitedMs = 0
  while (command.isRunning()) {
    if (waitedMs >= timeoutMs) {
      return false
    }
    const delay = Math.min(25, timeoutMs - waitedMs)
    await sleep(delay)
    waitedMs += delay
  }
  return true
}
