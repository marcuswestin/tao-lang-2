import { FS, Platform } from '@shared'
import { TestRunRoot } from './test-run-root'

/** Jest's transform cache is useful across runs, but Jest never evicts entries for obsolete paths. */
const ENV = 'TAO_TEST_JEST_CACHE_DIRECTORY'
// At most about twelve cold 2,135-file module graphs, or over two hundred 116-file edits. A hot
// checkout keeps the transforms it can reuse; obsolete keys compete for this fixed allowance.
const MAX_FILES = 25_000
const MAX_BYTES = 256 * 1024 * 1024
// A killed CLI may leave Jest running briefly. Keep its lease longer than a normal journey, then
// reclaim it on a later run. The outer limit also prevents a reused PID from pinning it forever.
const DEAD_OWNER_GRACE_MS = 60 * 60 * 1000
const MAX_LEASE_AGE_MS = 24 * DEAD_OWNER_GRACE_MS
const LEASE_NAME = /^\d+-[0-9a-f-]+\.json$/

type Options = {
  /** An isolated root and small budgets let lifecycle tests exercise eviction without real Jest. */
  root?: string
  maxFiles?: number
  maxBytes?: number
}

/** JestTransformCache owns a bounded, checkout-scoped transform cache for `tao test`. */
export const JestTransformCache = { ENV, root, run } as const

/** Keep reusable transforms out of macOS boot-time temp cleanup, scoped by the run-root identity. */
function root(runtimePackageRoot: string): string {
  const checkoutIdentity = FS.basename(FS.dirname(TestRunRoot.hostGeneratedRoot(runtimePackageRoot)))
  return FS.resolvePath(`.cache/tao/jest-transform-cache/${checkoutIdentity}`, FS.homeDir())
}

/**
 * run registers a process lease before Jest starts and prunes after its last concurrent reader exits.
 * A killed CLI leaves a lease; a later run reclaims it after a grace period that protects any
 * surviving Jest child. Registration and pruning share a file lock so a new reader cannot enter
 * while old files are being removed.
 */
async function run<Value>(
  runtimePackageRoot: string,
  work: (cacheDirectory: string) => Promise<Value>,
  options: Options = {},
): Promise<Value> {
  const cacheRoot = options.root ?? root(runtimePackageRoot)
  await FS.mkdir(cacheRoot)
  const canonicalRoot = await FS.realPath(cacheRoot)
  const cacheDirectory = FS.resolvePath('data', canonicalRoot)
  const leasesRoot = FS.resolvePath('leases', canonicalRoot)
  await FS.mkdir(cacheDirectory)
  await FS.mkdir(leasesRoot)
  const leasePath = FS.resolvePath(`${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.json`, leasesRoot)
  const locked = async (action: () => Promise<void>) =>
    await FS.withFileMutationLock(FS.resolvePath('coordination', canonicalRoot), canonicalRoot, action)

  await locked(async () => {
    const leases = await activeLeases(leasesRoot)
    // A prior process may have died before its final prune. Ordinary runs prune at exit only, so
    // warm runs do not pay for a full cache walk twice.
    if (leases.active === 0 && leases.reclaimed) {
      await prune(cacheDirectory, options)
    }
    await FS.writeJson(leasePath, { pid: Platform.runtimeProcess.pid })
  })
  try {
    return await work(cacheDirectory)
  } finally {
    await locked(async () => {
      await FS.remove(leasePath)
      if ((await activeLeases(leasesRoot)).active === 0) {
        await prune(cacheDirectory, options)
      }
    })
  }
}

/** Remove expired leases while protecting active processes and recently orphaned Jest children. */
async function activeLeases(leasesRoot: string): Promise<{ active: number; reclaimed: boolean }> {
  let active = 0
  let reclaimed = false
  for (const name of await FS.listDir(leasesRoot)) {
    if (!LEASE_NAME.test(name)) {
      continue
    }
    const path = FS.resolvePath(name, leasesRoot)
    const pid = Number(name.split('-')[0])
    const ageMs = Date.now() - await FS.modifiedTimeMs(path).catch(() => Date.now())
    if (ageMs < MAX_LEASE_AGE_MS && (Platform.processIsAlive(pid) || ageMs < DEAD_OWNER_GRACE_MS)) {
      active += 1
    } else {
      await FS.remove(path)
      reclaimed = true
    }
  }
  return { active, reclaimed }
}

/** Evict the oldest transforms until both file count and disk bytes fit the cache budget. */
async function prune(cacheDirectory: string, options: Options): Promise<void> {
  const files: Array<{ path: string; bytes: number; modifiedMs: number }> = []
  let bytes = 0
  for await (const path of FS.walk(cacheDirectory, { includeHidden: true })) {
    if (!await FS.isFile(path)) {
      continue
    }
    const size = await FS.byteSize(path).catch(() => 0)
    files.push({ path, bytes: size, modifiedMs: await FS.modifiedTimeMs(path).catch(() => 0) })
    bytes += size
  }
  const maxFiles = options.maxFiles ?? MAX_FILES
  const maxBytes = options.maxBytes ?? MAX_BYTES
  if (files.length <= maxFiles && bytes <= maxBytes) {
    return
  }
  files.sort((left, right) => left.modifiedMs - right.modifiedMs || left.path.localeCompare(right.path))
  let count = files.length
  for (const file of files) {
    if (count <= maxFiles && bytes <= maxBytes) {
      break
    }
    await FS.remove(file.path)
    count -= 1
    bytes -= file.bytes
  }
  await removeEmptyDirectories(cacheDirectory)
}

/** Remove Jest's now-empty hash buckets too, so obsolete configurations leave no directory buildup. */
async function removeEmptyDirectories(directory: string): Promise<void> {
  for (const name of await FS.listDir(directory)) {
    const child = FS.resolvePath(name, directory)
    if (await FS.isDirectory(child)) {
      await removeEmptyDirectories(child)
      if ((await FS.listDir(child)).length === 0) {
        await FS.remove(child)
      }
    }
  }
}
