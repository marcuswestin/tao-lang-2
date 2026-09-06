import TR from '@runtime/TR'
import { Assert, Errors, Switch } from '@shared/core'
import React from 'react'
import { type StudioScenarioControlModel, StudioScenarioControls } from '../client/StudioScenarioControls'
import type { StudioParameterSchema } from '../StudioPreviewManifest'
import type { StudioJsonObject, StudioJsonValue } from '../StudioProtocol'
import { parseStudioJson } from './StudioHostJson'
import type { TaoStudioHostTextAction, TaoStudioHostVisualProps } from './StudioHostProps'

type StudioScenarioArgumentDrafts = Readonly<Record<string, string>>

export function StudioScenarioPanelSurface(
  props:
    & TaoStudioHostVisualProps
    & Readonly<{
      Available: boolean
      children?: React.ReactNode
    }>,
): React.ReactElement {
  return (
    <section
      className="studio-scenario-inspector"
      data-scenario-available={props.Available}
      data-studio-tao-scenario="true"
      style={props.Layout?.style}
    >
      <h2>Scenario</h2>
      {props.children}
    </section>
  )
}

export function StudioFailureCaptureInput(
  props:
    & TaoStudioHostVisualProps
    & Readonly<{ Replay: TaoStudioHostTextAction }>,
): React.ReactElement {
  const [status, setStatus] = React.useState('')
  return (
    <label className="studio-preview-cell-replay-load" data-testid={props.Tag} style={props.Layout?.style}>
      Load failure capture
      <input
        accept="application/json,.json"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          if (file !== undefined) {
            void file.text().then(text => {
              try {
                const capture = JSON.parse(text) as unknown
                Assert.input(
                  capture !== null && typeof capture === 'object',
                  'Failure capture must be a JSON object.',
                )
                setStatus('')
                return props.Replay.invoke(TR.Value(text))
              } catch (error) {
                setStatus(Errors.messageOf(error))
              }
            }, error => setStatus(Errors.messageOf(error)))
          }
        }}
        type="file"
      />
      {status === '' ? undefined : <span role="alert">{status}</span>}
    </label>
  )
}

export function studioScenarioArguments(
  model: Pick<StudioScenarioControlModel, 'parameters'>,
  drafts: StudioScenarioArgumentDrafts,
): Readonly<{ issues: readonly string[]; ok: false }> | Readonly<{ ok: true; value: StudioJsonObject }> {
  const args: Record<string, StudioJsonValue> = {}
  const issues: string[] = []
  for (const parameter of model.parameters) {
    const outcome = studioScenarioArgument(parameter, drafts[parameter.parameterId])
    if (outcome === undefined) {
      continue
    }
    if ('issue' in outcome) {
      issues.push(outcome.issue)
    } else {
      args[parameter.parameterId] = outcome.value
    }
  }
  if (issues.length > 0) {
    return { issues, ok: false }
  }
  return StudioScenarioControls.validateArguments(model, args)
}

type StudioScenarioArgumentOutcome =
  | Readonly<{ issue: string }>
  | Readonly<{ value: StudioJsonValue }>
  | undefined

/** One parameter's draft as its typed argument or an issue; an empty draft contributes nothing. */
function studioScenarioArgument(
  parameter: StudioParameterSchema,
  draft: string | undefined,
): StudioScenarioArgumentOutcome {
  if (draft === undefined || draft === '') {
    return undefined
  }
  const jsonArgument = (): StudioScenarioArgumentOutcome => {
    try {
      return { value: JSON.parse(draft) as StudioJsonValue }
    } catch {
      return { issue: `${parameter.label} must be valid JSON.` }
    }
  }
  return Switch.kind<StudioParameterSchema['type'], StudioScenarioArgumentOutcome>(parameter.type, {
    boolean: () =>
      draft === 'true' || draft === 'false'
        ? { value: draft === 'true' }
        : { issue: `${parameter.label} must be true or false.` },
    choice: jsonArgument,
    json: jsonArgument,
    number: () => {
      const value = Number(draft)
      return Number.isFinite(value) ? { value } : { issue: `${parameter.label} must be a finite number.` }
    },
    text: () => ({ value: draft }),
    time: () => ({ value: draft }),
  })
}

function scenarioDrafts(model: StudioScenarioControlModel | undefined): StudioScenarioArgumentDrafts {
  if (model === undefined) {
    return {}
  }
  return Object.fromEntries(model.parameters.map(parameter => {
    const value = model.arguments[parameter.parameterId] ?? parameter.defaultValue
    const draft: string = value === undefined ? '' : Switch.kind(parameter.type, {
      boolean: () => String(value === true),
      choice: () => JSON.stringify(value),
      json: () => JSON.stringify(value),
      number: () => String(value),
      text: () => String(value),
      time: () => String(value),
    })
    return [
      parameter.parameterId,
      draft,
    ]
  }))
}

function isStudioScenarioControlModel(value: unknown): value is StudioScenarioControlModel {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<StudioScenarioControlModel>
  return candidate.version === 1
    && candidate.cell !== undefined
    && typeof candidate.cell.id === 'string'
    && Number.isInteger(candidate.cell.revision)
    && candidate.entry !== undefined
    && typeof candidate.entry.label === 'string'
    && candidate.group !== undefined
    && typeof candidate.group.label === 'string'
    && Array.isArray(candidate.parameters)
    && Array.isArray(candidate.capturedLayers)
}

