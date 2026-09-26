import { CLI, Platform, Time } from '@shared'

export type StudioProcessTree =
  & Pick<
    CLI.StartedCommand,
    'closeOutput' | 'dispose' | 'exitCode' | 'kill' | 'onceClose' | 'onceError' | 'signalCode' | 'waitForClose'
  >
  & {
    isRunning: () => boolean
  }

export type StudioProcessTreeSpec = Pick<CLI.CommandSpec, 'args' | 'cwd' | 'env' | 'onOutput'> & {
  onError?: (error: Error) => void
  /** Resolve when the process exits even if a descendant still holds its captured output pipes. */
  settleOnExit?: boolean
  stdio?: Platform.SpawnOptions['stdio']
}

export type WaitForStudioProcessTreeClose = () => Promise<CLI.CommandCloseResult>

const defaultStopTimeoutMs = 3_000

/** Starts a command in its own process group so its complete subprocess tree can be stopped. */
export function startStudioProcessTree(command: string, spec: StudioProcessTreeSpec = {}): StudioProcessTree {
  const child = Platform.spawn(command, {
    args: [...(spec.args ?? [])],
    cwd: spec.cwd,
    detached: true,
    env: spec.env,
    stdio: spec.stdio ?? ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', chunk => spec.onOutput?.('stdout', Buffer.from(chunk)))
  child.stderr?.on('data', chunk => spec.onOutput?.('stderr', Buffer.from(chunk)))
  child.on('error', error => spec.onError?.(error))
  let releaseCompletion = () => {}
  const close = new Promise<CLI.CommandCloseResult>(resolve => {
    releaseCompletion = Platform.onChildProcessClose(child, (exitCode, signal) => resolve({ exitCode, signal }))
  })
  const completion = spec.settleOnExit === true
    ? new Promise<CLI.CommandCloseResult>(resolve => {
      child.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    : close
  return {
    async closeOutput() {
      child.stdout?.destroy()
      child.stderr?.destroy()
    },
    dispose() {
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
      const pid = child.pid
      if (pid === undefined) {
        return false
      }
      const kill = processGroupKillSpec(pid, signal)
      return Platform.spawnSync(kill.command, { args: kill.args, stdio: 'ignore' }).status === 0
    },
    isRunning() {
      const pid = child.pid
      if (pid === undefined) {
        return false
      }
      const probe = processGroupProbeSpec(pid)
      return Platform.spawnSync(probe.command, { args: probe.args, stdio: 'ignore' }).status === 0
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
  const stopped = Promise.all([
    closed,
    waitForStudioProcessGroupExit(command, sleep),
  ]).then(() => true)
  const gracefullyClosed = command.isRunning()
    ? await Promise.race([
      stopped,
      sleep(options.timeoutMs ?? defaultStopTimeoutMs).then(() => false),
    ])
    : await closed
  if (!gracefullyClosed) {
    command.kill('SIGKILL')
  }
  await closed
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

function processGroupProbeSpec(pid: number): { args: string[]; command: string } {
  return { args: ['-0', '--', `-${pid}`], command: '/bin/kill' }
}

async function waitForStudioProcessGroupExit(
  command: StudioProcessTree,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  while (command.isRunning()) {
    await sleep(25)
  }
}
