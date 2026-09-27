import * as Errors from './core/Errors'
import * as FS from './FS'
import { runtimeProcess } from './Platform'
import type { ProcessTableEntry } from './ProcessTree'

type LinuxProcess = ProcessTableEntry & { group: number }
type ProcFiles = Pick<typeof FS, 'listDirSync' | 'readTextSync'>

/**
 * Linux exposes the supervision fields in /proc/PID/stat without a procps dependency. The
 * starttime field is kept as raw clock ticks since boot, never rounded to wall-clock seconds.
 * https://www.kernel.org/doc/html/latest/filesystems/proc.html
 * https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html
 */
export function createLinuxProcessInspector(
  procRoot = '/proc',
  files: ProcFiles = { listDirSync: FS.listDirSync, readTextSync: FS.readTextSync },
) {
  const identity = (pid: number): LinuxProcess | undefined => {
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2_147_483_647) {
      Errors.throwUnexpected('Expected valid process IDs for process inspection.')
    }
    let stat: string
    try {
      stat = files.readTextSync(FS.resolvePath(`${pid}/stat`, procRoot))
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ESRCH') {
        return undefined
      }
      Errors.throwHostEnvironment(`Could not read Linux process ${pid}.`, { cause })
    }
    // comm is unescaped and may contain spaces, parentheses and newlines. The final ')' is
    // its delimiter; everything after it is the state and numeric stat fields.
    const open = stat.indexOf('(')
    const close = stat.lastIndexOf(')')
    const fields = stat.slice(close + 1).trim().split(/\s+/u)
    const parent = fields[1] ?? ''
    const group = fields[2] ?? ''
    const threads = fields[17] ?? ''
    const ticks = fields[19] ?? ''
    // do_task_stat leaves these defaults if __exit_signal removes sighand during the read.
    // State was sampled before that lock, so even R/S can accompany this precise exit sentinel.
    const exitedDuringRead = parent === '0' && group === '-1' && threads === '0'
    if (
      open < 1 || close <= open || stat.slice(0, open).trim() !== String(pid)
      || !/^[RSDZTtWXxKPI]$/u.test(fields[0] ?? '') || fields.length < 20
      || !/^\d+$/u.test(parent) || (!/^\d+$/u.test(group) && !exitedDuringRead) || !/^\d+$/u.test(ticks)
      || !Number.isSafeInteger(Number(parent)) || Number(parent) > 2_147_483_647
      || !Number.isSafeInteger(Number(group)) || Number(group) > 2_147_483_647
      || !/^\d+$/u.test(threads) || !Number.isSafeInteger(Number(threads))
    ) {
      Errors.throwHostEnvironment(`Linux process ${pid} returned malformed /proc stat data.`)
    }
    if (exitedDuringRead) {
      return undefined
    }
    // A leader that called pthread_exit can be a zombie while worker threads still hold pipes.
    // The kernel counts that unreaped leader in num_threads; only its final singleton entry is
    // gone for supervision. Waiting for kill(pid, 0) then would hang under a non-reaping init.
    if ((fields[0] === 'Z' || fields[0] === 'X' || fields[0] === 'x') && Number(threads) <= 1) {
      return undefined
    }
    return {
      command: stat.slice(open + 1, close),
      pid,
      ppid: Number(parent),
      group: Number(group),
      startedAt: ticks,
    }
  }
  const table = (): LinuxProcess[] => {
    let names: string[]
    try {
      names = files.listDirSync(procRoot)
    } catch (cause) {
      Errors.throwHostEnvironment('Could not list Linux processes in /proc.', { cause })
    }
    return names.filter(name => /^[1-9]\d*$/u.test(name)).flatMap(name => {
      const entry = identity(Number(name))
      return entry === undefined ? [] : [entry]
    })
  }
  const descendants = (rootPid: number): LinuxProcess[] => {
    const byParent = new Map<number, LinuxProcess[]>()
    for (const entry of table()) {
      const children = byParent.get(entry.ppid) ?? []
      children.push(entry)
      byParent.set(entry.ppid, children)
    }
    const found: Array<{ entry: LinuxProcess; depth: number }> = []
    const visited = new Set([rootPid, runtimeProcess.pid])
    const visit = (pid: number, depth: number) => {
      for (const child of byParent.get(pid) ?? []) {
        if (visited.has(child.pid)) {
          continue
        }
        visited.add(child.pid)
        found.push({ entry: child, depth })
        visit(child.pid, depth + 1)
      }
    }
    visit(rootPid, 1)
    return found.sort((left, right) => right.depth - left.depth).map(({ entry }) => entry)
  }
  const groupIsAlive = (group: number): boolean => table().some(entry => entry.group === group)
  return { identity, table, descendants, groupIsAlive }
}
