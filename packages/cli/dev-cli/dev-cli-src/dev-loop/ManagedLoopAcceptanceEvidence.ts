import { MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform } from '@shared'
import { ProcessTree, type TrackedProcess } from '@shared/ProcessTree'

type ResourceIdentity = { generation: string; name: string; pid: number; retained: boolean }

/** Acquire descendants only while both the live child handle and root kernel identity agree. */
export function captureManagedForegroundProcesses(
  child: Pick<CLI.StartedCommand, 'pid' | 'exitCode' | 'signalCode' | 'error'>,
  expected: TrackedProcess | undefined,
  identities = ProcessTree.identities,
  descendants = ProcessTree.descendants,
): { root?: TrackedProcess; processes: TrackedProcess[]; uncertain: boolean } {
  const alive = (): boolean => child.error === undefined && child.exitCode === null && child.signalCode === null
  if (child.pid === undefined || !alive()) {
    return { root: expected, processes: [], uncertain: expected === undefined }
  }
  const root = identities([child.pid]).get(child.pid)
  if (root === undefined || expected !== undefined && !ProcessTree.sameProcess(expected, root) || !alive()) {
    return { root: expected, processes: [], uncertain: true }
  }
  const candidates = descendants(child.pid)
  const after = identities([child.pid]).get(child.pid)
  if (!alive() || !ProcessTree.sameProcess(after, root)) {
    return { root, processes: [root], uncertain: true }
  }
  return { root, processes: [root, ...candidates], uncertain: false }
}
export type ManagedLoopInventory = {
  processCount: number
  peers: (TrackedProcess & { kind: string; role?: 'primary' | 'helper'; ppid?: number; parentStartedAt?: string })[]
  resources: ResourceIdentity[]
  targets?: { platform: 'ios' | 'android'; id: string; state: string }[]
  targetInspection?: { ios: 'complete' | 'unavailable'; android: 'complete' | 'unavailable' }
  listeners?: { pid: number; startedAt: string; port: number }[]
}

/** File paths mentioning a host are not a host: source test workers keep their kernel executable. */
function processKind(kernelCommand: string, argv: string): string | undefined {
  const executable = FS.basename(kernelCommand).toLowerCase()
  if (/^(?:google chrome|chrome|chromium)(?:$|[ -])/u.test(executable)) {
    return 'chrome'
  }
  if (/^(?:tao[ -]?studio|studio|electrobun)(?:$|[ .-])/u.test(executable)) {
    return 'studio'
  }
  if (/^(?:emulator$|qemu-system-)/u.test(executable)) {
    return 'emulator'
  }
  if (executable === 'xcodebuild') {
    return 'xcodebuild'
  }
  if (!/^(?:node|bun)$/u.test(executable)) {
    return undefined
  }
  if (/\/(?:expo\/bin\/cli(?:\.js)?|\.bin\/expo|metro\/src\/cli\.js)\s+start(?:\s|$)/u.test(argv)) {
    return 'metro'
  }
  if (/\/appium\/(?:build\/lib\/main\.js|index\.js)(?:\s|$)/u.test(argv)) {
    return 'appium'
  }
  return undefined
}

/** Read the entire table privately, then resolve kernel identities rather than ps timestamps. */
async function inventory(): Promise<ManagedLoopInventory> {
  const table = ProcessTree.processTable()
  if (table.length === 0) {
    Errors.throwHostEnvironment(
      'Complete process inspection is unavailable; managed acceptance cannot prove preservation.',
    )
  }
  const selected = table.filter(process =>
    /chrome|metro|expo|studio|electrobun|emulator|qemu|xcodebuild|appium/iu.test(process.command)
  )
  const identities = ProcessTree.identities(selected.map(process => process.pid))
  const parents = ProcessTree.identities([...new Set(selected.map(process => process.ppid))].filter(pid => pid > 1))
  const targets: NonNullable<ManagedLoopInventory['targets']> = []
  const targetInspection: NonNullable<ManagedLoopInventory['targetInspection']> = {
    ios: 'unavailable',
    android: 'unavailable',
  }
  const ios = await CLI.run('xcrun', {
    args: ['simctl', 'list', 'devices', '--json'],
    processPolicy: 'test',
    timeoutMs: 30_000,
  })
  if (ios.exitCode === 0 && ios.error === undefined) {
    const value = JSON.parse(ios.stdout) as { devices?: Record<string, { udid: string; state: string }[]> }
    if (value.devices !== undefined) {
      targets.push(
        ...Object.values(value.devices).flat().map(device => ({
          platform: 'ios' as const,
          id: device.udid,
          state: device.state,
        })),
      )
      targetInspection.ios = 'complete'
    }
  }
  const android = await CLI.run('adb', { args: ['devices'], processPolicy: 'test', timeoutMs: 30_000 })
  if (android.exitCode === 0 && android.error === undefined && android.stdout.includes('List of devices attached')) {
    targets.push(
      ...android.stdout.split(/\r?\n/u).flatMap(line => {
        const match = line.match(/^(\S+)\t+(\S+)/u)
        return match === null ? [] : [{ platform: 'android' as const, id: match[1]!, state: match[2]! }]
      }),
    )
    targetInspection.android = 'complete'
  }
  const listenerResult = await CLI.run('lsof', {
    args: ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'],
    processPolicy: 'test',
    timeoutMs: 30_000,
  })
  // lsof exit 1 with no stdout means a complete empty listener set, not an inspection error.
  if (
    listenerResult.error !== undefined
    || (listenerResult.exitCode !== 0
      && (listenerResult.exitCode !== 1 || listenerResult.stdout.trim() !== '' || listenerResult.stderr.trim() !== ''))
  ) {
    Errors.throwHostEnvironment(
      'Complete TCP listener inspection failed; managed acceptance cannot prove port cleanup.',
    )
  }
  let listenerPid: number | undefined
  const portEntries: { pid: number; port: number }[] = []
  for (const line of listenerResult.stdout.split(/\r?\n/u)) {
    if (/^p\d+$/u.test(line)) {
      listenerPid = Number(line.slice(1))
    }
    if (line.startsWith('n') && listenerPid !== undefined) {
      const port = Number(line.match(/:(\d+)$/u)?.[1])
      if (Number.isInteger(port) && port > 0 && port < 65_536) {
        portEntries.push({ pid: listenerPid, port })
      }
    }
  }
  const listenerIdentities = ProcessTree.identities([...new Set(portEntries.map(entry => entry.pid))])
  const listeners = portEntries.flatMap(entry => {
    const identity = listenerIdentities.get(entry.pid)
    return identity === undefined ? [] : [{ ...entry, startedAt: identity.startedAt }]
  })
  return {
    processCount: table.length,
    peers: selected.flatMap(process => {
      const identity = identities.get(process.pid)
      const kind = identity === undefined ? undefined : processKind(identity.command, process.command)
      return identity === undefined || kind === undefined ? [] : [{
        ...identity,
        // Command lines can carry unrelated secrets. Retain only a process class.
        command: 'scoped host peer',
        kind,
        role:
          kind === 'chrome' && (/Chrome Helper/iu.test(identity.command) || /(?:^|\s)--type=/u.test(process.command))
            ? 'helper' as const
            : 'primary' as const,
        ppid: process.ppid,
        parentStartedAt: parents.get(process.ppid)?.startedAt,
      }]
    }),
    resources: (await MachineResources.listOwners()).map(owner => ({
      generation: owner.id,
      name: owner.name,
      pid: owner.pid,
      retained: owner.retention !== undefined,
    })),
    targets,
    targetInspection,
    listeners,
  }
}

