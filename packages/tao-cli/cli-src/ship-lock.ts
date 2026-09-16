import { Errors, FS, Json, Platform, Text } from '@shared'
import { withShipLockWrite } from './ship-transaction'

type ShipLockStatus = 'accepted' | 'suggested'

type ShipLockProvenance = {
  at: string
  command: 'tao ship'
  version: number
}

export type ShipLockEntry = {
  accepted?: {
    bundleIdentifier: string
    datasourceConfiguration?: Readonly<Record<string, string>>
    issuerId: string
    keyId: string
    namespace: string
  }
  appStoreAppId?: string
  betaGroups?: {
    external?: string
    internal?: string
  }
  identity: string
  inputHash: string
  lastBuild?: {
    buildId?: string
    commit: string
    dirty?: boolean
    dirtyFingerprint?: string
    distribution?: 'app-store' | 'testflight'
    number: string
    processed?: boolean
    processingState?: 'FAILED' | 'INVALID' | 'PROCESSING' | 'VALID'
    releaseNotesFromCommit?: string
    submittedForReview?: boolean
    version: string
  }
  provenance: ShipLockProvenance
  status: ShipLockStatus
  suggested?: {
    bundleIdentifier: string
    datasourceConfiguration?: Readonly<Record<string, string>>
    issuerId: string
    keyId: string
    namespace: string
  }
  update?: {
    channel: string
    dataSchemaFingerprint?: string
    publicationId?: string
    runtimeFingerprint?: string
    serverUrl?: string
    supportedBinaries?: Array<{
      buildNumber: string
      dataSchemaFingerprint: string
      platform: 'ios'
      runtimeVersion: string
      version: string
    }>
  }
}

export type TaoProjectLock = {
  schemaVersion: 1
  ship?: {
    apps: Record<string, ShipLockEntry>
  }
}

export const SHIP_LOCK_RELATIVE_PATH = '.tao-project/lock.jsonc'

export async function readProjectLock(projectRoot: string): Promise<TaoProjectLock> {
  const path = FS.resolvePath(SHIP_LOCK_RELATIVE_PATH, projectRoot)
  if (!await FS.exists(path)) {
    return { schemaVersion: 1 }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Text.stripJsonc(await FS.readText(path)))
  } catch (error) {
    Errors.throwUserInput(`Tao project lock at ${path} is not valid JSONC: ${String(error)}`)
  }
  if (!Json.isRecord(parsed) || parsed['schemaVersion'] !== 1) {
    Errors.throwUserInput(`Tao project lock at ${path} must declare schemaVersion 1.`)
  }
  return parsed as TaoProjectLock
}

/** writeProjectLock writes the Tao-owned lock in deterministic, reviewable JSONC form. */
export async function writeProjectLock(projectRoot: string, lock: TaoProjectLock): Promise<string> {
  const path = FS.resolvePath(SHIP_LOCK_RELATIVE_PATH, projectRoot)
  return await withShipLockWrite(projectRoot, async () => {
    const fresh = await readProjectLock(projectRoot)
    const merged = mergeProjectLocks(fresh, lock)
    const temporary = `${path}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
    try {
      await FS.writeText(temporary, `${JSON.stringify(merged, null, 2)}\n`)
      await FS.move(temporary, path)
      return path
    } finally {
      await FS.remove(temporary).catch(() => {})
    }
  })
}

/** mergeProjectLocks preserves independently written app state while applying the caller's checkpoint. */
export function mergeProjectLocks(fresh: TaoProjectLock, incoming: TaoProjectLock): TaoProjectLock {
  const identities = new Set([
    ...Object.keys(fresh.ship?.apps ?? {}),
    ...Object.keys(incoming.ship?.apps ?? {}),
  ])
  const apps = Object.fromEntries(
    [...identities].toSorted().map(identity => {
      const before = fresh.ship?.apps[identity]
      const after = incoming.ship?.apps[identity]
      if (before === undefined) {
        return [identity, after!]
      }
      if (after === undefined) {
        return [identity, before]
      }
      return [
        identity,
        {
          ...before,
          ...after,
          ...(before.accepted === undefined && after.accepted === undefined
            ? {}
            : { accepted: { ...before.accepted, ...after.accepted } as NonNullable<ShipLockEntry['accepted']> }),
          ...(before.lastBuild === undefined && after.lastBuild === undefined
            ? {}
            : { lastBuild: { ...before.lastBuild, ...after.lastBuild } as NonNullable<ShipLockEntry['lastBuild']> }),
          ...(before.update === undefined && after.update === undefined
            ? {}
            : { update: { ...before.update, ...after.update } as NonNullable<ShipLockEntry['update']> }),
        } satisfies ShipLockEntry,
      ]
    }),
  )
  return {
    ...fresh,
    ...incoming,
    ship: {
      ...fresh.ship,
      ...incoming.ship,
      apps,
    },
  }
}

function shipLockEntry(lock: TaoProjectLock, identity: string): ShipLockEntry | undefined {
  return lock.ship?.apps[identity]
}

export function putShipLockEntry(lock: TaoProjectLock, entry: ShipLockEntry): TaoProjectLock {
  return {
    ...lock,
    ship: {
      ...lock.ship,
      apps: {
        ...(lock.ship?.apps ?? {}),
        [entry.identity]: entry,
      },
    },
  }
}

/** acceptedShipEntry refuses suggestions and declaration-stale accepted values. */
export function acceptedShipEntry(
  lock: TaoProjectLock,
  identity: string,
  inputHash: string,
): ShipLockEntry | undefined {
  const entry = shipLockEntry(lock, identity)
  if (!entry || entry.status !== 'accepted' || !entry.accepted) {
    return undefined
  }
  if (entry.inputHash !== inputHash) {
    Errors.throwUserInput(
      `Accepted ship metadata for '${identity}' is stale because its Tao declaration changed. Run tao ship interactively to review it.`,
    )
  }
  return entry
}

export function promoteShipEntry(entry: ShipLockEntry): ShipLockEntry {
  if (!entry.suggested) {
    Errors.throwUnexpected(`Ship metadata suggestion '${entry.identity}' has no value to accept.`)
  }
  const { suggested, ...rest } = entry
  return { ...rest, accepted: suggested, status: 'accepted' }
}
