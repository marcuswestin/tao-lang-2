import { Json } from '@shared/core'
import type { StudioCellEnvironment } from '../../StudioPreviewManifest'
import type { StudioJsonObject, StudioJsonValue, StudioRuntimeCaptureArtifact } from '../../StudioProtocol'

export type StudioRuntimeLog = Readonly<{
  arguments: readonly StudioJsonValue[]
  level: 'debug' | 'error' | 'info' | 'log' | 'warn'
  timestamp: number
}>

export type StudioRuntimeDataTable = Readonly<{
  datasource: string
  entity: string
  rows: readonly StudioJsonObject[]
}>

/** Reads the Data panel's tables out of a runtime capture's `data` domain. */
export const StudioRuntimeData = {
  tables(capture: StudioRuntimeCaptureArtifact | undefined): readonly StudioRuntimeDataTable[] {
    const value = capture?.domains.find(domain => domain.domain === 'data' && domain.version === 1)?.value
    if (!Json.isRecord(value) || !Array.isArray(value['entries'])) {
      return []
    }
    return value['entries'].flatMap(entry => runtimeDataEntryTables(entry))
  },
} as const

/** Adds Studio-owned viewport/network state without allowing unregistered domains into a capture. */
export function runtimeCaptureWithEnvironment(
  capture: StudioRuntimeCaptureArtifact,
  environment: StudioCellEnvironment | undefined,
): StudioRuntimeCaptureArtifact {
  if (environment === undefined) {
    return capture
  }
  const domains = [
    ...capture.domains.filter(domain => domain.domain !== 'environment'),
    {
      domain: 'environment',
      value: environment as unknown as StudioJsonValue,
      version: 1,
    },
  ].toSorted((left, right) => left.domain.localeCompare(right.domain))
  return { ...capture, domains }
}

/** Resolves portable runtime environment state without discarding a dev-owned environment codec. */
export function studioReplayConfiguration(
  capture: StudioRuntimeCaptureArtifact,
  currentEnvironment: StudioCellEnvironment,
): { environment: StudioCellEnvironment; replay: StudioRuntimeCaptureArtifact } {
  const capturedEnvironment = runtimeCaptureEnvironment(capture)
  const capturedScheme = runtimeCaptureScheme(capture)
  const hasEnvironmentDomain = capture.domains.some(domain => domain.domain === 'environment')
  return {
    environment: {
      ...(capturedEnvironment ?? currentEnvironment),
      scheme: capturedScheme ?? capturedEnvironment?.scheme ?? currentEnvironment.scheme,
    },
    replay: hasEnvironmentDomain ? capture : runtimeCaptureWithEnvironment(capture, currentEnvironment),
  }
}

function runtimeCaptureScheme(
  capture: StudioRuntimeCaptureArtifact,
): StudioCellEnvironment['scheme'] | undefined {
  const value = capture.domains.find(domain => domain.domain === 'scheme' && domain.version === 1)?.value
  return isStudioSchemeEnvironment(value) ? value : undefined
}

function runtimeCaptureEnvironment(capture: StudioRuntimeCaptureArtifact): StudioCellEnvironment | undefined {
  const value = capture.domains.find(domain => domain.domain === 'environment' && domain.version === 1)?.value
  return isStudioCellEnvironment(value) ? value : undefined
}

function isStudioCellEnvironment(value: unknown): value is StudioCellEnvironment {
  if (
    !Json.isRecord(value) || !Json.isRecord(value['network']) || !Json.isRecord(value['scheme'])
    || !Json.isRecord(value['viewport'])
  ) {
    return false
  }
  const network = value['network']
  const scheme = value['scheme']
  const viewport = value['viewport']
  const outcome = network['outcome']
  const error = network['error']
  return Number.isSafeInteger(network['latencyMs'])
    && Number(network['latencyMs']) >= 0
    && (outcome === 'error' || outcome === 'normal' || outcome === 'offline')
    && (outcome === 'error' ? Json.isRecord(error) && typeof error['message'] === 'string' : error === undefined)
    && isStudioSchemeEnvironment(scheme)
    && typeof viewport['width'] === 'number'
    && Number.isFinite(viewport['width'])
    && viewport['width'] > 0
    && typeof viewport['height'] === 'number'
    && Number.isFinite(viewport['height'])
    && viewport['height'] > 0
    && (viewport['presetId'] === undefined || typeof viewport['presetId'] === 'string')
}

