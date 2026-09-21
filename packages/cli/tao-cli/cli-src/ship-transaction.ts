import { CLI, Errors, FS, Platform, Time } from '@shared'
import { shipContentHash } from './ship-model'

type LockOwner = {
  pid: number
  token: string
}

type ReclaimClaim = {
  linkPath: string
  ownerPath: string
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
      if (await lockTarget(reclaimClaim.linkPath) === reclaimClaim.ownerPath) {
        await FS.remove(reclaimClaim.linkPath).catch(() => {})
      }
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
            const ownsReclaimClaim = reclaimClaim !== undefined
              && await lockTarget(reclaimClaim.linkPath) === reclaimClaim.ownerPath
            if (reclaimClaim?.staleTarget !== staleTarget || !ownsReclaimClaim) {
              await releaseReclaimClaim()
              reclaimClaim = await acquireReclaimClaim(coordinationRoot, name, staleTarget, ownerPath)
            }
            if (reclaimClaim) {
              await reclaimStaleOwner(coordinationRoot, linkPath, name, reclaimClaim)
            } else {
              await Time.sleep(ACQUIRE_POLL_MS)
            }
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
  if (
    await lockTarget(claim.linkPath) !== claim.ownerPath
    || await lockTarget(linkPath) !== claim.staleTarget
  ) {
    return
  }
  if (staleUnlinkDelayForTestingMs > 0) {
    await Time.sleep(staleUnlinkDelayForTestingMs)
  }
  await beforeStaleUnlinkForTesting?.(linkPath)
  // The fixed claim symlink is the cross-process election: while its owner is alive no later
  // contender can become another winner. Recheck both it and the observed lock target at the
  // destructive edge so a replacement installed while this claimant waited is never unlinked.
  if (
    await lockTarget(claim.linkPath) !== claim.ownerPath
    || await lockTarget(linkPath) !== claim.staleTarget
  ) {
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

async function acquireReclaimClaim(
  coordinationRoot: string,
  name: string,
  staleTarget: string,
  ownerPath: string,
): Promise<ReclaimClaim | undefined> {
  const targetKey = FS.basename(staleTarget).replaceAll(/[^a-zA-Z0-9._-]/gu, '_')
  const linkPath = FS.resolvePath(`${name}-reclaim-${targetKey}.lock`, coordinationRoot)
  try {
    await FS.symlink(FS.basename(ownerPath), linkPath)
    return { linkPath, ownerPath, staleTarget }
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error
    }
  }

  const observedTarget = await lockTarget(linkPath)
  const observedOwner = observedTarget === undefined ? undefined : await readOwner(observedTarget)
  if (observedOwner !== undefined && Platform.processIsAlive(observedOwner.pid)) {
    return undefined
  }

  // Atomically move a dead claimant aside instead of unlinking the shared path. If another process
  // already replaced it, the moved target exposes that race and is discarded without granting this
  // contender ownership; the fresh claimant will verify the fixed link before it can unlink.
  const displacedPath = FS.resolvePath(
    `${FS.basename(linkPath)}-displaced-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`,
    coordinationRoot,
  )
  try {
    await FS.move(linkPath, displacedPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return undefined
    }
    throw error
  }
  try {
    if (observedTarget !== undefined && await lockTarget(displacedPath) !== observedTarget) {
      return undefined
    }
  } finally {
    await FS.remove(displacedPath).catch(() => {})
  }
  return undefined
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
