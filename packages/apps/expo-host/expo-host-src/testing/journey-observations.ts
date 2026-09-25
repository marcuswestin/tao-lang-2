import { Errors, FS, Platform } from '@shared'
import type * as TestCompiler from './test-compiler/TestCompiler'

/** JOURNEY_OBSERVATIONS_ENV points Jest workers at one tao-test run's private observation directory. */
const JOURNEY_OBSERVATIONS_ENV = 'TAO_TEST_JOURNEY_OBSERVATIONS_DIR'
const DIRECTORY_NAME = 'journey-observations'
const FORMAT = 'tao-journey-observations'
const VERSION = 1

/** JourneyRenderObservation proves one version-bound authored render occurred in a live check tree. */
export type JourneyRenderObservation = {
  end: number
  renderId: string
  sourcePath: string
  sourceVersion: string
  start: number
}

/** JourneyCheckObservation is one check's live render observations, written independently by its Jest worker. */
export type JourneyCheckObservation = {
  appSourcePath: string
  checkName: string
  checkSource: TestCompiler.Source
  renders: readonly JourneyRenderObservation[]
  status: 'failed' | 'passed'
  suiteName: string
}

/** JourneyObservationsArtifact is the versioned CLI handoff Studio reads after a Tao test run. */
export type JourneyObservationsArtifact = {
  checks: readonly JourneyCheckObservation[]
  format: typeof FORMAT
  version: typeof VERSION
}

/** JourneyObservations owns worker-safe per-check records and their CLI aggregate. */
export const JourneyObservations = {
  artifact,
  DIRECTORY_NAME,
  ENV: JOURNEY_OBSERVATIONS_ENV,
  parseArtifact,
  read,
  record,
} as const

/** record writes one unique worker record when tao test requested observations. */
async function record(observation: JourneyCheckObservation): Promise<void> {
  const directory = Platform.runtimeProcess.env[JOURNEY_OBSERVATIONS_ENV]
  if (directory === undefined) {
    return
  }
  await FS.writeJson(
    FS.resolvePath(`check-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.json`, directory),
    observation,
  )
}

/** read combines the independent worker records left under one run root into the stable artifact shape. */
async function read(directory: string): Promise<JourneyObservationsArtifact> {
  if (!await FS.isDirectory(directory)) {
    return artifact([])
  }
  const checks = await Promise.all(
    (await FS.listDir(directory))
      .filter(name => name.endsWith('.json'))
      .toSorted()
      .map(async name => parseCheck(await FS.readJson<unknown>(FS.resolvePath(name, directory)), name)),
  )
  return artifact(checks)
}

/** parseArtifact validates an aggregate received across the CLI process boundary. */
function parseArtifact(value: unknown): JourneyObservationsArtifact {
  if (
    !isRecord(value) || value['format'] !== FORMAT || value['version'] !== VERSION || !Array.isArray(value['checks'])
  ) {
    Errors.throwHostEnvironment('Invalid Tao journey observations artifact.')
  }
  return artifact(value['checks'].map((check, index) => parseCheck(check, `checks[${index}]`)))
}

function artifact(checks: readonly JourneyCheckObservation[]): JourneyObservationsArtifact {
  return { checks, format: FORMAT, version: VERSION }
}

function parseCheck(value: unknown, name: string): JourneyCheckObservation {
  if (!isCheck(value)) {
    Errors.throwHostEnvironment(`Invalid Tao journey observation record: ${name}`)
  }
  return value
}

function isCheck(value: unknown): value is JourneyCheckObservation {
  if (
    !isRecord(value) || typeof value['appSourcePath'] !== 'string' || typeof value['checkName'] !== 'string'
    || typeof value['suiteName'] !== 'string' || (value['status'] !== 'passed' && value['status'] !== 'failed')
    || !isRecord(value['checkSource']) || !Array.isArray(value['renders'])
  ) {
    return false
  }
  return value['renders'].every(isRender)
}

function isRender(value: unknown): value is JourneyRenderObservation {
  return isRecord(value)
    && typeof value['renderId'] === 'string'
    && typeof value['sourcePath'] === 'string'
    && typeof value['sourceVersion'] === 'string'
    && Number.isInteger(value['start'])
    && Number.isInteger(value['end'])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
