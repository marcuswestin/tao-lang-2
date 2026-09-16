import { Errors } from '@shared'
import { createHash } from 'node:crypto'

/** ShipVersion is the numeric SemVer core Apple accepts as a marketing version. */
export type ShipVersion = `${number}.${number}.${number}`

export type ShipBump = 'major' | 'minor' | 'patch'

export type ShipIdentityInput = {
  appName: string
  primaryAppName: string
  projectId: string
  namespace: string
}

/** parseShipVersion accepts SemVer's three numeric core components and nothing Apple cannot consume. */
export function parseShipVersion(value: string): ShipVersion | undefined {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)) {
    return undefined
  }
  return value as ShipVersion
}

/** bumpShipVersion applies the selected SemVer core bump. */
export function bumpShipVersion(version: ShipVersion, bump: ShipBump): ShipVersion {
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number]
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

/** deriveShipIdentity deterministically separates every non-primary app variant. */
export function deriveShipIdentity(input: ShipIdentityInput): {
  bundleIdentifier: string
  channel: string
  variant?: string
} {
  const project = bundleSegment(input.projectId)
  const variant = input.appName === input.primaryAppName ? undefined : bundleSegment(input.appName)
  const namespace = input.namespace.split('.').map(bundleSegment).filter(Boolean).join('.')
  const bundleIdentifier = [namespace, project, variant].filter(Boolean).join('.')
  return {
    bundleIdentifier,
    channel: variant === undefined ? project : `${project}-${variant}`,
    ...(variant === undefined ? {} : { variant }),
  }
}

/** shipInputHash records only declaration-derived inputs, never credential material. */
export function shipInputHash(input: unknown): string {
  return createHash('sha256').update(stableJson(input)).digest('hex')
}

/** shipContentHash derives a stable SHA-256 identity without exposing Node crypto across CLI modules. */
export function shipContentHash(parts: readonly (string | Uint8Array)[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part)
  }
  return hash.digest('hex')
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
