import { FS } from '@shared'

const PRESSURE_RESOURCES = ['cpu', 'io', 'memory'] as const
const TOP_CPU_PROCESSES = 6

type ProcEntry = {
  pid: number
  ppid: number
  comm: string
  state: string
  threads: string
  cpuTicks: number
}

/**
 * Report what a Chrome that never exposed DevTools was waiting on, from procfs alone, so a hosted
 * timeout carries the evidence that separates CPU starvation (high pressure, runnable children) from
 * slow disk (io pressure, children in state D) from a stuck child (idle state with a futex wait).
 * Every section is best effort: a missing file reports itself and never hides the startup failure.
 */
export function describeChromeStall(
  pid: number | undefined,
  profile: string,
  procRoot = '/proc',
): string {
  const lines = [
    section('load', () => FS.readTextSync(FS.resolvePath('loadavg', procRoot)).trim()),
    ...PRESSURE_RESOURCES.map(resource =>
      section(
        `pressure ${resource}`,
        () => FS.readTextSync(FS.resolvePath(`pressure/${resource}`, procRoot)).trim().replace(/\n/gu, ' | '),
      )
    ),
  ]
  let table: ProcEntry[] = []
  lines.push(section('machine', () => {
    table = readProcessTable(procRoot)
    const count = (state: string) => table.filter(entry => entry.state === state).length
    return `${table.length} processes, ${count('R')} runnable, ${count('D')} in uninterruptible wait`
  }))
  lines.push(
    section(
      'busiest',
      () =>
        [...table].sort((left, right) => right.cpuTicks - left.cpuTicks).slice(0, TOP_CPU_PROCESSES)
          .map(entry => `${entry.pid} ${entry.comm} ${entry.state} ${entry.cpuTicks} ticks`).join('; '),
    ),
  )
  if (pid !== undefined) {
    lines.push(section(`chrome tree of ${pid}`, () => {
      const tree = subtree(table, pid)
      return tree.length === 0
        ? 'no process found'
        : tree.map(entry =>
          `${entry.pid}<${entry.ppid} ${entry.comm} ${entry.state} threads=${entry.threads} wchan=${
            readWchan(procRoot, String(entry.pid))
          }`
        ).join('; ')
    }))
    lines.push(section(`chrome main threads of ${pid}`, () => threadStates(procRoot, pid)))
  }
  lines.push(section('profile entries', () => FS.listDirSync(profile).sort().join(' ') || 'empty'))
  return `Stall snapshot:\n${lines.join('\n')}\n`
}

function section(label: string, read: () => string): string {
  try {
    return `${label}: ${read()}`
  } catch (error) {
    return `${label}: unavailable (${(error as NodeJS.ErrnoException).code ?? 'unreadable'})`
  }
}

function readProcessTable(procRoot: string): ProcEntry[] {
  return FS.listDirSync(procRoot).filter(name => /^[1-9]\d*$/u.test(name)).flatMap(name => {
    try {
      return [parseStat(Number(name), FS.readTextSync(FS.resolvePath(`${name}/stat`, procRoot)))]
    } catch {
      // The process exited between the listing and the read.
      return []
    }
  })
}

/** Fields after the final ')' follow proc_pid_stat(5): state, ppid, ..., utime, stime, ..., threads. */
function parseStat(pid: number, stat: string): ProcEntry {
  const open = stat.indexOf('(')
  const close = stat.lastIndexOf(')')
  const fields = stat.slice(close + 1).trim().split(/\s+/u)
  return {
    pid,
    ppid: Number(fields[1]),
    comm: stat.slice(open + 1, close),
    state: fields[0] ?? '?',
    threads: fields[17] ?? '?',
    cpuTicks: Number(fields[11]) + Number(fields[12]),
  }
}

function subtree(table: readonly ProcEntry[], rootPid: number): ProcEntry[] {
  const members = new Map<number, ProcEntry>()
  const root = table.find(entry => entry.pid === rootPid)
  if (root === undefined) {
    return []
  }
  members.set(root.pid, root)
  for (let grew = true; grew;) {
    grew = false
    for (const entry of table) {
      if (!members.has(entry.pid) && members.has(entry.ppid)) {
        members.set(entry.pid, entry)
        grew = true
      }
    }
  }
  return [...members.values()]
}

function readWchan(procRoot: string, taskPath: string): string {
  try {
    return FS.readTextSync(FS.resolvePath(`${taskPath}/wchan`, procRoot)).trim() || '-'
  } catch {
    return 'unreadable'
  }
}

function threadStates(procRoot: string, pid: number): string {
  const histogram = new Map<string, number>()
  for (const tid of FS.listDirSync(FS.resolvePath(`${pid}/task`, procRoot))) {
    try {
      const state = parseStat(Number(tid), FS.readTextSync(FS.resolvePath(`${pid}/task/${tid}/stat`, procRoot))).state
      const key = `${state}:${readWchan(procRoot, `${pid}/task/${tid}`)}`
      histogram.set(key, (histogram.get(key) ?? 0) + 1)
    } catch {
      // The thread exited between the listing and the read.
    }
  }
  return [...histogram].map(([key, count]) => `${key} x${count}`).join(', ') || 'none'
}