function isStudioSchemeEnvironment(value: unknown): value is StudioCellEnvironment['scheme'] {
  if (!Json.isRecord(value)) {
    return false
  }
  const capability = value['capability']
  const requested = value['requested']
  const resolved = value['resolved']
  const source = value['source']
  return (requested === 'dark' || requested === 'light' || requested === 'system')
    && (resolved === 'dark' || resolved === 'light')
    && (source === 'native-fixed' || source === 'preference' || source === 'scenario' || source === 'system')
    && (capability === 'fixed-light-native' || capability === 'pinned-native'
      || capability === 'reactive-browser' || capability === 'reactive-catalyst' || capability === 'reactive-native')
    && !(source === 'system' && requested !== 'system')
    && !(source === 'preference' && requested === 'system')
    && !(source === 'scenario' && requested === 'system')
    && !(source === 'native-fixed' && capability !== 'fixed-light-native')
    && !(capability === 'fixed-light-native' && (resolved !== 'light' || source !== 'native-fixed'))
    && !(capability === 'pinned-native' && (source !== 'scenario' || resolved !== requested))
}

function runtimeDataEntryTables(value: StudioJsonValue): readonly StudioRuntimeDataTable[] {
  if (!Json.isRecord(value) || typeof value['key'] !== 'string' || typeof value['snapshot'] !== 'string') {
    return []
  }
  const key = value['key']
  try {
    const snapshot = JSON.parse(value['snapshot']) as unknown
    if (!Json.isRecord(snapshot) || !Json.isRecord(snapshot['rows'])) {
      return []
    }
    return Object.entries(snapshot['rows']).flatMap(([entity, rows]) =>
      Array.isArray(rows) && rows.every(isStudioJsonObject)
        ? [{ datasource: runtimeDatasourceLabel(key), entity, rows }]
        : []
    )
  } catch {
    return []
  }
}

function isStudioJsonObject(value: unknown): value is StudioJsonObject {
  return Json.isRecord(value) && Object.values(value).every(isStudioJsonValue)
}

function isStudioJsonValue(value: unknown): value is StudioJsonValue {
  return value === null
    || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)
    || typeof value === 'string'
    || Array.isArray(value) && value.every(isStudioJsonValue)
    || isStudioJsonObject(value)
}

function runtimeDatasourceLabel(key: string): string {
  try {
    const parsed = JSON.parse(key) as unknown
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      try {
        const identity = JSON.parse(parsed[0]) as unknown
        if (Array.isArray(identity) && identity.length > 0) {
          const parts = identity.map(readableIdentityPart)
          return parts.filter((part, index) => index === 0 || part !== parts[index - 1]).join(' · ')
        }
      } catch {
        // Unconfigured and test datasource identities are already readable text.
      }
      return parsed[0]
    }
  } catch {
    // A provider-owned opaque key remains safe display text.
  }
  return key
}

/**
 * readableIdentityPart names a canonical declaration identity by its declared name. The identity
 * tuple (`["tao.declaration", 1, "hnreader", "@workspace", "HNReader", "datasource", "StubSource"]`)
 * is an address for machines; the person reading the Data panel wants `StubSource`.
 */
function readableIdentityPart(part: unknown): string {
  const canonical = (() => {
    if (Array.isArray(part)) {
      return part
    }
    if (typeof part !== 'string') {
      return undefined
    }
    try {
      const parsed = JSON.parse(part) as unknown
      return Array.isArray(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  })()
  if (canonical !== undefined && canonical.length > 0 && canonical[0] === 'tao.declaration') {
    return String(canonical[canonical.length - 1])
  }
  return typeof part === 'string' ? part : String(part)
}
