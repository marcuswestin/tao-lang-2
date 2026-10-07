import * as Errors from './core/Errors'
import type { TrackedProcess } from './ProcessTree'

/** ProcessOutputOwnerSeams supplies native descriptor and identity snapshots for one capture. */
type ProcessOutputOwnerSeams = {
  readDescriptors: (pids?: readonly number[]) => string
  identities: (pids: readonly number[]) => Map<number, TrackedProcess>
  sameProcess: (current: TrackedProcess | undefined, expected: TrackedProcess) => boolean
}

type Descriptor = {
  access: string
  device?: string
  fd: number
  pid: number
  type: string
}

const invalidSnapshot = (): never =>
  Errors.throwHostEnvironment('Could not safely capture inherited output socket owners; process absence is unproved.')

function parseDescriptors(output: string): Descriptor[] {
  if (output.length === 0 || !output.endsWith('\n')) {
    return invalidSnapshot()
  }
  const descriptors: Descriptor[] = []
  let currentPid: number | undefined
  const seenDescriptors = new Set<string>()

  for (const line of output.split('\n')) {
    if (line.length === 0) {
      continue
    }
    const fields = line.split('\0')
    if (fields.at(-1) !== '') {
      return invalidSnapshot()
    }
    fields.pop()
    const record = new Map<string, string>()
    for (const field of fields) {
      if (field.length < 2) {
        return invalidSnapshot()
      }
      const name = field[0]!
      if (name !== 'p' && name !== 'f' && name !== 't' && name !== 'a' && name !== 'd') {
        return invalidSnapshot()
      }
      if (record.has(name)) {
        return invalidSnapshot()
      }
      record.set(name, field.slice(1))
    }

    const pidValue = record.get('p')
    if (pidValue !== undefined) {
      if (!/^[1-9]\d*$/.test(pidValue) || record.size !== 1) {
        return invalidSnapshot()
      }
      const pid = Number(pidValue)
      if (!Number.isSafeInteger(pid) || pid <= 1) {
        return invalidSnapshot()
      }
      currentPid = pid
    }
    const fdValue = record.get('f')
    if (fdValue === undefined) {
      if (record.size !== 1 || pidValue === undefined) {
        return invalidSnapshot()
      }
      continue
    }
    if (currentPid === undefined || !/^(?:0|[1-9]\d*)$/.test(fdValue)) {
      return invalidSnapshot()
    }
    const fd = Number(fdValue)
    const type = record.get('t')
    const access = record.get('a')
    if (
      !Number.isSafeInteger(fd) || type === undefined || type.length === 0 || access === undefined
      || !['r', 'w', 'u'].includes(access)
    ) {
      return invalidSnapshot()
    }
    const device = record.get('d')
    if (type === 'unix' && (device === undefined || !/^0x[0-9a-f]+$/i.test(device) || /^0x0+$/i.test(device))) {
      return invalidSnapshot()
    }
    const key = `${currentPid}:${fd}`
    if (seenDescriptors.has(key)) {
      return invalidSnapshot()
    }
    seenDescriptors.add(key)
    descriptors.push({ access, device, fd, pid: currentPid, type })
  }
  return descriptors
}

function validIdentity(process: TrackedProcess | undefined, pid: number): process is TrackedProcess {
  return process !== undefined && process.pid === pid && Number.isSafeInteger(process.pid) && process.pid > 1
    && typeof process.startedAt === 'string' && process.startedAt.length > 0
    && typeof process.command === 'string'
}

function rootEndpoints(descriptors: readonly Descriptor[], rootPid: number): Map<number, string> {
  const endpoints = new Map<number, string>()
  for (const descriptor of descriptors) {
    if (
      descriptor.pid === rootPid && (descriptor.fd === 1 || descriptor.fd === 2)
      && descriptor.type === 'unix' && (descriptor.access === 'w' || descriptor.access === 'u')
    ) {
      if (descriptor.device === undefined) {
        return invalidSnapshot()
      }
      endpoints.set(descriptor.fd, descriptor.device.toLowerCase())
    }
  }
  return endpoints
}

function sameEndpoints(left: ReadonlyMap<number, string>, right: ReadonlyMap<number, string>): boolean {
  return left.size === right.size && [...left].every(([fd, device]) => right.get(fd) === device)
}

function sharesEndpoint(descriptors: readonly Descriptor[], pid: number, endpoints: ReadonlySet<string>): boolean {
  return descriptors.some(descriptor =>
    descriptor.pid === pid && descriptor.type === 'unix'
    && (descriptor.access === 'w' || descriptor.access === 'u')
    && descriptor.device !== undefined && endpoints.has(descriptor.device.toLowerCase())
  )
}

/**
 * captureInheritedOutputOwners grants temporary cleanup custody only to identities that still
 * hold a write-capable Unix socket endpoint captured from the root's stdout or stderr.
 */
export function captureInheritedOutputOwners(
  rootPid: number,
  seams: ProcessOutputOwnerSeams,
): TrackedProcess[] {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1) {
    return invalidSnapshot()
  }
  const initialRoot = seams.identities([rootPid]).get(rootPid)
  if (!validIdentity(initialRoot, rootPid)) {
    return invalidSnapshot()
  }

  const initialDescriptors = parseDescriptors(seams.readDescriptors())
  const seed = rootEndpoints(initialDescriptors, rootPid)
  if (seed.size === 0) {
    return invalidSnapshot()
  }
  const endpointSet = new Set(seed.values())
  const candidates = [
    ...new Set(
      initialDescriptors
        .filter(descriptor =>
          descriptor.pid !== rootPid && descriptor.type === 'unix'
          && (descriptor.access === 'w' || descriptor.access === 'u')
          && descriptor.device !== undefined && endpointSet.has(descriptor.device.toLowerCase())
        )
        .map(descriptor => descriptor.pid),
    ),
  ]

  const candidateIdentities = seams.identities(candidates)
  const selected = new Map<number, TrackedProcess>()
  for (const pid of candidates) {
    const identity = candidateIdentities.get(pid)
    if (identity === undefined) {
      // The native identity read proves this descriptor owner has already exited.
      continue
    }
    if (!validIdentity(identity, pid)) {
      return invalidSnapshot()
    }
    selected.set(pid, identity)
  }

  const confirmationPids = [rootPid, ...selected.keys()]
  const confirmedDescriptors = parseDescriptors(seams.readDescriptors(confirmationPids))
  const confirmedRoot = rootEndpoints(confirmedDescriptors, rootPid)
  if (!sameEndpoints(seed, confirmedRoot)) {
    return invalidSnapshot()
  }
  const finalIdentities = seams.identities(confirmationPids)
  const finalRoot = finalIdentities.get(rootPid)
  if (!validIdentity(finalRoot, rootPid) || !seams.sameProcess(finalRoot, initialRoot)) {
    return invalidSnapshot()
  }

  const owners: TrackedProcess[] = []
  for (const [pid, expected] of selected) {
    const current = finalIdentities.get(pid)
    if (current === undefined) {
      // A missing identity is the native proof that this selected owner exited during confirmation.
      continue
    }
    if (!validIdentity(current, pid) || !seams.sameProcess(current, expected)) {
      return invalidSnapshot()
    }
    if (!sharesEndpoint(confirmedDescriptors, pid, endpointSet)) {
      return invalidSnapshot()
    }
    owners.push(expected)
  }
  return owners
}
