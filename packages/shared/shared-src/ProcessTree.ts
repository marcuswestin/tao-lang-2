import type { Pointer } from 'bun:ffi'
import { createRequire } from 'node:module'
import * as Errors from './core/Errors'
import { sleep } from './core/Time'
import * as Platform from './Platform'

/**
 * Stopping a child is not stopping what the child started. A lane that signals only its direct
 * child leaves a runaway grandchild — a `bun test` allocating unboundedly, a simulator launch that
 * ignores SIGTERM — holding the machine with nothing left to kill it. This module is the one place
 * that knows how to find a child's whole owned tree, signal exactly that tree and nothing else, and
 * wait until it is really gone.
 *
 * Two identity rules keep a teardown from hitting a stranger. A PID alone is not an identity: the
 * kernel reuses it, so a snapshot taken before cancellation can name a process that has since died
 * and had its number handed to somebody else's work. Every tracked process therefore carries its OS
 * process-start time, and a signal is delivered only to a PID whose start identity still matches.
 * And a lane may stop only what it started: nothing here searches for processes by name or command.
 */

/** TrackedProcess names one owned process by PID together with the identity that survives PID reuse. */
export type TrackedProcess = {
  command: string
  pid: number
  /** Kernel process start time, including microseconds on Darwin, protects against PID reuse. */
  startedAt: string
}

/** ProcessTableEntry is a tracked process plus the parent link a tree walk needs. */
export type ProcessTableEntry = TrackedProcess & { ppid: number }

/**
 * ProcessSignalSeams is the seam `signalTracked` reads the world through, so a test can prove the
 * identity filter without a real process to signal.
 */
export type ProcessSignalSeams = {
  identities: (pids: readonly number[]) => Map<number, TrackedProcess>
  signal: (pids: readonly number[], signal: Platform.ProcessSignal) => void
}

/** How long a stopped process gets to honor SIGTERM before it is killed outright. */
const FORCE_KILL_GRACE_MS = 250

/** How often a wait loop re-reads whether the tree it stopped has gone. */
const EXIT_POLL_MS = 25

type BunFfi = typeof import('bun:ffi')

let bunFfi: BunFfi | undefined

/**
 * `bun:ffi` is reached through a runtime require rather than a static import: `@shared` is also
 * bundled for the IDE extension by esbuild, which cannot resolve a Bun-only specifier at all. A
 * lazy require keeps the specifier out of the module graph, and nothing here runs in that bundle.
 * The base path is the filesystem root rather than this module, because a builtin specifier needs
 * no resolution base and `import.meta.url` is empty in the extension's CommonJS bundle.
 */
function ffi(): BunFfi {
  bunFfi ??= createRequire('/')('bun:ffi') as BunFfi
  return bunFfi
}

/**
 * descendantProcesses snapshots the whole owned tree before a teardown can orphan an escaped
 * process group. Each PID carries its OS start identity so a later signal cannot hit a reused PID.
 */
function descendantProcesses(rootPid: number): TrackedProcess[] {
  if (process.platform === 'darwin') {
    return darwinDescendantProcesses(rootPid)
  }
  const byParent = new Map<number, TrackedProcess[]>()
  for (const process of processTable()) {
    const children = byParent.get(process.ppid) ?? []
    children.push(process)
    byParent.set(process.ppid, children)
  }
  const descendants: Array<TrackedProcess & { depth: number }> = []
  const visit = (pid: number, depth: number) => {
    for (const child of byParent.get(pid) ?? []) {
      descendants.push({ ...child, depth })
      visit(child.pid, depth + 1)
    }
  }
  visit(rootPid, 1)
  return descendants.toSorted((left, right) => right.depth - left.depth).map(({ depth: _depth, ...process }) => process)
}

/**
 * Darwin's libproc gives child PIDs and microsecond process-start identity inside the sandbox,
 * where a `ps` subprocess is both slower and one more thing that can be denied. The deepest
 * descendant is signalled first so a parent cannot spawn a replacement for a child already stopped.
 */
