import type { GenerationDeclaration } from '@generation'
import { Errors, Json, Switch } from '@shared'
import { cellIdentity, requireText, validateTaoSource, valueMatchesParameter } from './StudioPreviewCell'
import {
  reactiveBrowserSchemeCapability,
  type StudioJsonObject,
  type StudioJsonValue,
  type StudioSourceRange,
} from './StudioProtocol'
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
    | { entity?: string; kind: 'json' }
    | { kind: 'number'; maximum?: number; minimum?: number; step?: number }
    | { kind: 'text' }
    | { kind: 'time' }
}

type StudioScenarioStep =
  | { kind: 'advance'; milliseconds: number }
  | { kind: 'focus'; tag: string }
  | {
    kind: 'enter'
    selector: 'label' | 'placeholder' | 'tag' | 'text'
    target: string
    value: string
  }
  | {
    kind: 'hover' | 'press' | 'pressDown' | 'pressUp' | 'submit'
    selector: 'label' | 'placeholder' | 'tag' | 'text'
    target: string
  }
  | { index: number; kind: 'select'; steps: readonly StudioScenarioStep[]; tag: string }

export type StudioScenario = {
  args: StudioJsonObject
  fixtureId?: string
  group: string
  label: string
  prepare: readonly StudioJsonObject[]
  scenarioId: string
  source: StudioTaoSource
  stateLayers: readonly string[]
  steps?: readonly StudioScenarioStep[]
  subjectId: string
}

