import { Assert, Errors } from '@shared/core'
import { previewCompatibilitySignature } from '../../StudioPreviewCompatibility'
import type { StudioCellIdentity, StudioPreviewCell, StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import { StudioProtocol } from '../../StudioProtocol'
import {
  StudioApiClient,
  StudioApiError,
  type StudioCellRuntimeResponse,
  type StudioHandshake,
} from '../StudioApiClient'
import { StudioScenarioControls } from '../StudioScenarioControls'
import { invalidatePreviewJourneyRecording } from './StudioJourneyRecording'
import { StudioMatrixGrid } from './StudioMatrixGrid'
import { previewMatrixPlan, type StudioMatrixGroup, StudioMatrixLayout } from './StudioMatrixLayout'
import { StudioDrawCanvas, StudioMatrixSketches } from './StudioMatrixSketches'
import { StudioPreviewActivationGate } from './StudioPreviewActivationGate'
import { postInteractionMode, postPreviewRuntimeUpdate, postWholeAppPublicationUpdate } from './StudioPreviewBridge'
import { previewActivationToggle, renderCellPreview } from './StudioPreviewCellView'
import {
  disconnectPreviews,
  expectPreviewRevision,
  type StudioPreviewConnection,
  StudioPreviewFrameUrl,
  StudioPreviewPublication,
  StudioRetainedPreview,
} from './StudioPreviewConnection'
import { StudioReviewDom } from './StudioReviewDom'

function connectedCells(manifest: StudioPreviewManifestV2): readonly StudioPreviewCell[] {
  return manifest.cells
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
          handshake.studioSession?.activatedCellIds.includes(cell.cellId) ?? false,
          signal,
          true,
        )
      ),
    )
    for (const connection of connections) {
      connection.manifestCompatibilitySignature = compatibilitySignature
    }
    renderConnectionGrid(parent, manifest, connections, previewUrl)
    wireActivation(parent, connections, manifest, previewUrl, handshake)
    StudioMatrixSketches.render(
      parent,
      handshake.identity.project,
      handshake.sketchCatalog,
      StudioMatrixLayout.sketchSourceVersions(manifest),
    )
    StudioMatrixSketches.renderable(parent, StudioMatrixLayout.renderableViews(manifest, handshake.identity.project))
    return connections
  }
  const wholeApp = await connectWholeAppPreview(
    parent,
    previewUrl,
    origin,
    handshake,
    handshake.studioSession?.activatedCellIds.includes('whole-app') ?? false,
    signal,
    true,
  )
  wireActivation(parent, [wholeApp], manifest, previewUrl, handshake)
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

function renderWholeApp(parent: HTMLElement, connection: StudioPreviewConnection, appName: string): void {
  const existing = parent.querySelector<HTMLElement>(':scope > .studio-whole-app-preview')
  const card = existing ?? document.createElement('section')
  card.className = 'studio-preview-cell studio-whole-app-preview'
  card.dataset['cellId'] = 'whole-app'
  const label = card.querySelector<HTMLElement>(':scope > .studio-preview-cell-label')
    ?? document.createElement('header')
  label.className = 'studio-preview-cell-label'
  const name = document.createElement('span')
  name.textContent = `${appName} · whole app`
  label.replaceChildren(previewActivationToggle(connection), name)
  const viewport = card.querySelector<HTMLElement>(':scope > .studio-preview-cell-viewport')
    ?? document.createElement('div')
  viewport.className = 'studio-preview-cell-viewport'
  if (connection.startupPending) {
    viewport.replaceChildren()
  } else if (connection.activated) {
    if (!viewport.contains(connection.iframe)) {
      viewport.replaceChildren(connection.iframe)
    }
  } else {
    viewport.replaceChildren(previewActivationToggle(connection, 'activate'))
  }
  if (label.parentElement !== card) {
    card.append(label)
  }
  if (viewport.parentElement !== card) {
    card.append(viewport)
  }
  connection.frame = card
  if (existing === null) {
    StudioDrawCanvas.retain(parent, () => parent.replaceChildren(card))
  }
}

type StudioActivationState = {
  identity: string
  activatedCellIds: Set<string>
  connections: readonly StudioPreviewConnection[]
  context: {
    manifest: StudioPreviewManifestV2 | undefined
    previewUrl: string
    handshake: StudioHandshake
  }
  tail: Promise<void>
}

