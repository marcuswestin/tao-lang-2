import { CLI, Platform, Time } from '@shared'

export type StudioProcessTree = Pick<
  CLI.StartedCommand,
  'closeOutput' | 'dispose' | 'exitCode' | 'kill' | 'signalCode' | 'waitForClose'
>

export type StudioProcessTreeSpec = Pick<CLI.CommandSpec, 'args' | 'cwd' | 'env' | 'onOutput'> & {
  onError?: (error: Error) => void
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
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', chunk => spec.onOutput?.('stdout', Buffer.from(chunk)))
  child.stderr?.on('data', chunk => spec.onOutput?.('stderr', Buffer.from(chunk)))
  child.on('error', error => spec.onError?.(error))
  const close = new Promise<CLI.CommandCloseResult>(resolve => {
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  return {
    async closeOutput() {
      child.stdout?.destroy()
      child.stderr?.destroy()
    },
    dispose() {
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
    get signalCode() {
      return child.signalCode
    },
    waitForClose: () => close,
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
  const gracefullyClosed = command.exitCode !== null || command.signalCode !== null
    ? await closed
    : await Promise.race([
      closed,
      (options.sleep ?? Time.sleep)(options.timeoutMs ?? defaultStopTimeoutMs).then(() => false),
    ])
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
