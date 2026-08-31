import type {
  StudioCellEnvironment,
  StudioCellIdentity,
  StudioParameterSchema,
  StudioPreviewCell,
  StudioPreviewManifestV2,
} from '../StudioPreviewManifest'
import {
  type StudioJsonObject,
  type StudioJsonValue,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioRuntimeCaptureArtifact,
  type StudioSourceActionEnvelope,
  type StudioSourceActionIdentity,
  studioSourceActionVersion,
} from '../StudioProtocol'
import { projectRelativePath } from './StudioEditor'

export type StudioScenarioControlModel = Readonly<{
  arguments: StudioJsonObject
  cell: Readonly<{
    compileRevision: number
    id: string
    manifestRevision: string
    revision: number
  }>
  capturedLayers: readonly string[]
  entry: Readonly<{
    id: string
    label: string
    subjectId: string
  }>
  failureReplay?: StudioRuntimeCaptureArtifact
  group: Readonly<{
    id: string
    label: string
    sourcePath: string
  }>
  network: StudioCellEnvironment['network']
  parameters: readonly StudioParameterSchema[]
  sourceIdentity?: StudioSourceActionIdentity
  version: 1
  viewport: StudioCellEnvironment['viewport']
}>

export type StudioScenarioDraft = Readonly<{
  arguments: StudioJsonObject
  network: StudioCellEnvironment['network']
  viewport: StudioCellEnvironment['viewport']
}>

export type StudioScenarioFixtureCapture = Readonly<{
  fixtureName: string
  identity: StudioSourceActionIdentity
  request: Readonly<{
    channel: typeof studioProtocolChannel
    identity: StudioCellIdentity & { previewInstanceId: string }
    protocolVersion: typeof studioProtocolVersion
    requestId: string
    type: 'capture-fixture'
  }>
}>

export type StudioScenarioResult<Value> =
  | Readonly<{ ok: false; issues: readonly string[] }>
  | Readonly<{ ok: true; value: Value }>

export const StudioScenarioControls = {
  fixtureCapture,
  fromManifest,
  groupId,
  replay,
  saveArgumentsAction,
  validateArguments,
  validateDraft,
} as const

function groupId(sourcePath: string, group: string): string {
  return `${encodeURIComponent(sourcePath)}:${encodeURIComponent(group)}`
}

function fromManifest(input: {
  cell: StudioPreviewCell
  cellIdentity?: StudioCellIdentity
  failureReplay?: StudioRuntimeCaptureArtifact
  manifest: StudioPreviewManifestV2
  previewInstanceId: string
}): StudioScenarioResult<StudioScenarioControlModel> {
  const scenario = input.manifest.scenarios.find(candidate => candidate.scenarioId === input.cell.scenarioId)
  if (scenario === undefined) {
    return invalid(`Studio scenario does not exist: ${input.cell.scenarioId}`)
  }
  const sourceVersion = input.manifest.sourceVersions[scenario.source.path]
  const sourcePath = projectRelativePath(input.manifest.project.root, scenario.source.path)
  const sourceIdentity = input.cellIdentity === undefined || sourceVersion === undefined || sourcePath === undefined
    ? undefined
    : {
      ...input.cellIdentity,
      path: sourcePath,
      previewInstanceId: input.previewInstanceId,
      scenarioId: scenario.scenarioId,
      sourceVersion,
    }
  return valid({
    arguments: input.cell.args,
    cell: {
      compileRevision: input.cellIdentity?.compileRevision ?? input.manifest.compileRevision,
      id: input.cellIdentity?.cellId ?? input.cell.cellId,
      manifestRevision: input.cellIdentity?.manifestRevision ?? input.manifest.manifestRevision,
      revision: input.cellIdentity?.cellRevision ?? input.cell.cellRevision,
    },
    capturedLayers: input.cell.stateLayers,
    entry: { id: scenario.scenarioId, label: scenario.label, subjectId: scenario.subjectId },
    ...(input.failureReplay === undefined ? {} : { failureReplay: input.failureReplay }),
    group: {
      id: groupId(scenario.source.path, scenario.group),
      label: scenario.group,
      sourcePath: scenario.source.path,
    },
    network: input.cell.environment.network,
    parameters: input.manifest.parametersBySubject[scenario.subjectId] ?? [],
    ...(sourceIdentity === undefined ? {} : { sourceIdentity }),
    version: 1,
    viewport: input.cell.environment.viewport,
  })
}

function validateDraft(model: StudioScenarioControlModel, input: {
  arguments: unknown
  network: unknown
  viewport: unknown
}): StudioScenarioResult<StudioScenarioDraft> {
  const args = validateArguments(model, input.arguments)
  const issues = args.ok ? [] : [...args.issues]
  if (!isViewport(input.viewport)) {
    issues.push('Viewport width and height must be positive finite numbers.')
  }
  if (!isNetwork(input.network)) {
    issues.push('Network settings must use a non-negative integer latency and a valid outcome.')
  }
  return issues.length > 0
    ? { issues, ok: false }
    : valid({
      arguments: (args as { ok: true; value: StudioJsonObject }).value,
      network: input.network as StudioCellEnvironment['network'],
      viewport: input.viewport as StudioCellEnvironment['viewport'],
    })
}

