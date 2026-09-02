import { Errors, FS } from '@shared'

export type ShipLockStatus = 'accepted' | 'suggested'

export type ShipLockProvenance = {
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
    number: string
    processed?: boolean
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
    previousPublicationId?: string
    publicationId?: string
    runtimeFingerprint?: string
    serverUrl?: string
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
    parsed = JSON.parse(stripJsonc(await FS.readText(path)))
  } catch (error) {
    Errors.throwUserInput(`Tao project lock at ${path} is not valid JSONC: ${String(error)}`)
  }
  if (!isObject(parsed) || parsed['schemaVersion'] !== 1) {
    Errors.throwUserInput(`Tao project lock at ${path} must declare schemaVersion 1.`)
  }
  return parsed as TaoProjectLock
}

/** writeProjectLock writes the Tao-owned lock in deterministic, reviewable JSONC form. */
export async function writeProjectLock(projectRoot: string, lock: TaoProjectLock): Promise<string> {
  const path = FS.resolvePath(SHIP_LOCK_RELATIVE_PATH, projectRoot)
  await FS.writeText(path, `${JSON.stringify(lock, null, 2)}\n`)
  return path
}

export function shipLockEntry(lock: TaoProjectLock, identity: string): ShipLockEntry | undefined {
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

function stripJsonc(source: string): string {
  let result = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]!
    const next = source[index + 1]
    if (inString) {
      result += current
      if (escaped) {
        escaped = false
      } else if (current === '\\') {
        escaped = true
      } else if (current === '"') {
        inString = false
      }
      continue
    }
    if (current === '"') {
      inString = true
      result += current
      continue
    }
    if (current === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1
      }
      result += '\n'
      continue
    }
    if (current === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1
      }
      index += 1
      continue
    }
    result += current
  }
  return result.replace(/,\s*([}\]])/gu, '$1')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