type StudioFixture = {
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
  capability: 'fixed-light-native' | 'pinned-native' | 'reactive-browser' | 'reactive-catalyst' | 'reactive-native'
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
    Errors.throwUserInput(`Unsupported Studio preview manifest version: ${input.version}`)
  }
  requireText(input.manifestRevision, 'Studio manifest revision')
  requireRevision(input.compileRevision, 'Studio compile revision')
  requireText(input.project.appName, 'Studio project app name')
  requireText(input.project.entryPath, 'Studio project entry path')
  requireText(input.project.root, 'Studio project root')
  if (input.capabilities.scheme !== reactiveBrowserSchemeCapability) {
    Errors.throwUserInput('Studio browser previews require the reactive Scheme capability.')
  }
  const subjects = uniqueBy(input.subjects, subject => subject.subjectId, 'Studio subject')
  for (const subject of subjects.values()) {
    validateTaoSource(subject.source, 'Studio subject source')
    requireText(subject.kind === 'app' ? subject.appName : subject.viewName, `Studio ${subject.kind} name`)
  }
  const renders = uniqueBy(input.renders ?? [], render => render.renderId, 'Studio render')
  for (const render of renders.values()) {
    requireText(render.elementName, 'Studio render element name')
    validateTaoSource(render.source, 'Studio render source')
    if (render.studioRectId !== undefined) {
      requireText(render.studioRectId, 'Studio render rectangle identity')
    }
  }
  for (const [subjectId, parameters] of Object.entries(input.parametersBySubject)) {
    if (!subjects.has(subjectId)) {
      Errors.throwUserInput(`Studio parameters target an unknown subject: ${subjectId}`)
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
    validateTaoSource(fixture.source, 'Studio fixture source')
    requireText(fixture.label, 'Studio fixture label')
  }
  const scenarios = uniqueBy(input.scenarios, scenario => scenario.scenarioId, 'Studio scenario')
  for (const scenario of scenarios.values()) {
    validateTaoSource(scenario.source, 'Studio scenario source')
    requireText(scenario.group, 'Studio scenario group')
    requireText(scenario.label, 'Studio scenario label')
    if (scenario.fixtureId !== undefined && !fixtures.has(scenario.fixtureId)) {
      Errors.throwUserInput(`Studio scenario targets an unknown fixture: ${scenario.fixtureId}`)
    }
    const subject = subjects.get(scenario.subjectId)
    if (subject === undefined) {
      Errors.throwUserInput(`Studio scenario targets an unknown subject: ${scenario.subjectId}`)
    }
    validateArgsForSubject(input, subject.subjectId, scenario.args)
    library.resolve(scenario.stateLayers)
    validateJourneySteps(scenario.steps)
  }
  uniqueBy(input.cells, cell => cell.cellId, 'Studio cell')
  for (const cell of input.cells) {
    requireRevision(cell.cellRevision, 'Studio cell revision')
    const scenario = scenarios.get(cell.scenarioId)
    if (scenario === undefined) {
      Errors.throwUserInput(`Studio cell targets an unknown scenario: ${cell.scenarioId}`)
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

function validateJourneySteps(steps: unknown, depth = 0): void {
  if (steps === undefined) {
    return
  }
  if (!Array.isArray(steps)) {
    Errors.throwUserInput('Studio journey steps must be an array.')
  }
  if (depth > 64) {
    Errors.throwUserInput('Studio journey steps are nested too deeply.')
  }
  for (const step of steps) {
    validateJourneyStep(step, depth)
  }
}

function validateJourneyStep(step: unknown, depth: number): void {
  if (!Json.isRecord(step) || typeof step['kind'] !== 'string') {
    Errors.throwUserInput('Studio journey step must be an object with a supported kind.')
  }
  const kind = step['kind']
  if (kind === 'advance') {
    requireOnlyKeys(step, ['kind', 'milliseconds'], 'Studio journey advance')
    if (!Number.isFinite(step['milliseconds']) || (step['milliseconds'] as number) < 0) {
      Errors.throwUserInput('Studio journey advance must be a non-negative number of milliseconds.')
    }
    return
  }
  if (kind === 'focus') {
    requireOnlyKeys(step, ['kind', 'tag'], 'Studio journey focus')
    requireText(step['tag'] as string, 'Studio journey focus tag')
    return
  }
  if (kind === 'select') {
    requireOnlyKeys(step, ['index', 'kind', 'steps', 'tag'], 'Studio journey select')
    requireText(step['tag'] as string, 'Studio journey select tag')
    if (!Number.isSafeInteger(step['index']) || (step['index'] as number) < 1) {
      Errors.throwUserInput('Studio journey select index must be a positive whole number.')
    }
    if (!Array.isArray(step['steps'])) {
      Errors.throwUserInput('Studio journey select steps must be an array.')
    }
    validateJourneySteps(step['steps'], depth + 1)
    return
  }
  if (kind === 'enter') {
    requireOnlyKeys(step, ['kind', 'selector', 'target', 'value'], 'Studio journey enter')
    validateJourneySelector(step['selector'], kind)
    requireText(step['target'] as string, 'Studio journey enter target')
    if (typeof step['value'] !== 'string') {
      Errors.throwUserInput('Studio journey enter value must be text.')
    }
    return
  }
  if (['hover', 'press', 'pressDown', 'pressUp', 'submit'].includes(kind)) {
    requireOnlyKeys(step, ['kind', 'selector', 'target'], `Studio journey ${kind}`)
    validateJourneySelector(step['selector'], kind)
    requireText(step['target'] as string, `Studio journey ${kind} target`)
    return
  }
  Errors.throwUserInput(`Unsupported Studio journey step kind: ${kind}`)
}

function validateJourneySelector(value: unknown, kind: string): void {
  if (value !== 'label' && value !== 'placeholder' && value !== 'tag' && value !== 'text') {
    Errors.throwUserInput(`Studio journey ${kind} selector is invalid.`)
  }
}

function requireOnlyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key))
  if (unknown !== undefined) {
    Errors.throwUserInput(`${label} contains an unsupported field: ${unknown}`)
  }
}
function validateArgs(manifest: StudioPreviewManifestV2, scenarioId: string, args: StudioJsonObject): void {
  const scenario = manifest.scenarios.find(candidate => candidate.scenarioId === scenarioId)
  if (scenario === undefined) {
    Errors.throwUserInput(`Studio scenario does not exist: ${scenarioId}`)
  }
  validateArgsForSubject(manifest, scenario.subjectId, args)
}