function validateArguments(
  model: Pick<StudioScenarioControlModel, 'parameters'>,
  input: unknown,
): StudioScenarioResult<StudioJsonObject> {
  if (!isJsonObject(input)) {
    return invalid('Scenario arguments must be a JSON object.')
  }
  const parameters = new Map(model.parameters.map(parameter => [parameter.parameterId, parameter]))
  const issues: string[] = []
  for (const key of Object.keys(input)) {
    if (!parameters.has(key)) {
      issues.push(`Argument is not declared: ${key}.`)
    }
  }
  for (const parameter of model.parameters) {
    const value = input[parameter.parameterId]
    if (value === undefined) {
      if (parameter.required && parameter.defaultValue === undefined) {
        issues.push(`${parameter.label} is required.`)
      }
    } else if (!matchesParameter(value, parameter)) {
      issues.push(`${parameter.label} does not match ${parameter.type.kind}.`)
    }
  }
  return issues.length === 0 ? valid(input) : { issues, ok: false }
}

function saveArgumentsAction(
  model: StudioScenarioControlModel,
  args: unknown,
  requestId: string,
  appearance?: 'dark' | 'light',
): StudioScenarioResult<StudioSourceActionEnvelope> {
  const checked = validateArguments(model, args)
  if (!checked.ok) {
    return checked
  }
  if (model.sourceIdentity === undefined) {
    return invalid('Scenario source identity is unavailable.')
  }
  if (requestId.trim() === '') {
    return invalid('Scenario save request id is required.')
  }
  return valid({
    action: {
      ...(appearance === undefined ? {} : { appearance }),
      arguments: checked.value,
      kind: 'set-scenario-arguments',
      scenarioGroupName: model.group.label,
      scenarioName: model.entry.label,
    },
    channel: studioProtocolChannel,
    checkpoint: { id: `scenario-arguments:${requestId}`, phase: 'single' },
    identity: model.sourceIdentity,
    protocolVersion: studioProtocolVersion,
    requestId,
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action',
  })
}

function fixtureCapture(
  model: StudioScenarioControlModel,
  fixtureName: string,
  requestId: string,
): StudioScenarioResult<StudioScenarioFixtureCapture> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fixtureName)) {
    return invalid('Fixture name must be a Tao identifier.')
  }
  if (model.sourceIdentity === undefined) {
    return invalid('Fixture capture source identity is unavailable.')
  }
  const identity = model.sourceIdentity
  return valid({
    fixtureName,
    identity,
    request: {
      channel: studioProtocolChannel,
      identity: {
        appName: identity.appName,
        cellId: model.cell.id,
        cellRevision: model.cell.revision,
        compileRevision: model.cell.compileRevision,
        manifestRevision: model.cell.manifestRevision,
        previewInstanceId: identity.previewInstanceId,
        project: identity.project,
      },
      protocolVersion: studioProtocolVersion,
      requestId,
      type: 'capture-fixture',
    },
  })
}

function replay(
  model: StudioScenarioControlModel,
  input: unknown = model.failureReplay,
): StudioScenarioResult<StudioRuntimeCaptureArtifact> {
  const capture = StudioProtocol.parseRuntimeCapture(input)
  return capture === undefined ? invalid('This is not a supported Tao runtime capture.') : valid(capture)
}

function matchesParameter(value: StudioJsonValue, parameter: StudioParameterSchema): boolean {
  switch (parameter.type.kind) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'choice':
      return parameter.type.values.some(candidate => Object.is(candidate, value))
    case 'json':
      return true
    case 'number':
      return typeof value === 'number'
        && Number.isFinite(value)
        && (parameter.type.minimum === undefined || value >= parameter.type.minimum)
        && (parameter.type.maximum === undefined || value <= parameter.type.maximum)
    case 'text':
    case 'time':
      return typeof value === 'string'
  }
}

function isViewport(value: unknown): value is StudioCellEnvironment['viewport'] {
  return isRecord(value)
    && typeof value['width'] === 'number'
    && Number.isFinite(value['width'])
    && value['width'] > 0
    && typeof value['height'] === 'number'
    && Number.isFinite(value['height'])
    && value['height'] > 0
    && (value['presetId'] === undefined || typeof value['presetId'] === 'string')
}

function isNetwork(value: unknown): value is StudioCellEnvironment['network'] {
  if (!isRecord(value) || !Number.isSafeInteger(value['latencyMs']) || Number(value['latencyMs']) < 0) {
    return false
  }
  const outcome = value['outcome']
  const error = value['error']
  return (outcome === 'normal' || outcome === 'offline')
    ? error === undefined
    : outcome === 'error'
      && isRecord(error)
      && typeof error['message'] === 'string'
      && (error['code'] === undefined || typeof error['code'] === 'string')
      && (error['status'] === undefined || Number.isSafeInteger(error['status']))
}

function isJsonObject(value: unknown): value is StudioJsonObject {
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isJsonValue(value: unknown): value is StudioJsonValue {
  return value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
    || typeof value === 'number' && Number.isFinite(value)
    || Array.isArray(value) && value.every(isJsonValue)
    || isJsonObject(value)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function valid<Value>(value: Value): StudioScenarioResult<Value> {
  return { ok: true, value }
}

function invalid(...issues: string[]): StudioScenarioResult<never> {
  return { issues, ok: false }
}
