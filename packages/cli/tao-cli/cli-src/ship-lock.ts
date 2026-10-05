import { Errors, FS, Json, ProjectLocal, ReleaseCapabilities, type ReleaseProfile, Text } from '@shared'
import { PROJECT_LOCK_RELATIVE_PATH } from './project-lock-path'
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

/**
 * The package resolver owns this section as one complete snapshot. Shipping never interprets it; it only
 * preserves it while updating the independent `ship` concern in the same Tao-written project lock.
 */
export type InstallsLock = {
  lockfileVersion: 2
  environments: Record<string, {
    projectRoot: string
    npm: Record<string, {
      name: string
      requested: string
      version: string
    }>
    publications: ReadonlyArray<{ name?: string; version: string }>
  }>
  local: Record<string, {
    sourceRoot: string
    publication?: string
    root: string
    version: string
    bindings: Readonly<Record<string, string>>
  }>
}

export type TaoProjectLock = {
  installs?: InstallsLock
  schemaVersion: 1
  skillsVersion?: string
  ship?: {
    apps: Record<string, ShipLockEntry>
  }
  /** The Tao release this project runs under; `toolchain-pin.ts` reads and writes it. */
  toolchain?: {
    releaseProfile?: ReleaseProfile & { fingerprint: string }
    version: string
  }
}

export const SHIP_LOCK_RELATIVE_PATH = PROJECT_LOCK_RELATIVE_PATH

export async function readProjectLock(projectRoot: string): Promise<TaoProjectLock> {
  await ProjectLocal.prepare(projectRoot)
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
  await ProjectLocal.prepare(projectRoot)
  const root = await FS.realPath(projectRoot)
  const path = FS.resolvePath(SHIP_LOCK_RELATIVE_PATH, root)
  return await withShipLockWrite(root, async () => {
    const fresh = await readProjectLock(root)
    const merged = mergeProjectLocks(fresh, lock)
    const temporary = ProjectLocal.stagingPath(path, root)
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
  // A lock only the other concerns have written, such as a new project's toolchain pin, gains no
  // empty `ship` section.
  const shipping = fresh.ship === undefined && incoming.ship === undefined
    ? {}
    : { ship: { ...fresh.ship, ...incoming.ship, apps } }
  // Skills are installed by their own writer. A ship or toolchain caller may carry an older
  // snapshot, so the lock's current version wins when its other concerns are merged.
  const skillsVersion = fresh.skillsVersion ?? incoming.skillsVersion
  const freshEnvironments = installEnvironmentsByProjectRoot(fresh.installs?.environments ?? {})
  const incomingEnvironments = installEnvironmentsByProjectRoot(incoming.installs?.environments ?? {})
  const installs = fresh.installs === undefined && incoming.installs === undefined
    ? {}
    : {
      installs: {
        lockfileVersion: 2 as const,
        local: { ...fresh.installs?.local, ...incoming.installs?.local },
        environments: Object.fromEntries(
          [...new Set([...Object.keys(freshEnvironments), ...Object.keys(incomingEnvironments)])].toSorted().map(
            projectRoot => {
              const before = freshEnvironments[projectRoot]
              const after = incomingEnvironments[projectRoot]
              const source = after ?? before!
              return [projectRoot, {
                projectRoot,
                publications: source.publications,
                npm: { ...before?.npm, ...after?.npm },
              }]
            },
          ),
        ),
      } satisfies InstallsLock,
    }
  return { ...fresh, ...incoming, ...shipping, ...installs, ...(skillsVersion === undefined ? {} : { skillsVersion }) }
}

/**
 * A committed lock must read the same in every checkout, so install environments are keyed by their
 * project root relative to the lock's project, never by the machine-specific dependency namespace.
 * Entries an older Tao wrote under a namespace fold into their project root's key, later keys winning.
 */
export function installEnvironmentsByProjectRoot(
  environments: InstallsLock['environments'],
): InstallsLock['environments'] {
  const byProjectRoot: InstallsLock['environments'] = {}
  for (const key of Object.keys(environments).toSorted()) {
    const entry = environments[key]!
    const previous = byProjectRoot[entry.projectRoot]
    byProjectRoot[entry.projectRoot] = { ...entry, npm: { ...previous?.npm, ...entry.npm } }
  }
  return byProjectRoot
}

/**
 * writeToolchainPin records the Tao release a project runs under, which the version shim in
 * `toolchain-pin.ts` reads, keeping every other concern the lock already holds.
 */
export async function writeToolchainPin(projectRoot: string, version: string): Promise<string> {
  const lock = await readProjectLock(projectRoot)
  return await writeProjectLock(projectRoot, {
    ...lock,
    toolchain: {
      version,
      ...(ReleaseCapabilities.current().phase === 'development'
        ? {}
        : { releaseProfile: { ...ReleaseCapabilities.current(), fingerprint: ReleaseCapabilities.fingerprint() } }),
    },
  })
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

/** putInstallsLock replaces the resolver-owned graph without disturbing other lock concerns. */
export function putInstallsLock(lock: TaoProjectLock, installs: InstallsLock): TaoProjectLock {
  return { ...lock, installs }
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