function darwinDescendantProcesses(rootPid: number): TrackedProcess[] {
  const { dlopen, FFIType, ptr } = ffi()
  const library = dlopen('/usr/lib/libproc.dylib', {
    proc_listchildpids: {
      args: [FFIType.i32, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
    proc_pidinfo: {
      args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
  })
  try {
    const descendants: Array<TrackedProcess & { depth: number }> = []
    const visited = new Set<number>([rootPid])
    const visit = (pid: number, depth: number) => {
      const children = new Int32Array(4_096)
      const count = library.symbols.proc_listchildpids(pid, ptr(children), children.byteLength)
      for (const childPid of children.subarray(0, Math.min(Math.max(0, count), children.length))) {
        if (!Number.isSafeInteger(childPid) || childPid <= 1 || visited.has(childPid)) {
          continue
        }
        visited.add(childPid)
        const child = darwinProcessIdentity(childPid, library.symbols.proc_pidinfo)
        if (child === undefined) {
          continue
        }
        descendants.push({ ...child, depth })
        visit(childPid, depth + 1)
      }
    }
    visit(rootPid, 1)
    return descendants.toSorted((left, right) => right.depth - left.depth)
      .map(({ depth: _depth, ...process }) => process)
  } finally {
    library.close()
  }
}

function darwinProcessIdentity(
  pid: number,
  inspect: (pid: number, flavor: number, arg: number, buffer: Pointer, size: number) => number,
): TrackedProcess | undefined {
  const bytes = new Uint8Array(136)
  if (inspect(pid, 3, 0, ffi().ptr(bytes), bytes.byteLength) < bytes.byteLength) {
    return undefined
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(12, true) !== pid) {
    return undefined
  }
  return {
    command: darwinProcessName(bytes),
    pid,
    startedAt: `${view.getBigUint64(120, true)}:${view.getBigUint64(128, true)}`,
  }
}

/**
 * processGroupOf reads which process group a PID belongs to, so a caller can see whether a child
 * was detached rather than having to trust the option it passed. `proc_bsdinfo` carries `pbi_pgid`
 * at offset 100, beside the `pbi_pid` at 12 that guards against a stale read.
 */
function processGroupOf(pid: number): number | undefined {
  if (process.platform !== 'darwin') {
    Errors.throwHostEnvironment('Reading a process group id is only implemented on macOS.')
  }
  const { dlopen, FFIType } = ffi()
  const library = dlopen('/usr/lib/libproc.dylib', {
    proc_pidinfo: {
      args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
  })
  try {
    const bytes = new Uint8Array(136)
    if (library.symbols.proc_pidinfo(pid, 3, 0, ffi().ptr(bytes), bytes.byteLength) < bytes.byteLength) {
      return undefined
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return view.getUint32(12, true) === pid ? view.getUint32(100, true) : undefined
  } finally {
    library.close()
  }
}

function darwinProcessName(bytes: Uint8Array): string {
  const decode = (offset: number, length: number) =>
    new TextDecoder().decode(bytes.subarray(offset, offset + length)).replace(/\0.*$/, '')
  return decode(64, 32) || decode(48, 16)
}

/** processTable uses the repository-approved fixed process listing, not caller-shaped ps arguments. */
function processTable(): ProcessTableEntry[] {
  const result = Platform.spawnSync('ps', {
    args: ['-axo', 'pid=,ppid=,lstart=,command='],
  })
  if (result.status !== 0) {
    return []
  }
  const processes: ProcessTableEntry[] = []
  for (const line of String(result.stdout).split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/)
    if (match === null) {
      continue
    }
    const pid = Number(match[1])
    const ppid = Number(match[2])
    if (Number.isSafeInteger(pid) && pid > 1 && Number.isSafeInteger(ppid) && ppid >= 0) {
      processes.push({ command: match[4]!, pid, ppid, startedAt: match[3]! })
    }
  }
  return processes
}

/** signalTrackedProcesses signals only PIDs whose start identities still match the owned snapshot. */
function signalTrackedProcesses(
  processes: readonly TrackedProcess[],
  signal: Platform.ProcessSignal,
  seams: ProcessSignalSeams = systemProcessSignalSeams,
): void {
  if (processes.length === 0) {
    return
  }
  const current = seams.identities(processes.map(process => process.pid))
  const pids = processes
    .filter(process => sameProcess(current.get(process.pid), process))
    .map(process => process.pid)
  if (pids.length > 0) {
    seams.signal(pids, signal)
  }
}

const systemProcessSignalSeams: ProcessSignalSeams = {
  identities: currentProcessIdentities,
  signal: (pids, signal) => {
    Platform.spawnSync('/bin/kill', {
      args: [`-${signal.replace(/^SIG/, '')}`, '--', ...pids.map(String)],
      stdio: 'ignore',
    })
  },
}

/**
 * Identity is the start time alone. `command` is descriptive and deliberately not compared: it is
 * read from the kernel's process name, which changes at `exec`, while the start time is set at
 * `fork` and never moves. A shell that backgrounds `sleep 300` reports the PID between the two, so
 * a snapshot taken then records the shell's own name and every later reading disagrees with it.
 *
 * Comparing it was wrong in the direction that matters. `signalTrackedProcesses` skipped a
 * descendant that exec'd between the snapshot and the signal — the runaway this module exists to
 * stop — and `waitForTrackedProcessesExit` called such a tree gone while it was still running. The
 * `'test'` policy caches its descendant list once and reuses it across the 250ms SIGKILL
 * escalation, so that window was milliseconds wide rather than microseconds.
 */
function sameProcess(current: TrackedProcess | undefined, expected: TrackedProcess): boolean {
  return current !== undefined && current.startedAt === expected.startedAt
}

/**
 * currentProcessIdentities answers for exactly the PIDs it was asked about; a PID that is gone is
 * absent from the result. Outside Darwin the only reading available is `ps`, whose `lstart` has
 * one-second granularity — enough to catch a PID the kernel handed on minutes later, not enough to
 * catch one reused inside the same second. Darwin's libproc start time is microsecond-precise and
 * needs no subprocess, which is why it is the primary path and the one every lane on this host
 * takes.
 */
function currentProcessIdentities(pids: readonly number[]): Map<number, TrackedProcess> {
  if (process.platform !== 'darwin') {
    // Filtered to the asked-about PIDs: the table is every process on the host, and handing the
    // whole of it back made callers that pair each entry with its expected identity look up
    // processes they never asked about and find nothing.
    const wanted = new Set(pids)
    return new Map(
      processTable().filter(entry => wanted.has(entry.pid)).map(entry => [entry.pid, entry]),
    )
  }
  const { dlopen, FFIType } = ffi()
  const library = dlopen('/usr/lib/libproc.dylib', {
    proc_pidinfo: {
      args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
      returns: FFIType.i32,
    },
  })
  try {
    return new Map(pids.flatMap(pid => {
      const process = darwinProcessIdentity(pid, library.symbols.proc_pidinfo)
      return process === undefined ? [] : [[pid, process] as const]
    }))
  } finally {
    library.close()
  }
}

async function waitForTrackedProcessesExit(processes: readonly TrackedProcess[]): Promise<void> {
  // Asked of the expected processes rather than of whatever the reading returned, so an entry with
  // no expectation behind it cannot be paired with one that is not there.
  const pids = processes.map(process => process.pid)
  for (;;) {
    const current = currentProcessIdentities(pids)
    if (!processes.some(expected => sameProcess(current.get(expected.pid), expected))) {
      return
    }
    await sleep(EXIT_POLL_MS)
  }
}

/** signalProcessGroup stops a detached command and every descendant that inherited its pipes. */
function signalProcessGroup(pid: number | undefined, signal: Platform.ProcessSignal): boolean {
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) {
    return false
  }
  const result = Platform.spawnSync('/bin/kill', {
    args: [`-${signal.replace(/^SIG/, '')}`, '--', `-${pid}`],
    stdio: 'ignore',
  })
  return result.status === 0
}

/** waitForProcessGroupExit keeps a teardown pending until no descendant remains signalable. */
async function waitForProcessGroupExit(pid: number | undefined): Promise<void> {
  if (pid === undefined) {
    return
  }
  while (processGroupIsAlive(pid)) {
    await sleep(EXIT_POLL_MS)
  }
}

function processGroupIsAlive(pid: number): boolean {
  return Platform.spawnSync('/bin/kill', { args: ['-0', '--', `-${pid}`], stdio: 'ignore' }).status === 0
}

/**
 * stopTree stops a detached child's whole process group, escalating to SIGKILL, and waits for exit.
 * A process stopped for hanging may ignore SIGTERM — the Studio canary's surviving launch process
 * did — and would then hold the lane open through the very mechanism meant to unblock it.
 */
async function stopTree(pid: number | undefined, options: { graceMs?: number } = {}): Promise<void> {
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) {
    return
  }
  const tracked = descendantProcesses(pid)
  signalTrackedProcesses(tracked, 'SIGTERM')
  signalProcessGroup(pid, 'SIGTERM')
  const forceKill = setTimeout(() => {
    signalTrackedProcesses(tracked, 'SIGKILL')
    signalProcessGroup(pid, 'SIGKILL')
  }, options.graceMs ?? FORCE_KILL_GRACE_MS)
  try {
    await Promise.all([
      waitForProcessGroupExit(pid),
      waitForTrackedProcessesExit(tracked),
    ])
  } finally {
    clearTimeout(forceKill)
  }
}

/** ProcessTree finds, signals and waits out the process tree one owned child started. */
export const ProcessTree = {
  FORCE_KILL_GRACE_MS,
  descendants: descendantProcesses,
  identities: currentProcessIdentities,
  isGroupAlive: processGroupIsAlive,
  processGroupOf,
  processTable,
  sameProcess,
  signalGroup: signalProcessGroup,
  signalTracked: signalTrackedProcesses,
  stopTree,
  systemSignalSeams: systemProcessSignalSeams,
  waitForGroupExit: waitForProcessGroupExit,
  waitForTrackedExit: waitForTrackedProcessesExit,
} as const
