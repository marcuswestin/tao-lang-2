import type { GenerationDeclaration } from '@generation'
import { Errors } from '@shared'
import type { StudioJsonObject, StudioJsonValue, StudioSourceRange } from './StudioProtocol'
import { type StudioStateEntry, StudioStateLibrary } from './StudioStateLibrary'

export const studioPreviewManifestVersion = 2 as const

export type StudioTaoSource = {
  kind: 'tao'
  path: string
  range: StudioSourceRange
}

export type StudioScenarioSubject =
  | { appName: string; kind: 'app'; source: StudioTaoSource; subjectId: string }
  | { kind: 'view'; source: StudioTaoSource; subjectId: string; viewName: string }

export type StudioParameterSchema = {
  defaultValue?: StudioJsonValue
  label: string
  parameterId: string
  required: boolean
  type:
    | { kind: 'boolean' }
    | { kind: 'choice'; values: readonly (boolean | number | string)[] }
    | { kind: 'json' }
    | { kind: 'number'; maximum?: number; minimum?: number; step?: number }
    | { kind: 'text' }
    | { kind: 'time' }
}

export type StudioScenario = {
  args: StudioJsonObject
  fixtureId?: string
  group: string
  label: string
  prepare: readonly StudioJsonObject[]
  scenarioId: string
  source: StudioTaoSource
  stateLayers: readonly string[]
  steps?: readonly (
    | { kind: 'advance'; milliseconds: number }
    | { kind: 'focus'; tag: string }
    | {
      kind: 'hover' | 'pressDown' | 'pressUp'
      selector: 'label' | 'placeholder' | 'tag' | 'text'
      target: string
    }
  )[]
  subjectId: string
}

export type StudioFixture = {
  fixtureId: string
  label: string
  plan: StudioJsonObject
  source: StudioTaoSource
}

export type StudioViewport = {
  height: number
  presetId?: string
  width: number
}

export type StudioNetworkSimulation = {
  error?: { code?: string; message: string; status?: number }
  latencyMs: number
  outcome: 'error' | 'normal' | 'offline'
}

export type StudioSchemeEnvironment = {
  capability: 'fixed-light-native' | 'reactive-browser'
  requested: 'dark' | 'light' | 'system'
  resolved: 'dark' | 'light'
  source: 'native-fixed' | 'preference' | 'scenario' | 'system'
}

export type StudioCellEnvironment = {
  network: StudioNetworkSimulation
  scheme: StudioSchemeEnvironment
  viewport: StudioViewport
}

export type StudioPreviewCell = {
  args: StudioJsonObject
  cellId: string
  cellRevision: number
  environment: StudioCellEnvironment
  scenarioId: string
  stateLayers: readonly string[]
}

export type StudioPreviewManifestV2 = {
  capabilities: {
    captureDomains: readonly string[]
    scheme: 'reactive-browser'
  }
  cells: readonly StudioPreviewCell[]
  compileRevision: number
  fixtures: readonly StudioFixture[]
  generationDeclarations: readonly GenerationDeclaration[]
  manifestRevision: string
  parametersBySubject: Readonly<Record<string, readonly StudioParameterSchema[]>>
  project: { appName: string; entryPath: string; root: string }
  /** renders is compiler-published when available; older v2 manifests remain readable. */
  renders?: readonly StudioRenderInventoryEntry[]
  scenarios: readonly StudioScenario[]
  sourceVersions: Readonly<Record<string, string>>
  states: readonly StudioStateEntry[]
  subjects: readonly StudioScenarioSubject[]
  version: typeof studioPreviewManifestVersion
}

export type StudioRenderInventoryEntry = {
  elementName: string
  renderId: string
  source: StudioTaoSource
  studioRectId?: string
}

export type StudioCellIdentity = {
  appName: string
  cellId: string
  cellRevision: number
  compileRevision: number
  manifestRevision: string
  project: string
}

export type StudioCellInstanceIdentity = StudioCellIdentity & {
  previewInstanceId: string
}

/** StudioPreviewManifest validates the storage-neutral scenario and cell contract. */
export const StudioPreviewManifest = {
  cellIdentity,
  define,
  validateArgs,
  validateEnvironment,
} as const

