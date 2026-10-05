import * as Errors from './core/Errors'
import { sleep } from './core/Time'
import * as Platform from './Platform'
import { inspectDarwinProcesses } from './ProcessTreeDarwin'
import { createLinuxProcessInspector } from './ProcessTreeLinux'

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
  /** Kernel start identity: seconds:microseconds on Darwin, raw ticks since boot on Linux. */
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

const linuxProcesses = createLinuxProcessInspector()

function requireProcessInspectionPlatform(platform = Platform.hostPlatform): void {
  if (platform !== 'darwin' && platform !== 'linux') {
    Errors.throwHostEnvironment(`Process inspection is not implemented on ${platform}.`)
  }
}

/**
 * descendantProcesses snapshots the whole owned tree before a teardown can orphan an escaped
 * process group. Each PID carries its OS start identity so a later signal cannot hit a reused PID.
 */
function descendantProcesses(rootPid: number): TrackedProcess[] {
  requireProcessInspectionPlatform()
  if (Platform.hostPlatform === 'darwin') {
    return darwinDescendantProcesses(rootPid)
  }
  return linuxProcesses.descendants(rootPid).map(({ group: _group, ...entry }) => entry)
}

/**
 * Darwin's libproc gives child PIDs and microsecond process-start identity inside the sandbox,
 * where a `ps` subprocess is both slower and one more thing that can be denied. The deepest
 * descendant is signalled first so a parent cannot spawn a replacement for a child already stopped.
 */
function darwinDescendantProcesses(rootPid: number): TrackedProcess[] {
  return inspectDarwinProcesses('descendants', [rootPid]).map(({ group: _group, ...process }) => process)
}

/** processGroupOf reads the kernel process group rather than trusting the spawn options. */
function processGroupOf(pid: number): number | undefined {
  requireProcessInspectionPlatform()
  if (Platform.hostPlatform === 'linux') {
    return linuxProcesses.identity(pid)?.group
  }
  return inspectDarwinProcesses('identities', [pid])[0]?.group
}

/** Exact kernel identities include orphaned members whose old parent no longer exists. */
function processGroupMembers(group: number): TrackedProcess[] {
  requireProcessInspectionPlatform()
  if (!Number.isSafeInteger(group) || group < 1 || group > 2_147_483_647) {
    Errors.throwUnexpected('Expected a valid process group for process inspection.')
  }
  return Platform.hostPlatform === 'linux'
    ? linuxProcesses.table().filter(entry => entry.group === group).map(({ group: _group, ...entry }) => entry)
    : inspectDarwinProcesses('group', [group]).map(({ group: _group, ...entry }) => entry)
}

/** processTable reads procfs on Linux and the fixed process listing on Darwin. */
function processTable(): ProcessTableEntry[] {
  requireProcessInspectionPlatform()
  if (Platform.hostPlatform === 'linux') {
    return linuxProcesses.table().map(({ group: _group, ...entry }) => entry)
  }
  const result = Platform.spawnSync('ps', {
    args: ['-axo', 'pid=,ppid=,lstart=,command='],
  })
  if (result.status !== 0) {
    Errors.throwHostEnvironment('Could not inspect the process table; process absence is unproved.', {
      details: { status: result.status },
    })
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
    requireProcessInspectionPlatform()
    if (Platform.hostPlatform === 'linux') {
      for (const pid of pids) {
        Platform.signalProcess(pid, signal)
      }
      return
    }
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
 * absent from the result. Linux reads the kernel's raw start ticks from /proc, and Darwin's
 * libproc start time is microsecond-precise. Neither relies on rounded ps wall-clock timestamps.
 */
function currentProcessIdentities(pids: readonly number[]): Map<number, TrackedProcess> {
  requireProcessInspectionPlatform()
  if (Platform.hostPlatform === 'linux') {
    return new Map(pids.flatMap(pid => {
      const entry = linuxProcesses.identity(pid)
      return entry === undefined ? [] : [[pid, entry] as const]
    }))
  }
  return new Map(
    inspectDarwinProcesses('identities', pids).map(({ group: _group, ...process }) => [process.pid, process]),
  )
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
  requireProcessInspectionPlatform()
  if (Platform.hostPlatform === 'linux') {
    return Platform.signalProcess(-pid, signal)
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

function processGroupIsAlive(
  pid: number,
  probe: typeof Platform.signalProcess = Platform.signalProcess,
  seams: { platform?: typeof Platform.hostPlatform; linuxGroupIsAlive?: (group: number) => boolean } = {},
): boolean {
  const platform = seams.platform ?? Platform.hostPlatform
  requireProcessInspectionPlatform(platform)
  if (platform === 'linux') {
    // kill(0) also succeeds for unreaped zombie groups, which no longer hold our pipes.
    // The proc table filters exited members and refuses unreadable or malformed identities.
    return (seams.linuxGroupIsAlive ?? linuxProcesses.groupIsAlive)(pid)
  }
  return probe(-pid, 0)
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
  groupMembers: processGroupMembers,
  processTable,
  sameProcess,
  signalGroup: signalProcessGroup,
  signalTracked: signalTrackedProcesses,
  stopTree,
  systemSignalSeams: systemProcessSignalSeams,
  waitForGroupExit: waitForProcessGroupExit,
  waitForTrackedExit: waitForTrackedProcessesExit,
} as const
