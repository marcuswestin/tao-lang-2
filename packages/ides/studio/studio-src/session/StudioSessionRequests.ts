import { Assert, Errors, Json } from '@shared'
import type {
  StudioAppendScenarioStepsPatchRequest,
  StudioComponentKind,
  StudioInsertCapturedFixturePatchRequest,
  StudioLayoutEntry,
  StudioScenarioArgumentValue,
  StudioSourcePatchRequest,
  StudioStyleEntry,
  StudioStyleLandingScope,
} from '@source-actions'
import type { StudioCellReconfigureRequest } from '../StudioMatrixSession'
import type {
  StudioCellEnvironment,
  StudioCellIdentity,
  StudioCellInstanceIdentity,
} from '../StudioPreviewManifest'
import {
  type StudioJsonObject,
  type StudioPreviewLayoutMeasurementsMessage,
  type StudioProjectIdentity,
  StudioProtocol,
  type StudioSketchFlowAction,
  type StudioSketchFlowActionRequest,
  type StudioSketchSnapRequest,
  type StudioSketchSnapUndoRequest,
  type StudioSketchUnsnapRequest,
  type StudioSourceActionEnvelope,
  type StudioSourceActionUndoEnvelope,
} from '../StudioProtocol'

/**
 * StudioSessionRequests decodes untrusted session input — sketch, cell, and source-action requests
 * that arrive over the wire — into the typed requests the session and source-actions operate on.
 */
export const StudioSessionRequests = {
  cellInstanceIdentity,
  cellReconfigureRequest,
  completeCellInstanceIdentity,
  parseSketchFlowActionRequest,
  parseSketchSnapRequest,
  parseSketchSnapUndoRequest,
  parseSketchUnsnapRequest,
  requireSessionIdentity,
  requireSourceActionPreconditions,
  sourcePatchRequest,
}

function parseSketchSnapRequest(value: unknown): StudioSketchSnapRequest {
  Assert.input(Json.isRecord(value), 'Studio Snap request must be an object.')
  requireOnlyInputKeys(
    value,
    [
      'checkpointId',
      'confirmedProposalVersion',
      'expectedCatalogRevision',
      'rectIds',
      'requestId',
      'sketchId',
      'sourceVersion',
    ],
    'Studio Snap request',
  )
  const checkpointId = requireInputText(value['checkpointId'], 'Studio Snap checkpointId')
  const requestId = requireInputText(value['requestId'], 'Studio Snap requestId')
  const sketchId = requireInputText(value['sketchId'], 'Studio Snap sketchId')
  const sourceVersion = requireInputText(value['sourceVersion'], 'Studio Snap sourceVersion')
  Assert.input(
    Number.isSafeInteger(value['expectedCatalogRevision']) && Number(value['expectedCatalogRevision']) >= 0,
    'Studio Snap expectedCatalogRevision must be a nonnegative integer.',
  )
  Assert.input(Array.isArray(value['rectIds']) && value['rectIds'].length > 0, 'Studio Snap rectIds must not be empty.')
  const rectIds = value['rectIds'].map((id, index) => requireInputText(id, `Studio Snap rectIds[${index}]`))
  Assert.input(new Set(rectIds).size === rectIds.length, 'Studio Snap rectIds must be unique.')
  const confirmedProposalVersion = value['confirmedProposalVersion'] === undefined
    ? undefined
    : requireInputText(value['confirmedProposalVersion'], 'Studio Snap confirmedProposalVersion')
  return {
    checkpointId,
    ...(confirmedProposalVersion === undefined ? {} : { confirmedProposalVersion }),
    expectedCatalogRevision: Number(value['expectedCatalogRevision']),
    rectIds,
    requestId,
    sketchId,
    sourceVersion,
  }
}

function parseSketchSnapUndoRequest(value: unknown): StudioSketchSnapUndoRequest {
  Assert.input(Json.isRecord(value), 'Studio Snap undo request must be an object.')
  requireOnlyInputKeys(
    value,
    ['checkpointId', 'expectedCatalogRevision', 'requestId', 'sourceVersion'],
    'Studio Snap undo request',
  )
  Assert.input(
    Number.isSafeInteger(value['expectedCatalogRevision']) && Number(value['expectedCatalogRevision']) >= 0,
    'Studio Snap undo expectedCatalogRevision must be a nonnegative integer.',
  )
  return {
    checkpointId: requireInputText(value['checkpointId'], 'Studio Snap undo checkpointId'),
    expectedCatalogRevision: Number(value['expectedCatalogRevision']),
    requestId: requireInputText(value['requestId'], 'Studio Snap undo requestId'),
    sourceVersion: requireInputText(value['sourceVersion'], 'Studio Snap undo sourceVersion'),
  }
}

