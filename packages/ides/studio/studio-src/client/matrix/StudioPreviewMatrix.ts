import { Assert, Errors } from '@shared/core'
import { previewCompatibilitySignature } from '../../StudioPreviewCompatibility'
import type { StudioCellIdentity, StudioPreviewCell, StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import { StudioProtocol } from '../../StudioProtocol'
import { StudioApiClient, type StudioCellRuntimeResponse, type StudioHandshake } from '../StudioApiClient'
import { StudioScenarioControls } from '../StudioScenarioControls'
import { invalidatePreviewJourneyRecording } from './StudioJourneyRecording'
import { StudioMatrixGrid } from './StudioMatrixGrid'
import { previewMatrixPlan, type StudioMatrixGroup, StudioMatrixLayout } from './StudioMatrixLayout'
import { StudioDrawCanvas, StudioMatrixSketches } from './StudioMatrixSketches'
import { postInteractionMode, postPreviewRuntimeUpdate, postWholeAppPublicationUpdate } from './StudioPreviewBridge'
import { renderCellPreview } from './StudioPreviewCellView'
import {
  disconnectPreviews,
  expectPreviewRevision,
  type StudioPreviewConnection,
  StudioPreviewFrameUrl,
  StudioPreviewPublication,
  StudioRetainedPreview,
} from './StudioPreviewConnection'
import { StudioReviewDom } from './StudioReviewDom'

/**
 * Latency experiment: `?taoStudioPreviews=first` on the Studio page connects only the first scenario's
 * preview, so each save reaches one iframe instead of every cell.
 */
function connectedCells(manifest: StudioPreviewManifestV2): readonly StudioPreviewCell[] {
  const firstOnly = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('taoStudioPreviews') === 'first'
  return firstOnly ? manifest.cells.slice(0, 1) : manifest.cells
}

export async function connectPreviews(
  parent: HTMLElement,
  previewUrl: string | undefined,
  handshake: StudioHandshake,
  signal?: AbortSignal,
): Promise<StudioPreviewConnection[]> {
  if (previewUrl === undefined) {
    StudioMatrixSketches.render(
      parent,
      handshake.identity.project,
      handshake.sketchCatalog,
      handshake.previewManifest === undefined
        ? undefined
        : StudioMatrixLayout.sketchSourceVersions(handshake.previewManifest),
    )
    return []
  }
  const origin = StudioProtocol.messageOrigin(previewUrl)
  Assert.input(origin, 'Tao Studio preview URL must be an absolute HTTP or HTTPS URL.')
  const manifest = handshake.previewManifest
  if (manifest !== undefined && manifest.cells.length > 0) {
    const compatibilitySignature = previewCompatibilitySignature(manifest)
    const connections = await Promise.all(
      connectedCells(manifest).map(cell =>
        connectCellPreview(
          previewUrl,
          origin,
          handshake,
          manifest,
          cell,
          signal,
        )
      ),
    )
    for (const connection of connections) {
      connection.manifestCompatibilitySignature = compatibilitySignature
    }
    renderConnectionGrid(parent, manifest, connections, previewUrl)
    StudioMatrixSketches.render(
      parent,
      handshake.identity.project,
      handshake.sketchCatalog,
      StudioMatrixLayout.sketchSourceVersions(manifest),
    )
    StudioMatrixSketches.renderable(parent, StudioMatrixLayout.renderableViews(manifest, handshake.identity.project))
    return connections
  }
  const wholeApp = await connectWholeAppPreview(parent, previewUrl, origin, handshake, signal)
  if (manifest !== undefined) {
    wholeApp.manifestCompatibilitySignature = previewCompatibilitySignature(manifest)
  }
  StudioMatrixSketches.render(
    parent,
    handshake.identity.project,
    handshake.sketchCatalog,
    handshake.previewManifest === undefined
      ? undefined
      : StudioMatrixLayout.sketchSourceVersions(handshake.previewManifest),
  )
  if (manifest !== undefined) {
    StudioMatrixSketches.renderable(parent, StudioMatrixLayout.renderableViews(manifest, handshake.identity.project))
  }
  return [wholeApp]
}

/** Lays the connections out as scenario-group rows and stamps the canvas with the review manifest marker. */
function renderConnectionGrid(
  parent: HTMLElement,
  manifest: StudioPreviewManifestV2,
  connections: readonly StudioPreviewConnection[],
  previewUrl: string,
): void {
  StudioMatrixGrid.reconcile(parent, connectionGroups(manifest, connections), (frame, connection) => {
    connection.frame = frame
    renderCellPreview(frame, connection, previewUrl, manifest)
  })
  const canvas = parent.querySelector<HTMLElement>(':scope > .studio-preview-grid')
  if (canvas !== null) {
    canvas.dataset['taoReviewManifest'] = StudioReviewDom.manifest(manifest)
  }
}

/**
 * connectWholeAppPreview shows the running app in one frame. It is the preview for an app that declares no
 * scenarios, so there are no cells to lay out.
 */
async function connectWholeAppPreview(
  parent: HTMLElement,
  previewUrl: string,
  origin: string,
  handshake: StudioHandshake,
  signal?: AbortSignal,
): Promise<StudioPreviewConnection> {
  const previewInstanceId = crypto.randomUUID()
  await StudioApiClient.previewInstance({ previewInstanceId }, signal)
  const iframe = document.createElement('iframe')
  iframe.src = StudioPreviewFrameUrl.create(previewUrl, previewInstanceId, window.location)
  iframe.title = `${handshake.identity.appName} live preview`
  StudioDrawCanvas.retain(parent, () => parent.replaceChildren(iframe))
  StudioDrawCanvas.ensure(parent)
  return { iframe, interactionMode: 'run', origin, previewInstanceId }
}

function connectionGroups(
  manifest: StudioPreviewManifestV2,
  connections: readonly StudioPreviewConnection[],
): readonly StudioMatrixGroup<StudioPreviewConnection>[] {
  const connectionsByCell = new Map(
    connections.flatMap(connection =>
      connection.cell === undefined ? [] : [[connection.cell.cellId, connection] as const]
    ),
  )
  const subjects = new Map(manifest.subjects.map(subject => [subject.subjectId, subject]))
  return StudioMatrixLayout.groups(manifest).map(group => ({
    cells: group.cellIds.flatMap(cellId => {
      const connection = connectionsByCell.get(cellId)
      return connection === undefined ? [] : [{ id: cellId, item: connection }]
    }),
    id: group.id,
    label: group.label,
    ...(() => {
      const subjectView = StudioMatrixLayout.subjectView(manifest, group.id)
      const subjectViewId = StudioMatrixLayout.subjectViewId(manifest, group.id)
      return subjectView === undefined || subjectViewId === undefined ? {} : { subjectView, subjectViewId }
    })(),
    ...(() => {
      if (group.label !== 'sketch') {
        return {}
      }
      const scenarios = manifest.scenarios.filter(scenario =>
        StudioScenarioControls.groupId(scenario.source.path, scenario.group) === group.id
      )
      const viewNames = new Set(scenarios.flatMap(scenario => {
        const subject = subjects.get(scenario.subjectId)
        return subject?.kind === 'view' ? [subject.viewName] : []
      }))
      const sketchView = viewNames.size === 1 ? [...viewNames][0] : undefined
      const sourceVersions = new Set(scenarios.flatMap(scenario => {
        const sourceVersion = manifest.sourceVersions[scenario.source.path]
        return sourceVersion === undefined ? [] : [sourceVersion]
      }))
      const sketchSourceVersion = sourceVersions.size === 1 ? [...sourceVersions][0] : undefined
      const sourcePaths = new Set(scenarios.map(scenario => scenario.source.path))
      const sketchSourcePath = sourcePaths.size === 1 ? [...sourcePaths][0] : undefined
      return {
        ...(sketchSourcePath === undefined ? {} : { sketchSourcePath }),
        ...(sketchSourceVersion === undefined ? {} : { sketchSourceVersion }),
        ...(sketchView === undefined ? {} : { sketchView }),
      }
    })(),
  }))
}

async function connectCellPreview(
  previewUrl: string,
  origin: string,
  handshake: StudioHandshake,
  manifest: StudioPreviewManifestV2,
  cell: StudioPreviewCell,
  signal?: AbortSignal,
): Promise<StudioPreviewConnection> {
  const previewInstanceId = crypto.randomUUID()
  const cellIdentity: StudioCellIdentity = {
    appName: handshake.identity.appName,
    cellId: cell.cellId,
    cellRevision: cell.cellRevision,
    compileRevision: manifest.compileRevision,
    manifestRevision: manifest.manifestRevision,
    project: handshake.identity.project,
  }
  await StudioApiClient.cellInstance({ ...cellIdentity, previewInstanceId }, signal)
  const iframe = document.createElement('iframe')
  iframe.src = StudioPreviewFrameUrl.create(previewUrl, previewInstanceId, window.location, true)
  iframe.title = `${cell.scenarioId} live preview`
  const connection: StudioPreviewConnection = {
    cell,
    cellIdentity,
    expectedRevision: manifest.compileRevision,
    iframe,
    navigationPending: true,
    interactionMode: 'run',
    origin,
    previewInstanceId,
  }
  watchCellPreviewLoad(connection, handshake)
  return connection
}

/** Every cell, including those created for the first manifest, returns to the normal retry budget on load. */
export function watchCellPreviewLoad(connection: StudioPreviewConnection, handshake: StudioHandshake): void {
  connection.iframe.addEventListener('load', () => {
    StudioPreviewPublication.loaded(connection)
    invalidatePreviewJourneyRecording(connection)
    postInteractionMode(connection, handshake)
  })
}

export async function refreshCellPreviews(
  parent: HTMLElement,
  previews: StudioPreviewConnection[],
  previewUrl: string,
  manifest: StudioPreviewManifestV2,
  handshake: StudioHandshake,
): Promise<void> {
  const origin = StudioProtocol.messageOrigin(previewUrl)
  Assert.input(origin, 'Tao Studio preview URL must be an absolute HTTP or HTTPS URL.')
  const publicationChecks = new URL(previewUrl).searchParams.get('taoStudioPublication') !== 'off'
  const compatibilitySignature = previewCompatibilitySignature(manifest)
  const resetRetained = previews[0]?.manifestCompatibilitySignature !== undefined
    && previews[0].manifestCompatibilitySignature !== compatibilitySignature
  const wholeApp = previews.find(preview => preview.cell === undefined)
  const plan = previewMatrixPlan(manifest.cells.length, wholeApp !== undefined)
  if (plan === 'keep-whole-app') {
    if (!parent.contains(wholeApp!.iframe)) {
      StudioDrawCanvas.retain(parent, () => parent.replaceChildren(wholeApp!.iframe))
    }
    StudioDrawCanvas.ensure(parent)
    if (wholeApp !== undefined) {
      wholeApp.manifestCompatibilitySignature = compatibilitySignature
      if (resetRetained) {
        if (!publicationChecks) {
          wholeApp.iframe.addEventListener('load', () => postWholeAppPublicationUpdate(wholeApp, manifest, handshake), {
            once: true,
          })
        }
        wholeApp.iframe.src = wholeApp.iframe.src
      } else if (!publicationChecks) {
        postWholeAppPublicationUpdate(wholeApp, manifest, handshake)
      }
    }
    return
  }
  if (plan === 'create-whole-app') {
    disconnectPreviews(previews, 'This app no longer declares scenarios, so its cells were replaced.')
    const next = await connectWholeAppPreview(parent, previewUrl, origin, handshake)
    next.manifestCompatibilitySignature = compatibilitySignature
    previews.splice(0, previews.length, next)
    return
  }
  const previousByCell = new Map(
    previews.flatMap(preview => preview.cell === undefined ? [] : [[preview.cell.cellId, preview] as const]),
  )
  const interactionMode = previews[0]?.interactionMode ?? 'run'
  const setInteractionMode = previews[0]?.setInteractionMode
  const cells = connectedCells(manifest)
  const nextConnections = await Promise.all(cells.map(async cell => {
    const previous = previousByCell.get(cell.cellId)
    if (previous !== undefined) {
      return previous
    }
    const connection = await connectCellPreview(previewUrl, origin, handshake, manifest, cell)
    connection.interactionMode = interactionMode
    connection.setInteractionMode = setInteractionMode
    return connection
  }))
  const nextIds = new Set(cells.map(cell => cell.cellId))
  for (const preview of previews) {
    if (preview.cell !== undefined && nextIds.has(preview.cell.cellId)) {
      continue
    }
    disconnectPreviews([preview], 'The preview cell was removed before live data arrived.')
  }
  previews.splice(0, previews.length, ...nextConnections)
  for (const preview of nextConnections) {
    preview.manifestCompatibilitySignature = compatibilitySignature
  }
  renderConnectionGrid(parent, manifest, nextConnections, previewUrl)
  StudioMatrixSketches.rerender(parent, StudioMatrixLayout.sketchSourceVersions(manifest))
  StudioMatrixSketches.renderable(parent, StudioMatrixLayout.renderableViews(manifest, handshake.identity.project))

  await Promise.all(nextConnections.map(async preview => {
    const cell = manifest.cells.find(candidate => candidate.cellId === preview.cell!.cellId)!
    if (!previousByCell.has(cell.cellId)) {
      return
    }
    const identities = StudioRetainedPreview.registrationIdentities(manifest, cell, preview.cellIdentity)
    const pendingIdentity = identities[0]!
    if (preview.generation?.phase === 'generating') {
      preview.generation = undefined
      preview.generationNotice = 'The Tao source changed while generation was running; its result was ignored.'
    }
    preview.cellIdentity = pendingIdentity
    preview.expectedRevision = manifest.compileRevision
    const refresh = async (): Promise<void> => {
      const runtime = await StudioRetainedPreview.register<StudioCellRuntimeResponse>(
        identities,
        preview.previewInstanceId,
        async identity => await StudioApiClient.cellInstance(identity) as StudioCellRuntimeResponse,
      )
      if (preview.cellIdentity !== pendingIdentity) {
        return
      }
      if (preview.capture !== undefined) {
        clearTimeout(preview.capture.timeout)
        preview.capture = undefined
      }
      if (preview.runtimeCaptureRequest !== undefined) {
        clearTimeout(preview.runtimeCaptureRequest.timeout)
        preview.runtimeCaptureRequest.reject(
          new Errors.UnexpectedBehaviorError('The preview remounted before live data arrived.'),
        )
        preview.runtimeCaptureRequest = undefined
      }
      preview.cell = runtime.cell
      preview.cellIdentity = runtime.identity
      preview.iframe.title = `${runtime.cell.scenarioId} live preview`
      expectPreviewRevision(preview, runtime.identity.compileRevision)
      postPreviewRuntimeUpdate(preview, runtime, publicationChecks ? undefined : manifest.sourceVersions)
      if (!publicationChecks && resetRetained) {
        preview.iframe.addEventListener(
          'load',
          () => postPreviewRuntimeUpdate(preview, runtime, manifest.sourceVersions),
          { once: true },
        )
      }
      if (publicationChecks) {
        StudioPreviewPublication.expect(preview, runtime.identity)
      }
      postInteractionMode(preview, handshake)
      if (preview.frame !== undefined) {
        renderCellPreview(preview.frame, preview, previewUrl, manifest)
      }
    }
    preview.refresh = (preview.refresh ?? Promise.resolve()).catch(() => {}).then(refresh)
    await preview.refresh
  }))
  if (resetRetained) {
    // A scenario contract change invalidates all browser interaction state. Metro's ordinary
    // compatible refresh keeps the iframe realm; only this structural change reloads it.
    for (const preview of nextConnections) {
      if (previousByCell.has(preview.cell!.cellId)) {
        StudioPreviewPublication.navigating(preview)
        preview.iframe.src = preview.iframe.src
      }
    }
  }
}