export function studioScenarioModel(state: string): StudioScenarioControlModel | undefined {
  const parsed = parseStudioJson<unknown>(state)
  return isStudioScenarioControlModel(parsed) ? parsed : undefined
}

function studioScenarioDraftMap(drafts: string): StudioScenarioArgumentDrafts {
  const parsed = parseStudioJson<unknown>(drafts)
  if (parsed === undefined || parsed === null || Array.isArray(parsed)) {
    return {}
  }
  const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(entries)
}

function studioScenarioParameter(state: string, parameterId: string) {
  return studioScenarioModel(state)?.parameters.find(parameter => parameter.parameterId === parameterId)
}

export function StudioScenarioAvailable(state: string): boolean {
  return studioScenarioModel(state) !== undefined
}

export function StudioScenarioArgumentDrafts(state: string): string {
  return JSON.stringify(scenarioDrafts(studioScenarioModel(state)))
}

export function StudioScenarioArgumentIds(state: string): string[] {
  return studioScenarioModel(state)?.parameters.map(parameter => parameter.parameterId) ?? []
}

export function StudioScenarioEntryLabel(state: string): string {
  return studioScenarioModel(state)?.entry.label ?? ''
}

export function StudioScenarioGroupLabel(state: string): string {
  return studioScenarioModel(state)?.group.label ?? ''
}

export function StudioScenarioSubjectId(state: string): string {
  return studioScenarioModel(state)?.entry.subjectId ?? ''
}

export function StudioScenarioCellIdentity(state: string): string {
  const model = studioScenarioModel(state)
  return model === undefined
    ? ''
    : `${model.cell.id} · revision ${model.cell.revision} · manifest ${model.cell.manifestRevision}`
}

export function StudioScenarioCapturedLayers(state: string): string[] {
  return [...(studioScenarioModel(state)?.capturedLayers ?? [])]
}

export function StudioScenarioFailureAvailable(state: string): boolean {
  return studioScenarioModel(state)?.failureReplay !== undefined
}

export function StudioScenarioFixtureNameValid(fixtureName: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(fixtureName)
}

export function StudioScenarioArgumentDraft(drafts: string, parameterId: string): string {
  return studioScenarioDraftMap(drafts)[parameterId] ?? ''
}

export function StudioScenarioArgumentUsesPicker(state: string, parameterId: string): boolean {
  const kind = studioScenarioParameter(state, parameterId)?.type.kind
  return kind === 'boolean' || kind === 'choice'
}

export function StudioScenarioArgumentLabel(state: string, parameterId: string): string {
  return studioScenarioParameter(state, parameterId)?.label ?? parameterId
}

export function StudioScenarioArgumentOptions(state: string, parameterId: string): string[] {
  const parameter = studioScenarioParameter(state, parameterId)
  if (parameter?.type.kind === 'boolean') {
    return parameter.required ? ['true', 'false'] : ['', 'true', 'false']
  }
  return parameter?.type.kind === 'choice' ? parameter.type.values.map(value => JSON.stringify(value)) : []
}

export function StudioScenarioUpdateArgumentDraft(drafts: string, parameterId: string, value: string): string {
  return JSON.stringify({ ...studioScenarioDraftMap(drafts), [parameterId]: value })
}

export function StudioScenarioArgumentsValid(state: string, drafts: string): boolean {
  const model = studioScenarioModel(state)
  return model !== undefined && studioScenarioArguments(model, studioScenarioDraftMap(drafts)).ok
}

export function StudioScenarioArgumentIssues(state: string, drafts: string): string {
  const model = studioScenarioModel(state)
  if (model === undefined) {
    return ''
  }
  const checked = studioScenarioArguments(model, studioScenarioDraftMap(drafts))
  return checked.ok ? '' : checked.issues.join(' ')
}

export function StudioScenarioIdentityPayload(state: string): string {
  const model = studioScenarioModel(state)
  Assert.input(model, 'The active Studio scenario is unavailable.')
  return JSON.stringify({ cellId: model.cell.id, cellRevision: model.cell.revision })
}

export function StudioScenarioArgumentsPayload(state: string, drafts: string, appearance: string): string {
  const model = studioScenarioModel(state)
  Assert.input(model, 'The active Studio scenario is unavailable.')
  const checked = studioScenarioArguments(model, studioScenarioDraftMap(drafts))
  if (!checked.ok) {
    Errors.throwUserInput(checked.issues.join(' '))
  }
  if (appearance !== 'dark' && appearance !== 'light') {
    Errors.throwUserInput('Studio can author only the resolved light or dark scenario appearance.')
  }
  return JSON.stringify({
    appearance,
    arguments: checked.value,
    cellId: model.cell.id,
    cellRevision: model.cell.revision,
  })
}

export function StudioScenarioFixturePayload(state: string, fixtureName: string): string {
  Assert.input(StudioScenarioFixtureNameValid(fixtureName), 'Fixture name must be a Tao identifier.')
  return JSON.stringify({ ...JSON.parse(StudioScenarioIdentityPayload(state)), fixtureName })
}

export function StudioScenarioReplayPayload(state: string, capture: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(capture) as unknown
  } catch {
    Errors.throwUserInput('Failure capture must be valid JSON.')
  }
  Assert.input(parsed !== null && typeof parsed === 'object', 'Failure capture must be a JSON object.')
  return JSON.stringify({ ...JSON.parse(StudioScenarioIdentityPayload(state)), capture: parsed })
}