function parseSketchFlowActionRequest(value: unknown): StudioSketchFlowActionRequest {
  Assert.input(Json.isRecord(value), 'Studio flow request must be an object.')
  requireOnlyInputKeys(
    value,
    ['action', 'checkpointId', 'expectedCatalogRevision', 'requestId', 'sketchId', 'sourceVersion'],
    'Studio flow request',
  )
  Assert.input(
    Number.isSafeInteger(value['expectedCatalogRevision']) && Number(value['expectedCatalogRevision']) >= 0,
    'Studio flow expectedCatalogRevision must be a nonnegative integer.',
  )
  Assert.input(Json.isRecord(value['action']), 'Studio flow action must be an object.')
  const raw = value['action']
  let action: StudioSketchFlowAction
  if (raw['kind'] === 'toggle-direction') {
    requireOnlyInputKeys(raw, ['kind', 'rectId'], 'Studio toggle-direction action')
    action = { kind: 'toggle-direction', rectId: requireInputText(raw['rectId'], 'Studio flow rectId') }
  } else if (raw['kind'] === 'insert-separator') {
    requireOnlyInputKeys(raw, ['afterRectId', 'beforeRectId', 'kind'], 'Studio insert-separator action')
    action = {
      afterRectId: requireInputText(raw['afterRectId'], 'Studio flow afterRectId'),
      ...(raw['beforeRectId'] === undefined
        ? {}
        : { beforeRectId: requireInputText(raw['beforeRectId'], 'Studio flow beforeRectId') }),
      kind: 'insert-separator',
    }
  } else if (raw['kind'] === 'insert-spacer') {
    requireOnlyInputKeys(raw, ['afterRectId', 'beforeRectId', 'kind', 'ratio'], 'Studio insert-spacer action')
    Assert.input(
      Array.isArray(raw['ratio'])
        && raw['ratio'].length === 2
        && raw['ratio'].every(value => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100),
      'Studio flow Spacer ratio must contain two integers from 1 through 100.',
    )
    action = {
      afterRectId: requireInputText(raw['afterRectId'], 'Studio flow afterRectId'),
      beforeRectId: requireInputText(raw['beforeRectId'], 'Studio flow beforeRectId'),
      kind: 'insert-spacer',
      ratio: [Number(raw['ratio'][0]), Number(raw['ratio'][1])],
    }
  } else {
    Errors.throwUserInput(`Unsupported Studio flow action: ${String(raw['kind'])}`)
  }
  return {
    action,
    checkpointId: requireInputText(value['checkpointId'], 'Studio flow checkpointId'),
    expectedCatalogRevision: Number(value['expectedCatalogRevision']),
    requestId: requireInputText(value['requestId'], 'Studio flow requestId'),
    sketchId: requireInputText(value['sketchId'], 'Studio flow sketchId'),
    sourceVersion: requireInputText(value['sourceVersion'], 'Studio flow sourceVersion'),
  }
}

function parseSketchUnsnapRequest(value: unknown): StudioSketchUnsnapRequest {
  Assert.input(Json.isRecord(value), 'Studio Unsnap request must be an object.')
  requireOnlyInputKeys(
    value,
    ['checkpointId', 'expectedCatalogRevision', 'rectIds', 'requestId', 'sketchId', 'sourceVersion'],
    'Studio Unsnap request',
  )
  const parsed = parseSketchSnapRequest(value)
  return {
    checkpointId: parsed.checkpointId,
    expectedCatalogRevision: parsed.expectedCatalogRevision,
    rectIds: parsed.rectIds,
    requestId: parsed.requestId,
    sketchId: parsed.sketchId,
    sourceVersion: parsed.sourceVersion,
  }
}

function requireOnlyInputKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(value).filter(key => !allowed.includes(key))
  Assert.input(unsupported.length === 0, `${label} has unsupported fields: ${unsupported.join(', ')}`)
}

function requireInputText(value: unknown, label: string): string {
  Assert.input(typeof value === 'string' && value.trim().length > 0, `${label} must be a nonempty string.`)
  return value
}

function requireSessionIdentity(
  envelope: StudioSourceActionEnvelope | StudioSourceActionUndoEnvelope,
  expected: StudioProjectIdentity,
): void {
  Assert.input(
    envelope.identity.project === expected.project && envelope.identity.appName === expected.appName,
    'Studio source action targets a different project or app.',
  )
}

