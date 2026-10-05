import type {
  StudioPreviewJourneyRecordingStateMessage,
  StudioPreviewJourneyStepRecordedMessage,
  StudioRecordedJourneyStep,
} from '../../StudioProtocol'
import type { StudioPreviewConnection } from './StudioPreviewConnection'
import { StudioReviewDom } from './StudioReviewDom'

export type StudioJourneyRecordingDraft = Readonly<{
  captureSensitiveText: boolean
  id: string
  sequence: number
  sourceIdentity: string
  status: 'invalidated' | 'recording' | 'starting' | 'stopped'
  steps: readonly StudioRecordedJourneyStep[]
}>

export const StudioJourneyRecorder = {
  canStart(preview: StudioPreviewConnection): boolean {
    const identity = preview.cellIdentity
    const appliedRevision = preview.appliedRevision
    return identity !== undefined
      && preview.iframe.contentWindow !== null
      && appliedRevision !== undefined
      && appliedRevision >= identity.compileRevision
      && (preview.expectedRevision === undefined || appliedRevision >= preview.expectedRevision)
      && StudioReviewDom.appliedReady(preview.journeyReplayStatus)
  },
  formatStep(step: StudioRecordedJourneyStep): string {
    if (step.kind === 'unresolved') {
      return `${step.action}: unresolved — ${step.reason}`
    }
    const target = step.selector === 'tag'
      ? `#${step.target}`
      : step.selector === 'text'
      ? JSON.stringify(step.target)
      : `${step.selector} ${JSON.stringify(step.target)}`
    return step.kind === 'enter'
      ? `enter ${step.redacted ? '<redacted>' : JSON.stringify(step.value)} into ${target}`
      : `${step.kind} ${target}`
  },
  receive(
    draft: StudioJourneyRecordingDraft,
    message: StudioPreviewJourneyRecordingStateMessage | StudioPreviewJourneyStepRecordedMessage,
  ): StudioJourneyRecordingDraft {
    if (message.recordingId !== draft.id) {
      return draft
    }
    if (message.type === 'preview-journey-recording-state') {
      if (message.sequence < draft.sequence || draft.status === 'invalidated') {
        return draft
      }
      if (message.sequence > draft.sequence) {
        return { ...draft, status: 'invalidated' }
      }
      if (draft.status === 'stopped' && message.status !== 'invalidated') {
        return draft
      }
      return { ...draft, status: message.status }
    }
    if (message.sequence <= draft.sequence) {
      return draft
    }
    if (message.sequence !== draft.sequence + 1 || draft.status !== 'recording' || draft.steps.length >= 100) {
      return { ...draft, status: 'invalidated' }
    }
    return { ...draft, sequence: message.sequence, steps: [...draft.steps, message.step] }
  },
  invalidate(draft: StudioJourneyRecordingDraft): StudioJourneyRecordingDraft {
    return draft.status === 'invalidated' ? draft : { ...draft, status: 'invalidated' }
  },
} as const

/** Any preview-lifecycle boundary makes a browser-local recording unsafe to save. */
export function invalidatePreviewJourneyRecording(preview: StudioPreviewConnection): void {
  if (preview.journeyRecordingTimeout !== undefined) {
    clearTimeout(preview.journeyRecordingTimeout)
    preview.journeyRecordingTimeout = undefined
  }
  if (preview.journeyRecording === undefined) {
    return
  }
  const invalidated = StudioJourneyRecorder.invalidate(preview.journeyRecording)
  if (invalidated === preview.journeyRecording) {
    return
  }
  preview.journeyRecording = invalidated
  preview.changed?.()
}

/** Recording starts only after the exact preview acknowledges the request. */
export function awaitPreviewJourneyRecordingAcknowledgement(
  preview: StudioPreviewConnection,
  recordingId: string,
  timeoutMs = 5_000,
): void {
  if (preview.journeyRecordingTimeout !== undefined) {
    clearTimeout(preview.journeyRecordingTimeout)
  }
  preview.journeyRecordingTimeout = setTimeout(() => {
    preview.journeyRecordingTimeout = undefined
    const draft = preview.journeyRecording
    if (draft?.id === recordingId && draft.status === 'starting') {
      preview.journeyRecording = StudioJourneyRecorder.invalidate(draft)
      preview.changed?.()
    }
  }, timeoutMs)
}
