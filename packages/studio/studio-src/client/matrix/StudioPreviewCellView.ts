import { Assert, Errors } from '@shared/core'
import type { StudioCellEnvironment, StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import type { StudioJsonObject, StudioRuntimeCaptureArtifact } from '../../StudioProtocol'
import { StudioApiClient } from '../StudioApiClient'
import { StudioDialog } from '../StudioDialog'
import { StudioScenarioControls } from '../StudioScenarioControls'
import { StudioCellControls } from './StudioCellControls'
import { StudioDebugEvents } from './StudioDebugEvents'
import {
  applyConnectionSourceAction,
  configureGenerationAvailability,
  fixtureSourceIdentity,
  StudioFixtureGenerationFeedback,
  StudioFixtureProposal,
} from './StudioFixtureActions'
import { invalidatePreviewJourneyRecording } from './StudioJourneyRecording'
import {
  observePreviewVisibility,
  setPreviewSource,
  type StudioPreviewConnection,
  StudioPreviewFrameUrl,
} from './StudioPreviewConnection'
import { StudioReviewDom } from './StudioReviewDom'
import { studioReplayConfiguration } from './StudioRuntimeCapture'

/** The cell's one status line: a state for styling and the sentence the person reads. */
type StudioCellStatus = {
  element: HTMLSpanElement
  set(state: 'busy' | 'error' | 'idle', text: string): void
}

function cellStatus(connection: StudioPreviewConnection): StudioCellStatus {
  const element = document.createElement('span')
  element.className = 'studio-preview-cell-status'
  element.setAttribute('role', 'status')
  const set = (state: 'busy' | 'error' | 'idle', text: string): void => {
    element.dataset['state'] = state
    element.textContent = text
  }
  if (connection.generationNotice !== undefined) {
    set('error', connection.generationNotice)
    connection.generationNotice = undefined
  }
  return { element, set }
}

function cellButton(className: string, text: string, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = className
  button.textContent = text
  button.type = type
  return button
}

/**
 * renderCellPreview builds one cell's header, controls, and viewport around its retained iframe, and
 * wires the remount, fixture, generation, and replay actions onto the connection. A remount renders
 * the cell again with the same frame, so the iframe keeps its identity while everything else is rebuilt.
 */
export function renderCellPreview(
  frame: HTMLElement,
  connection: StudioPreviewConnection,
  previewUrl: string,
  manifest: StudioPreviewManifestV2,
): void {
  const cell = connection.cell!
  frame.style.width = `${Math.max(320, cell.environment.viewport.width)}px`
  const scenario = manifest.scenarios.find(candidate => candidate.scenarioId === cell.scenarioId)
  connection.journeyReplayStatus = (scenario?.steps?.length ?? 0) > 0 ? 'pending' : undefined
  const subjectParameters = manifest.parametersBySubject[scenario?.subjectId ?? ''] ?? []
  const modeled = StudioScenarioControls.fromManifest({
    cell,
    cellIdentity: connection.cellIdentity,
    failureReplay: connection.runtimeFailure,
    manifest,
    previewInstanceId: connection.previewInstanceId,
  })
  const scenarioModel = modeled.ok ? modeled.value : undefined
  connection.scenarioModel = scenarioModel
  const review = StudioReviewDom.cell(manifest, cell)
  if (review === undefined) {
    delete frame.dataset['taoReviewKey']
    delete frame.dataset['taoReviewLabel']
    delete frame.dataset['taoReviewGroup']
    delete frame.dataset['taoReviewEnvironment']
    delete frame.dataset['taoReviewRenderInputs']
  } else {
    frame.dataset['taoReviewKey'] = review.key
    frame.dataset['taoReviewLabel'] = review.label
    frame.dataset['taoReviewGroup'] = review.group
    frame.dataset['taoReviewEnvironment'] = review.environment
    frame.dataset['taoReviewRenderInputs'] = review.renderInputs
  }
  StudioReviewDom.status(frame, 'pending')
  const label = document.createElement('header')
  label.className = 'studio-preview-cell-label'
  label.textContent = scenario?.label ?? cell.scenarioId
  connection.scenarioLabel = scenario?.label ?? cell.scenarioId

  const details = document.createElement('span')
  details.className = 'studio-preview-cell-details'
  details.textContent = `${cell.environment.viewport.width}×${cell.environment.viewport.height} · ${
    StudioCellControls.networkLabel(cell.environment)
  }`
  label.append(details)

  const form = document.createElement('form')
  form.className = 'studio-preview-cell-controls'
  form.dataset['taoStudioCellControls'] = cell.cellId
  const argumentControls = StudioCellControls.arguments(subjectParameters, cell.args)
  const viewportControls = StudioCellControls.viewport(cell.environment)
  const networkControls = StudioCellControls.network(cell.environment)
  const schemeControls = StudioCellControls.scheme(cell.environment)
  const actions = document.createElement('div')
  actions.className = 'studio-preview-cell-actions'
  const apply = cellButton('studio-preview-cell-apply', 'Apply & remount', 'submit')
  const promote = cellButton('studio-preview-cell-promote', 'Save to scenario')
  promote.disabled = scenarioModel === undefined || subjectParameters.length === 0
  const fixtureName = document.createElement('input')
  fixtureName.className = 'studio-preview-fixture-name'
  fixtureName.placeholder = 'CapturedState'
  fixtureName.setAttribute('aria-label', 'Captured fixture name')
  fixtureName.value = 'CapturedState'
  const capture = cellButton('studio-preview-cell-capture', 'Capture fixture')
  capture.disabled = scenarioModel === undefined
  const generate = cellButton('studio-preview-cell-generate', 'Checking AI…')
  generate.disabled = true
  const status = cellStatus(connection)
  const loadReplay = cellButton('studio-preview-cell-replay-load', 'Load failure capture')
  const pasteReplay = cellButton('studio-preview-cell-replay-load', 'Paste failure capture')
  pasteReplay.disabled = navigator.clipboard?.readText === undefined
  const replayFailure = cellButton('studio-preview-cell-replay-load', 'Replay captured state')
  replayFailure.disabled = connection.runtimeFailure === undefined
  const replayFile = document.createElement('input')
  replayFile.accept = 'application/json,.json'
  replayFile.hidden = true
  replayFile.type = 'file'
  actions.append(
    apply,
    promote,
    fixtureName,
    capture,
    generate,
    loadReplay,
    pasteReplay,
    replayFailure,
    replayFile,
    status.element,
  )
  form.append(
    argumentControls.element,
    viewportControls.element,
    networkControls.element,
    schemeControls,
    actions,
  )
  connection.scenarioControls = form

  const sourceIdentity = JSON.stringify(scenarioModel?.sourceIdentity) ?? ''
  if (
    connection.journeyRecording !== undefined
    && connection.journeyRecording.sourceIdentity !== sourceIdentity
  ) {
    invalidatePreviewJourneyRecording(connection)
  }

  const viewport = document.createElement('div')
  viewport.className = 'studio-preview-cell-viewport'
  viewport.style.height = `${cell.environment.viewport.height}px`
  viewport.style.width = `${cell.environment.viewport.width}px`
  connection.iframe.style.height = '100%'
  connection.iframe.style.width = '100%'
  viewport.append(connection.iframe)
  observePreviewVisibility(frame, connection)

  const remount = async (
    configuration: Readonly<{
      args?: StudioJsonObject
      environment?: StudioCellEnvironment
      replay?: StudioRuntimeCaptureArtifact
    }>,
  ): Promise<void> => {
    Assert.input(connection.cellIdentity, 'Studio cell identity is unavailable for remounting.')
    // Debugger state belongs to one preview document. A replacement cannot resume that document's
    // pause or settle its journal root, so retain neither in the new cell.
    connection.debug = StudioDebugEvents.empty()
    const runtime = await StudioApiClient.reconfigureCell({
      ...connection.cellIdentity,
      ...configuration,
    })
    connection.cell = runtime.cell
    connection.cellIdentity = runtime.identity
    const previewInstanceId = crypto.randomUUID()
    await StudioApiClient.cellInstance({ ...runtime.identity, previewInstanceId })
    connection.previewInstanceId = previewInstanceId
    setPreviewSource(connection, StudioPreviewFrameUrl.create(previewUrl, previewInstanceId, window.location, true))
    renderCellPreview(frame, connection, previewUrl, manifest)
  }

  connection.reconfigureEnvironment = async environment => {
    await remount({ environment })
  }

  connection.reconfigureArguments = async args => {
    await remount({ args })
  }

  connection.replayRuntimeCapture = async rawCapture => {
    const currentEnvironment = connection.cell?.environment ?? cell.environment
    const configured = studioReplayConfiguration(rawCapture, currentEnvironment)
    connection.runtimeFailure = undefined
    await remount({
      environment: configured.environment,
      replay: configured.replay,
    })
  }

  loadReplay.addEventListener('click', () => replayFile.click())
  const replayText = async (text: string): Promise<void> => {
    Assert.input(scenarioModel, 'Studio scenario identity is unavailable.')
    const replay = StudioScenarioControls.replay(scenarioModel, JSON.parse(text))
    if (!replay.ok) {
      Errors.throwUserInput(replay.issues.join(' '))
    }
    await connection.replayRuntimeCapture?.(replay.value)
  }
  pasteReplay.addEventListener('click', () => {
    pasteReplay.disabled = true
    status.set('busy', 'Pasting failure capture…')
    void navigator.clipboard.readText().then(replayText).catch(error => {
      pasteReplay.disabled = false
      status.set('error', Errors.messageOf(error))
    })
  })
  replayFailure.addEventListener('click', () => {
    if (scenarioModel === undefined) {
      return
    }
    const replay = StudioScenarioControls.replay(scenarioModel)
    if (!replay.ok) {
      status.set('error', replay.issues.join(' '))
      return
    }
    replayFailure.disabled = true
    status.set('busy', 'Restoring captured state…')
    void connection.replayRuntimeCapture?.(replay.value).catch(error => {
      replayFailure.disabled = false
      status.set('error', Errors.messageOf(error))
    })
  })
  replayFile.addEventListener('change', () => {
    const file = replayFile.files?.[0]
    if (file === undefined) {
      return
    }
    loadReplay.disabled = true
    status.set('busy', 'Loading failure capture…')
    void file.text().then(replayText).catch(error => {
      loadReplay.disabled = false
      status.set('error', Errors.messageOf(error))
    })
  })

  form.addEventListener('submit', event => {
    event.preventDefault()
    if (connection.cellIdentity === undefined) {
      return
    }
    apply.disabled = true
    status.set('busy', 'Remounting…')
    void (async () => {
      try {
        const draft = StudioCellControls.readDraft(
          scenarioModel,
          argumentControls.read,
          networkControls.read,
          viewportControls.read,
        )
        if (!draft.ok) {
          Errors.throwUserInput(draft.issues.join(' '))
        }
        await remount({
          args: draft.value.arguments,
          environment: {
            network: draft.value.network,
            scheme: cell.environment.scheme,
            viewport: draft.value.viewport,
          },
        })
      } catch (error) {
        apply.disabled = false
        status.set('error', Errors.messageOf(error))
      }
    })()
  })
  promote.addEventListener('click', () => {
    if (scenarioModel === undefined) {
      return
    }
    const draft = StudioCellControls.readDraft(
      scenarioModel,
      argumentControls.read,
      networkControls.read,
      viewportControls.read,
    )
    if (!draft.ok) {
      status.set('error', draft.issues.join(' '))
      return
    }
    const action = StudioScenarioControls.saveArgumentsAction(scenarioModel, draft.value.arguments, crypto.randomUUID())
    if (!action.ok) {
      status.set('error', action.issues.join(' '))
      return
    }
    promote.disabled = true
    status.set('busy', 'Saving Tao scenario…')
    void applyConnectionSourceAction(connection, action.value).then(
      () => {
        status.set('busy', 'Saved; waiting for the compiled manifest…')
      },
      error => {
        promote.disabled = false
        status.set('error', Errors.messageOf(error))
      },
    )
  })
  if (scenario !== undefined) {
    void configureGenerationAvailability(generate)
  }
  generate.addEventListener('click', () => {
    if (scenario === undefined || connection.cellIdentity === undefined) {
      return
    }
    const name = fixtureName.value.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      status.set('error', 'Fixture name must be a Tao identifier.')
      return
    }
    const identity = fixtureSourceIdentity(connection, manifest, scenario)
    if (identity === undefined) {
      status.set('error', 'Fixture generation source identity is unavailable.')
      return
    }
    generate.disabled = true
    status.set('busy', 'Generating a realistic fixture…')
    const requestId = crypto.randomUUID()
    connection.generation = { phase: 'generating', requestId }
    void StudioApiClient.generateFixture(scenario.scenarioId).then(async result => {
      if (connection.generation?.requestId !== requestId) {
        return
      }
      if (result.status === 'failed') {
        connection.generation = undefined
        generate.disabled = false
        status.set('error', StudioFixtureGenerationFeedback.failure(result))
        return
      }
      const envelope = StudioFixtureProposal.sourceAction({
        fixtureName: name,
        identity,
        origin: 'generated',
        plan: result.fixture,
        requestId,
      })
      status.element.textContent = 'Validating canonical Tao source…'
      const proposal = await StudioApiClient.sourceActionProposal(envelope)
      const confirmed = await StudioDialog.confirm({
        confirmLabel: 'Save fixture',
        diff: proposal.diff,
        title: 'Save this generated Tao fixture?',
      })
      if (!confirmed) {
        connection.generation = undefined
        generate.disabled = false
        status.set('idle', 'Generated fixture was not saved.')
        return
      }
      connection.generation = { phase: 'saving', requestId }
      status.element.textContent = 'Saving generated state as Tao source…'
      await applyConnectionSourceAction(connection, envelope)
      if (connection.generation?.requestId === requestId) {
        connection.generation = undefined
        status.set('busy', 'Saved; waiting for the compiled manifest…')
      }
    }).catch(error => {
      if (connection.generation?.requestId !== requestId) {
        return
      }
      connection.generation = undefined
      generate.disabled = false
      status.set('error', Errors.messageOf(error))
    })
  })
  connection.captureFixture = fixtureName =>
    new Promise((resolve, reject) => {
      if (scenarioModel === undefined) {
        reject(new Errors.UnexpectedBehaviorError('Studio scenario identity is unavailable.'))
        return
      }
      const target = connection.iframe.contentWindow
      const requestId = crypto.randomUUID()
      const request = StudioScenarioControls.fixtureCapture(scenarioModel, fixtureName.trim(), requestId)
      if (!request.ok || target === null) {
        reject(
          request.ok
            ? new Errors.HostEnvironmentError('The active preview is not connected.')
            : new Errors.UserInputError(request.issues.join(' ')),
        )
        return
      }
      if (connection.capture !== undefined) {
        clearTimeout(connection.capture.timeout)
        connection.capture.reject(new Errors.UnexpectedBehaviorError('A newer fixture capture replaced this request.'))
      }
      const timeout = setTimeout(() => {
        if (connection.capture?.requestId !== requestId) {
          return
        }
        connection.capture = undefined
        reject(new Errors.HostEnvironmentError('Fixture capture timed out; retry after the preview is ready.'))
      }, 10_000)
      connection.capture = {
        fixtureName: request.value.fixtureName,
        identity: request.value.identity,
        reject,
        requestId,
        resolve,
        timeout,
      }
      target.postMessage(request.value.request, connection.origin)
    })
  capture.addEventListener('click', () => {
    capture.disabled = true
    status.set('busy', 'Capturing isolated provider state…')
    void connection.captureFixture?.(fixtureName.value).then(result => {
      capture.disabled = false
      status.set(
        'idle',
        result === 'saved'
          ? 'Saved; waiting for the compiled manifest…'
          : 'Captured fixture was not saved.',
      )
    }, error => {
      capture.disabled = false
      status.set('error', Errors.messageOf(error))
    })
  })

  frame.tabIndex = 0
  frame.setAttribute('aria-label', `${connection.scenarioLabel} preview`)
  frame.onclick = () => connection.activate?.()
  frame.onfocus = () => connection.activate?.()
  frame.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      connection.activate?.()
    }
  }
  frame.replaceChildren(label, viewport)
  connection.changed?.()
}