function sourcePatchRequest(envelope: StudioSourceActionEnvelope): StudioSourcePatchRequest {
  const action = envelope.action
  if (
    action.kind === 'append-scenario-steps'
    && typeof action['scenarioGroupName'] === 'string'
    && typeof action['scenarioName'] === 'string'
    && Array.isArray(action['steps'])
    && action['steps'].every(isRecordedScenarioStep)
  ) {
    return {
      kind: action.kind,
      scenarioGroupName: action['scenarioGroupName'],
      scenarioName: action['scenarioName'],
      steps: action['steps'],
    }
  }
  if (
    action.kind === 'insert-captured-fixture'
    && typeof action['fixtureName'] === 'string'
    && isCapturedFixturePlan(action['plan'])
  ) {
    return {
      fixtureName: action['fixtureName'],
      kind: action.kind,
      plan: action['plan'],
    }
  }
  if (action.kind === 'insert-component' && isStudioComponentKind(action['component'])) {
    return {
      ...(typeof action['afterId'] === 'string' ? { afterId: action['afterId'] } : {}),
      ...(typeof action['beforeId'] === 'string' ? { beforeId: action['beforeId'] } : {}),
      component: action['component'],
      kind: action.kind,
    }
  }
  if (action.kind === 'insert-project-view' && typeof action['viewName'] === 'string') {
    Assert.input(
      action['viewSourcePath'] === undefined || typeof action['viewSourcePath'] === 'string',
      'Project view source path must be a string.',
    )
    const rawBindings = action['bindings']
    Assert.input(
      rawBindings === undefined || Json.isRecord(rawBindings),
      'Project view bindings must name lexical values.',
    )
    const bindings = rawBindings === undefined
      ? undefined
      : Object.fromEntries(
        Object.entries(rawBindings).map(([name, value]) => {
          Assert.input(typeof value === 'string', 'Project view bindings must name lexical values.')
          return [name, value]
        }),
      )
    return {
      ...(typeof action['afterId'] === 'string' ? { afterId: action['afterId'] } : {}),
      ...(typeof action['beforeId'] === 'string' ? { beforeId: action['beforeId'] } : {}),
      kind: action.kind,
      viewName: action['viewName'],
      ...(action['viewSourcePath'] === undefined ? {} : { viewSourcePath: action['viewSourcePath'] }),
      ...(bindings === undefined ? {} : { bindings }),
    }
  }
  if (
    action.kind === 'move-render'
    && typeof action['draggedId'] === 'string'
    && (action['afterId'] === undefined || typeof action['afterId'] === 'string')
    && (action['beforeId'] === undefined || typeof action['beforeId'] === 'string')
  ) {
    return {
      ...(typeof action['afterId'] === 'string' ? { afterId: action['afterId'] } : {}),
      ...(typeof action['beforeId'] === 'string' ? { beforeId: action['beforeId'] } : {}),
      draggedId: action['draggedId'],
      kind: action.kind,
    }
  }
  if (
    action.kind === 'set-layout-entry'
    && typeof action['renderId'] === 'string'
    && Array.isArray(action['entry'])
    && action['entry'].every(value => typeof value === 'string' || typeof value === 'number')
  ) {
    return {
      entry: action['entry'] as unknown as StudioLayoutEntry,
      kind: action.kind,
      renderId: action['renderId'],
    }
  }
  if (
    action.kind === 'wrap-render'
    && typeof action['renderId'] === 'string'
    && (action['wrapper'] === 'Col' || action['wrapper'] === 'Row' || action['wrapper'] === 'Stack')
  ) {
    return { kind: action.kind, renderId: action['renderId'], wrapper: action['wrapper'] }
  }
  if (action.kind === 'remove-render' && typeof action['renderId'] === 'string') {
    return { kind: action.kind, renderId: action['renderId'] }
  }
  if (
    action.kind === 'set-text-content'
    && typeof action['renderId'] === 'string'
    && typeof action['content'] === 'string'
  ) {
    return { content: action['content'], kind: action.kind, renderId: action['renderId'] }
  }
  if (
    action.kind === 'bind-text'
    && typeof action['renderId'] === 'string'
    && typeof action['expression'] === 'string'
  ) {
    return { expression: action['expression'], kind: action.kind, renderId: action['renderId'] }
  }
  if (
    action.kind === 'set-style-entry'
    && typeof action['renderId'] === 'string'
    && Array.isArray(action['entry'])
    && action['entry'].length > 0
    && action['entry'].every(value => typeof value === 'string' || typeof value === 'number')
    && isStudioStyleLandingScope(action['landing'])
  ) {
    return {
      entry: action['entry'] as unknown as StudioStyleEntry,
      kind: action.kind,
      landing: action['landing'],
      renderId: action['renderId'],
    }
  }
  if (
    action.kind === 'set-scenario-arguments'
    && (action['appearance'] === undefined || action['appearance'] === 'dark' || action['appearance'] === 'light')
    && typeof action['scenarioGroupName'] === 'string'
    && typeof action['scenarioName'] === 'string'
    && Json.isRecord(action['arguments'])
    && Object.values(action['arguments']).every(isStudioScenarioArgumentValue)
  ) {
    return {
      ...(action['appearance'] === undefined ? {} : { appearance: action['appearance'] }),
      arguments: action['arguments'] as Readonly<Record<string, StudioScenarioArgumentValue>>,
      kind: action.kind,
      scenarioGroupName: action['scenarioGroupName'],
      scenarioName: action['scenarioName'],
    }
  }
  if (
    action.kind === 'set-design-entry'
    && typeof action['designName'] === 'string'
    && typeof action['memberName'] === 'string'
    && Array.isArray(action['entry'])
    && action['entry'].length > 0
    && action['entry'].every(value => typeof value === 'string' || typeof value === 'number')
  ) {
    return {
      designName: action['designName'],
      entry: action['entry'] as unknown as StudioStyleEntry,
      kind: action.kind,
      memberName: action['memberName'],
    }
  }
  Errors.throwUserInput(`Unsupported or invalid Studio source action: ${action.kind}`)
}