function validateArgsForSubject(manifest: StudioPreviewManifestV2, subjectId: string, args: StudioJsonObject): void {
  const parameters = manifest.parametersBySubject[subjectId] ?? []
  const parameterById = new Map(parameters.map(parameter => [parameter.parameterId, parameter]))
  for (const key of Object.keys(args)) {
    if (!parameterById.has(key)) {
      Errors.throwUserInput(`Studio argument is not declared by ${subjectId}: ${key}`)
    }
  }
  for (const parameter of parameters) {
    const value = args[parameter.parameterId]
    if (value === undefined) {
      if (parameter.required && parameter.defaultValue === undefined) {
        Errors.throwUserInput(`Studio argument is required: ${parameter.parameterId}`)
      }
      continue
    }
    if (!valueMatchesParameter(value, parameter)) {
      const expected = parameter.type.kind === 'json' && parameter.type.entity !== undefined
        ? `entity ${parameter.type.entity}`
        : parameter.type.kind
      Errors.throwUserInput(`Studio argument ${parameter.parameterId} does not match ${expected}.`)
    }
  }
}

function validateParameter(parameter: StudioParameterSchema): void {
  requireText(parameter.parameterId, 'Studio parameter id')
  requireText(parameter.label, 'Studio parameter label')
  if (parameter.defaultValue !== undefined && !valueMatchesParameter(parameter.defaultValue, parameter)) {
    Errors.throwUserInput(`Studio parameter default does not match ${parameter.parameterId}.`)
  }
  Switch.kind<StudioParameterSchema['type'], void>(parameter.type, {
    // A boolean, a free text, and a time carry nothing beyond their kind.
    boolean: Switch.nothing,
    choice: ({ values }) => {
      if (values.length === 0) {
        Errors.throwUserInput(`Studio choice parameter has no values: ${parameter.parameterId}`)
      }
    },
    json: ({ entity }) => {
      if (entity !== undefined) {
        requireText(entity, `Studio entity parameter type for ${parameter.parameterId}`)
      }
    },
    number: numeric => {
      for (const value of [numeric.minimum, numeric.maximum, numeric.step]) {
        if (value !== undefined && !Number.isFinite(value)) {
          Errors.throwUserInput(`Studio numeric parameter is not finite: ${parameter.parameterId}`)
        }
      }
      if (numeric.step !== undefined && numeric.step <= 0) {
        Errors.throwUserInput(`Studio numeric parameter step must be positive: ${parameter.parameterId}`)
      }
    },
    text: Switch.nothing,
    time: Switch.nothing,
  })
}

function validateEnvironment(environment: StudioCellEnvironment): void {
  if (!positiveFinite(environment.viewport.width) || !positiveFinite(environment.viewport.height)) {
    Errors.throwUserInput('Studio viewport dimensions must be positive finite numbers.')
  }
  if (!Number.isSafeInteger(environment.network.latencyMs) || environment.network.latencyMs < 0) {
    Errors.throwUserInput('Studio network latency must be a non-negative integer.')
  }
  if (environment.network.outcome === 'error' && environment.network.error === undefined) {
    Errors.throwUserInput('Studio error simulation requires an explicit error.')
  }
  if (environment.network.outcome !== 'error' && environment.network.error !== undefined) {
    Errors.throwUserInput('Studio network errors are only valid for error simulation.')
  }
  validateScheme(environment.scheme)
}

function validateScheme(scheme: StudioSchemeEnvironment): void {
  if (
    !['dark', 'light', 'system'].includes(scheme.requested)
    || !['dark', 'light'].includes(scheme.resolved)
    || !['fixed-light-native', 'pinned-native', 'reactive-browser', 'reactive-catalyst', 'reactive-native'].includes(
      scheme.capability,
    )
    || !['native-fixed', 'preference', 'scenario', 'system'].includes(scheme.source)
    || (scheme.source === 'system' && scheme.requested !== 'system')
    || (scheme.source === 'preference' && scheme.requested === 'system')
    || (scheme.source === 'scenario' && scheme.requested === 'system')
    || (scheme.source === 'native-fixed' && scheme.capability !== 'fixed-light-native')
    || (scheme.capability === 'fixed-light-native' && (scheme.resolved !== 'light' || scheme.source !== 'native-fixed'))
    || (scheme.capability === 'pinned-native' && (scheme.source !== 'scenario' || scheme.resolved !== scheme.requested))
  ) {
    Errors.throwUserInput('Studio Scheme must record a valid request, resolution, source, and capability.')
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
      Errors.throwUserInput(`${label} id is duplicated: ${key}`)
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
    Errors.throwUserInput(`${label} is invalid.`)
  }
}