function define(input: StudioPreviewManifestV2): StudioPreviewManifestV2 {
  if (input.version !== studioPreviewManifestVersion) {
    throw new Errors.UserInputError(`Unsupported Studio preview manifest version: ${input.version}`)
  }
  requireText(input.manifestRevision, 'Studio manifest revision')
  requireRevision(input.compileRevision, 'Studio compile revision')
  requireText(input.project.appName, 'Studio project app name')
  requireText(input.project.entryPath, 'Studio project entry path')
  requireText(input.project.root, 'Studio project root')
  if (input.capabilities.scheme !== 'reactive-browser') {
    throw new Errors.UserInputError('Studio browser previews require the reactive Scheme capability.')
  }
  const subjects = uniqueBy(input.subjects, subject => subject.subjectId, 'Studio subject')
  for (const subject of subjects.values()) {
    validateSource(subject.source, 'Studio subject source')
    requireText(subject.kind === 'app' ? subject.appName : subject.viewName, `Studio ${subject.kind} name`)
  }
  const renders = uniqueBy(input.renders ?? [], render => render.renderId, 'Studio render')
  for (const render of renders.values()) {
    requireText(render.elementName, 'Studio render element name')
    validateSource(render.source, 'Studio render source')
    if (render.studioRectId !== undefined) {
      requireText(render.studioRectId, 'Studio render rectangle identity')
    }
  }
  for (const [subjectId, parameters] of Object.entries(input.parametersBySubject)) {
    if (!subjects.has(subjectId)) {
      throw new Errors.UserInputError(`Studio parameters target an unknown subject: ${subjectId}`)
    }
    uniqueBy(parameters, parameter => parameter.parameterId, `Studio parameter for ${subjectId}`)
    for (const parameter of parameters) {
      validateParameter(parameter)
    }
  }
  const library = new StudioStateLibrary(input.states, input.capabilities.captureDomains)
  for (const state of input.states) {
    library.resolve([state.stateId])
  }
  const fixtures = uniqueBy(input.fixtures, fixture => fixture.fixtureId, 'Studio fixture')
  for (const fixture of fixtures.values()) {
    validateSource(fixture.source, 'Studio fixture source')
    requireText(fixture.label, 'Studio fixture label')
  }
  const scenarios = uniqueBy(input.scenarios, scenario => scenario.scenarioId, 'Studio scenario')
  for (const scenario of scenarios.values()) {
    validateSource(scenario.source, 'Studio scenario source')
    requireText(scenario.group, 'Studio scenario group')
    requireText(scenario.label, 'Studio scenario label')
    if (scenario.fixtureId !== undefined && !fixtures.has(scenario.fixtureId)) {
      throw new Errors.UserInputError(`Studio scenario targets an unknown fixture: ${scenario.fixtureId}`)
    }
    const subject = subjects.get(scenario.subjectId)
    if (subject === undefined) {
      throw new Errors.UserInputError(`Studio scenario targets an unknown subject: ${scenario.subjectId}`)
    }
    validateArgsForSubject(input, subject.subjectId, scenario.args)
    library.resolve(scenario.stateLayers)
    for (const step of scenario.steps ?? []) {
      validateJourneyStep(step)
    }
  }
  uniqueBy(input.cells, cell => cell.cellId, 'Studio cell')
  for (const cell of input.cells) {
    requireRevision(cell.cellRevision, 'Studio cell revision')
    const scenario = scenarios.get(cell.scenarioId)
    if (scenario === undefined) {
      throw new Errors.UserInputError(`Studio cell targets an unknown scenario: ${cell.scenarioId}`)
    }
    validateArgsForSubject(input, scenario.subjectId, cell.args)
    validateEnvironment(cell.environment)
    library.resolve(cell.stateLayers)
  }
  for (const [path, version] of Object.entries(input.sourceVersions)) {
    requireText(path, 'Studio source version path')
    requireText(version, `Studio source version for ${path}`)
  }
  return input
}

function validateJourneyStep(step: NonNullable<StudioScenario['steps']>[number]): void {
  if (step.kind === 'advance') {
    if (!Number.isSafeInteger(step.milliseconds) || step.milliseconds < 0) {
      throw new Errors.UserInputError('Studio journey advance must be a non-negative whole number of milliseconds.')
    }
    return
  }
  if (step.kind === 'focus') {
    requireText(step.tag, 'Studio journey focus tag')
    return
  }
  requireText(step.target, `Studio journey ${step.kind} target`)
}

function cellIdentity(manifest: StudioPreviewManifestV2, cell: StudioPreviewCell): StudioCellIdentity {
  return {
    appName: manifest.project.appName,
    cellId: cell.cellId,
    cellRevision: cell.cellRevision,
    compileRevision: manifest.compileRevision,
    manifestRevision: manifest.manifestRevision,
    project: manifest.project.root,
  }
}

function validateArgs(manifest: StudioPreviewManifestV2, scenarioId: string, args: StudioJsonObject): void {
  const scenario = manifest.scenarios.find(candidate => candidate.scenarioId === scenarioId)
  if (scenario === undefined) {
    throw new Errors.UserInputError(`Studio scenario does not exist: ${scenarioId}`)
  }
  validateArgsForSubject(manifest, scenario.subjectId, args)
}