function requireSourceActionPreconditions(
  envelope: StudioSourceActionEnvelope,
  request: StudioSourcePatchRequest,
): void {
  const occurrenceRequired = request.kind === 'move-render'
    || request.kind === 'set-layout-entry'
    || request.kind === 'set-style-entry'
    || request.kind === 'wrap-render'
    || request.kind === 'remove-render'
    || request.kind === 'set-text-content'
    || request.kind === 'bind-text'
    || (request.kind === 'insert-component' || request.kind === 'insert-project-view')
      && (request.beforeId !== undefined || request.afterId !== undefined)
  Assert.input(
    !occurrenceRequired || envelope.identity.occurrence !== undefined,
    `Studio source action requires render occurrence identity: ${request.kind}`,
  )
  Assert.input(
    occurrenceRequired || envelope.identity.occurrence === undefined,
    `Studio source action cannot carry render occurrence identity: ${request.kind}`,
  )
}

function isStudioStyleLandingScope(value: unknown): value is StudioStyleLandingScope {
  if (!Json.isRecord(value)) {
    return false
  }
  if (value['kind'] === 'element-inline') {
    return true
  }
  if (value['kind'] === 'style-bundle') {
    return typeof value['bundleName'] === 'string'
      && (value['mode'] === 'edit' || value['mode'] === 'fork')
      && (value['forkName'] === undefined || typeof value['forkName'] === 'string')
  }
  if (value['kind'] === 'element-default') {
    return typeof value['elementName'] === 'string'
  }
  return (value['kind'] === 'token' || value['kind'] === 'size-token') && typeof value['tokenName'] === 'string'
}

function isCapturedFixturePlan(value: unknown): value is StudioInsertCapturedFixturePatchRequest['plan'] {
  return Json.isRecord(value)
    && Array.isArray(value['accounts'])
    && value['accounts'].every(account =>
      Json.isRecord(account)
      && typeof account['name'] === 'string'
      && isFixtureFields(account['fields'])
    )
    && Array.isArray(value['creates'])
    && value['creates'].every(create =>
      Json.isRecord(create)
      && typeof create['entity'] === 'string'
      && typeof create['name'] === 'string'
      && isFixtureFields(create['fields'])
    )
}

function isRecordedScenarioStep(value: unknown): value is StudioAppendScenarioStepsPatchRequest['steps'][number] {
  if (!Json.isRecord(value) || typeof value['target'] !== 'string') {
    return false
  }
  const selector = value['selector']
  if (selector !== 'label' && selector !== 'placeholder' && selector !== 'tag' && selector !== 'text') {
    return false
  }
  return value['kind'] === 'press'
    || value['kind'] === 'submit'
    || value['kind'] === 'enter' && typeof value['value'] === 'string'
}

function isFixtureFields(value: unknown): value is Readonly<Record<string, StudioScenarioArgumentValue>> {
  return Json.isRecord(value) && Object.values(value).every(isStudioScenarioArgumentValue)
}