const activationStates = new WeakMap<HTMLElement, StudioActivationState>()
const maxActivationContextAttempts = 3

function releasePreviewInstance(previewInstanceId: string, wholeApp = false): () => void {
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    const release = wholeApp ? StudioApiClient.releasePreviewInstance : StudioApiClient.releaseCellInstance
    void release(previewInstanceId).catch(() => {})
  }
}

export function wireActivation(
  parent: HTMLElement,
  connections: readonly StudioPreviewConnection[],
  manifest: StudioPreviewManifestV2 | undefined,
  previewUrl: string,
  handshake: StudioHandshake,
): void {
  const identity = `${handshake.identity.project}\0${handshake.identity.appName}`
  let state = activationStates.get(parent)
  if (state === undefined || state.identity !== identity) {
    if (state !== undefined) {
      state.connections = []
    }
    state = {
      identity,
      activatedCellIds: new Set(
        handshake.studioSession?.activatedCellIds
          ?? connections.filter(connection => connection.activated).map(connection =>
            connection.cell?.cellId ?? 'whole-app'
          ),
      ),
      connections,
      context: { manifest, previewUrl, handshake },
      tail: Promise.resolve(),
    }
    activationStates.set(parent, state)
  } else {
    state.connections = connections
    state.context = { manifest, previewUrl, handshake }
    if (manifest !== undefined) {
      const available = new Set(connections.map(connection => connection.cell?.cellId ?? 'whole-app'))
      let pruned = false
      for (const id of state.activatedCellIds) {
        if (!available.has(id)) {
          state.activatedCellIds.delete(id)
          pruned = true
        }
      }
      if (pruned) {
        const activation = state
        const save = activation.tail.then(async () => {
          if (activationStates.get(parent) === activation) {
            await StudioApiClient.saveStudioSessionField('activatedCellIds', [...activation.activatedCellIds])
          }
        })
        activation.tail = save.catch(() => {})
      }
    }
  }
  const activation = state
  StudioPreviewActivationGate.attach(
    parent,
    handshake.compile,
    manifest,
    connections,
  )
  for (const connection of connections) {
    connection.toggleActivation = () => {
      const requested = activation.tail.then(async () => {
        const current = (): boolean =>
          activationStates.get(parent) === activation && activation.connections.includes(connection)
        if (!current()) {
          return
        }
        const id = connection.cell?.cellId ?? 'whole-app'
        const next = !activation.activatedCellIds.has(id)
        const deadline = Date.now() + 30_000
        let savedWithoutMount = false
        const pruneSavedActivation = async (): Promise<void> => {
          if (savedWithoutMount && activationStates.get(parent) === activation) {
            savedWithoutMount = false
            await StudioApiClient.saveStudioSessionField('activatedCellIds', [...activation.activatedCellIds])
          }
        }
        let releaseRegistered: (() => void) | undefined
        try {
          for (let attempt = 0; attempt < maxActivationContextAttempts; attempt++) {
            if (!current()) {
              await pruneSavedActivation()
              return
            }
            const context = activation.context
            const { manifest, previewUrl, handshake } = context
            const cell = connection.cell
            const generation = next
              ? await StudioPreviewActivationGate.wait(parent, deadline, () => activation.context.manifest)
              : StudioPreviewActivationGate.generation(parent)
            if (!current() || activation.context !== context || connection.cell !== cell) {
              continue
            }
            let previewInstanceId: string | undefined
            let cellIdentity: StudioCellIdentity | undefined
            releaseRegistered = undefined
            if (next) {
              previewInstanceId = crypto.randomUUID()
              if (cell === undefined) {
                await StudioApiClient.previewInstance({ previewInstanceId })
                releaseRegistered = releasePreviewInstance(previewInstanceId, true)
              } else {
                Assert(manifest, 'a preview manifest for an activated scenario')
                cellIdentity = {
                  appName: handshake.identity.appName,
                  cellId: cell.cellId,
                  cellRevision: cell.cellRevision,
                  compileRevision: manifest.compileRevision,
                  manifestRevision: manifest.manifestRevision,
                  project: handshake.identity.project,
                }
                try {
                  await StudioApiClient.cellInstance({ ...cellIdentity, previewInstanceId })
                } catch (error) {
                  // Publishing a pending design overlay may replace the context while
                  // registration is in flight. Restart with that context, never weaken
                  // the server's identity check or retry an unchanged stale request.
                  if (
                    error instanceof StudioApiError && error.status === 409
                    && (error.details?.['code'] === 'stale-manifest' || error.details?.['code'] === 'stale-compile')
                    && (activation.context !== context || connection.cell !== cell
                      || StudioPreviewActivationGate.generation(parent) !== generation)
                  ) {
                    continue
                  }
                  throw error
                }
                releaseRegistered = releasePreviewInstance(previewInstanceId)
              }
            }
            if (!current()) {
              releaseRegistered?.()
              await pruneSavedActivation()
              return
            }
            if (next && Date.now() > deadline) {
              Errors.throwHostEnvironment('The preview did not finish updating before activation timed out. Try again.')
            }
            if (
              activation.context !== context || connection.cell !== cell
              || StudioPreviewActivationGate.generation(parent) !== generation
            ) {
              releaseRegistered?.()
              continue
            }
            const activatedCellIds = new Set(activation.activatedCellIds)
            if (next) {
              activatedCellIds.add(id)
            } else {
              activatedCellIds.delete(id)
            }
            await StudioApiClient.saveStudioSessionField('activatedCellIds', [...activatedCellIds])
            savedWithoutMount = true
            if (!current()) {
              releaseRegistered?.()
              await pruneSavedActivation()
              return
            }
            if (next && Date.now() > deadline) {
              Errors.throwHostEnvironment('The preview did not finish updating before activation timed out. Try again.')
            }
            if (
              activation.context !== context || connection.cell !== cell
              || StudioPreviewActivationGate.generation(parent) !== generation
            ) {
              releaseRegistered?.()
              continue
            }
            activation.activatedCellIds = activatedCellIds
            savedWithoutMount = false
            connection.activated = next
            if (next) {
              connection.previewInstanceId = previewInstanceId!
              connection.releaseCellInstance = releaseRegistered
              if (cellIdentity !== undefined) {
                connection.cellIdentity = cellIdentity
                connection.expectedRevision = cellIdentity.compileRevision
              } else {
                connection.expectedRevision = manifest?.compileRevision
              }
              StudioPreviewPublication.navigating(connection)
              connection.iframe.src = StudioPreviewFrameUrl.create(
                previewUrl,
                connection.previewInstanceId,
                window.location,
                cell !== undefined,
              )
            } else {
              connection.startupPending = false
              connection.releaseCellInstance?.()
              connection.releaseCellInstance = undefined
              StudioPreviewPublication.cancel(connection)
              connection.appliedIdentity = undefined
              connection.iframe.src = 'about:blank'
              connection.iframe.remove()
            }
            StudioPreviewActivationGate.changed(connection)
            if (cell === undefined) {
              renderWholeApp(parent, connection, handshake.identity.appName)
              StudioDrawCanvas.ensure(parent)
            } else if (connection.frame !== undefined && manifest !== undefined) {
              renderCellPreview(connection.frame, connection, previewUrl, manifest)
            }
            return
          }
          Errors.throwHostEnvironment('The preview changed repeatedly while activation was in progress. Try again.')
        } catch (error) {
          releaseRegistered?.()
          await pruneSavedActivation()
          throw error
        }
      })
      activation.tail = requested.catch(() => {})
      return requested
    }
  }
}

