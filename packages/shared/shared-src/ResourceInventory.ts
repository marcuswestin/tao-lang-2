import * as Errors from './core/Errors'
import * as FS from './FS'
import * as HCI from './HCI'
import * as Platform from './Platform'
import { ProcessTree, type TrackedProcess } from './ProcessTree'
import { TaoHome } from './TaoHome'

type Entry = {
  id: string
  kind: string
  classification: 'active' | 'stranded' | 'retained' | 'unverified' | 'inactive' | 'reusable'
  path?: string
  checkout?: string
  taskId?: string
  pid?: number
  purpose?: string
  reason?: string
  cleanup?: string
}

export type Report = { version: 1; entries: Entry[]; warnings: string[] }

export type InspectOptions = {
  checkout: string
  mode: 'startup' | 'full'
  indexRoot?: string
  machineRegistryRoot?: string
  temporaryRoot?: string
  androidRoot?: string
  homeRoot?: string
  inspectIdentities?: typeof ProcessTree.identities
  inspectGroup?: typeof ProcessTree.groupMembers
  inspectProcessTable?: typeof ProcessTree.processTable
  inspectProcessAlive?: typeof Platform.processIsAlive
  inspectProjectFiles?: (
    checkout: string,
    limits: { maxFiles: number; maxBytes: number; timeoutMs: number },
  ) => readonly string[]
  taskId?: string
}

type RecordValue = Record<string, unknown>
type Registration = {
  version: 1
  id: string
  kind: 'launch' | 'process' | 'directory'
  checkout: string
  taskId?: string
  owner?: TrackedProcess
  process?: TrackedProcess
  processGroup?: number
  children?: TrackedProcess[]
  provenance?: 'complete' | 'uncertain'
  path?: string
  purpose?: string
  cleanupCondition?: string
  directoryMetadata?: { device: number; inode: number; uid: number }
}

const STARTUP_MARKER = 'TAO_RESOURCE_INVENTORY_NOTIFIED'
const MAX_RECORD_BYTES = 65_536
const MAX_ENTRIES = 256
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const KERNEL_START = /^\d+(?::\d+)?$/u

function cacheRoot(): string {
  const configured = Platform.runtimeProcess.env['XDG_CACHE_HOME']
  return configured ? FS.resolvePath(configured) : FS.resolvePath('.cache', FS.homeDir())
}

function indexRoot(root?: string): string {
  return FS.resolvePath(root ?? FS.resolvePath('tao/resource-inventory', cacheRoot()))
}

function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value['length'] > 0 && value['length'] <= 4_096
    && !/[\u0000-\u001f\u007f]/u.test(value)
}

function absolute(value: unknown): value is string {
  return text(value) && FS.isAbsolute(value) && FS.resolvePath(value) === value
    && !value['split']('/').some(part => /^\.env(?:\.|$)/u.test(part) || ['.ssh', '.aws'].includes(part))
}

function tracked(value: unknown): value is TrackedProcess {
  return object(value) && Number.isSafeInteger(value['pid']) && (value['pid'] as number) > 1
    && (value['pid'] as number) <= 2_147_483_647 && text(value['startedAt'])
    && KERNEL_START.test(value['startedAt']) && typeof value['command'] === 'string'
}

