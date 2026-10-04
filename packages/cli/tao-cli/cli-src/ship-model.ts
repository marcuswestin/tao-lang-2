import { Errors, Platform } from '@shared'

/** Tao keeps the authored full SemVer; native packaging uses its numeric core. */
export type ShipVersion = string

export type ShipBump = 'major' | 'minor' | 'patch'

export type ShipIdentityInput = {
  appId: string
  namespace: string
}

/** Parse a full Tao SemVer, including prerelease and build metadata. */
export function parseShipVersion(value: string): ShipVersion | undefined {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
      .test(value)
  ) {
    return undefined
  }
  return value
}

/** Apple accepts the numeric core as its marketing version. */
export function nativeMarketingVersion(version: ShipVersion): string {
  return version.split(/[+-]/u, 1)[0]!
}

/** bumpShipVersion applies the selected SemVer core bump. */
export function bumpShipVersion(version: ShipVersion, bump: ShipBump): ShipVersion {
  const [major, minor, patch] = nativeMarketingVersion(version).split('.').map(Number) as [number, number, number]
  if (bump === 'major') {
    return `${major + 1}.0.0`
  }
  if (bump === 'minor') {
    return `${major}.${minor + 1}.0`
  }
  return `${major}.${minor}.${patch + 1}`
}

/** decideShipVersion preserves an unconsumed version unless a bump is forced. */
export function decideShipVersion(
  current: ShipVersion,
  options: { consumed: boolean; forcedBump?: ShipBump },
): { bumped: boolean; version: ShipVersion } {
  const bump = options.forcedBump ?? (options.consumed ? 'patch' : undefined)
  return bump === undefined
    ? { bumped: false, version: current }
    : { bumped: true, version: bumpShipVersion(current, bump) }
}

/** timestampBuildNumber derives Apple's increasing per-version build number in UTC. */
export function timestampBuildNumber(date: Date): string {
  const digits = [
    date.getUTCFullYear().toString().padStart(4, '0'),
    (date.getUTCMonth() + 1).toString().padStart(2, '0'),
    date.getUTCDate().toString().padStart(2, '0'),
    date.getUTCHours().toString().padStart(2, '0'),
    date.getUTCMinutes().toString().padStart(2, '0'),
  ]
  return digits.join('')
}

/** nextBuildNumber keeps timestamp-derived build numbers monotonic across local and remote history. */
export function nextBuildNumber(minimum: string, usedNumbers: readonly string[]): string {
  const minimumValue = numericBuildNumber(minimum)
  const maximumUsed = usedNumbers.reduce<bigint | undefined>((maximum, candidate) => {
    const value = numericBuildNumber(candidate, false)
    if (value === undefined) {
      return maximum
    }
    return maximum === undefined || value > maximum ? value : maximum
  }, undefined)
  return (maximumUsed !== undefined && maximumUsed >= minimumValue ? maximumUsed + 1n : minimumValue).toString()
}

/** Derive a native identifier and update channel from the selected effective app id. */
export function deriveShipIdentity(input: ShipIdentityInput): {
  bundleIdentifier: string
  channel: string
} {
  const app = bundleSegment(input.appId)
  const namespace = input.namespace.split('.').map(bundleSegment).filter(Boolean).join('.')
  const bundleIdentifier = [namespace, app].filter(Boolean).join('.')
  return {
    bundleIdentifier,
    channel: app,
  }
}

/** shipInputHash records only declaration-derived inputs, never credential material. */
export function shipInputHash(input: unknown): string {
  return Platform.sha256Hex(stableJson(input))
}

/** shipContentHash derives a stable SHA-256 identity without exposing Node crypto across CLI modules. */
export function shipContentHash(parts: readonly (string | Uint8Array)[]): string {
  return Platform.sha256Hex(parts)
}

function bundleSegment(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

function numericBuildNumber(value: string): bigint
function numericBuildNumber(value: string, required: false): bigint | undefined
function numericBuildNumber(value: string, required = true): bigint | undefined {
  if (!/^\d+$/u.test(value)) {
    if (required) {
      Errors.throwUnexpected(`Build number must contain only decimal digits: ${value}`)
    }
    return undefined
  }
  return BigInt(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${
      Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right)).map(
        ([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`,
      ).join(',')
    }}`
  }
  return JSON.stringify(value)
}