const restoredStartupTails = new WeakMap<HTMLElement, Promise<void>>()

/** Restored cells keep their persisted activation while browser registration waits for a stable publication. */
export function startRestoredPreviews(
  parent: HTMLElement,
  connections: readonly StudioPreviewConnection[],
  signal?: AbortSignal,
): Promise<void> {
  const previous = restoredStartupTails.get(parent) ?? Promise.resolve()
  const task = previous.catch(() => {}).then(() => runRestoredPreviews(parent, connections, signal))
  restoredStartupTails.set(parent, task)
  return task
}

async function runRestoredPreviews(
  parent: HTMLElement,
  connections: readonly StudioPreviewConnection[],
  signal?: AbortSignal,
): Promise<void> {
  const activation = activationStates.get(parent)
  if (activation === undefined) {
    return
  }
  const deadline = Date.now() + 30_000
  const current = (connection: StudioPreviewConnection): boolean =>
    activationStates.get(parent) === activation
    && activation.connections.includes(connection)
    && connection.activated === true
    && connection.startupPending === true
  const start = async (connection: StudioPreviewConnection, initialGeneration?: number): Promise<void> => {
    if (!current(connection) || connection.startupStarting) {
      return
    }
    connection.startupStarting = true
    try {
      for (let attempt = 0; attempt < maxActivationContextAttempts; attempt++) {
        if (!current(connection)) {
          return
        }
        const context = activation.context
        const cell = connection.cell
        const generation = initialGeneration
          ?? await StudioPreviewActivationGate.wait(parent, deadline, () => activation.context.manifest, signal)
        initialGeneration = undefined
        if (!current(connection) || context !== activation.context || cell !== connection.cell) {
          continue
        }
        const previewInstanceId = crypto.randomUUID()
        let releaseRegistered: (() => void) | undefined
        try {
          if (cell === undefined) {
            await StudioApiClient.previewInstance({ previewInstanceId }, signal)
            releaseRegistered = releasePreviewInstance(previewInstanceId, true)
          } else {
            const identity = connection.cellIdentity
            Assert(identity, 'the current cell identity for a restored preview')
            await StudioApiClient.cellInstance({ ...identity, previewInstanceId }, signal)
            releaseRegistered = releasePreviewInstance(previewInstanceId)
          }
          if (signal?.aborted) {
            throw Errors.abortError('Tao Studio preview activation was cancelled.')
          }
          if (Date.now() > deadline) {
            Errors.throwHostEnvironment('The preview did not finish updating before activation timed out. Try again.')
          }
          if (
            !current(connection) || context !== activation.context || cell !== connection.cell
            || generation !== StudioPreviewActivationGate.generation(parent)
          ) {
            releaseRegistered?.()
            continue
          }
          connection.previewInstanceId = previewInstanceId
          connection.releaseCellInstance = releaseRegistered
          connection.expectedRevision = context.manifest?.compileRevision
          connection.startupPending = false
          connection.navigationPending = true
          connection.iframe.src = StudioPreviewFrameUrl.create(
            context.previewUrl,
            previewInstanceId,
            window.location,
            cell !== undefined,
          )
          if (cell === undefined) {
            renderWholeApp(parent, connection, context.handshake.identity.appName)
          } else if (connection.frame !== undefined && context.manifest !== undefined) {
            renderCellPreview(connection.frame, connection, context.previewUrl, context.manifest)
          }
          StudioPreviewActivationGate.changed(connection)
          return
        } catch (error) {
          releaseRegistered?.()
          if (
            error instanceof StudioApiError && error.status === 409
            && (error.details?.['code'] === 'stale-manifest' || error.details?.['code'] === 'stale-compile')
            && (context !== activation.context || cell !== connection.cell
              || generation !== StudioPreviewActivationGate.generation(parent))
          ) {
            continue
          }
          throw error
        }
      }
      Errors.throwHostEnvironment('The preview changed repeatedly while activation was in progress. Try again.')
    } finally {
      connection.startupStarting = false
    }
  }
  const pending = connections.filter(connection => current(connection) && !connection.startupStarting)
  if (pending.length > 0) {
    const generation = await StudioPreviewActivationGate.wait(
      parent,
      deadline,
      () => activation.context.manifest,
      signal,
    )
    await Promise.all(pending.map(connection => start(connection, generation)))
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
  activated: boolean,
  signal?: AbortSignal,
  deferActivated = false,
): Promise<StudioPreviewConnection> {
  const previewInstanceId = crypto.randomUUID()
  const startupPending = activated && deferActivated
  if (activated && !startupPending) {
    await StudioApiClient.previewInstance({ previewInstanceId }, signal)
  }
  const iframe = document.createElement('iframe')
  if (activated && !startupPending) {
    iframe.src = StudioPreviewFrameUrl.create(previewUrl, previewInstanceId, window.location)
  }
  iframe.title = `${handshake.identity.appName} live preview`
  const connection: StudioPreviewConnection = {
    activated,
    expectedRevision: handshake.previewManifest?.compileRevision,
    iframe,
    interactionMode: 'run',
    navigationPending: true,
    origin,
    previewInstanceId,
    ...(activated && !startupPending ? { releaseCellInstance: releasePreviewInstance(previewInstanceId, true) } : {}),
    startupPending,
  }
  watchCellPreviewLoad(connection, handshake)
  renderWholeApp(parent, connection, handshake.identity.appName)
  StudioDrawCanvas.ensure(parent)
  return connection
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
  activated: boolean,
  signal?: AbortSignal,
  deferActivated = false,
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
  const startupPending = activated && deferActivated
  if (activated && !startupPending) {
    await StudioApiClient.cellInstance({ ...cellIdentity, previewInstanceId }, signal)
  }
  const iframe = document.createElement('iframe')
  if (activated && !startupPending) {
    iframe.src = StudioPreviewFrameUrl.create(previewUrl, previewInstanceId, window.location, true)
  }
  iframe.title = `${cell.scenarioId} live preview`
  const connection: StudioPreviewConnection = {
    cell,
    cellIdentity,
    activated,
    expectedRevision: manifest.compileRevision,
    iframe,
    navigationPending: true,
    interactionMode: 'run',
    origin,
    previewInstanceId,
    startupPending,
    ...(activated && !startupPending ? { releaseCellInstance: releasePreviewInstance(previewInstanceId) } : {}),
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
    if (wholeApp !== undefined) {
      wholeApp.expectedRevision = manifest.compileRevision
    }
    renderWholeApp(parent, wholeApp!, handshake.identity.appName)
    StudioDrawCanvas.ensure(parent)
    wireActivation(parent, previews, manifest, previewUrl, handshake)
    if (wholeApp !== undefined) {
      wholeApp.manifestCompatibilitySignature = compatibilitySignature
      if (resetRetained) {
        if (!publicationChecks) {
          wholeApp.iframe.addEventListener('load', () => postWholeAppPublicationUpdate(wholeApp, manifest, handshake), {
            once: true,
          })
        }
        if (wholeApp.activated && !wholeApp.startupPending) {
          wholeApp.iframe.src = wholeApp.iframe.src
        }
      } else if (!publicationChecks && wholeApp.activated && !wholeApp.startupPending) {
        postWholeAppPublicationUpdate(wholeApp, manifest, handshake)
      }
    }
    return
  }
  if (plan === 'create-whole-app') {
    disconnectPreviews(previews, 'This app no longer declares scenarios, so its cells were replaced.')
    const next = await connectWholeAppPreview(parent, previewUrl, origin, handshake, false)
    next.manifestCompatibilitySignature = compatibilitySignature
    previews.splice(0, previews.length, next)
    wireActivation(parent, previews, manifest, previewUrl, handshake)
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
    const pendingActivation = activationStates.get(parent)
    const connection = await connectCellPreview(
      previewUrl,
      origin,
      handshake,
      manifest,
      cell,
      pendingActivation?.activatedCellIds.has(cell.cellId) ?? false,
      undefined,
      true,
    )
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
  for (const preview of nextConnections) {
    if (preview.activated && !preview.startupPending) {
      continue
    }
    const cell = manifest.cells.find(candidate => candidate.cellId === preview.cell!.cellId)!
    preview.cell = cell
    preview.cellIdentity = {
      appName: handshake.identity.appName,
      cellId: cell.cellId,
      cellRevision: cell.cellRevision,
      compileRevision: manifest.compileRevision,
      manifestRevision: manifest.manifestRevision,
      project: handshake.identity.project,
    }
  }
  renderConnectionGrid(parent, manifest, nextConnections, previewUrl)
  wireActivation(parent, nextConnections, manifest, previewUrl, handshake)
  StudioMatrixSketches.rerender(parent, StudioMatrixLayout.sketchSourceVersions(manifest))
  StudioMatrixSketches.renderable(parent, StudioMatrixLayout.renderableViews(manifest, handshake.identity.project))

  await Promise.all(nextConnections.map(async preview => {
    if (!preview.activated || preview.startupPending) {
      return
    }
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
      if (preview.activated && !preview.startupPending && previousByCell.has(preview.cell!.cellId)) {
        StudioPreviewPublication.navigating(preview)
        preview.iframe.src = preview.iframe.src
      }
    }
  }
}
