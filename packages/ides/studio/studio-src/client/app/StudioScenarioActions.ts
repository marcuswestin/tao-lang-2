import { Assert, Errors, Switch } from '@shared/core'
import type { StudioSourceActionEnvelope } from '../../StudioProtocol'
import { StudioApiClient, StudioApiError } from '../StudioApiClient'
import { StudioDialog } from '../StudioDialog'
import {
  awaitPreviewJourneyRecordingAcknowledgement,
  revealCanvasNode,
  type StudioActivePreview,
  StudioJourneyRecorder,
  type StudioPreviewConnection,
} from '../StudioMatrixView'
import { type StudioScenarioControlModel, StudioScenarioControls } from '../StudioScenarioControls'
import { parseScenarioPanelCommand, type StudioScenarioPanelCommand } from './StudioScenarioPanelCommand'

export type StudioScenarioActionsDeps = Readonly<{
  activePreview: StudioActivePreview
  apply: (envelope: StudioSourceActionEnvelope) => Promise<boolean>
  /** Whether a source mutation may start; when not, the status line already says why. */
  canMutate: () => boolean
  publish: () => void
  status: HTMLElement
}>

/**
 * The scenario panel's commands against the active cell: remounting arguments, capturing fixtures,
 * replaying captures, and recording journeys. A journey operation is numbered per preview so a
 * save that outlives a discard or a re-record cannot act on the wrong draft.
 */
export class StudioScenarioActions {
  readonly #deps: StudioScenarioActionsDeps
  readonly #journeyBusy = new WeakSet<StudioPreviewConnection>()
  readonly #journeyOperations = new WeakMap<StudioPreviewConnection, number>()

  constructor(deps: StudioScenarioActionsDeps) {
    this.#deps = deps
  }

  journeyBusy(preview: StudioPreviewConnection): boolean {
    return this.#journeyBusy.has(preview)
  }

  /** Brings the active cell's fixture-name field into view for the Capture Fixture command. */
  focusCaptureFixture(): void {
    const preview = this.#deps.activePreview.current()
    const input = preview?.scenarioControls?.querySelector<HTMLInputElement>('.studio-preview-fixture-name')
    if (preview === undefined || input === null || input === undefined) {
      this.#deps.status.dataset['state'] = 'error'
      this.#deps.status.textContent = 'The active preview cell does not expose fixture capture controls.'
      return
    }
    revealCanvasNode(preview.frame)
    input.focus()
  }

  async execute(name: string, payload: string): Promise<void> {
    const command = parseScenarioPanelCommand(name, payload)
    const preview = this.#deps.activePreview.current()
    const model = preview?.scenarioModel
    if (
      preview?.cell === undefined
      || model === undefined
      || preview.cell.cellId !== command.cellId
      || preview.cell.cellRevision !== command.cellRevision
    ) {
      throw new StudioApiError('The selected Studio preview changed while its scenario was being edited.', 409, {
        actualCellId: preview?.cell?.cellId,
        actualCellRevision: preview?.cell?.cellRevision,
        code: 'stale-cell',
        expectedCellId: command.cellId,
        expectedCellRevision: command.cellRevision,
      })
    }
    await Switch.kind<StudioScenarioPanelCommand, Promise<void>>(command, {
      'scenario-apply-arguments': async applied => {
        const checked = StudioScenarioControls.validateArguments(model, applied.arguments)
        if (!checked.ok) {
          Errors.throwUserInput(checked.issues.join(' '))
        }
        Assert.input(
          preview.reconfigureArguments,
          'The active scenario cannot currently remount arguments.',
        )
        await preview.reconfigureArguments(checked.value)
      },
      'scenario-capture-fixture': async captured => {
        Assert.input(preview.captureFixture, 'The active scenario cannot currently capture a fixture.')
        await preview.captureFixture(captured.fixtureName)
      },
      'scenario-discard-journey': async () => this.#discardJourney(preview, model),
      'scenario-replay-capture': async replayed => await this.#replay(preview, model, replayed.capture),
      'scenario-replay-failure': async () => await this.#replay(preview, model, undefined),
      'scenario-save-arguments': async saved => {
        const action = StudioScenarioControls.saveArgumentsAction(
          model,
          saved.arguments,
          crypto.randomUUID(),
          saved.appearance,
        )
        if (!action.ok) {
          Errors.throwUserInput(action.issues.join(' '))
        }
        if (!this.#deps.canMutate()) {
          return
        }
        await this.#deps.apply(action.value)
      },
      'scenario-save-journey': async () => await this.#saveJourney(preview, model),
      'scenario-start-journey': async started => this.#startJourney(preview, model, started.captureSensitiveText),
      'scenario-stop-journey': async () => this.#stopJourney(preview, model),
    })
  }

