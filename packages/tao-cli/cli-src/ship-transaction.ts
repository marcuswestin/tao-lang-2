import { CLI, Errors, FS, Platform, Time } from '@shared'
import { shipContentHash } from './ship-model'

type LockOwner = {
  pid: number
  token: string
}

type ReclaimClaim = {
  path: string
  prefix: string
  staleTarget: string
}

const ACQUIRE_POLL_MS = 25
const ACQUIRE_TIMEOUT_MS = 30 * 60_000
let staleUnlinkDelayForTestingMs = 0
let beforeStaleUnlinkForTesting: ((linkPath: string) => Promise<void>) | undefined

/** withShipTransaction serializes complete ship runs for one Git repository across independent processes. */
export async function withShipTransaction<T>(projectRoot: string, work: () => Promise<T>): Promise<T> {
  return await withProjectLock(projectRoot, 'ship-transaction', work)
}

/** withShipLockWrite serializes atomic fresh-state lock merges, including callers outside a ship run. */
export async function withShipLockWrite<T>(projectRoot: string, work: () => Promise<T>): Promise<T> {
  return await withProjectLock(projectRoot, 'ship-lock-write', work)
}

async function withProjectLock<T>(projectRoot: string, name: string, work: () => Promise<T>): Promise<T> {
  const serializationRoot = await shipSerializationRoot(projectRoot)
  const repositoryKey = shipContentHash([serializationRoot])
  const coordinationRoot = FS.resolvePath(`tao-ship-coordination/${repositoryKey}`, FS.tmpdir())
  await FS.mkdir(coordinationRoot)
  const token = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  const ownerPath = FS.resolvePath(`${name}-${token}.json`, coordinationRoot)
  const linkPath = FS.resolvePath(`${name}.lock`, coordinationRoot)
  await FS.writeJson(ownerPath, { pid: Platform.runtimeProcess.pid, token } satisfies LockOwner)
  const deadline = Time.nowMs() + ACQUIRE_TIMEOUT_MS
  let reclaimClaim: ReclaimClaim | undefined
  const releaseReclaimClaim = async (): Promise<void> => {
    if (reclaimClaim) {
      await FS.remove(reclaimClaim.path).catch(() => {})
      reclaimClaim = undefined
    }
  }
  try {
    while (true) {
      try {
        await FS.symlink(FS.basename(ownerPath), linkPath)
        break
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          throw error
        }
        const staleTarget = await lockTarget(linkPath)
        const owner = staleTarget === undefined ? undefined : await readOwner(staleTarget)
        if (owner === undefined || !Platform.processIsAlive(owner.pid)) {
          if (staleTarget !== undefined) {
            if (reclaimClaim?.staleTarget !== staleTarget) {
              await releaseReclaimClaim()
              reclaimClaim = await createReclaimClaim(coordinationRoot, name, staleTarget)
            }
            await reclaimStaleOwner(coordinationRoot, linkPath, name, reclaimClaim)
          }
          continue
        }
        await releaseReclaimClaim()
        if (Time.nowMs() >= deadline) {
          Errors.throwHostEnvironment(`Timed out waiting for another tao ship process in ${projectRoot}.`)
        }
        await Time.sleep(ACQUIRE_POLL_MS)
      }
    }
    await releaseReclaimClaim()
    try {
      return await work()
    } finally {
      if (await lockTarget(linkPath) === ownerPath) {
        await FS.remove(linkPath)
      }
    }
  } finally {
    await releaseReclaimClaim()
    await FS.remove(ownerPath).catch(() => {})
  }
}

async function shipSerializationRoot(projectRoot: string): Promise<string> {
  const gitRoot = await CLI.run('git', {
    args: ['--no-optional-locks', '-C', projectRoot, 'rev-parse', '--show-toplevel'],
  })
  const root = gitRoot.exitCode === 0 && gitRoot.stdout.trim().length > 0
    ? gitRoot.stdout.trim()
    : projectRoot
  return await FS.realPath(root).catch(() => FS.resolvePath(root))
}

/**
 * Elects one stale-owner reclaimer before unlinking. Losers never unlink, so a replacement owner
 * cannot be deleted between an exact-target check and removal by another stale observer.
 */
async function reclaimStaleOwner(
  coordinationRoot: string,
  linkPath: string,
  name: string,
  claim: ReclaimClaim,
): Promise<void> {
  await Time.sleep(ACQUIRE_POLL_MS)
  const liveClaims: string[] = []
  for (const entry of await FS.listDir(coordinationRoot)) {
    if (!entry.startsWith(claim.prefix)) {
      continue
    }
    const candidate = FS.resolvePath(entry, coordinationRoot)
    const owner = await readOwner(candidate)
    if (owner === undefined || !Platform.processIsAlive(owner.pid)) {
      await FS.remove(candidate).catch(() => {})
    } else {
      liveClaims.push(candidate)
    }
  }
  if (liveClaims.toSorted()[0] !== claim.path || await lockTarget(linkPath) !== claim.staleTarget) {
    return
  }
  if (staleUnlinkDelayForTestingMs > 0) {
    await Time.sleep(staleUnlinkDelayForTestingMs)
  }
  await beforeStaleUnlinkForTesting?.(linkPath)
  // The election and the target observation are separate filesystem operations. Recheck at the
  // destructive edge so a replacement installed while this claimant waited is never unlinked.
  if (await lockTarget(linkPath) !== claim.staleTarget) {
    return
  }
  await FS.remove(linkPath).catch(error => {
    if (errorCode(error) !== 'ENOENT') {
      throw error
    }
  })
  if (
    await lockTarget(linkPath) !== claim.staleTarget
    && FS.dirname(claim.staleTarget) === coordinationRoot
    && FS.basename(claim.staleTarget).startsWith(`${name}-`)
  ) {
    await FS.remove(claim.staleTarget).catch(() => {})
  }
}

async function createReclaimClaim(
  coordinationRoot: string,
  name: string,
  staleTarget: string,
): Promise<ReclaimClaim> {
  const targetKey = FS.basename(staleTarget).replaceAll(/[^a-zA-Z0-9._-]/gu, '_')
  const prefix = `${name}-reclaim-${targetKey}-`
  const path = FS.resolvePath(
    `${prefix}${String(Time.nowMs()).padStart(16, '0')}-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.json`,
    coordinationRoot,
  )
  await FS.writeJson(
    path,
    {
      pid: Platform.runtimeProcess.pid,
      token: FS.basename(path),
    } satisfies LockOwner,
  )
  return { path, prefix, staleTarget }
}

async function lockTarget(linkPath: string): Promise<string | undefined> {
  const result = await CLI.run('/usr/bin/readlink', { args: [linkPath] })
  const target = result.stdout.trim()
  return result.exitCode === 0 && target.length > 0 ? FS.resolvePath(target, FS.dirname(linkPath)) : undefined
}

async function readOwner(path: string): Promise<LockOwner | undefined> {
  try {
    const value = await FS.readJson<Partial<LockOwner>>(path)
    return Number.isInteger(value.pid) && (value.pid ?? 0) > 0 && typeof value.token === 'string'
      ? value as LockOwner
      : undefined
  } catch {
    return undefined
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

/** Narrow test seam for deterministically widening the stale-unlink replacement race. */
export const ShipTransactionTesting = {
  setBeforeStaleUnlink(hook: ((linkPath: string) => Promise<void>) | undefined): void {
    beforeStaleUnlinkForTesting = hook
  },
  setStaleUnlinkDelay(ms: number): void {
    staleUnlinkDelayForTestingMs = ms
  },
}