function isStudioScenarioArgumentValue(value: unknown): value is
  | boolean
  | number
  | string
  | { kind: 'now' }
  | { handle: string; kind: 'fixture-reference' }
{
  return typeof value === 'boolean'
    || typeof value === 'string'
    || typeof value === 'number' && Number.isFinite(value)
    || Json.isRecord(value) && value['kind'] === 'now'
    || Json.isRecord(value)
      && value['kind'] === 'fixture-reference'
      && typeof value['handle'] === 'string'
}

function cellIdentity(value: unknown): StudioCellIdentity {
  if (
    !Json.isRecord(value)
    || typeof value['appName'] !== 'string'
    || typeof value['cellId'] !== 'string'
    || !nonNegativeInteger(value['cellRevision'])
    || !nonNegativeInteger(value['compileRevision'])
    || typeof value['manifestRevision'] !== 'string'
    || typeof value['project'] !== 'string'
  ) {
    Errors.throwUserInput('Expected a complete Studio cell identity.')
  }
  return {
    appName: value['appName'],
    cellId: value['cellId'],
    cellRevision: value['cellRevision'],
    compileRevision: value['compileRevision'],
    manifestRevision: value['manifestRevision'],
    project: value['project'],
  }
}

function completeCellInstanceIdentity(message: StudioPreviewLayoutMeasurementsMessage): StudioCellInstanceIdentity {
  const identity = message.identity
  if (
    identity.cellId === undefined
    || identity.cellRevision === undefined
    || identity.compileRevision === undefined
    || identity.manifestRevision === undefined
  ) {
    Errors.throwUserInput('Expected a complete Studio cell preview identity for layout measurements.')
  }
  return {
    appName: identity.appName,
    cellId: identity.cellId,
    cellRevision: identity.cellRevision,
    compileRevision: identity.compileRevision,
    manifestRevision: identity.manifestRevision,
    previewInstanceId: identity.previewInstanceId,
    project: identity.project,
  }
}

function cellInstanceIdentity(value: unknown): StudioCellInstanceIdentity {
  const identity = cellIdentity(value)
  if (!Json.isRecord(value) || typeof value['previewInstanceId'] !== 'string') {
    Errors.throwUserInput('Expected a Studio cell preview instance id.')
  }
  return { ...identity, previewInstanceId: value['previewInstanceId'] }
}

function cellReconfigureRequest(value: unknown): StudioCellReconfigureRequest {
  const identity = cellIdentity(value)
  if (!Json.isRecord(value)) {
    Errors.throwUserInput('Expected a Studio cell reconfiguration.')
  }
  const args = value['args']
  const environment = value['environment']
  const rawReplay = value['replay']
  const replay = rawReplay === undefined ? undefined : StudioProtocol.parseRuntimeCapture(rawReplay)
  const stateLayers = value['stateLayers']
  Assert.input(
    args === undefined || Json.isRecord(args) && isJsonValue(args),
    'Studio cell arguments must be JSON data.',
  )
  Assert.input(environment === undefined || Json.isRecord(environment), 'Studio cell environment must be an object.')
  Assert.input(
    rawReplay === undefined || replay !== undefined,
    'Studio cell replay must be a valid runtime capture artifact.',
  )
  Assert.input(
    stateLayers === undefined || Array.isArray(stateLayers) && stateLayers.every(isString),
    'Studio cell state layers must be names.',
  )
  return {
    ...identity,
    ...(args === undefined ? {} : { args: args as StudioJsonObject }),
    ...(environment === undefined ? {} : { environment: environment as StudioCellEnvironment }),
    ...(replay === undefined ? {} : { replay }),
    ...(stateLayers === undefined ? {} : { stateLayers: stateLayers as readonly string[] }),
  }
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  return Json.isRecord(value) && Object.values(value).every(isJsonValue)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStudioComponentKind(value: unknown): value is StudioComponentKind {
  return typeof value === 'string' && studioComponentKinds.has(value as StudioComponentKind)
}

const studioComponentKinds = new Set<StudioComponentKind>([
  'Box',
  'Button',
  'Checkbox',
  'Col',
  'DatePicker',
  'FormButton',
  'Image',
  'Number',
  'Panes',
  'Picker',
  'Progress',
  'Row',
  'ScrollView',
  'SegmentedControl',
  'Slider',
  'Spinner',
  'Stack',
  'Switch',
  'Text',
  'TextFrame',
  'TextInput',
  'TextMultiline',
  'WrappingRow',
])