  #startJourney(
    preview: StudioPreviewConnection,
    model: StudioScenarioControlModel,
    captureSensitiveText: boolean,
  ): void {
    this.#requireJourneyIdle(preview)
    Assert.input(
      preview.journeyRecording === undefined,
      'Save or discard the current journey recording before starting another.',
    )
    Assert.input(
      StudioJourneyRecorder.canStart(preview),
      'Wait for this preview and its scenario journey to finish loading before recording.',
    )
    const recordingId = crypto.randomUUID()
    const request = StudioScenarioControls.recordingRequest(model, recordingId, true, captureSensitiveText)
    if (!request.ok) {
      Errors.throwUserInput(request.issues.join(' '))
    }
    this.#advanceJourneyOperation(preview)
    preview.journeyRecording = {
      captureSensitiveText,
      id: recordingId,
      sequence: 0,
      sourceIdentity: JSON.stringify(model.sourceIdentity),
      status: 'starting',
      steps: [],
    }
    preview.setInteractionMode?.('run')
    awaitPreviewJourneyRecordingAcknowledgement(preview, recordingId)
    preview.iframe.contentWindow?.postMessage(request.value, preview.origin)
    this.#deps.publish()
  }

  #stopJourney(preview: StudioPreviewConnection, model: StudioScenarioControlModel): void {
    this.#requireJourneyIdle(preview)
    const draft = preview.journeyRecording
    Assert.input(draft?.status === 'recording', 'No journey recording is active for this preview.')
    const request = StudioScenarioControls.recordingRequest(model, draft.id, false, draft.captureSensitiveText)
    if (!request.ok) {
      Errors.throwUserInput(request.issues.join(' '))
    }
    preview.iframe.contentWindow?.postMessage(request.value, preview.origin)
  }

  #discardJourney(preview: StudioPreviewConnection, model: StudioScenarioControlModel): void {
    this.#requireJourneyIdle(preview)
    const draft = preview.journeyRecording
    if (draft?.status === 'recording') {
      const request = StudioScenarioControls.recordingRequest(model, draft.id, false, draft.captureSensitiveText)
      if (request.ok) {
        preview.iframe.contentWindow?.postMessage(request.value, preview.origin)
      }
    }
    this.#advanceJourneyOperation(preview)
    preview.journeyRecording = undefined
    this.#deps.publish()
  }

  async #saveJourney(preview: StudioPreviewConnection, model: StudioScenarioControlModel): Promise<void> {
    this.#requireJourneyIdle(preview)
    const draft = preview.journeyRecording
    Assert.input(draft?.status === 'stopped', 'Stop the journey recording before saving it.')
    const action = StudioScenarioControls.appendRecordedStepsAction(model, draft.steps, crypto.randomUUID())
    if (!action.ok) {
      Errors.throwUserInput(action.issues.join(' '))
    }
    if (!this.#deps.canMutate()) {
      return
    }
    const operation = this.#advanceJourneyOperation(preview)
    const draftId = draft.id
    this.#journeyBusy.add(preview)
    this.#deps.publish()
    try {
      const proposal = await StudioApiClient.sourceActionProposal(action.value)
      if (
        !this.#isCurrentJourneyOperation(preview, operation)
        || preview !== this.#deps.activePreview.current()
        || preview.journeyRecording !== draft
      ) {
        return
      }
      const confirmed = await StudioDialog.confirm({
        confirmLabel: 'Save steps',
        diff: proposal.diff,
        title: 'Save these recorded steps to the scenario?',
      })
      if (!confirmed) {
        return
      }
      const applied = await this.#deps.apply(action.value)
      if (
        applied
        && this.#isCurrentJourneyOperation(preview, operation)
        && preview.journeyRecording?.id === draftId
      ) {
        preview.journeyRecording = undefined
      }
    } finally {
      if (this.#isCurrentJourneyOperation(preview, operation)) {
        this.#journeyBusy.delete(preview)
        this.#deps.publish()
      }
    }
  }

  /** A replay with no capture replays the recorded failure the scenario already holds. */
  async #replay(
    preview: StudioPreviewConnection,
    model: StudioScenarioControlModel,
    capture: unknown,
  ): Promise<void> {
    const replay = StudioScenarioControls.replay(model, capture)
    if (!replay.ok) {
      Errors.throwUserInput(replay.issues.join(' '))
    }
    Assert.input(
      preview.replayRuntimeCapture,
      'The active scenario cannot currently replay captured state.',
    )
    await preview.replayRuntimeCapture(replay.value)
  }

  #advanceJourneyOperation(preview: StudioPreviewConnection): number {
    const operation = (this.#journeyOperations.get(preview) ?? 0) + 1
    this.#journeyOperations.set(preview, operation)
    return operation
  }

  #isCurrentJourneyOperation(preview: StudioPreviewConnection, operation: number): boolean {
    return this.#journeyOperations.get(preview) === operation
  }

  #requireJourneyIdle(preview: StudioPreviewConnection): void {
    Assert.input(!this.#journeyBusy.has(preview), 'Wait for the current journey operation to finish.')
  }
}
