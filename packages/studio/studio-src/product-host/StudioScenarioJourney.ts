import { Switch } from '@shared/core'
import { parseStudioJson } from './StudioHostJson'
import { StudioScenarioIdentityPayload, studioScenarioModel } from './StudioScenarioPanel'

type StudioJourneyRecordingModel = Readonly<{
  busy: boolean
  captureSensitiveText: boolean
  id: string
  status: 'invalidated' | 'recording' | 'starting' | 'stopped'
  steps: readonly StudioJourneyStep[]
}>

type StudioJourneyStep = Readonly<{
  action?: 'enter' | 'press' | 'submit'
  kind: 'enter' | 'press' | 'submit' | 'unresolved'
  reason?: string
  redacted?: boolean
  selector?: 'label' | 'placeholder' | 'tag' | 'text'
  target?: string
  value?: string
}>

function studioJourneyRecording(recording: string): StudioJourneyRecordingModel | undefined {
  const parsed = parseStudioJson<unknown>(recording)
  if (parsed === undefined) {
    return undefined
  }
  const candidate = parsed as Partial<StudioJourneyRecordingModel>
  return typeof candidate.id === 'string'
      && typeof candidate.busy === 'boolean'
      && typeof candidate.captureSensitiveText === 'boolean'
      && ['invalidated', 'recording', 'starting', 'stopped'].includes(candidate.status ?? '')
      && Array.isArray(candidate.steps)
    ? candidate as StudioJourneyRecordingModel
    : undefined
}

function studioJourneyStepLine(step: StudioJourneyStep): string {
  return Switch.kind(step, {
    enter: () =>
      `enter ${step.redacted ? '<redacted>' : JSON.stringify(step.value ?? '')} into ${studioJourneyStepTarget(step)}`,
    press: () => `press ${studioJourneyStepTarget(step)}`,
    submit: () => `submit ${studioJourneyStepTarget(step)}`,
    unresolved: () =>
      `${step.action ?? 'interaction'}: unresolved — ${step.reason ?? 'Interaction target could not be resolved.'}`,
  })
}

function studioJourneyStepTarget(step: StudioJourneyStep): string {
  const quoted = JSON.stringify(step.target ?? '')
  return Switch(step.selector, {
    label: () => `label ${quoted}`,
    placeholder: () => `placeholder ${quoted}`,
    tag: () => `#${step.target ?? ''}`,
    text: () => quoted,
    undefined: () => `target ${quoted}`,
  })
}

export function StudioScenarioJourneyActive(recording: string): boolean {
  return studioJourneyRecording(recording)?.status === 'recording'
}

export function StudioScenarioJourneyButtonLabel(recording: string): string {
  return studioJourneyRecording(recording)?.status === 'starting'
    ? 'Starting recording…'
    : StudioScenarioJourneyActive(recording)
    ? 'Stop recording'
    : 'Record journey'
}

export function StudioScenarioJourneyCommand(recording: string): string {
  return StudioScenarioJourneyActive(recording) ? 'scenario-stop-journey' : 'scenario-start-journey'
}

export function StudioScenarioJourneyBusy(recording: string): boolean {
  return studioJourneyRecording(recording)?.busy === true
}

export function StudioScenarioJourneyAvailable(recording: string): boolean {
  return studioJourneyRecording(recording) !== undefined
}

export function StudioScenarioJourneyLines(recording: string): string[] {
  return studioJourneyRecording(recording)?.steps.map(studioJourneyStepLine) ?? []
}

export function StudioScenarioJourneyStatus(recording: string): string {
  const draft = studioJourneyRecording(recording)
  if (draft === undefined) {
    return ''
  }
  if (draft.busy) {
    return 'Preparing canonical Tao source…'
  }
  if (draft.status === 'starting') {
    return 'Waiting for the exact preview to acknowledge recording…'
  }
  if (draft.status === 'invalidated') {
    return 'The preview changed; discard this draft and record again.'
  }
  if (draft.steps.some(step => step.kind === 'unresolved')) {
    return 'An interaction has no unique semantic target. Add a unique Tag or accessibility label, then record again.'
  }
  if (draft.steps.some(step => step.kind === 'enter' && step.redacted)) {
    return 'Sensitive text was redacted. Discard and record again with Retain sensitive text only when safe.'
  }
  return draft.status === 'recording'
    ? `Recording ${draft.steps.length} semantic step${draft.steps.length === 1 ? '' : 's'}…`
    : `${draft.steps.length} step${draft.steps.length === 1 ? '' : 's'} ready for review.`
}

export function StudioScenarioJourneyCanRecord(state: string, recording: string, ready: boolean): boolean {
  const draft = studioJourneyRecording(recording)
  return studioScenarioModel(state)?.sourceIdentity !== undefined
    && ready
    && draft === undefined
}

export function StudioScenarioJourneyCanSave(recording: string): boolean {
  const draft = studioJourneyRecording(recording)
  return draft?.status === 'stopped'
    && !draft.busy
    && draft.steps.length > 0
    && !draft.steps.some(step => step.kind === 'unresolved' || step.kind === 'enter' && step.redacted)
}

export function StudioScenarioJourneyPayload(state: string, captureSensitiveText: boolean): string {
  return JSON.stringify({
    ...JSON.parse(StudioScenarioIdentityPayload(state)),
    captureSensitiveText,
  })
}