function redact(value: string): string {
  return value['replace'](/(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, 'https://[redacted]@')
    .replace(/\b(token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]')
    .replace(/\bBearer\s+\S+/giu, 'Bearer [redacted]')
}

function absent(error: unknown): boolean {
  return object(error) && error['code'] === 'ENOENT'
}

/** Check every component, including a symlinked ancestor of an otherwise regular record. */
async function metadata(path: string): Promise<Awaited<ReturnType<typeof FS.entryMetadata>>> {
  if (!absolute(path)) {
    Errors.throwHostEnvironment('Resource inventory requires a normalized absolute path.')
  }
  const parts: string[] = []
  for (let current = path; FS.dirname(current) !== current; current = FS.dirname(current)) {
    parts.push(current)
  }
  for (const component of parts.reverse()) {
    if ((await FS.entryMetadata(component)).kind === 'symlink') {
      Errors.throwHostEnvironment('Resource inventory refuses symbolic links.')
    }
  }
  return await FS.entryMetadata(path)
}

async function names(
  path: string,
  warnings: string[],
  include: (name: string) => boolean = () => true,
  limit = MAX_ENTRIES,
): Promise<string[]> {
  try {
    if ((await metadata(path)).kind !== 'directory') {
      Errors.throwHostEnvironment('Resource inventory expected a directory.')
    }
    const children = (await FS.listDir(path)).filter(include)
    if (children.length > limit) {
      warnings.push(`Inventory bounded to ${limit} entries at ${redact(path)}; additional entries were omitted.`)
    }
    return children.slice(0, limit)
  } catch (error) {
    if (!absent(error)) {
      warnings.push(`Could not inspect inventory directory ${redact(path)}; ownership is unverified.`)
    }
    return []
  }
}

async function read(path: string): Promise<unknown> {
  const info = await metadata(path)
  if (info.kind !== 'file' || info.size > MAX_RECORD_BYTES) {
    Errors.throwHostEnvironment('Resource inventory refuses an invalid metadata record.')
  }
  return await FS.readJson<unknown>(path)
}

function unverified(path: string, kind: string): Entry {
  return { id: path, kind, path, classification: 'unverified', reason: 'Metadata could not be verified.' }
}

function registration(value: unknown): value is Registration {
  return object(value) && value['version'] === 1 && text(value['id']) && UUID.test(value['id'])
    && absolute(value['checkout']) && (value['taskId'] === undefined || text(value['taskId']))
    && (value['owner'] === undefined || tracked(value['owner']))
    && (value['directoryMetadata'] === undefined || directoryIdentity(value['directoryMetadata']))
    && (value['children'] === undefined || (Array.isArray(value['children']) && value['children'].every(tracked)))
    && (value['provenance'] === undefined || ['complete', 'uncertain'].includes(value['provenance'] as string))
    && ((value['kind'] === 'process' && tracked(value['owner']) && tracked(value['process'])
      && (value['processGroup'] === undefined || value['processGroup'] === value['process'].pid))
      || (value['kind'] === 'directory' && absolute(value['path']) && text(value['purpose'])
        && text(value['cleanupCondition']))
      || (value['kind'] === 'launch' && tracked(value['owner']) && text(value['purpose'])
        && value['provenance'] === 'uncertain' && value['process'] === undefined
        && value['processGroup'] === undefined && value['children'] === undefined && value['path'] === undefined))
}

function directoryIdentity(value: unknown): boolean {
  return object(value) && ['device', 'inode', 'uid'].every(key =>
    Number.isSafeInteger(value[key])
    && (value[key] as number) >= 0
  )
}

type Candidate = {
  entry: Entry
  owner?: TrackedProcess
  children?: TrackedProcess[]
  retained?: boolean
  processGroup?: number
  groupUnverified?: boolean
  directoryGone?: boolean
  directoryChanged?: boolean
  closureUnverified?: boolean
  identityUnverified?: boolean
  groups?: TrackedProcess[]
}

async function registrations(root: string, candidates: Candidate[], warnings: string[], limit: number): Promise<void> {
  for (const name of await names(root, warnings, name => name.endsWith('.json') || name.endsWith('.tmp'), limit)) {
    const path = FS.resolvePath(name, root)
    try {
      const value = await read(path)
      if (!registration(value) || name !== `${value['id']}.json`) {
        candidates.push({ entry: unverified(path, 'registration') })
        continue
      }
      let directoryGone = false
      let directoryChanged = false
      if (value['path'] !== undefined) {
        try {
          await metadata(value['path'])
          if (value['directoryMetadata'] !== undefined) {
            const current = FS.entryMetadataSync(value['path'])
            const recorded = value['directoryMetadata']
            directoryChanged = current.kind !== 'directory' || current.device !== recorded.device
              || current.inode !== recorded.inode || current.uid !== recorded.uid
          }
        } catch (error) {
          if (!absent(error)) {
            throw error
          }
          directoryGone = true
        }
      }
      candidates.push({
        entry: {
          id: value['id'],
          kind: value['kind'],
          classification: 'unverified',
          checkout: value['checkout'],
          ...(value['taskId'] === undefined ? {} : { taskId: redact(value['taskId']) }),
          ...(value['path'] === undefined ? {} : { path: value['path'] }),
          ...(value['purpose'] === undefined ? {} : { purpose: redact(value['purpose']) }),
          ...(value['cleanupCondition'] === undefined ? {} : { cleanup: redact(value['cleanupCondition']) }),
          ...(value['process'] === undefined ? {} : { pid: value['process'].pid }),
        },
        owner: value['owner'],
        children: value['process'] === undefined ? undefined : [value['process'], ...value['children'] ?? []],
        processGroup: value['processGroup'],
        closureUnverified: value['provenance'] === 'uncertain',
        directoryGone,
        directoryChanged,
      })
    } catch {
      candidates.push({ entry: unverified(path, 'registration') })
    }
  }
}

function machineOwner(value: unknown, path: string, retained = false): Candidate | undefined {
  if (
    !object(value) || !text(value['id']) || !text(value['name']) || !absolute(value['repositoryRoot'])
    || !Number.isSafeInteger(value['pid']) || (value['pid'] as number) <= 1 || !text(value['startedAt'])
    || !Number.isFinite(Date.parse(value['startedAt']))
    || (value['processStartedAt'] !== undefined && !text(value['processStartedAt']))
  ) {
    return undefined
  }
  if (
    value['retention'] !== undefined && (!object(value['retention']) || !text(value['retention']['reason'])
      || !Array.isArray(value['retention']['processes']) || !value['retention']['processes'].every(tracked)
      || !Array.isArray(value['retention']['resourceNames']) || !value['retention']['resourceNames'].every(text)
      || typeof value['retention']['quarantined'] !== 'boolean')
  ) {
    return undefined
  }
  return {
    entry: {
      id: `machine:${value['name']}:${value['id']}`,
      kind: 'machine-lease',
      path,
      checkout: value['repositoryRoot'],
      pid: value['pid'] as number,
      purpose: redact(value['name']),
      classification: 'unverified',
      cleanup: 'Inspect the authoritative machine lease before any explicit recovery.',
    },
    owner: { pid: value['pid'] as number, startedAt: value['processStartedAt'] as string ?? '', command: '' },
    retained: retained || value['retention'] !== undefined,
  }
}

async function machine(root: string, candidates: Candidate[], warnings: string[], limit: number): Promise<void> {
  for (
    const name of await names(root, warnings, name => name.startsWith('resource-') && name.endsWith('.lease'), limit)
  ) {
    const path = FS.resolvePath(name, root)
    try {
      candidates.push(machineOwner(await read(path), path) ?? { entry: unverified(path, 'machine-lease') })
    } catch {
      candidates.push({ entry: unverified(path, 'machine-lease') })
    }
  }
  const retainedRoot = FS.resolvePath('.retentions', root)
  for (const name of await names(retainedRoot, warnings, name => name.endsWith('.json'), limit)) {
    const path = FS.resolvePath(name, retainedRoot)
    try {
      const value = await read(path)
      const retained = object(value) ? machineOwner(value['retainedOwner'], path, true) : undefined
      if (
        !retained || !object(value) || !Array.isArray(value['originalOwners'])
        || value['originalOwners'].length === 0 || !value['originalOwners'].every(owner => machineOwner(owner, path))
      ) {
        candidates.push({ entry: unverified(path, 'machine-retention') })
      } else {
        candidates.push(retained)
      }
    } catch {
      candidates.push({ entry: unverified(path, 'machine-retention') })
    }
  }
}

async function sessions(checkout: string, candidates: Candidate[], warnings: string[], limit: number): Promise<void> {
  const root = FS.resolvePath('.artifacts/dev-loops', checkout)
  const states = ['starting', 'ready', 'stopping', 'stopped', 'failed', 'cleanup-failed', 'interrupted']
  for (const name of await names(root, warnings, name => UUID.test(name), limit)) {
    const path = FS.resolvePath(`${name}/receipt.json`, root)
    try {
      const value = await read(path)
      if (
        !object(value) || value['version'] !== 1 || value['session'] !== name || value['checkout'] !== checkout
        || !states.includes(value['state'] as string) || !Array.isArray(value['children'])
        || !value['children'].every(tracked)
        || (value['controller'] !== undefined && !tracked(value['controller']))
        || (value['processGroups'] !== undefined
          && (!Array.isArray(value['processGroups']) || !value['processGroups'].every(tracked)))
        || (value['mobileDriverProcesses'] !== undefined
          && (!Array.isArray(value['mobileDriverProcesses']) || !value['mobileDriverProcesses'].every(tracked)))
      ) {
        candidates.push({ entry: unverified(path, 'managed-session') })
        continue
      }
      candidates.push({
        entry: {
          id: `${checkout}:${name}`,
          kind: 'managed-session',
          path,
          checkout,
          classification: 'unverified',
          cleanup: 'Use the managed session owner to inspect or stop this session.',
        },
        owner: value['controller'] as TrackedProcess | undefined,
        children: [
          ...value['children'],
          ...value['processGroups'] as TrackedProcess[] ?? [],
          ...value['mobileDriverProcesses'] as TrackedProcess[] ?? [],
        ],
        groups: value['processGroups'] as TrackedProcess[] | undefined,
        retained: value['cleanupOutcome'] === 'retained' || value['ownershipRefusal'] !== undefined
          || value['mobileDriverCleanup'] === 'retained',
        closureUnverified: value['provenance'] !== 'complete' || value['cleanupOutcome'] === 'unknown'
          || value['mobileDriverCleanup'] === 'opening',
      })
    } catch {
      candidates.push({ entry: unverified(path, 'managed-session') })
    }
  }
}

function classify(candidate: Candidate, identities: Map<number, TrackedProcess> | undefined): void {
  const { entry, owner, children } = candidate
  if (entry.kind === 'launch') {
    entry.reason = 'Launch intent is unfulfilled; spawned resource ownership and closure are unproved.'
    return
  }
  if (candidate.retained) {
    entry.classification = 'retained'
    entry.reason = 'An authoritative retained fence still requires explicit recovery.'
    return
  }
  if (candidate.groupUnverified) {
    entry.reason = 'The recorded detached group has surviving or unverified members; closure is unproved.'
    return
  }
  if (candidate.directoryGone) {
    entry.classification = 'inactive'
    entry.reason = 'The registered directory is no longer present.'
    return
  }
  if (candidate.directoryChanged) {
    entry.reason = 'The directory identity changed after registration; ownership is unverified.'
    return
  }
  if (candidate.identityUnverified) {
    entry.reason = 'A recorded PID is still live or unreadable, but its kernel start identity is unavailable.'
    return
  }
  if (identities === undefined || owner === undefined) {
    return
  }
  const currentOwner = identities.get(owner.pid)
  if (currentOwner !== undefined && !KERNEL_START.test(owner.startedAt)) {
    return
  }
  const ownerAlive = ProcessTree.sameProcess(currentOwner, owner)
  const childAlive = children?.some(child => ProcessTree.sameProcess(identities.get(child.pid), child)) ?? false
  if (entry.kind === 'directory') {
    entry.classification = ownerAlive ? 'active' : 'unverified'
    entry.reason = ownerAlive
      ? 'The registered owner is active.'
      : 'Directory registration describes provenance, not cleanup authority.'
    return
  }
  entry.classification = children === undefined
    ? (ownerAlive ? 'active' : 'inactive')
    : childAlive
    ? (ownerAlive ? 'active' : 'stranded')
    : ownerAlive
    ? 'active'
    : 'inactive'
  if (candidate.closureUnverified && entry.classification === 'inactive') {
    entry.classification = 'unverified'
    entry.reason = 'Recorded cleanup or descendant provenance remains uncertain; closure is unproved.'
    return
  }
  entry.reason = entry.classification === 'stranded'
    ? 'A captured child survives its original owner.'
    : entry.classification === 'inactive'
    ? 'The recorded process identities are no longer present.'
    : 'The recorded owner is active.'
}

function projectFiles(
  checkout: string,
  limits: { maxFiles: number; maxBytes: number; timeoutMs: number },
): readonly string[] {
  const marker = FS.resolvePath('.git', checkout)
  metadataSync(marker)
  if (!FS.existsSync(marker)) {
    return []
  }
  const result = Platform.spawnSync('git', {
    args: ['ls-files', '-z', '--cached', '--', ':(glob)**/.tao/.gitignore', ':(glob)*.tao', ':(glob)**/*.tao'],
    cwd: checkout,
    timeout: limits.timeoutMs,
    maxBuffer: limits.maxBytes,
  })
  if (result.error !== undefined || result.status !== 0) {
    Errors.throwHostEnvironment('Authored project discovery failed or exceeded its budget.')
  }
  return result.stdout.toString('utf8').split('\0').filter(Boolean)
}

/** Discover authored roots from Git metadata; probe only fixed legacy locations, never their contents. */
async function legacyProjects(
  checkout: string,
  options: InspectOptions,
  candidates: Candidate[],
  warnings: string[],
): Promise<void> {
  const limits = options.mode === 'startup'
    ? { maxFiles: MAX_ENTRIES, maxBytes: MAX_RECORD_BYTES, timeoutMs: 500 }
    : { maxFiles: 4_096, maxBytes: 1_048_576, timeoutMs: 2_000 }
  const roots = new Set([FS.resolvePath(checkout)])
  let rootLimitWarned = false
  try {
    const files = (options.inspectProjectFiles ?? projectFiles)(checkout, limits)
    if (files.length > limits.maxFiles) {
      warnings.push(
        `Authored project discovery bounded to ${limits.maxFiles} paths in ${
          redact(checkout)
        }; legacy inventory is partial.`,
      )
    }
    for (const file of files.slice(0, limits.maxFiles)) {
      if (!text(file) || FS.isAbsolute(file) || file.split('/').some(part => part === '..' || part === '.')) {
        warnings.push(`Invalid authored project path in ${redact(checkout)}; legacy inventory is partial.`)
        continue
      }
      const parts = file.split('/')
      const resolved = FS.resolvePath(file, checkout)
      if (!FS.pathIsWithin(resolved, checkout)) {
        warnings.push(`Invalid authored project path in ${redact(checkout)}; legacy inventory is partial.`)
        continue
      }
      const isMarker = file.endsWith('/.tao/.gitignore') || file === '.tao/.gitignore'
      if (
        parts.some(part => part === 'node_modules' || part === '.artifacts' || part.startsWith('_gen_'))
        || (!isMarker && parts.some(part => part.startsWith('.')))
      ) {
        continue
      }
      let root = isMarker ? FS.dirname(FS.dirname(resolved)) : FS.dirname(resolved)
      if (!isMarker && !file.endsWith('.tao')) {
        continue
      }
      for (;;) {
        if (roots.size >= limits.maxFiles && !roots.has(root)) {
          if (!rootLimitWarned) {
            warnings.push(
              `Authored project root discovery exceeded its limit in ${redact(checkout)}; legacy inventory is partial.`,
            )
            rootLimitWarned = true
          }
          break
        }
        roots.add(root)
        if (root === FS.resolvePath(checkout) || isMarker) {
          break
        }
        root = FS.dirname(root)
      }
    }
  } catch {
    warnings.push(
      `Authored project discovery failed or exceeded its budget in ${redact(checkout)}; legacy inventory is partial.`,
    )
  }
  const paths = [
    ['dev', 'legacy-project-dev', 'directory'],
    ['typescript', 'legacy-project-typescript', 'directory'],
    ['sessions', 'legacy-project-sessions', 'directory'],
    ['bridge-check.tsconfig.json', 'legacy-project-bridge-check', 'file'],
  ] as const
  for (const root of roots) {
    // Installed app runs retain launch provenance in their durable local state.
    // Discover it through the same authored roots as the project metadata.
    await registrations(
      FS.resolvePath('.tao/local/resource-inventory', root),
      candidates,
      warnings,
      options.mode === 'startup' ? Math.max(0, MAX_ENTRIES - candidates.length) : Number.POSITIVE_INFINITY,
    )
    for (const [relative, kind, expected] of paths) {
      const path = FS.resolvePath(`.tao/${relative}`, root)
      try {
        const info = await metadata(path)
        candidates.push({
          entry: {
            id: path,
            kind,
            path,
            checkout,
            classification: 'unverified',
            reason: info.kind === expected
              ? 'Legacy project metadata does not establish ownership or cleanup authority.'
              : 'Legacy project metadata has an unexpected filesystem kind; ownership is unverified.',
          },
        })
      } catch (error) {
        if (!absent(error)) {
          candidates.push({ entry: unverified(path, kind) })
        }
      }
    }
  }
}

async function directories(options: InspectOptions, candidates: Candidate[], warnings: string[]): Promise<void> {
  const roots = [
    ['.artifacts/host-acceptance', 'host-acceptance'],
    ['.artifacts/tests/studio-smoke', 'studio-smoke'],
    ['.tao/local/dev', 'project-dev'],
    ['.tao/dev', 'legacy-project-dev'],
    ['.artifacts/build', 'build-output'],
    ['.artifacts/cache', 'checkout-cache'],
    ['.tao/cache', 'project-cache'],
    ['.artifacts/scratch', 'checkout-scratch'],
  ] as const
  for (const [relative, kind] of roots) {
    const path = FS.resolvePath(relative, options.checkout)
    try {
      if ((await metadata(path)).kind !== 'directory') {
        continue
      }
      candidates.push({
        entry: {
          id: path,
          kind,
          path,
          checkout: options.checkout,
          classification: 'unverified',
          reason: 'Directory metadata alone does not establish cleanup authority.',
        },
      })
    } catch (error) {
      if (!absent(error)) {
        candidates.push({ entry: unverified(path, kind) })
      }
    }
  }
  const home = options.homeRoot ?? FS.homeDir()
  const android = options.androidRoot ?? FS.resolvePath('.android/avd', home)
  for (const name of await names(android, warnings, name => /\.(?:avd|ini)$/u.test(name), Number.POSITIVE_INFINITY)) {
    const path = FS.resolvePath(name, android)
    try {
      const info = await metadata(path)
      if (info.kind !== 'directory' && info.kind !== 'file') {
        continue
      }
      candidates.push({
        entry: {
          id: path,
          kind: 'android-avd',
          path,
          classification: 'unverified',
          reason: 'Android storage metadata does not establish target ownership or cleanup authority.',
        },
      })
    } catch {
      candidates.push({ entry: unverified(path, 'android-avd') })
    }
  }
  const machineRoots = [
    [
      FS.resolvePath('tao', options.homeRoot === undefined ? cacheRoot() : FS.resolvePath('.cache', home)),
      'machine-cache',
    ],
    [options.homeRoot === undefined ? TaoHome.root() : FS.resolvePath('.tao', home), 'tao-home'],
  ] as const
  const knownSubdirectories = new Set(['cache', 'hosts', 'versions', 'agents', 'machine-lanes', 'resource-inventory'])
  for (const [root, kind] of machineRoots) {
    try {
      if ((await metadata(root)).kind !== 'directory') {
        continue
      }
      candidates.push({
        entry: {
          id: root,
          kind,
          path: root,
          classification: 'unverified',
          reason: 'Known Tao storage metadata does not establish cleanup authority.',
        },
      })
    } catch (error) {
      if (!absent(error)) {
        candidates.push({ entry: unverified(root, kind) })
      }
      continue
    }
    for (const name of await names(root, warnings, name => knownSubdirectories.has(name), Number.POSITIVE_INFINITY)) {
      const path = FS.resolvePath(name, root)
      try {
        if ((await metadata(path)).kind !== 'directory') {
          continue
        }
        candidates.push({
          entry: {
            id: path,
            kind: `${kind}-directory`,
            path,
            classification: 'unverified',
            reason: 'Known Tao storage metadata does not establish cleanup authority.',
          },
        })
      } catch {
        candidates.push({ entry: unverified(path, `${kind}-directory`) })
      }
    }
  }
  const temporary = options.temporaryRoot ?? await FS.realPath(FS.tmpdir())
  for (
    const name of await names(
      temporary,
      warnings,
      name =>
        /^tao-(?:managed-loop-project-|admission|ide-|clerk-phone-|instant-review-|expo-home|dev(?:-|$))/u.test(name),
      Number.POSITIVE_INFINITY,
    )
  ) {
    const path = FS.resolvePath(name, temporary)
    try {
      if ((await metadata(path)).kind !== 'directory') {
        continue
      }
      candidates.push({
        entry: {
          id: path,
          kind: 'temporary-directory',
          path,
          classification: 'unverified',
          reason: 'A recognized temporary prefix is descriptive, not proof of ownership.',
        },
      })
    } catch {
      candidates.push({ entry: unverified(path, 'temporary-directory') })
    }
  }
  await worktrees(options.checkout, candidates, warnings)
}

async function readPointer(path: string): Promise<string> {
  const info = await metadata(path)
  if (info.kind !== 'file' || info.size > MAX_RECORD_BYTES) {
    Errors.throwHostEnvironment('Resource inventory refuses an invalid Git pointer.')
  }
  return (await FS.readText(path)).trim()
}

async function worktrees(checkout: string, candidates: Candidate[], warnings: string[]): Promise<void> {
  let git = FS.resolvePath('.git', checkout)
  try {
    const info = await metadata(git)
    if (info.kind === 'file') {
      const pointer = await readPointer(git)
      if (!pointer.startsWith('gitdir: ')) {
        return
      }
      const directory = FS.resolvePath(pointer.slice(8), checkout)
      if (
        FS.basename(FS.dirname(directory)) !== 'worktrees' || FS.basename(FS.dirname(FS.dirname(directory))) !== '.git'
      ) {
        return
      }
      git = FS.dirname(FS.dirname(directory))
      if ((await metadata(git)).kind !== 'directory') {
        return
      }
    } else if (info.kind !== 'directory') {
      return
    }
  } catch (error) {
    if (!absent(error)) {
      warnings.push('Git worktree metadata could not be inspected.')
    }
    return
  }
  const primaryCheckout = FS.dirname(git)
  if (primaryCheckout !== FS.resolvePath(checkout)) {
    candidates.push({
      entry: {
        id: git,
        kind: 'worktree',
        path: primaryCheckout,
        checkout: primaryCheckout,
        classification: 'unverified',
        reason: 'The common Git directory identifies the primary checkout; cleanup authority requires confirmation.',
      },
    })
  }
  const root = FS.resolvePath('worktrees', git)
  for (const name of await names(root, warnings, () => true, Number.POSITIVE_INFINITY)) {
    const path = FS.resolvePath(`${name}/gitdir`, root)
    try {
      const pointer = await readPointer(path)
      if (!absolute(pointer) || FS.basename(pointer) !== '.git') {
        candidates.push({ entry: unverified(path, 'worktree') })
        continue
      }
      const linkedCheckout = FS.dirname(pointer)
      let classification: Entry['classification'] = 'unverified'
      try {
        await metadata(linkedCheckout)
      } catch (error) {
        if (absent(error)) {
          classification = 'inactive'
        }
      }
      candidates.push({
        entry: {
          id: path,
          kind: 'worktree',
          path: linkedCheckout,
          checkout: linkedCheckout,
          classification,
          reason: 'Git registration is provenance; task completion and cleanup authority require confirmation.',
        },
      })
    } catch {
      candidates.push({ entry: unverified(path, 'worktree') })
    }
  }
}

function commandUsesDirectory(command: string, directory: string): boolean {
  for (let offset = command.indexOf(directory); offset >= 0; offset = command.indexOf(directory, offset + 1)) {
    const before = command[offset - 1]
    const after = command[offset + directory.length]
    if (
      (before === undefined || /[\s"'=]/u.test(before))
      && (after === undefined || /[\s/"']/u.test(after))
    ) {
      return true
    }
  }
  return false
}

/** Command paths establish relevance only; neither a parentless process nor its argv proves custody. */
function legacyProcesses(options: InspectOptions, candidates: Candidate[], warnings: string[]): void {
  const knownPids = new Set(candidates.flatMap(candidate => [
    ...candidate.owner === undefined ? [] : [candidate.owner.pid],
    ...candidate.children?.map(child => child.pid) ?? [],
    ...candidate.entry.pid === undefined ? [] : [candidate.entry.pid],
  ]))
  knownPids.add(Platform.runtimeProcess.pid)
  const checkouts = [
    ...new Set([
      FS.resolvePath(options.checkout),
      ...candidates.flatMap(candidate => candidate.entry.checkout === undefined ? [] : [candidate.entry.checkout]),
    ]),
  ]
  const runtimeDirectories = candidates.filter(candidate =>
    candidate.entry.kind === 'directory' || candidate.entry.kind === 'temporary-directory'
    || candidate.entry.kind === 'tao-home-directory' || candidate.entry.kind === 'machine-cache-directory'
  ).flatMap(candidate => candidate.entry.path === undefined ? [] : [candidate.entry.path])
  try {
    const table = (options.inspectProcessTable ?? ProcessTree.processTable)()
    for (const process of table) {
      if (knownPids.has(process.pid)) {
        continue
      }
      const checkout = checkouts.find(directory => commandUsesDirectory(process.command, directory))
      const path = checkout ?? runtimeDirectories.find(directory => commandUsesDirectory(process.command, directory))
      if (path === undefined) {
        continue
      }
      candidates.push({
        entry: {
          id: `legacy-process:${process.pid}`,
          kind: 'legacy-process',
          classification: 'unverified',
          pid: process.pid,
          path,
          ...(checkout === undefined ? {} : { checkout }),
          reason: 'Process metadata mentions a known directory; ownership and cleanup authority are unverified.',
        },
      })
      knownPids.add(process.pid)
    }
  } catch {
    warnings.push('Legacy process inspection failed; the full resource inventory is partial.')
  }
}

/** Read metadata only; startup is bounded and full inspection is exhaustive within the known roots. */
export async function inspect(options: InspectOptions): Promise<Report> {
  const warnings: string[] = []
  const candidates: Candidate[] = []
  const limit = options.mode === 'startup' ? MAX_ENTRIES : Number.POSITIVE_INFINITY
  await registrations(indexRoot(options.indexRoot), candidates, warnings, limit)
  await machine(
    options.machineRegistryRoot ?? FS.resolvePath('tao/machine-lanes', cacheRoot()),
    candidates,
    warnings,
    limit,
  )
  await sessions(FS.resolvePath(options.checkout), candidates, warnings, limit)
  if (options.mode === 'startup') {
    await legacyProjects(FS.resolvePath(options.checkout), options, candidates, warnings)
  }
  if (options.mode === 'full') {
    await directories(options, candidates, warnings)
    await legacyProjects(FS.resolvePath(options.checkout), options, candidates, warnings)
    const knownWorktrees = new Set(
      candidates.filter(candidate => candidate.entry.kind === 'worktree')
        .flatMap(candidate => candidate.entry.checkout === undefined ? [] : [candidate.entry.checkout]),
    )
    knownWorktrees.delete(FS.resolvePath(options.checkout))
    for (const checkout of knownWorktrees) {
      await sessions(checkout, candidates, warnings, limit)
      await legacyProjects(checkout, options, candidates, warnings)
    }
    legacyProcesses(options, candidates, warnings)
  }
  const pids = [
    ...new Set(candidates.flatMap(candidate => [
      ...candidate.owner === undefined ? [] : [candidate.owner.pid],
      ...candidate.children?.map(child => child.pid) ?? [],
    ])),
  ]
  let identities: Map<number, TrackedProcess> | undefined
  try {
    identities = pids.length === 0 ? new Map() : (options.inspectIdentities ?? ProcessTree.identities)(pids)
  } catch {
    warnings.push('Process identity inspection failed; process ownership is unverified.')
  }
  const unverifiedPids = new Set<number>()
  if (identities !== undefined) {
    for (const pid of pids) {
      if (identities.has(pid)) {
        continue
      }
      try {
        if ((options.inspectProcessAlive ?? Platform.processIsAlive)(pid)) {
          unverifiedPids.add(pid)
        }
      } catch {
        unverifiedPids.add(pid)
      }
    }
  }
  for (const candidate of candidates) {
    candidate.identityUnverified = [
      ...candidate.owner === undefined ? [] : [candidate.owner.pid],
      ...candidate.children?.map(child => child.pid) ?? [],
    ].some(pid => unverifiedPids.has(pid))
    const groups = [
      ...candidate.groups ?? [],
      ...candidate.processGroup === undefined || candidate.children?.[0] === undefined ? [] : [candidate.children[0]],
    ]
    for (const root of groups) {
      try {
        const members = (options.inspectGroup ?? ProcessTree.groupMembers)(root.pid)
        candidate.groupUnverified ||= members.length > 0
          && (identities === undefined || !ProcessTree.sameProcess(identities.get(root.pid), root))
      } catch {
        candidate.groupUnverified = true
        warnings.push('Detached process group inspection failed; group closure is unverified.')
      }
    }
    classify(candidate, identities)
  }
  const entries = [...new Map(candidates.map(candidate => [candidate.entry.id, candidate.entry])).values()]
    .map(entry =>
      Object.fromEntries(
        Object.entries(entry).map(([key, value]) => [key, typeof value === 'string' ? redact(value) : value]),
      ) as Entry
    )
  return { version: 1, entries, warnings }
}

/** Nested commands share one advisory marker; it grants no authority and suppresses only repeated output. */
export async function notifyStartup(options: Omit<InspectOptions, 'mode'>): Promise<void> {
  if (Platform.runtimeProcess.env[STARTUP_MARKER] === '1') {
    return
  }
  Platform.runtimeProcess.env[STARTUP_MARKER] = '1'
  try {
    const report = await inspect({ ...options, mode: 'startup' })
    const count = report.entries.filter(entry =>
      ['stranded', 'retained', 'unverified'].includes(entry.classification)
    ).length
    if (count > 0 || report.warnings.length > 0) {
      HCI.writeStderr(
        `Tao resources: ${count} resource(s) need inspection. Run tao resources for ownership and cleanup guidance.\n`,
      )
    }
  } catch {
    HCI.writeStderr('Tao resource inventory could not be inspected. Run tao resources for guidance.\n')
  }
}

/** Human output uses the same classifications as JSON and offers inspection, never deletion commands. */
export function formatReport(report: Report): string {
  const classifications = ['active', 'stranded', 'retained', 'unverified', 'inactive', 'reusable'] as const
  const counts = classifications.map(classification =>
    `${classification}: ${report.entries.filter(entry => entry.classification === classification).length}`
  )
  const lines = [`Tao resources (${report.entries.length}): ${counts.join(', ')}`]
  for (const entry of report.entries) {
    lines.push(`${entry.classification} ${entry.kind}: ${entry.path ?? entry.id}`)
    if (entry.reason) {
      lines.push(`  ${entry.reason}`)
    }
    if (entry.cleanup) {
      lines.push(`  Cleanup condition: ${entry.cleanup}`)
    }
  }
  for (const warning of report.warnings) {
    lines.push(`Warning: ${warning}`)
  }
  lines.push('Inventory is read-only. Confirm ownership and cleanup conditions before explicit recovery.')
  return `${lines.join('\n')}\n`
}

function metadataSync(path: string): void {
  if (!absolute(path)) {
    Errors.throwHostEnvironment('Resource inventory requires a normalized absolute path.')
  }
  const parts: string[] = []
  for (let current = path; FS.dirname(current) !== current; current = FS.dirname(current)) {
    parts.push(current)
  }
  for (const component of parts.reverse()) {
    try {
      if (FS.entryMetadataSync(component).kind === 'symlink') {
        Errors.throwHostEnvironment('Resource inventory refuses symbolic links.')
      }
    } catch (error) {
      if (!absent(error)) {
        throw error
      }
    }
  }
}

function publish(record: Registration, root: string): string {
  metadataSync(root)
  FS.ensureDirSync(root, { mode: 0o700 })
  metadataSync(root)
  const staged = FS.resolvePath(`${record.id}.tmp`, root)
  FS.writeTextSync(staged, `${JSON.stringify(record)}\n`, { mode: 0o600, exclusive: true })
  FS.renameSync(staged, FS.resolvePath(`${record.id}.json`, root))
  return record.id
}

/** Store discovery provenance synchronously after capture; the owning lifecycle still controls teardown. */
export function registerProcess(options: {
  owner: TrackedProcess
  process: TrackedProcess
  checkout: string
  command: string
  taskId?: string
  indexRoot?: string
  processGroup?: number
  children?: TrackedProcess[]
  provenance?: 'complete' | 'uncertain'
}): string {
  if (
    !tracked(options.owner) || !tracked(options.process) || !absolute(options.checkout)
    || !text(options.command) || (options.taskId !== undefined && !text(options.taskId))
    || (options.processGroup !== undefined && options.processGroup !== options.process.pid)
    || (options.children !== undefined && !options.children.every(tracked))
    || (options.provenance !== undefined && !['complete', 'uncertain'].includes(options.provenance))
  ) {
    Errors.throwHostEnvironment('Cannot register invalid resource process provenance.')
  }
  metadataSync(options.checkout)
  return publish({
    version: 1,
    id: Platform.randomUUID(),
    kind: 'process',
    checkout: options.checkout,
    owner: { ...options.owner, command: '' },
    process: { ...options.process, command: '' },
    purpose: redact(options.command),
    ...(options.taskId === undefined ? {} : { taskId: redact(options.taskId) }),
    ...(options.processGroup === undefined ? {} : { processGroup: options.processGroup }),
    ...(options.children === undefined ? {} : { children: options.children.map(child => ({ ...child, command: '' })) }),
    ...(options.provenance === undefined ? {} : { provenance: options.provenance }),
  }, indexRoot(options.indexRoot))
}

function privateRegistration(id: string, root: string): Registration {
  if (!UUID.test(id)) {
    Errors.throwHostEnvironment('Cannot inspect an invalid resource registration.')
  }
  const path = FS.resolvePath(`${id}.json`, root)
  metadataSync(path)
  const info = FS.entryMetadataSync(path)
  if (
    info.kind !== 'file' || info.size > MAX_RECORD_BYTES || (info.mode & 0o077) !== 0
    || (Platform.runtimeProcess.uid !== undefined && info.uid !== Platform.runtimeProcess.uid)
  ) {
    Errors.throwHostEnvironment('Cannot inspect an invalid resource record.')
  }
  const record: unknown = JSON.parse(FS.readTextSync(path))
  if (!registration(record) || record.id !== id) {
    Errors.throwHostEnvironment('Cannot inspect an invalid resource record.')
  }
  return record
}

function processRegistration(id: string, root: string): Registration {
  const record = privateRegistration(id, root)
  if (record.kind !== 'process') {
    Errors.throwHostEnvironment('Expected a captured resource process registration.')
  }
  return record
}

function replaceRegistration(record: Registration, root: string): void {
  metadataSync(root)
  const staged = FS.resolvePath(`${record.id}-${Platform.randomUUID()}.tmp`, root)
  FS.writeTextSync(staged, `${JSON.stringify(record)}\n`, { mode: 0o600, exclusive: true })
  metadataSync(FS.resolvePath(`${record.id}.json`, root))
  FS.renameSync(staged, FS.resolvePath(`${record.id}.json`, root))
}

/** Persist private discovery intent before allocation; an interrupted admission stays unverified. */
export function beginLaunch(options: {
  owner: TrackedProcess
  checkout: string
  command: string
  taskId?: string
  indexRoot?: string
}): string {
  if (
    !tracked(options.owner) || !absolute(options.checkout) || !text(options.command)
    || (options.taskId !== undefined && !text(options.taskId))
  ) {
    Errors.throwHostEnvironment('Cannot begin invalid resource launch provenance.')
  }
  metadataSync(options.checkout)
  return publish({
    version: 1,
    id: Platform.randomUUID(),
    kind: 'launch',
    checkout: options.checkout,
    owner: { ...options.owner, command: '' },
    purpose: redact(options.command),
    provenance: 'uncertain',
    ...(options.taskId === undefined ? {} : { taskId: redact(options.taskId) }),
  }, indexRoot(options.indexRoot))
}

/** Resolve an existing intent to its captured root; failed publication preserves the original intent. */
export function publishLaunch(id: string, options: {
  process: TrackedProcess
  processGroup?: number
  indexRoot?: string
}): void {
  if (
    !tracked(options.process) || (options.processGroup !== undefined && options.processGroup !== options.process.pid)
  ) {
    Errors.throwHostEnvironment('Cannot publish invalid resource process provenance.')
  }
  const root = indexRoot(options.indexRoot)
  const previous = privateRegistration(id, root)
  if (previous.kind !== 'launch') {
    Errors.throwHostEnvironment('The resource launch intent is no longer unfulfilled.')
  }
  replaceRegistration({
    ...previous,
    kind: 'process',
    process: { ...options.process, command: '' },
    provenance: 'complete',
    ...(options.processGroup === undefined ? {} : { processGroup: options.processGroup }),
  }, root)
}

/** Preserve captured identities before teardown; uncertainty is permanent discovery provenance. */
export function updateProcess(id: string, options: {
  children: TrackedProcess[]
  provenance: 'complete' | 'uncertain'
  indexRoot?: string
}): void {
  if (
    !Array.isArray(options.children) || !options.children.every(tracked)
    || !['complete', 'uncertain'].includes(options.provenance)
  ) {
    Errors.throwHostEnvironment('Cannot update invalid resource process provenance.')
  }
  const root = indexRoot(options.indexRoot)
  const previous = processRegistration(id, root)
  const children = [...new Map([...previous.children ?? [], ...options.children]
    .map(child => [`${child.pid}:${child.startedAt}`, { ...child, command: '' }])).values()]
  const record = {
    ...previous,
    children,
    provenance: previous.provenance === 'uncertain' ? 'uncertain' as const : options.provenance,
  }
  replaceRegistration(record, root)
}

/** Caller must prove closure first. Remove only the discovery record; failures leave it discoverable. */
export function retireProcess(id: string, options: { indexRoot?: string } = {}): void {
  const root = indexRoot(options.indexRoot)
  const record = processRegistration(id, root)
  if (record.provenance === 'uncertain') {
    Errors.throwHostEnvironment('Resource process closure remains uncertain; its discovery record was retained.')
  }
  FS.removeSync(FS.resolvePath(`${id}.json`, root))
}

/** Registration describes an external directory and its cleanup condition; it never grants removal authority. */
export async function registerDirectory(options: {
  path: string
  checkout: string
  purpose: string
  cleanupCondition: string
  taskId?: string
  indexRoot?: string
}): Promise<string> {
  const info = await metadata(options.path)
  if (
    info.kind !== 'directory' || !absolute(options.checkout) || !text(options.purpose)
    || !text(options.cleanupCondition) || (options.taskId !== undefined && !text(options.taskId))
  ) {
    Errors.throwHostEnvironment('Cannot register invalid resource directory provenance.')
  }
  await metadata(options.checkout)
  let owner: TrackedProcess | undefined
  try {
    owner = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
  } catch {
    // Missing capture remains unverified; directory existence never fills in process ownership.
  }
  const identity = FS.entryMetadataSync(options.path)
  return publish({
    version: 1,
    id: Platform.randomUUID(),
    kind: 'directory',
    path: options.path,
    checkout: options.checkout,
    purpose: redact(options.purpose),
    cleanupCondition: redact(options.cleanupCondition),
    directoryMetadata: { device: identity.device, inode: identity.inode, uid: identity.uid },
    ...(owner === undefined ? {} : { owner: { ...owner, command: '' } }),
    ...(options.taskId === undefined ? {} : { taskId: redact(options.taskId) }),
  }, indexRoot(options.indexRoot))
}