function validateArgsForSubject(manifest: StudioPreviewManifestV2, subjectId: string, args: StudioJsonObject): void {
  const parameters = manifest.parametersBySubject[subjectId] ?? []
  const parameterById = new Map(parameters.map(parameter => [parameter.parameterId, parameter]))
  for (const key of Object.keys(args)) {
    if (!parameterById.has(key)) {
      throw new Errors.UserInputError(`Studio argument is not declared by ${subjectId}: ${key}`)
    }
  }
  for (const parameter of parameters) {
    const value = args[parameter.parameterId]
    if (value === undefined) {
      if (parameter.required && parameter.defaultValue === undefined) {
        throw new Errors.UserInputError(`Studio argument is required: ${parameter.parameterId}`)
      }
      continue
    }
    if (!valueMatchesParameter(value, parameter)) {
      throw new Errors.UserInputError(`Studio argument ${parameter.parameterId} does not match ${parameter.type.kind}.`)
    }
  }
}

function validateParameter(parameter: StudioParameterSchema): void {
  requireText(parameter.parameterId, 'Studio parameter id')
  requireText(parameter.label, 'Studio parameter label')
  if (parameter.defaultValue !== undefined && !valueMatchesParameter(parameter.defaultValue, parameter)) {
    throw new Errors.UserInputError(`Studio parameter default does not match ${parameter.parameterId}.`)
  }
  if (parameter.type.kind === 'choice' && parameter.type.values.length === 0) {
    throw new Errors.UserInputError(`Studio choice parameter has no values: ${parameter.parameterId}`)
  }
  if (parameter.type.kind === 'number') {
    for (const value of [parameter.type.minimum, parameter.type.maximum, parameter.type.step]) {
      if (value !== undefined && !Number.isFinite(value)) {
        throw new Errors.UserInputError(`Studio numeric parameter is not finite: ${parameter.parameterId}`)
      }
    }
    if (parameter.type.step !== undefined && parameter.type.step <= 0) {
      throw new Errors.UserInputError(`Studio numeric parameter step must be positive: ${parameter.parameterId}`)
    }
  }
}

function valueMatchesParameter(value: StudioJsonValue, parameter: StudioParameterSchema): boolean {
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
      return typeof value === 'string'
    case 'time':
      return typeof value === 'string'
  }
}

function validateEnvironment(environment: StudioCellEnvironment): void {
  if (!positiveFinite(environment.viewport.width) || !positiveFinite(environment.viewport.height)) {
    throw new Errors.UserInputError('Studio viewport dimensions must be positive finite numbers.')
  }
  if (!Number.isSafeInteger(environment.network.latencyMs) || environment.network.latencyMs < 0) {
    throw new Errors.UserInputError('Studio network latency must be a non-negative integer.')
  }
  if (environment.network.outcome === 'error' && environment.network.error === undefined) {
    throw new Errors.UserInputError('Studio error simulation requires an explicit error.')
  }
  if (environment.network.outcome !== 'error' && environment.network.error !== undefined) {
    throw new Errors.UserInputError('Studio network errors are only valid for error simulation.')
  }
  validateScheme(environment.scheme)
}

function validateScheme(scheme: StudioSchemeEnvironment): void {
  if (
    !['dark', 'light', 'system'].includes(scheme.requested)
    || !['dark', 'light'].includes(scheme.resolved)
    || !['fixed-light-native', 'reactive-browser'].includes(scheme.capability)
    || !['native-fixed', 'preference', 'scenario', 'system'].includes(scheme.source)
    || (scheme.source === 'system' && scheme.requested !== 'system')
    || (scheme.source === 'preference' && scheme.requested === 'system')
    || (scheme.source === 'scenario' && scheme.requested === 'system')
    || (scheme.source === 'native-fixed' && scheme.capability !== 'fixed-light-native')
    || (scheme.capability === 'fixed-light-native' && (scheme.resolved !== 'light' || scheme.source !== 'native-fixed'))
  ) {
    throw new Errors.UserInputError('Studio Scheme must record a valid request, resolution, source, and capability.')
  }
}

function validateSource(source: StudioTaoSource, label: string): void {
  if (source.kind !== 'tao') {
    throw new Errors.UserInputError(`${label} must be Tao source.`)
  }
  requireText(source.path, `${label} path`)
  if (
    !Number.isSafeInteger(source.range.start)
    || !Number.isSafeInteger(source.range.end)
    || source.range.start < 0
    || source.range.end < source.range.start
  ) {
    throw new Errors.UserInputError(`${label} range is invalid.`)
  }
}

function uniqueBy<Value>(
  values: readonly Value[],
  id: (value: Value) => string,
  label: string,
): Map<string, Value> {
  const result = new Map<string, Value>()
  for (const value of values) {
    const key = requireText(id(value), `${label} id`)
    if (result.has(key)) {
      throw new Errors.UserInputError(`${label} id is duplicated: ${key}`)
    }
    result.set(key, value)
  }
  return result
}

function positiveFinite(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function requireRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Errors.UserInputError(`${label} is invalid.`)
  }
}

function requireText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Errors.UserInputError(`${label} must not be empty.`)
  }
  return value
}