function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[^\s"']+/giu, 'Bearer [redacted]')
      .replace(/(token|authorization|capability|password|secret)(["']?\s*[:=]\s*["']?)[^\s,"'}]+/giu, '$1$2[redacted]')
      .replace(/TAO_DEV_LOOP_WORKER_CREDENTIALS=[^\s]+/gu, 'TAO_DEV_LOOP_WORKER_CREDENTIALS=[redacted]')
  }
  if (Array.isArray(value)) {
    return value.map(sanitize)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|authorization|capability|credentials|password|secret/iu.test(key))
        .map(([key, entry]) => [key, sanitize(entry)]),
    )
  }
  return value
}

function preserved(before: ManagedLoopInventory, after: ManagedLoopInventory): string[] {
  const changed = before.peers.filter(peer => peer.role !== 'helper').filter(peer =>
    !after.peers.some(current => current.pid === peer.pid && current.startedAt === peer.startedAt)
  ).map(peer => `Peer ${peer.kind} ${peer.pid}/${peer.startedAt} changed or exited.`)
  for (const resource of before.resources) {
    if (
      !after.resources.some(current =>
        current.name === resource.name && current.generation === resource.generation && current.pid === resource.pid
        && current.retained === resource.retained
      )
    ) {
      changed.push(`Peer resource ${resource.name}/${resource.generation} changed.`)
    }
  }
  for (const target of before.targets ?? []) {
    if (
      !after.targets?.some(current =>
        current.platform === target.platform && current.id === target.id && current.state === target.state
      )
    ) {
      changed.push(`Peer target ${target.platform}:${target.id} changed from ${target.state}.`)
    }
  }
  return changed
}

function helperChanges(before: ManagedLoopInventory, after: ManagedLoopInventory): TrackedProcess[] {
  return before.peers.filter(peer =>
    peer.role === 'helper'
    && !after.peers.some(current => current.pid === peer.pid && current.startedAt === peer.startedAt)
  ).map(peer => ({
    pid: peer.pid,
    startedAt: peer.startedAt,
    command: 'observed helper departure; causality unproved',
  }))
}

async function write(root: string, name: string, value: unknown): Promise<void> {
  await FS.writeJson(FS.resolvePath(`${name}.json`, root), sanitize(value), { mode: 0o600 })
}

/** A signal requires both invocation ownership and a fresh kernel match. Never adopt by PID/name. */
function signalOwned(identity: TrackedProcess, owned: readonly TrackedProcess[], signal: Platform.ProcessSignal): void {
  if (!owned.some(process => process.pid === identity.pid && process.startedAt === identity.startedAt)) {
    Errors.throwUnexpected('The finite acceptance runner may signal only a captured invocation-owned process.')
  }
  const live = ProcessTree.identities([identity.pid]).get(identity.pid)
  if (!ProcessTree.sameProcess(live, identity)) {
    Errors.throwHostEnvironment('The acceptance process identity changed; refusing to signal it.')
  }
  ProcessTree.signalTracked([identity], signal)
}

export const ManagedLoopAcceptanceEvidence = {
  helperChanges,
  inventory,
  preserved,
  processKind,
  sanitize,
  signalOwned,
  write,
} as const
