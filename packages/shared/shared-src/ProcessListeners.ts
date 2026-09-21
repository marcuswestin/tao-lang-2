import type * as CLI from './CLI'

/** ProcessListener is one process reported by lsof as listening on a TCP port. */
export type ProcessListener = {
  command: string
  name?: string
  pid: number
}

type LsofListenerResult = Pick<CLI.CommandResult, 'error' | 'exitCode' | 'stderr' | 'stdout'>

/** formatLsofListeners reads port listeners from a completed `lsof -F pcn` invocation. */
function formatLsofListeners(result: LsofListenerResult): ProcessListener[] | undefined {
  const listeners = parseLsofListeners(result.stdout)
  if (listeners.length > 0) {
    return listeners
  }
  if (result.error !== undefined) {
    return undefined
  }
  if (result.exitCode !== 0 && result.stdout.trim() === '' && result.stderr.trim() === '') {
    return []
  }
  return result.exitCode === 0 ? listeners : undefined
}

/** formatListeners formats listening processes for terminal output. */
function formatListeners(listeners: readonly ProcessListener[]): string {
  return listeners.map(listener =>
    `${listener.command} pid ${listener.pid}${listener.name ? ` (${listener.name})` : ''}`
  ).join(', ')
}

/** formatKillCommand returns the copy-pasteable graceful termination command for listeners. */
function formatKillCommand(listeners: readonly ProcessListener[]): string {
  return `kill -TERM ${listeners.map(listener => listener.pid).join(' ')}`
}

function parseLsofListeners(output: string): ProcessListener[] {
  const listeners: ProcessListener[] = []
  let current: Partial<ProcessListener> = {}
  const flush = () => {
    if (current.pid !== undefined) {
      listeners.push({
        command: current.command ?? 'unknown',
        name: current.name,
        pid: current.pid,
      })
    }
    current = {}
  }

  for (const line of output.split(/\r?\n/)) {
    if (line.length < 2) {
      continue
    }
    const field = line[0]
    const value = line.slice(1)
    if (field === 'p') {
      flush()
      const pid = Number(value)
      current = Number.isInteger(pid) ? { pid } : {}
    } else if (field === 'c') {
      current.command = value
    } else if (field === 'n') {
      current.name ??= value
    }
  }
  flush()

  const byPid = new Map(listeners.map(listener => [listener.pid, listener]))
  return [...byPid.values()]
}

/** ProcessListeners owns pure parsing and display of host listener records. */
export const ProcessListeners = {
  formatKillCommand,
  formatListeners,
  formatLsofListeners,
}
