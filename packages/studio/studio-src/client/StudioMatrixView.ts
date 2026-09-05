import { Assert, Errors, Json } from '@shared/core'
import { EditorView } from 'codemirror'
import type { StudioDraftFile } from '../StudioDraftSync'
import { StudioInspector, type StudioInspectorSelection } from '../StudioInspector'
import { cellIdentity } from '../StudioPreviewCell'
import type {
  StudioCellEnvironment,
  StudioCellIdentity,
  StudioParameterSchema,
  StudioPreviewCell,
  StudioPreviewManifestV2,
} from '../StudioPreviewManifest'
import type {
  StudioSketchFlowActionRequest,
  StudioSketchSnapRequest,
  StudioSketchSnapUndoRequest,
  StudioSketchUnsnapRequest,
} from '../StudioProjectSession'
import {
  type StudioFixturePlan,
  type StudioFixtureValue,
  type StudioJsonObject,
  type StudioJsonValue,
  type StudioPreviewIdentity,
  type StudioPreviewJourneyRecordingStateMessage,
  type StudioPreviewJourneyStepRecordedMessage,
  type StudioPreviewRuntimeUpdateMessage,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioRecordedJourneyStep,
  type StudioRuntimeCaptureArtifact,
  type StudioSourceActionEnvelope,
  type StudioSourceActionIdentity,
} from '../StudioProtocol'
import type { StudioSketch, StudioSketchCatalogAction, StudioSketchCatalogSnapshot } from '../StudioSketchCatalog'
import {
  StudioApiClient,
  StudioApiError,
  StudioApiRoutes,
  type StudioCellRuntimeResponse,
  type StudioHandshake,
} from './StudioApiClient'
import { StudioDialog } from './StudioDialog'
import { absoluteSourcePath, projectRelativePath, StudioSourceNavigation } from './StudioEditor'
import {
  type StudioScenarioControlModel,
  StudioScenarioControls,
  type StudioScenarioDraft,
  type StudioScenarioResult,
} from './StudioScenarioControls'
import {
  type MountedStudioSketchView,
  type StudioSketchRectChange,
  StudioSketchView,
  type StudioSketchViewFlowActionRequest,
} from './StudioSketchView'

type StudioMatrixCell<Item> = {
  id: string
  item: Item
}

type StudioMatrixGroup<Item> = {
  cells: readonly StudioMatrixCell<Item>[]
  id: string
  label: string
  sketchSourceVersion?: string
  sketchView?: string
  /** The one view every scenario in the group focuses, when the group is a focused-view group. */
  subjectView?: string
}

export type StudioMatrixGroupLayout = {
  cellIds: readonly string[]
  id: string
  label: string
}

export const StudioMatrixLayout = {
  groups(manifest: Pick<StudioPreviewManifestV2, 'cells' | 'scenarios'>): readonly StudioMatrixGroupLayout[] {
    const cellsByScenario = new Map<string, StudioPreviewCell[]>()
    for (const cell of manifest.cells) {
      const cells = cellsByScenario.get(cell.scenarioId) ?? []
      cells.push(cell)
      cellsByScenario.set(cell.scenarioId, cells)
    }
    const groups = new Map<string, { cellIds: string[]; id: string; label: string }>()
    for (const scenario of manifest.scenarios) {
      const id = StudioScenarioControls.groupId(scenario.source.path, scenario.group)
      const group = groups.get(id) ?? { cellIds: [], id, label: scenario.group }
      group.cellIds.push(...(cellsByScenario.get(scenario.scenarioId) ?? []).map(cell => cell.cellId))
      groups.set(id, group)
    }
    return [...groups.values()]
  },
  /** subjectView names the view a scenario group focuses when every entry renders that same view. */
  subjectView(
    manifest: Pick<StudioPreviewManifestV2, 'scenarios' | 'subjects'>,
    groupId: string,
  ): string | undefined {
    const subjects = new Map(manifest.subjects.map(subject => [subject.subjectId, subject]))
    const viewNames = new Set(
      manifest.scenarios
        .filter(scenario => StudioScenarioControls.groupId(scenario.source.path, scenario.group) === groupId)
        .map(scenario => {
          const subject = subjects.get(scenario.subjectId)
          return subject?.kind === 'view' ? subject.viewName : undefined
        }),
    )
    return viewNames.size === 1 ? [...viewNames][0] : undefined
  },
  /** focusable says whether canvas mode can focus a view: some group renders that view alone. */
  focusable(groups: readonly Pick<StudioMatrixGroup<unknown>, 'subjectView'>[], viewName: string): boolean {
    return groups.some(group => group.subjectView === viewName)
  },
  reconcile(previous: readonly string[], next: readonly string[]): {
    added: readonly string[]
    removed: readonly string[]
    retained: readonly string[]
  } {
    const before = new Set(previous)
    const after = new Set(next)
    return {
      added: next.filter(id => !before.has(id)),
      removed: previous.filter(id => !after.has(id)),
      retained: next.filter(id => before.has(id)),
    }
  },
} as const

export const StudioPreviewFrameUrl = {
  create(
    previewUrl: string,
    previewInstanceId: string,
    studioLocation: Pick<Location, 'origin' | 'pathname'>,
    cell = false,
  ): string {
    const url = new URL(previewUrl)
    if (cell) {
      url.searchParams.set('taoStudioCell', '1')
    }
    url.searchParams.set('taoStudioParentOrigin', studioLocation.origin)
    url.searchParams.set('taoStudioPreviewInstanceId', previewInstanceId)
    const sessionId = StudioApiRoutes.currentSessionId(studioLocation.pathname)
    if (sessionId !== undefined) {
      url.searchParams.set('taoStudioSessionId', sessionId)
    }
    return url.toString()
  },
} as const

export const StudioRetainedPreview = {
  registrationIdentities(
    manifest: StudioPreviewManifestV2,
    cell: StudioPreviewCell,
    previous: StudioCellIdentity | undefined,
  ): readonly StudioCellIdentity[] {
    const base = cellIdentity(manifest, cell)
    if (previous === undefined || previous.cellRevision <= base.cellRevision) {
      return [base]
    }
    return [{ ...base, cellRevision: previous.cellRevision }, base]
  },
  async register<Result>(
    identities: readonly StudioCellIdentity[],
    previewInstanceId: string,
    request: (identity: StudioCellIdentity & { previewInstanceId: string }) => Promise<Result>,
  ): Promise<Result> {
    for (const [index, identity] of identities.entries()) {
      try {
        return await request({ ...identity, previewInstanceId })
      } catch (error) {
        if (
          index === identities.length - 1
          || !(error instanceof StudioApiError)
          || error.status !== 409
        ) {
          throw error
        }
      }
    }
    Errors.throwUnexpected('Studio retained preview has no registration identity.')
  },
} as const

/** Keyed DOM host for scenario-group rows and their left-to-right preview cells. */
export const StudioMatrixView = {
  render<Item>(
    parent: HTMLElement,
    groups: readonly StudioMatrixGroup<Item>[],
    render: (frame: HTMLElement, item: Item) => void,
  ): void {
    reconcileMatrix(parent, groups, render)
  },
  reconcile: reconcileMatrix,
  renderSketches: renderMatrixSketches,
  /** focusView enters or leaves canvas mode for one view; `exit` runs when the bar's Back is pressed. */
  focusView: focusCanvasView,
  /** focusedView reports the view canvas mode currently shows alone, if any. */
  focusedView(parent: HTMLElement): string | undefined {
    return canvasFocus.get(parent)
  },
} as const

export type StudioReviewCellMetadata = Readonly<{
  environment: string
  group: string
  key: string
  label: string
  renderInputs: string
}>

function canonicalReviewJson(value: unknown): string {
  const normalize = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(normalize)
      : input !== null && typeof input === 'object'
      ? Object.fromEntries(
        Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(
          ([key, entry]) => [key, normalize(entry)],
        ),
      )
      : input
  return JSON.stringify(normalize(value))
}

/** Stable browser markers let review tooling capture cells without understanding Studio internals. */
export const StudioReviewDom = {
  appliedReady(journeyReplayStatus: StudioPreviewConnection['journeyReplayStatus']): boolean {
    return journeyReplayStatus === undefined || journeyReplayStatus === 'settled'
  },
  cell(
    manifest: StudioPreviewManifestV2,
    cell: StudioPreviewCell,
  ): StudioReviewCellMetadata | undefined {
    const scenario = manifest.scenarios.find(candidate => candidate.scenarioId === cell.scenarioId)
    if (scenario === undefined) {
      return undefined
    }
    const sourcePath = projectRelativePath(manifest.project.root, scenario.source.path)
    if (sourcePath === undefined) {
      return undefined
    }
    const environment = canonicalReviewJson({
      network: cell.environment.network,
      scheme: cell.environment.scheme,
      viewport: cell.environment.viewport,
    })
    const renderInputs = canonicalReviewJson({
      arguments: cell.args,
      fixtureId: scenario.fixtureId ?? null,
      prepare: scenario.prepare,
      stateLayers: cell.stateLayers,
      steps: scenario.steps ?? [],
    })
    return {
      environment,
      group: scenario.group,
      key: JSON.stringify([sourcePath, scenario.group, scenario.label, renderInputs, environment]),
      label: scenario.label,
      renderInputs,
    }
  },
  manifest(manifest: StudioPreviewManifestV2): string {
    const sourceVersions = Object.fromEntries(
      Object.entries(manifest.sourceVersions)
        .flatMap(([path, version]) => {
          const relative = projectRelativePath(manifest.project.root, path)
          return relative === undefined ? [] : [[relative, version] as const]
        })
        .sort(([left], [right]) => left.localeCompare(right)),
    )
    return JSON.stringify({
      appName: manifest.project.appName,
      compileRevision: manifest.compileRevision,
      entryPath: projectRelativePath(manifest.project.root, manifest.project.entryPath)
        ?? manifest.project.entryPath,
      manifestRevision: manifest.manifestRevision,
      sourceVersions,
    })
  },
  status(frame: HTMLElement, status: 'failed' | 'pending' | 'ready', error?: string): void {
    frame.dataset['taoReviewStatus'] = status
    if (error === undefined) {
      delete frame.dataset['taoReviewError']
    } else {
      frame.dataset['taoReviewError'] = error
    }
  },
} as const

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
      && preview.suspended !== true
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

const mountedSketches = new WeakMap<HTMLElement, MountedMatrixSketches>()

type MountedMatrixSketches = {
  catalog: StudioSketchCatalogSnapshot
  mounts: Map<HTMLElement, MountedStudioSketchView>
  mutationLane: StudioSketchMutationLane
  project: string
}

export type StudioSketchSnapMutationState = {
  catalog: StudioSketchCatalogSnapshot
  mutationLane: StudioSketchMutationLane
}

export const StudioSketchSnapRequests = {
  flow(
    request: StudioSketchViewFlowActionRequest,
    expectedCatalogRevision: number,
    requestId: string,
  ): StudioSketchFlowActionRequest {
    return { ...request, expectedCatalogRevision, requestId }
  },
  snap(
    request: Readonly<{
      checkpointId: string
      confirmedProposalVersion?: string
      rectIds: readonly string[]
      sketchId: string
      sourceVersion: string
    }>,
    expectedCatalogRevision: number,
    requestId: string,
  ): StudioSketchSnapRequest {
    return { ...request, expectedCatalogRevision, requestId }
  },
  undo(
    request: Readonly<{ checkpointId: string; sourceVersion: string }>,
    expectedCatalogRevision: number,
    requestId: string,
  ): StudioSketchSnapUndoRequest {
    return { ...request, expectedCatalogRevision, requestId }
  },
  unsnap(
    request: Readonly<{
      checkpointId: string
      rectIds: readonly string[]
      sketchId: string
      sourceVersion: string
    }>,
    expectedCatalogRevision: number,
    requestId: string,
  ): StudioSketchUnsnapRequest {
    return { ...request, expectedCatalogRevision, requestId }
  },
} as const

function renderMatrixSketches(
  parent: HTMLElement,
  project: string,
  catalog: StudioSketchCatalogSnapshot,
): void {
  const state = mountedSketches.get(parent) ?? {
    catalog,
    mounts: new Map(),
    mutationLane: new StudioSketchMutationLane(),
    project,
  }
  state.catalog = catalog
  state.project = project
  mountedSketches.set(parent, state)
  const hosts = [...parent.querySelectorAll<HTMLElement>('[data-tao-studio-sketch-host]')]
  for (const [host, mount] of state.mounts) {
    if (!hosts.includes(host)) {
      mount.dispose()
      state.mounts.delete(host)
    }
  }
  const assignments = new Map<HTMLElement, StudioSketch[]>()
  const matched = new Set<string>()
  for (const host of hosts) {
    const view = host.dataset['taoStudioSketchView']
    const sketches = catalog.sketches.filter(sketch => sketch.view === view)
    sketches.forEach(sketch => matched.add(sketch.id))
    assignments.set(host, sketches)
  }
  const fallback = hosts[0]
  if (fallback !== undefined) {
    assignments.set(fallback, [
      ...(assignments.get(fallback) ?? []),
      ...catalog.sketches.filter(sketch => !matched.has(sketch.id)),
    ])
  }
  for (const host of hosts) {
    const sketches = assignments.get(host) ?? []
    const active = host === fallback || sketches.length > 0
    host.toggleAttribute('data-tao-studio-sketch-create-surface', host === fallback)
    let mount = state.mounts.get(host)
    if (!active) {
      mount?.dispose()
      state.mounts.delete(host)
      continue
    }
    if (mount === undefined) {
      mount = StudioSketchView.mount(host, {
        onCreateSketch: async size => {
          const result = await applySketchAction(state, {
            ...size,
            id: crypto.randomUUID(),
            kind: 'create-sketch',
            project: state.project,
            rects: [],
          })
          delete host.dataset['taoStudioSketchError']
          renderMatrixSketches(parent, state.project, result.catalog)
        },
        onError: error => {
          host.dataset['taoStudioSketchError'] = error instanceof Error ? error.message : String(error)
        },
        onFlowAction: async request => await applySketchFlowAction(state, request),
        onRectChange: async change => {
          const result = await applySketchAction(state, sketchAction(change))
          delete host.dataset['taoStudioSketchError']
          return result.catalog.sketches
        },
        onSnap: async request => await applySketchSnap(state, request),
        onUnsnap: async request => await applySketchUnsnap(state, request),
        onUndoSnap: async request => await undoSketchSnap(state, request),
        sketches,
        sourceVersion: host.dataset['taoStudioSketchSourceVersion'],
      })
      state.mounts.set(host, mount)
    } else {
      mount.render(sketches, host.dataset['taoStudioSketchSourceVersion'])
    }
  }
}

export type StudioSketchSnapApi = Pick<
  typeof StudioApiClient,
  'sketchSnapApply' | 'sketchSnapProposal' | 'sketchUnsnapApply' | 'undoSketchSnap'
>

async function applySketchFlowAction(
  state: MountedMatrixSketches,
  request: StudioSketchViewFlowActionRequest,
): Promise<Awaited<ReturnType<typeof StudioApiClient.sketchFlowAction>>> {
  return await state.mutationLane.run(async () => {
    const applied = await StudioApiClient.sketchFlowAction(
      StudioSketchSnapRequests.flow(request, state.catalog.revision, crypto.randomUUID()),
    )
    state.catalog = applied.catalog
    return applied
  })
}

async function applySketchSnap(
  state: StudioSketchSnapMutationState,
  request: Readonly<{
    checkpointId: string
    confirmedProposalVersion?: string
    rectIds: readonly string[]
    sketchId: string
    sourceVersion: string
  }>,
): Promise<
  | Awaited<ReturnType<typeof StudioApiClient.sketchSnapApply>>
  | Awaited<ReturnType<typeof StudioApiClient.sketchSnapProposal>>
> {
  return await applySketchSnapWith(state, request, StudioApiClient, () => crypto.randomUUID())
}

export async function applySketchSnapWith(
  state: StudioSketchSnapMutationState,
  request: Readonly<{
    checkpointId: string
    confirmedProposalVersion?: string
    rectIds: readonly string[]
    sketchId: string
    sourceVersion: string
  }>,
  api: StudioSketchSnapApi,
  requestId: () => string,
): Promise<
  | Awaited<ReturnType<typeof StudioApiClient.sketchSnapApply>>
  | Awaited<ReturnType<typeof StudioApiClient.sketchSnapProposal>>
> {
  return await state.mutationLane.run(async () => {
    const base = StudioSketchSnapRequests.snap(request, state.catalog.revision, requestId())
    if (request.confirmedProposalVersion !== undefined) {
      const applied = await api.sketchSnapApply({
        ...base,
        confirmedProposalVersion: request.confirmedProposalVersion,
      })
      state.catalog = applied.catalog
      return applied
    }
    const proposal = await api.sketchSnapProposal(base)
    if (proposal.needsConfirmation) {
      return proposal
    }
    const applied = await api.sketchSnapApply(base)
    state.catalog = applied.catalog
    return applied
  })
}

async function applySketchUnsnap(
  state: MountedMatrixSketches,
  request: Readonly<{
    checkpointId: string
    rectIds: readonly string[]
    sketchId: string
    sourceVersion: string
  }>,
): Promise<Awaited<ReturnType<typeof StudioApiClient.sketchUnsnapApply>>> {
  return await state.mutationLane.run(async () => {
    const applied = await StudioApiClient.sketchUnsnapApply(
      StudioSketchSnapRequests.unsnap(request, state.catalog.revision, crypto.randomUUID()),
    )
    state.catalog = applied.catalog
    return applied
  })
}

async function undoSketchSnap(
  state: MountedMatrixSketches,
  request: Readonly<{ checkpointId: string; sourceVersion: string }>,
): Promise<Awaited<ReturnType<typeof StudioApiClient.undoSketchSnap>>> {
  return await state.mutationLane.run(async () => {
    const undone = await StudioApiClient.undoSketchSnap(
      StudioSketchSnapRequests.undo(request, state.catalog.revision, crypto.randomUUID()),
    )
    state.catalog = undone.catalog
    return undone
  })
}

async function applySketchAction(
  state: MountedMatrixSketches,
  action: StudioSketchCatalogAction,
): Promise<Awaited<ReturnType<typeof StudioApiClient.sketchAction>>> {
  return await state.mutationLane.run(async () => {
    const result = await StudioApiClient.sketchAction({
      action,
      expectedRevision: state.catalog.revision,
      requestId: crypto.randomUUID(),
    })
    state.catalog = result.catalog
    return result
  })
}

export class StudioSketchMutationLane {
  #lane: Promise<void> = Promise.resolve()

  run<Result>(mutation: () => Promise<Result>): Promise<Result> {
    const result = this.#lane.then(mutation, mutation)
    this.#lane = result.then(() => undefined, () => undefined)
    return result
  }
}

function sketchAction(change: StudioSketchRectChange): StudioSketchCatalogAction {
  if (change.kind === 'add') {
    return { kind: 'add-rect', rect: change.rect, sketchId: change.sketchId }
  }
  if (change.kind === 'duplicate') {
    Assert.input(change.sourceRectId, 'A duplicated Studio rectangle requires its source identity.')
    return {
      id: change.rect.id,
      kind: 'duplicate-rect',
      rectId: change.sourceRectId,
      sketchId: change.sketchId,
      x: change.rect.x,
      y: change.rect.y,
    }
  }
  return { kind: 'update-rect', rect: change.rect, rectId: change.rect.id, sketchId: change.sketchId }
}

function reconcileMatrix<Item>(
  parent: HTMLElement,
  groups: readonly StudioMatrixGroup<Item>[],
  render: (frame: HTMLElement, item: Item) => void,
): void {
  const document = parent.ownerDocument
  const canvas = parent.querySelector<HTMLElement>(':scope > .studio-preview-grid') ?? document.createElement('div')
  canvas.className = 'studio-preview-grid'
  canvas.dataset['taoStudioCanvas'] = 'true'
  const frames = new Map([...canvas.querySelectorAll<HTMLElement>('[data-tao-studio-cell]')]
    .map(frame => [frame.dataset['taoStudioCell']!, frame]))
  const rows = new Map([...canvas.querySelectorAll<HTMLElement>(':scope > [data-tao-studio-group]')]
    .map(row => [row.dataset['taoStudioGroup']!, row]))
  const nextRows = groups.map(group => {
    const row = rows.get(group.id) ?? document.createElement('section')
    row.className = 'studio-preview-group'
    row.dataset['taoStudioGroup'] = group.id
    if (group.subjectView === undefined) {
      delete row.dataset['taoStudioGroupView']
    } else {
      row.dataset['taoStudioGroupView'] = group.subjectView
    }
    const heading = row.querySelector<HTMLElement>(':scope > .studio-preview-group-label')
      ?? document.createElement('h2')
    heading.className = 'studio-preview-group-label'
    heading.textContent = group.label
    const cells = row.querySelector<HTMLElement>(':scope > .studio-preview-group-cells')
      ?? document.createElement('div')
    cells.className = 'studio-preview-group-cells'
    const nextFrames = group.cells.map(cell => {
      const existing = frames.get(cell.id)
      if (existing !== undefined) {
        return existing
      }
      const frame = document.createElement('section')
      frame.className = 'studio-preview-cell'
      frame.dataset['taoStudioCell'] = cell.id
      render(frame, cell.item)
      return frame
    })
    const sketchHost = cells.querySelector<HTMLElement>(':scope > [data-tao-studio-sketch-host]')
      ?? document.createElement('section')
    if (sketchHost.dataset['taoStudioSketchHost'] === undefined) {
      sketchHost.dataset['taoStudioSketchHost'] = group.id
      sketchHost.style.flex = '0 0 auto'
      sketchHost.style.overflow = 'visible'
    }
    if (group.sketchView === undefined) {
      delete sketchHost.dataset['taoStudioSketchView']
    } else {
      sketchHost.dataset['taoStudioSketchView'] = group.sketchView
    }
    if (group.sketchSourceVersion === undefined) {
      delete sketchHost.dataset['taoStudioSketchSourceVersion']
    } else {
      sketchHost.dataset['taoStudioSketchSourceVersion'] = group.sketchSourceVersion
    }
    reconcileElementChildren(cells, [...nextFrames, sketchHost])
    reconcileElementChildren(row, [heading, cells])
    return row
  })
  reconcileElementChildren(canvas, nextRows)
  if (!parent.contains(canvas)) {
    parent.replaceChildren(canvas)
  }
  applyCanvasFocus(parent)
}

const canvasFocus = new WeakMap<HTMLElement, string>()

/**
 * Canvas mode shows one view alone: every scenario group that does not focus that view is hidden,
 * and a bar above the grid names the view and offers the way back. Cells stay mounted, so the app's
 * own previews keep their state while the person works on the one definition.
 */
function focusCanvasView(parent: HTMLElement, viewName: string | undefined, exit: () => void): void {
  if (viewName === undefined) {
    canvasFocus.delete(parent)
  } else {
    canvasFocus.set(parent, viewName)
  }
  parent.dataset['taoStudioCanvasExit'] = 'true'
  canvasExits.set(parent, exit)
  applyCanvasFocus(parent)
}

const canvasExits = new WeakMap<HTMLElement, () => void>()

function applyCanvasFocus(parent: HTMLElement): void {
  const focused = canvasFocus.get(parent)
  const document = parent.ownerDocument
  const canvas = parent.querySelector<HTMLElement>(':scope > .studio-preview-grid')
  if (canvas === null) {
    return
  }
  for (const row of canvas.querySelectorAll<HTMLElement>(':scope > [data-tao-studio-group]')) {
    row.hidden = focused !== undefined && row.dataset['taoStudioGroupView'] !== focused
  }
  const existing = canvas.querySelector<HTMLElement>(':scope > .studio-canvas-bar')
  if (focused === undefined) {
    existing?.remove()
    delete parent.dataset['taoStudioCanvasFocus']
    return
  }
  parent.dataset['taoStudioCanvasFocus'] = focused
  const bar = existing ?? document.createElement('div')
  bar.className = 'studio-canvas-bar'
  bar.dataset['taoStudioCanvasBar'] = focused
  const label = bar.querySelector<HTMLElement>(':scope > span') ?? document.createElement('span')
  label.textContent = `Editing ${focused} on its own. Changes land in that one view definition.`
  const back = bar.querySelector<HTMLButtonElement>(':scope > button') ?? document.createElement('button')
  back.type = 'button'
  back.textContent = 'Back to app'
  back.dataset['taoStudioCanvasBack'] = 'true'
  back.onclick = () => canvasExits.get(parent)?.()
  bar.replaceChildren(label, back)
  canvas.prepend(bar)
}

/** Moves keyed matrix nodes in place so retained preview iframes keep their browsing contexts. */
function reconcileElementChildren(parent: HTMLElement, next: readonly HTMLElement[]): void {
  for (const [index, element] of next.entries()) {
    const current = parent.children.item(index)
    if (current !== element) {
      parent.insertBefore(element, current)
    }
  }
  while (parent.children.length > next.length) {
    parent.lastElementChild?.remove()
  }
}

export type StudioPreviewConnection = {
  activate?: () => void
  applySourceAction?: (envelope: StudioSourceActionEnvelope) => Promise<void>
  appliedRevision?: number
  capture?: {
    fixtureName: string
    identity: StudioSourceActionIdentity
    reject: (error: Error) => void
    requestId: string
    resolve: (result: 'cancelled' | 'saved') => void
    timeout: ReturnType<typeof setTimeout>
  }
  captureFixture?: (fixtureName: string) => Promise<'cancelled' | 'saved'>
  generation?: { phase: 'generating' | 'saving'; requestId: string }
  generationNotice?: string
  cell?: StudioPreviewCell
  cellIdentity?: StudioCellIdentity
  frame?: HTMLElement
  iframe: HTMLIFrameElement
  interactionMode: StudioInteractionMode
  expectedRevision?: number
  origin: string
  previewInstanceId: string
  reconfigureEnvironment?: (environment: StudioCellEnvironment) => Promise<void>
  reconfigureArguments?: (args: StudioJsonObject) => Promise<void>
  refresh?: Promise<void>
  journeyRecording?: StudioJourneyRecordingDraft
  journeyRecordingTimeout?: ReturnType<typeof setTimeout>
  journeyReplayStatus?: 'failed' | 'pending' | 'settled'
  revisionTimeout?: ReturnType<typeof setTimeout>
  replayRuntimeCapture?: (capture: StudioRuntimeCaptureArtifact) => Promise<void>
  runtimeCaptureRequest?: {
    reject: (error: Error) => void
    requestId: string
    resolve: (capture: StudioRuntimeCaptureArtifact) => void
    timeout: ReturnType<typeof setTimeout>
  }
  runtimeFailure?: StudioRuntimeCaptureArtifact
  runtimeLogs?: readonly StudioRuntimeLog[]
  scenarioModel?: StudioScenarioControlModel
  scenarioControls?: HTMLFormElement
  scenarioLabel?: string
  setInteractionMode?: (mode: StudioInteractionMode) => void
  changed?: () => void
  sourceSyncDisconnect?: () => void
  suspended?: boolean
  suspendedSource?: string
  visibilityObserver?: IntersectionObserver
}

export function disconnectPreviews(
  previews: readonly StudioPreviewConnection[],
  reason = 'The Tao Studio preview was disconnected.',
): void {
  for (const preview of previews) {
    invalidatePreviewJourneyRecording(preview)
    if (preview.revisionTimeout !== undefined) {
      clearTimeout(preview.revisionTimeout)
      preview.revisionTimeout = undefined
    }
    if (preview.capture !== undefined) {
      clearTimeout(preview.capture.timeout)
      preview.capture.reject(new Error(reason))
      preview.capture = undefined
    }
    if (preview.runtimeCaptureRequest !== undefined) {
      clearTimeout(preview.runtimeCaptureRequest.timeout)
      preview.runtimeCaptureRequest.reject(new Error(reason))
      preview.runtimeCaptureRequest = undefined
    }
    preview.visibilityObserver?.disconnect()
    preview.visibilityObserver = undefined
    preview.sourceSyncDisconnect?.()
    preview.sourceSyncDisconnect = undefined
    preview.iframe.src = 'about:blank'
  }
}

/** Any preview-lifecycle boundary makes a browser-local recording unsafe to save. */
function invalidatePreviewJourneyRecording(preview: StudioPreviewConnection): void {
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

/** StudioPreviewSourceSync keeps source identity available across an iframe's initial load and reloads. */
export const StudioPreviewSourceSync = {
  connect(preview: StudioPreviewConnection, synchronize: () => void): void {
    preview.sourceSyncDisconnect?.()
    const listener = (): void => synchronize()
    preview.iframe.addEventListener('load', listener)
    preview.sourceSyncDisconnect = () => preview.iframe.removeEventListener('load', listener)
    // The load callback covers previews that install their message listener synchronously. Tab
    // activation, saves, and selections republish identity for receivers that mount later.
    synchronize()
  },
} as const

export type StudioRuntimeLog = Readonly<{
  arguments: readonly StudioJsonValue[]
  level: 'debug' | 'error' | 'info' | 'log' | 'warn'
  timestamp: number
}>

export type StudioRuntimeDataTable = Readonly<{
  datasource: string
  entity: string
  rows: readonly StudioJsonObject[]
}>

export const StudioRuntimeData = {
  tables(capture: StudioRuntimeCaptureArtifact | undefined): readonly StudioRuntimeDataTable[] {
    const value = capture?.domains.find(domain => domain.domain === 'data' && domain.version === 1)?.value
    if (!Json.isRecord(value) || !Array.isArray(value['entries'])) {
      return []
    }
    return value['entries'].flatMap(entry => runtimeDataEntryTables(entry))
  },
} as const

/** Pure transition used by the viewport observer and covered without a browser DOM. */
export const StudioPreviewSuspension = {
  transition(suspended: boolean, visible: boolean): 'resume' | 'suspend' | 'unchanged' {
    if (visible && suspended) {
      return 'resume'
    }
    if (!visible && !suspended) {
      return 'suspend'
    }
    return 'unchanged'
  },
} as const

/** Keeps visual edits bound to the preview cell that most recently produced a trusted message. */
export class StudioActivePreview {
  readonly #previews: readonly StudioPreviewConnection[]
  readonly #listeners = new Set<() => void>()
  #active: StudioPreviewConnection | undefined

  constructor(previews: readonly StudioPreviewConnection[]) {
    this.#previews = previews
    this.#active = previews[0]
    this.reconcile()
  }

  activate(preview: StudioPreviewConnection): void {
    if (this.#previews.includes(preview) && preview !== this.#active) {
      this.#active = preview
      this.#markActive()
      this.#notify()
    }
  }

  current(): StudioPreviewConnection | undefined {
    return this.#active !== undefined && this.#previews.includes(this.#active)
      ? this.#active
      : this.#previews[0]
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Rewires a manifest-reconciled connection list and falls back when the active cell was removed. */
  reconcile(wire?: (preview: StudioPreviewConnection) => void): void {
    const previous = this.#active
    const previousCellId = previous?.cell?.cellId
    this.#active = previous !== undefined && this.#previews.includes(previous)
      ? previous
      : this.#previews.find(preview => preview.cell?.cellId === previousCellId) ?? this.#previews[0]
    for (const preview of this.#previews) {
      preview.activate = () => this.activate(preview)
      wire?.(preview)
    }
    this.#markActive()
    if (wire !== undefined || previous !== this.#active) {
      this.#notify()
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #markActive(): void {
    for (const preview of this.#previews) {
      if (preview.frame === undefined) {
        continue
      }
      if (preview === this.#active) {
        preview.frame.setAttribute('aria-current', 'true')
      } else {
        preview.frame.removeAttribute('aria-current')
      }
    }
  }
}

type StudioInteractionMode = 'edit' | 'run'

type StudioOpenFile = {
  editor: EditorView
  file: StudioDraftFile
}

export async function connectPreviews(
  parent: HTMLElement,
  previewUrl: string | undefined,
  handshake: StudioHandshake,
  signal?: AbortSignal,
): Promise<StudioPreviewConnection[]> {
  if (previewUrl === undefined) {
    return []
  }
  const origin = StudioProtocol.messageOrigin(previewUrl)
  Assert.input(origin, 'Tao Studio preview URL must be an absolute HTTP or HTTPS URL.')
  const manifest = handshake.previewManifest
  if (manifest !== undefined && manifest.cells.length > 0) {
    const connections = await Promise.all(manifest.cells.map(cell =>
      connectCellPreview(
        previewUrl,
        origin,
        handshake,
        manifest,
        cell,
        signal,
      )
    ))
    StudioMatrixView.render(
      parent,
      connectionGroups(manifest, connections),
      (frame, connection) => {
        connection.frame = frame
        renderCellPreview(frame, connection, previewUrl, manifest)
      },
    )
    const canvas = parent.querySelector<HTMLElement>(':scope > .studio-preview-grid')
    if (canvas !== null) {
      canvas.dataset['taoReviewManifest'] = StudioReviewDom.manifest(manifest)
    }
    StudioMatrixView.renderSketches(parent, handshake.identity.project, handshake.sketchCatalog)
    return connections
  }
  return [await connectWholeAppPreview(parent, previewUrl, origin, handshake, signal)]
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
  parent.replaceChildren(iframe)
  return { iframe, interactionMode: 'edit', origin, previewInstanceId }
}

/**
 * previewMatrixPlan decides what the preview area should hold. An app that declares no scenarios has no cells,
 * and must keep showing the whole running app rather than an empty matrix.
 */
export function previewMatrixPlan(
  cellCount: number,
  hasWholeAppPreview: boolean,
): 'cells' | 'create-whole-app' | 'keep-whole-app' {
  if (cellCount > 0) {
    return 'cells'
  }
  return hasWholeAppPreview ? 'keep-whole-app' : 'create-whole-app'
}

/** previewNoticeFor explains a preview the project's current state cannot back with a live app. */
export function previewNoticeFor(
  compile: {
    diagnostics?: readonly { filePath?: string; message: string; range?: { start: { line: number } } }[]
    message: string
    status: string
  },
): { detail: string; heading: string } | undefined {
  if (compile.status !== 'error') {
    return undefined
  }
  const diagnostic = compile.diagnostics?.[0]
  const where = diagnostic?.filePath === undefined
    ? ''
    : `${diagnostic.filePath.split('/').at(-1) ?? diagnostic.filePath}${
      diagnostic.range === undefined ? '' : `:${diagnostic.range.start.line + 1}`
    } — `
  return {
    detail: `${where}${diagnostic?.message ?? compile.message}`,
    heading: 'This preview is out of date: the project did not compile.',
  }
}

/**
 * previewBundleNoticeFor explains a preview whose app never started. The Tao project compiles, so nothing in
 * the problems panel is wrong; the failure is in the bundler that builds the generated TypeScript, and it
 * otherwise shows only as an empty frame.
 */
export function previewBundleNoticeFor(
  diagnosis: { message?: string; status: string } | undefined,
): { detail: string; heading: string } | undefined {
  if (diagnosis === undefined || diagnosis.status === 'ok' || diagnosis.status === 'unknown') {
    return undefined
  }
  if (diagnosis.status === 'unreachable') {
    return {
      detail: `${diagnosis.message ?? 'no response'} — reload the preview, or restart Studio.`,
      heading: 'This preview is empty: its app server did not answer.',
    }
  }
  return {
    detail: `${diagnosis.message ?? 'the bundler reported no detail'} — reload the preview, or restart Studio.`,
    heading: 'This preview is empty: the project compiled, but the app bundle failed to build.',
  }
}

/** studioPreviewNotice puts a human-facing explanation over the preview, without discarding a live frame. */
export function studioPreviewNotice(
  parent: HTMLElement,
  notice: { detail: string; heading: string } | undefined,
): void {
  const existing = parent.querySelector<HTMLElement>(':scope > .studio-preview-notice')
  if (notice === undefined) {
    existing?.remove()
    return
  }
  const element = existing ?? document.createElement('div')
  element.className = 'studio-preview-notice'
  element.setAttribute('role', 'status')
  const heading = element.querySelector<HTMLElement>('strong') ?? document.createElement('strong')
  heading.textContent = notice.heading
  const detail = element.querySelector<HTMLElement>('small') ?? document.createElement('small')
  detail.textContent = notice.detail
  element.replaceChildren(heading, detail)
  if (existing === null) {
    parent.append(element)
  }
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
      return subjectView === undefined ? {} : { subjectView }
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
      return {
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
    interactionMode: 'edit',
    origin,
    previewInstanceId,
  }
  schedulePreviewRevisionFallback(connection)
  return connection
}

export function configureInteractionMode(
  button: HTMLButtonElement,
  previews: readonly StudioPreviewConnection[],
  handshake: StudioHandshake,
): void {
  const render = (mode: StudioInteractionMode): void => {
    button.dataset['mode'] = mode
    button.textContent = mode === 'edit' ? 'Mode: Edit' : 'Mode: Run'
    button.title = mode === 'edit'
      ? 'Studio owns clicks and drags for selection and visual editing.'
      : 'The app receives clicks, presses, scrolling, and other interaction normally.'
  }
  const setMode = (mode: StudioInteractionMode): void => {
    render(mode)
    for (const preview of previews) {
      preview.interactionMode = mode
      postInteractionMode(preview, handshake)
    }
  }
  for (const preview of previews) {
    preview.setInteractionMode = setMode
    preview.iframe.addEventListener('load', () => {
      invalidatePreviewJourneyRecording(preview)
      postInteractionMode(preview, handshake)
    })
  }
  button.addEventListener('click', () => setMode(button.dataset['mode'] === 'edit' ? 'run' : 'edit'))
  setMode('edit')
}

function postInteractionMode(preview: StudioPreviewConnection, handshake: StudioHandshake): void {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return
  }
  target.postMessage({
    channel: studioProtocolChannel,
    identity: {
      ...(preview.cellIdentity ?? handshake.identity),
      previewInstanceId: preview.previewInstanceId,
    },
    mode: preview.interactionMode,
    protocolVersion: studioProtocolVersion,
    type: 'set-interaction-mode',
  }, preview.origin)
}

function postPreviewRuntimeUpdate(
  preview: StudioPreviewConnection,
  runtime: StudioCellRuntimeResponse,
): void {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return
  }
  const message: StudioPreviewRuntimeUpdateMessage<StudioCellRuntimeResponse> = {
    channel: studioProtocolChannel,
    identity: { ...runtime.identity, previewInstanceId: preview.previewInstanceId },
    protocolVersion: studioProtocolVersion,
    runtime,
    type: 'preview-runtime-update',
  }
  target.postMessage(message, preview.origin)
}

function renderCellPreview(
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
    networkLabel(cell.environment)
  }`
  label.append(details)

  const form = document.createElement('form')
  form.className = 'studio-preview-cell-controls'
  form.dataset['taoStudioCellControls'] = cell.cellId
  const argumentControls = renderArgumentControls(subjectParameters, cell.args)
  const viewportControls = renderViewportControls(cell.environment)
  const networkControls = renderNetworkControls(cell.environment)
  const schemeControls = renderSchemeControls(cell.environment)
  const actions = document.createElement('div')
  actions.className = 'studio-preview-cell-actions'
  const apply = document.createElement('button')
  apply.className = 'studio-preview-cell-apply'
  apply.textContent = 'Apply & remount'
  apply.type = 'submit'
  const promote = document.createElement('button')
  promote.className = 'studio-preview-cell-promote'
  promote.textContent = 'Save to scenario'
  promote.type = 'button'
  promote.disabled = scenarioModel === undefined || subjectParameters.length === 0
  const fixtureName = document.createElement('input')
  fixtureName.className = 'studio-preview-fixture-name'
  fixtureName.placeholder = 'CapturedState'
  fixtureName.setAttribute('aria-label', 'Captured fixture name')
  fixtureName.value = 'CapturedState'
  const capture = document.createElement('button')
  capture.className = 'studio-preview-cell-capture'
  capture.textContent = 'Capture fixture'
  capture.type = 'button'
  capture.disabled = scenarioModel === undefined
  const generate = document.createElement('button')
  generate.className = 'studio-preview-cell-generate'
  generate.textContent = 'Checking AI…'
  generate.type = 'button'
  generate.disabled = true
  const status = document.createElement('span')
  status.className = 'studio-preview-cell-status'
  status.setAttribute('role', 'status')
  if (connection.generationNotice !== undefined) {
    status.dataset['state'] = 'error'
    status.textContent = connection.generationNotice
    connection.generationNotice = undefined
  }
  const loadReplay = document.createElement('button')
  loadReplay.className = 'studio-preview-cell-replay-load'
  loadReplay.textContent = 'Load failure capture'
  loadReplay.type = 'button'
  const pasteReplay = document.createElement('button')
  pasteReplay.className = 'studio-preview-cell-replay-load'
  pasteReplay.textContent = 'Paste failure capture'
  pasteReplay.type = 'button'
  pasteReplay.disabled = navigator.clipboard?.readText === undefined
  const replayFailure = document.createElement('button')
  replayFailure.className = 'studio-preview-cell-replay-load'
  replayFailure.textContent = 'Replay captured state'
  replayFailure.type = 'button'
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
    status,
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
    status.dataset['state'] = 'busy'
    status.textContent = 'Pasting failure capture…'
    void navigator.clipboard.readText().then(replayText).catch(error => {
      pasteReplay.disabled = false
      status.dataset['state'] = 'error'
      status.textContent = Errors.messageOf(error)
    })
  })
  replayFailure.addEventListener('click', () => {
    if (scenarioModel === undefined) {
      return
    }
    const replay = StudioScenarioControls.replay(scenarioModel)
    if (!replay.ok) {
      status.dataset['state'] = 'error'
      status.textContent = replay.issues.join(' ')
      return
    }
    replayFailure.disabled = true
    status.dataset['state'] = 'busy'
    status.textContent = 'Restoring captured state…'
    void connection.replayRuntimeCapture?.(replay.value).catch(error => {
      replayFailure.disabled = false
      status.dataset['state'] = 'error'
      status.textContent = Errors.messageOf(error)
    })
  })
  replayFile.addEventListener('change', () => {
    const file = replayFile.files?.[0]
    if (file === undefined) {
      return
    }
    loadReplay.disabled = true
    status.dataset['state'] = 'busy'
    status.textContent = 'Loading failure capture…'
    void file.text().then(replayText).catch(error => {
      loadReplay.disabled = false
      status.dataset['state'] = 'error'
      status.textContent = Errors.messageOf(error)
    })
  })

  form.addEventListener('submit', event => {
    event.preventDefault()
    if (connection.cellIdentity === undefined) {
      return
    }
    apply.disabled = true
    status.dataset['state'] = 'busy'
    status.textContent = 'Remounting…'
    void (async () => {
      try {
        const draft = readScenarioDraft(
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
        status.dataset['state'] = 'error'
        status.textContent = Errors.messageOf(error)
      }
    })()
  })
  promote.addEventListener('click', () => {
    if (scenarioModel === undefined) {
      return
    }
    const draft = readScenarioDraft(
      scenarioModel,
      argumentControls.read,
      networkControls.read,
      viewportControls.read,
    )
    if (!draft.ok) {
      status.dataset['state'] = 'error'
      status.textContent = draft.issues.join(' ')
      return
    }
    const action = StudioScenarioControls.saveArgumentsAction(scenarioModel, draft.value.arguments, crypto.randomUUID())
    if (!action.ok) {
      status.dataset['state'] = 'error'
      status.textContent = action.issues.join(' ')
      return
    }
    promote.disabled = true
    status.dataset['state'] = 'busy'
    status.textContent = 'Saving Tao scenario…'
    void applyConnectionSourceAction(connection, action.value).then(
      () => {
        status.dataset['state'] = 'busy'
        status.textContent = 'Saved; waiting for the compiled manifest…'
      },
      error => {
        promote.disabled = false
        status.dataset['state'] = 'error'
        status.textContent = Errors.messageOf(error)
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
      status.dataset['state'] = 'error'
      status.textContent = 'Fixture name must be a Tao identifier.'
      return
    }
    const identity = fixtureSourceIdentity(connection, manifest, scenario)
    if (identity === undefined) {
      status.dataset['state'] = 'error'
      status.textContent = 'Fixture generation source identity is unavailable.'
      return
    }
    generate.disabled = true
    status.dataset['state'] = 'busy'
    status.textContent = 'Generating a realistic fixture…'
    const requestId = crypto.randomUUID()
    connection.generation = { phase: 'generating', requestId }
    void StudioApiClient.generateFixture(scenario.scenarioId).then(async result => {
      if (connection.generation?.requestId !== requestId) {
        return
      }
      if (result.status === 'failed') {
        connection.generation = undefined
        generate.disabled = false
        status.dataset['state'] = 'error'
        status.textContent = generatedFixtureFailureMessage(result)
        return
      }
      const envelope = fixtureProposalSourceAction({
        fixtureName: name,
        identity,
        origin: 'generated',
        plan: result.fixture,
        requestId,
      })
      status.textContent = 'Validating canonical Tao source…'
      const proposal = await StudioApiClient.sourceActionProposal(envelope)
      const confirmed = await StudioDialog.confirm({
        confirmLabel: 'Save fixture',
        diff: proposal.diff,
        title: 'Save this generated Tao fixture?',
      })
      if (!confirmed) {
        connection.generation = undefined
        generate.disabled = false
        status.dataset['state'] = 'idle'
        status.textContent = 'Generated fixture was not saved.'
        return
      }
      connection.generation = { phase: 'saving', requestId }
      status.textContent = 'Saving generated state as Tao source…'
      await applyConnectionSourceAction(connection, envelope)
      if (connection.generation?.requestId === requestId) {
        connection.generation = undefined
        status.dataset['state'] = 'busy'
        status.textContent = 'Saved; waiting for the compiled manifest…'
      }
    }).catch(error => {
      if (connection.generation?.requestId !== requestId) {
        return
      }
      connection.generation = undefined
      generate.disabled = false
      status.dataset['state'] = 'error'
      status.textContent = Errors.messageOf(error)
    })
  })
  connection.captureFixture = fixtureName =>
    new Promise((resolve, reject) => {
      if (scenarioModel === undefined) {
        reject(new Error('Studio scenario identity is unavailable.'))
        return
      }
      const target = connection.iframe.contentWindow
      const requestId = crypto.randomUUID()
      const request = StudioScenarioControls.fixtureCapture(scenarioModel, fixtureName.trim(), requestId)
      if (!request.ok || target === null) {
        reject(new Error(request.ok ? 'The active preview is not connected.' : request.issues.join(' ')))
        return
      }
      if (connection.capture !== undefined) {
        clearTimeout(connection.capture.timeout)
        connection.capture.reject(new Error('A newer fixture capture replaced this request.'))
      }
      const timeout = setTimeout(() => {
        if (connection.capture?.requestId !== requestId) {
          return
        }
        connection.capture = undefined
        reject(new Error('Fixture capture timed out; retry after the preview is ready.'))
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
    status.dataset['state'] = 'busy'
    status.textContent = 'Capturing isolated provider state…'
    void connection.captureFixture?.(fixtureName.value).then(result => {
      capture.disabled = false
      status.dataset['state'] = 'idle'
      status.textContent = result === 'saved'
        ? 'Saved; waiting for the compiled manifest…'
        : 'Captured fixture was not saved.'
    }, error => {
      capture.disabled = false
      status.dataset['state'] = 'error'
      status.textContent = Errors.messageOf(error)
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

async function applyConnectionSourceAction(
  connection: StudioPreviewConnection,
  envelope: StudioSourceActionEnvelope,
): Promise<void> {
  if (connection.applySourceAction !== undefined) {
    await connection.applySourceAction(envelope)
    return
  }
  await StudioApiClient.sourceAction(envelope)
}

async function configureGenerationAvailability(button: HTMLButtonElement): Promise<void> {
  try {
    const availability = await StudioApiClient.aiAvailability()
    button.textContent = availability.status === 'available' ? 'Generate fixture' : 'AI unavailable'
    button.disabled = availability.status !== 'available'
    button.title = availability.status === 'available'
      ? 'Generate a realistic state for this scene.'
      : availability.reason ?? 'On-device generation is unavailable.'
  } catch (error) {
    button.textContent = 'AI unavailable'
    button.disabled = true
    button.title = Errors.messageOf(error)
  }
}

function fixtureSourceIdentity(
  connection: StudioPreviewConnection,
  manifest: StudioPreviewManifestV2,
  scenario: StudioPreviewManifestV2['scenarios'][number],
): StudioSourceActionIdentity | undefined {
  const sourceVersion = manifest.sourceVersions[scenario.source.path]
  const path = projectRelativePath(manifest.project.root, scenario.source.path)
  return connection.cellIdentity === undefined || sourceVersion === undefined || path === undefined
    ? undefined
    : {
      ...connection.cellIdentity,
      path,
      previewInstanceId: connection.previewInstanceId,
      scenarioId: scenario.scenarioId,
      sourceVersion,
    }
}

function readScenarioDraft(
  model: StudioScenarioControlModel | undefined,
  readArguments: () => StudioJsonObject,
  readNetwork: () => StudioCellEnvironment['network'],
  readViewport: () => StudioCellEnvironment['viewport'],
): StudioScenarioResult<StudioScenarioDraft> {
  if (model === undefined) {
    return { issues: ['Studio scenario identity is unavailable.'], ok: false }
  }
  try {
    return StudioScenarioControls.validateDraft(model, {
      arguments: readArguments(),
      network: readNetwork(),
      viewport: readViewport(),
    })
  } catch (error) {
    return { issues: [Errors.messageOf(error)], ok: false }
  }
}

function renderArgumentControls(
  parameters: readonly StudioParameterSchema[],
  args: StudioJsonObject,
): { element: HTMLElement; read: () => StudioJsonObject } {
  const group = controlGroup('Arguments')
  const readers: Array<readonly [string, () => StudioJsonValue | undefined]> = []
  if (parameters.length === 0) {
    group.fields.append(controlNote('No editable arguments'))
  }
  for (const parameter of parameters) {
    const current = args[parameter.parameterId] ?? parameter.defaultValue
    const control = parameterControl(parameter, current)
    group.fields.append(control.element)
    readers.push([parameter.parameterId, control.read])
  }
  return {
    element: group.element,
    read: () =>
      Object.fromEntries(readers.flatMap(([id, read]) => {
        const value = read()
        return value === undefined ? [] : [[id, value]]
      })),
  }
}

function parameterControl(
  parameter: StudioParameterSchema,
  value: StudioJsonValue | undefined,
): { element: HTMLElement; read: () => StudioJsonValue | undefined } {
  const field = controlField(parameter.label)
  const type = parameter.type
  if (type.kind === 'boolean') {
    const input = document.createElement('input')
    input.checked = value === true
    input.type = 'checkbox'
    field.control.append(input)
    return { element: field.element, read: () => input.checked }
  }
  if (type.kind === 'choice') {
    const select = document.createElement('select')
    for (const choice of type.values) {
      const option = document.createElement('option')
      option.value = JSON.stringify(choice)
      option.textContent = String(choice)
      option.selected = Object.is(choice, value)
      select.append(option)
    }
    field.control.append(select)
    return { element: field.element, read: () => JSON.parse(select.value) as StudioJsonValue }
  }
  if (type.kind === 'json') {
    const input = document.createElement('textarea')
    input.rows = 2
    input.value = value === undefined ? '' : JSON.stringify(value)
    field.control.append(input)
    return {
      element: field.element,
      read: () => input.value.trim() === '' ? undefined : JSON.parse(input.value) as StudioJsonValue,
    }
  }
  const input = document.createElement('input')
  input.required = parameter.required
  if (type.kind === 'number') {
    input.type = 'number'
    if (type.minimum !== undefined) {
      input.min = String(type.minimum)
    }
    if (type.maximum !== undefined) {
      input.max = String(type.maximum)
    }
    if (type.step !== undefined) {
      input.step = String(type.step)
    }
    if (typeof value === 'number') {
      input.value = String(value)
    }
    field.control.append(input)
    return {
      element: field.element,
      read: () => input.value === '' ? undefined : requiredFiniteNumber(input, parameter.label),
    }
  }
  input.type = 'text'
  if (type.kind === 'time') {
    input.placeholder = 'Time'
  }
  if (typeof value === 'string') {
    input.value = value
  }
  field.control.append(input)
  return { element: field.element, read: () => input.value === '' && !parameter.required ? undefined : input.value }
}

function renderViewportControls(environment: StudioCellEnvironment): {
  element: HTMLElement
  read: () => StudioCellEnvironment['viewport']
} {
  const group = controlGroup('Viewport')
  const preset = document.createElement('select')
  const presets = [
    { height: 844, label: 'Phone', presetId: 'phone', width: 390 },
    { height: 1180, label: 'Tablet', presetId: 'tablet', width: 820 },
    { height: 900, label: 'Laptop', presetId: 'laptop', width: 1440 },
  ] as const
  for (const item of presets) {
    const option = document.createElement('option')
    option.value = item.presetId
    option.textContent = item.label
    preset.append(option)
  }
  if (
    environment.viewport.presetId !== undefined
    && !presets.some(item => item.presetId === environment.viewport.presetId)
  ) {
    const authored = document.createElement('option')
    authored.value = environment.viewport.presetId
    authored.textContent = environment.viewport.presetId
    preset.append(authored)
  }
  const custom = document.createElement('option')
  custom.value = 'custom'
  custom.textContent = 'Custom'
  preset.append(custom)
  preset.value = environment.viewport.presetId ?? 'custom'

  const width = dimensionInput(environment.viewport.width, 'Width')
  const height = dimensionInput(environment.viewport.height, 'Height')
  preset.addEventListener('change', () => {
    const selected = presets.find(item => item.presetId === preset.value)
    if (selected !== undefined) {
      width.value = String(selected.width)
      height.value = String(selected.height)
    }
  })
  width.addEventListener('input', () => {
    preset.value = 'custom'
  })
  height.addEventListener('input', () => {
    preset.value = 'custom'
  })
  group.fields.append(labelControl('Device', preset), labelControl('Width', width), labelControl('Height', height))
  return {
    element: group.element,
    read: () => ({
      ...(preset.value === 'custom' ? {} : { presetId: preset.value }),
      height: requiredFiniteNumber(height, 'Viewport height'),
      width: requiredFiniteNumber(width, 'Viewport width'),
    }),
  }
}

function renderNetworkControls(environment: StudioCellEnvironment): {
  element: HTMLElement
  read: () => StudioCellEnvironment['network']
} {
  const group = controlGroup('Network')
  const outcome = document.createElement('select')
  for (const value of ['normal', 'offline', 'error'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value[0]!.toUpperCase() + value.slice(1)
    outcome.append(option)
  }
  outcome.value = environment.network.outcome
  const latency = dimensionInput(environment.network.latencyMs, 'Latency')
  latency.min = '0'
  const message = document.createElement('input')
  message.type = 'text'
  message.value = environment.network.error?.message ?? 'Injected Studio network failure'
  const status = dimensionInput(environment.network.error?.status ?? 503, 'Status')
  status.min = '100'
  status.max = '599'
  const errorFields = [labelControl('Error', message), labelControl('Status', status)]
  const updateErrorVisibility = (): void => {
    for (const field of errorFields) {
      field.hidden = outcome.value !== 'error'
    }
  }
  outcome.addEventListener('change', updateErrorVisibility)
  updateErrorVisibility()
  group.fields.append(labelControl('Mode', outcome), labelControl('Latency ms', latency), ...errorFields)
  return {
    element: group.element,
    read: () => ({
      ...(outcome.value === 'error'
        ? {
          error: {
            message: message.value.trim() || 'Injected Studio network failure',
            status: requiredFiniteNumber(status, 'Network error status'),
          },
        }
        : {}),
      latencyMs: requiredFiniteNumber(latency, 'Network latency'),
      outcome: outcome.value as StudioCellEnvironment['network']['outcome'],
    }),
  }
}

function renderSchemeControls(environment: StudioCellEnvironment): HTMLElement {
  const group = controlGroup('Scheme')
  const select = document.createElement('select')
  select.disabled = true
  select.title = 'Scenario appearance is authored in Tao; Studio shows the runtime resolution here.'
  for (const value of ['system', 'light', 'dark'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value[0]!.toUpperCase() + value.slice(1)
    option.selected = value === environment.scheme.requested
    select.append(option)
  }
  group.fields.append(
    labelControl('Requested', select),
    controlNote(
      `${environment.scheme.resolved} · ${environment.scheme.source} · ${environment.scheme.capability}`,
    ),
  )
  return group.element
}

function controlGroup(title: string): { element: HTMLElement; fields: HTMLElement } {
  const element = document.createElement('fieldset')
  element.className = 'studio-preview-control-group'
  const legend = document.createElement('legend')
  legend.textContent = title
  const fields = document.createElement('div')
  fields.className = 'studio-preview-control-fields'
  element.append(legend, fields)
  return { element, fields }
}

function controlField(label: string): { control: HTMLElement; element: HTMLLabelElement } {
  const element = document.createElement('label')
  element.className = 'studio-preview-control-field'
  const caption = document.createElement('span')
  caption.textContent = label
  const control = document.createElement('span')
  control.className = 'studio-preview-control-input'
  element.append(caption, control)
  return { control, element }
}

function labelControl(label: string, control: HTMLElement): HTMLLabelElement {
  const field = controlField(label)
  field.control.append(control)
  return field.element
}

function controlNote(text: string): HTMLElement {
  const note = document.createElement('span')
  note.className = 'studio-preview-control-note'
  note.textContent = text
  return note
}

function dimensionInput(value: number, label: string): HTMLInputElement {
  const input = document.createElement('input')
  input.setAttribute('aria-label', label)
  input.min = '1'
  input.step = '1'
  input.type = 'number'
  input.value = String(value)
  return input
}

function requiredFiniteNumber(input: HTMLInputElement, label: string): number {
  const value = input.valueAsNumber
  Assert.input(Number.isFinite(value), `${label} must be a number.`)
  return value
}

function networkLabel(environment: StudioCellEnvironment): string {
  const latency = environment.network.latencyMs === 0 ? '' : ` +${environment.network.latencyMs}ms`
  return `${environment.network.outcome}${latency} · Scheme ${environment.scheme.resolved}`
}

function observePreviewVisibility(frame: HTMLElement, connection: StudioPreviewConnection): void {
  connection.visibilityObserver?.disconnect()
  if (typeof IntersectionObserver === 'undefined') {
    return
  }
  const observer = new IntersectionObserver(entries => {
    const visible = entries.some(entry =>
      entry.target === frame && (entry.isIntersecting || entry.intersectionRatio > 0)
    )
    const transition = StudioPreviewSuspension.transition(connection.suspended === true, visible)
    if (transition === 'suspend') {
      invalidatePreviewJourneyRecording(connection)
      connection.suspendedSource = connection.iframe.src
      connection.suspended = true
      connection.iframe.src = 'about:blank'
    } else if (transition === 'resume') {
      connection.suspended = false
      const source = connection.suspendedSource
      connection.suspendedSource = undefined
      if (source !== undefined) {
        connection.iframe.src = source
        schedulePreviewRevisionFallback(connection)
      }
    }
  }, { root: frame.closest<HTMLElement>('.studio-preview-grid'), rootMargin: '600px' })
  observer.observe(frame)
  connection.visibilityObserver = observer
}

function setPreviewSource(connection: StudioPreviewConnection, source: string): void {
  invalidatePreviewJourneyRecording(connection)
  if (connection.suspended === true) {
    connection.suspendedSource = source
  } else {
    connection.iframe.src = source
  }
}

function expectPreviewRevision(connection: StudioPreviewConnection, compileRevision: number): void {
  connection.expectedRevision = compileRevision
  if (connection.revisionTimeout !== undefined) {
    clearTimeout(connection.revisionTimeout)
    connection.revisionTimeout = undefined
  }
  schedulePreviewRevisionFallback(connection)
}

function schedulePreviewRevisionFallback(connection: StudioPreviewConnection): void {
  const expected = connection.expectedRevision
  if (
    expected === undefined
    || (connection.appliedRevision ?? -1) >= expected
    || connection.suspended === true
    || connection.revisionTimeout !== undefined
  ) {
    return
  }
  connection.revisionTimeout = setTimeout(() => {
    connection.revisionTimeout = undefined
    if (
      connection.expectedRevision !== expected
      || (connection.appliedRevision ?? -1) >= expected
      || connection.suspended === true
    ) {
      return
    }
    const source = connection.iframe.src
    if (source !== '' && source !== 'about:blank') {
      invalidatePreviewJourneyRecording(connection)
      connection.iframe.src = source
    }
  }, 750)
}

/** Adds Studio-owned viewport/network state without allowing unregistered domains into a capture. */
export function runtimeCaptureWithEnvironment(
  capture: StudioRuntimeCaptureArtifact,
  environment: StudioCellEnvironment | undefined,
): StudioRuntimeCaptureArtifact {
  if (environment === undefined) {
    return capture
  }
  const domains = [
    ...capture.domains.filter(domain => domain.domain !== 'environment'),
    {
      domain: 'environment',
      value: environment as unknown as StudioJsonValue,
      version: 1,
    },
  ].toSorted((left, right) => left.domain.localeCompare(right.domain))
  return { ...capture, domains }
}

/** Resolves portable runtime environment state without discarding a dev-owned environment codec. */
export function studioReplayConfiguration(
  capture: StudioRuntimeCaptureArtifact,
  currentEnvironment: StudioCellEnvironment,
): { environment: StudioCellEnvironment; replay: StudioRuntimeCaptureArtifact } {
  const capturedEnvironment = runtimeCaptureEnvironment(capture)
  const capturedScheme = runtimeCaptureScheme(capture)
  const hasEnvironmentDomain = capture.domains.some(domain => domain.domain === 'environment')
  return {
    environment: {
      ...(capturedEnvironment ?? currentEnvironment),
      scheme: capturedScheme ?? capturedEnvironment?.scheme ?? currentEnvironment.scheme,
    },
    replay: hasEnvironmentDomain ? capture : runtimeCaptureWithEnvironment(capture, currentEnvironment),
  }
}

function runtimeCaptureScheme(
  capture: StudioRuntimeCaptureArtifact,
): StudioCellEnvironment['scheme'] | undefined {
  const value = capture.domains.find(domain => domain.domain === 'scheme' && domain.version === 1)?.value
  return isStudioSchemeEnvironment(value) ? value : undefined
}

function runtimeCaptureEnvironment(capture: StudioRuntimeCaptureArtifact): StudioCellEnvironment | undefined {
  const value = capture.domains.find(domain => domain.domain === 'environment' && domain.version === 1)?.value
  return isStudioCellEnvironment(value) ? value : undefined
}

function isStudioCellEnvironment(value: unknown): value is StudioCellEnvironment {
  if (
    !Json.isRecord(value) || !Json.isRecord(value['network']) || !Json.isRecord(value['scheme'])
    || !Json.isRecord(value['viewport'])
  ) {
    return false
  }
  const network = value['network']
  const scheme = value['scheme']
  const viewport = value['viewport']
  const outcome = network['outcome']
  const error = network['error']
  return Number.isSafeInteger(network['latencyMs'])
    && Number(network['latencyMs']) >= 0
    && (outcome === 'error' || outcome === 'normal' || outcome === 'offline')
    && (outcome === 'error' ? Json.isRecord(error) && typeof error['message'] === 'string' : error === undefined)
    && isStudioSchemeEnvironment(scheme)
    && typeof viewport['width'] === 'number'
    && Number.isFinite(viewport['width'])
    && viewport['width'] > 0
    && typeof viewport['height'] === 'number'
    && Number.isFinite(viewport['height'])
    && viewport['height'] > 0
    && (viewport['presetId'] === undefined || typeof viewport['presetId'] === 'string')
}

function isStudioSchemeEnvironment(value: unknown): value is StudioCellEnvironment['scheme'] {
  if (!Json.isRecord(value)) {
    return false
  }
  const capability = value['capability']
  const requested = value['requested']
  const resolved = value['resolved']
  const source = value['source']
  return (requested === 'dark' || requested === 'light' || requested === 'system')
    && (resolved === 'dark' || resolved === 'light')
    && (source === 'native-fixed' || source === 'preference' || source === 'scenario' || source === 'system')
    && (capability === 'fixed-light-native' || capability === 'reactive-browser')
    && !(source === 'system' && requested !== 'system')
    && !(source === 'preference' && requested === 'system')
    && !(source === 'scenario' && requested === 'system')
    && !(source === 'native-fixed' && capability !== 'fixed-light-native')
    && !(capability === 'fixed-light-native' && (resolved !== 'light' || source !== 'native-fixed'))
}

function showRuntimeFailure(
  preview: StudioPreviewConnection,
  capture: StudioRuntimeCaptureArtifact,
  openSource: () => Promise<void>,
): void {
  const frame = preview.frame
  const failure = capture.failure
  if (frame === undefined || failure === undefined) {
    return
  }
  const panel = document.createElement('section')
  panel.className = 'studio-preview-runtime-failure'
  panel.setAttribute('role', 'alert')
  const heading = document.createElement('strong')
  heading.textContent = failure.stopper ? 'Stopped repeated crash' : 'Runtime failure'
  const message = document.createElement('span')
  message.textContent = failure.error.message
  const context = document.createElement('span')
  context.className = 'studio-preview-runtime-failure-context'
  context.textContent = [failure.frame.boundary, failure.frame.declaration].filter(Boolean).join(' · ')
  const actions = document.createElement('div')
  actions.className = 'studio-preview-runtime-failure-actions'
  const source = document.createElement('button')
  source.textContent = 'Open failing source'
  source.disabled = failure.frame.source === undefined
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  source.addEventListener('click', () => {
    source.disabled = true
    void openSource().catch(error => {
      source.disabled = false
      status.dataset['state'] = 'error'
      status.textContent = Errors.messageOf(error)
    })
  })
  actions.append(source, status)
  panel.append(heading, message, context, actions)
  const current = frame.querySelector(':scope > .studio-preview-runtime-failure')
  current?.remove()
  const viewport = frame.querySelector(':scope > .studio-preview-cell-viewport')
  frame.insertBefore(panel, viewport)
}

async function openRuntimeFailureSource(
  capture: StudioRuntimeCaptureArtifact,
  handshake: StudioHandshake,
  openFile: (path: string) => Promise<StudioOpenFile | undefined>,
): Promise<void> {
  const source = capture.failure?.frame.source
  Assert.input(source, 'This runtime failure has no Tao source frame.')
  const path = projectRelativePath(handshake.identity.project, source.path)
    ?? (handshake.files.some(file => file.path === source.path) ? source.path : undefined)
  Assert.input(path, 'The failing source is outside this Studio project.')
  const opened = await openFile(path)
  Assert.input(opened, `Could not open ${path}.`)
  const end = Math.min(source.end, opened.editor.state.doc.length)
  const start = Math.min(source.start, end)
  opened.editor.dispatch({
    effects: EditorView.scrollIntoView(start, { y: 'center' }),
    selection: { anchor: start, head: end },
  })
  opened.editor.focus()
}

function matchesExactPreviewCellIdentity(
  preview: StudioPreviewConnection,
  identity: StudioPreviewIdentity,
): boolean {
  const expected = preview.cellIdentity
  return expected !== undefined
    && identity.appName === expected.appName
    && identity.project === expected.project
    && identity.previewInstanceId === preview.previewInstanceId
    && identity.cellId === expected.cellId
    && identity.cellRevision === expected.cellRevision
    && identity.compileRevision === expected.compileRevision
    && identity.manifestRevision === expected.manifestRevision
}

export async function handlePreviewMessage(
  event: MessageEvent,
  preview: StudioPreviewConnection,
  handshake: StudioHandshake,
  openFile: (path: string) => Promise<StudioOpenFile | undefined>,
  actions: {
    activate?: () => void
    applySourceAction: (envelope: StudioSourceActionEnvelope) => Promise<void>
    changed?: () => void
    inspect: (selection: StudioInspectorSelection) => void
  },
): Promise<void> {
  const message = StudioProtocol.parseWindowMessage(event, {
    ...handshake.identity,
    origin: preview.origin,
    previewInstanceId: preview.previewInstanceId,
    source: preview.iframe.contentWindow,
  })
  if (message === undefined) {
    return
  }
  if (message.type === 'preview-console') {
    preview.runtimeLogs = [...(preview.runtimeLogs ?? []), {
      arguments: message.arguments,
      level: message.level,
      timestamp: message.timestamp,
    }].slice(-500)
    actions.changed?.()
    return
  }
  if (
    message.type === 'preview-journey-step-recorded'
    || message.type === 'preview-journey-recording-state'
  ) {
    const draft = preview.journeyRecording
    if (draft === undefined || draft.id !== message.recordingId) {
      return
    }
    if (!matchesExactPreviewCellIdentity(preview, message.identity)) {
      invalidatePreviewJourneyRecording(preview)
      actions.changed?.()
      return
    }
    preview.journeyRecording = StudioJourneyRecorder.receive(draft, message)
    if (
      preview.journeyRecording.status !== 'starting'
      && preview.journeyRecordingTimeout !== undefined
    ) {
      clearTimeout(preview.journeyRecordingTimeout)
      preview.journeyRecordingTimeout = undefined
    }
    actions.changed?.()
    return
  }
  if (
    message.type === 'preview-journey-replay-settled'
    || message.type === 'preview-journey-replay-failed'
  ) {
    if (!matchesExactPreviewCellIdentity(preview, message.identity)) {
      return
    }
    preview.journeyReplayStatus = message.type === 'preview-journey-replay-settled' ? 'settled' : 'failed'
    if (preview.frame !== undefined) {
      if (message.type === 'preview-journey-replay-settled') {
        StudioReviewDom.status(preview.frame, 'ready')
      } else {
        StudioReviewDom.status(preview.frame, 'failed', message.error)
      }
    }
    return
  }
  if (message.type === 'preview-layout-measurements') {
    await StudioApiClient.previewLayoutMeasurements(message)
    return
  }
  if (message.type === 'preview-scheme-changed') {
    if (preview.cell !== undefined) {
      preview.cell = {
        ...preview.cell,
        environment: { ...preview.cell.environment, scheme: message.scheme },
      }
      actions.changed?.()
    }
    return
  }
  if (message.type === 'preview-runtime-captured' || message.type === 'preview-runtime-capture-failed') {
    const request = preview.runtimeCaptureRequest
    if (request === undefined || request.requestId !== message.requestId) {
      return
    }
    clearTimeout(request.timeout)
    preview.runtimeCaptureRequest = undefined
    if (message.type === 'preview-runtime-capture-failed') {
      request.reject(new Error(message.error))
    } else {
      request.resolve(message.capture)
    }
    return
  }
  if (message.type === 'preview-applied') {
    postInteractionMode(preview, handshake)
    const identity = preview.cellIdentity
    const currentCell = identity === undefined || (
      message.identity.cellId === identity.cellId
      && message.identity.cellRevision === identity.cellRevision
      && message.identity.compileRevision === identity.compileRevision
      && message.identity.manifestRevision === identity.manifestRevision
    )
    if (!currentCell) {
      return
    }
    if (identity !== undefined) {
      preview.appliedRevision = Math.max(preview.appliedRevision ?? 0, message.appliedRevision)
      if (
        preview.expectedRevision !== undefined
        && preview.appliedRevision >= preview.expectedRevision
        && preview.revisionTimeout !== undefined
      ) {
        clearTimeout(preview.revisionTimeout)
        preview.revisionTimeout = undefined
      }
    }
    if (preview.frame !== undefined && StudioReviewDom.appliedReady(preview.journeyReplayStatus)) {
      StudioReviewDom.status(preview.frame, 'ready')
    }
    await StudioApiClient.previewApplied(message)
    return
  }
  if (message.type === 'source-action') {
    actions.activate?.()
    await actions.applySourceAction({
      ...message,
      identity: {
        ...message.identity,
        ...(preview.cell === undefined ? {} : { scenarioId: preview.cell.scenarioId }),
      },
    })
    return
  }
  if (message.type === 'preview-runtime-failure') {
    actions.activate?.()
    const capture = runtimeCaptureWithEnvironment(
      message.capture,
      preview.cell?.environment,
    )
    preview.runtimeFailure = capture
    if (preview.frame !== undefined) {
      StudioReviewDom.status(preview.frame, 'failed', capture.failure?.error.message ?? 'Runtime failure')
    }
    preview.frame?.scrollIntoView({ block: 'center' })
    showRuntimeFailure(preview, capture, () => openRuntimeFailureSource(capture, handshake, openFile))
    preview.changed?.()
    return
  }
  if (
    message.type === 'preview-fixture-captured'
    || message.type === 'preview-fixture-capture-failed'
  ) {
    const capture = preview.capture
    if (capture === undefined || capture.requestId !== message.requestId) {
      return
    }
    clearTimeout(capture.timeout)
    preview.capture = undefined
    if (message.type === 'preview-fixture-capture-failed') {
      capture.reject(new Error(message.error))
      return
    }
    const envelope = StudioInspector.singleAction({
      action: {
        fixtureName: capture.fixtureName,
        kind: 'insert-captured-fixture',
        plan: message.fixture,
      },
      checkpointId: `captured-fixture:${capture.requestId}`,
      identity: capture.identity,
      requestId: capture.requestId,
    })
    let proposal: Awaited<ReturnType<typeof StudioApiClient.sourceActionProposal>>
    try {
      proposal = await StudioApiClient.sourceActionProposal(envelope)
    } catch (error) {
      capture.reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const confirmed = await StudioDialog.confirm({
      confirmLabel: 'Save fixture',
      diff: proposal.diff,
      title: 'Save this captured Tao fixture?',
    })
    if (!confirmed) {
      capture.resolve('cancelled')
      return
    }
    try {
      await actions.applySourceAction(envelope)
      capture.resolve('saved')
    } catch (error) {
      capture.reject(error instanceof Error ? error : new Error(String(error)))
    }
    return
  }
  if (message.type !== 'preview-select-source') {
    return
  }
  actions.activate?.()
  const opened = await StudioSourceNavigation.openAndSelect({
    identity: message.identity,
    openFile,
    project: handshake.identity.project,
    range: message.range,
  })
  if (opened === undefined) {
    return
  }
  actions.inspect(StudioInspector.selection({
    ...message,
    identity: {
      ...message.identity,
      ...(preview.cell === undefined ? {} : { scenarioId: preview.cell.scenarioId }),
    },
  }))
}

export function requestRuntimeCapture(
  preview: StudioPreviewConnection,
  handshake: StudioHandshake,
): Promise<StudioRuntimeCaptureArtifact> {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return Promise.reject(new Error('The active preview is not connected.'))
  }
  preview.runtimeCaptureRequest?.reject(new Error('A newer live-data refresh replaced this request.'))
  if (preview.runtimeCaptureRequest !== undefined) {
    clearTimeout(preview.runtimeCaptureRequest.timeout)
  }
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (preview.runtimeCaptureRequest?.requestId === requestId) {
        preview.runtimeCaptureRequest = undefined
        reject(new Error('The active preview did not return live app data.'))
      }
    }, 5_000)
    preview.runtimeCaptureRequest = { reject, requestId, resolve, timeout }
    target.postMessage({
      channel: studioProtocolChannel,
      identity: {
        ...(preview.cellIdentity ?? handshake.identity),
        previewInstanceId: preview.previewInstanceId,
      },
      protocolVersion: studioProtocolVersion,
      requestId,
      type: 'capture-runtime',
    }, preview.origin)
  })
}

function runtimeDataEntryTables(value: StudioJsonValue): readonly StudioRuntimeDataTable[] {
  if (!Json.isRecord(value) || typeof value['key'] !== 'string' || typeof value['snapshot'] !== 'string') {
    return []
  }
  const key = value['key']
  try {
    const snapshot = JSON.parse(value['snapshot']) as unknown
    if (!Json.isRecord(snapshot) || !Json.isRecord(snapshot['rows'])) {
      return []
    }
    return Object.entries(snapshot['rows']).flatMap(([entity, rows]) =>
      Array.isArray(rows) && rows.every(isStudioJsonObject)
        ? [{ datasource: runtimeDatasourceLabel(key), entity, rows }]
        : []
    )
  } catch {
    return []
  }
}

function isStudioJsonObject(value: unknown): value is StudioJsonObject {
  return Json.isRecord(value) && Object.values(value).every(isStudioJsonValue)
}

function isStudioJsonValue(value: unknown): value is StudioJsonValue {
  return value === null
    || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)
    || typeof value === 'string'
    || Array.isArray(value) && value.every(isStudioJsonValue)
    || isStudioJsonObject(value)
}

function runtimeDatasourceLabel(key: string): string {
  try {
    const parsed = JSON.parse(key) as unknown
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      try {
        const identity = JSON.parse(parsed[0]) as unknown
        if (Array.isArray(identity) && identity.length > 0) {
          const parts = identity.map(readableIdentityPart)
          return parts.filter((part, index) => index === 0 || part !== parts[index - 1]).join(' · ')
        }
      } catch {
        // Unconfigured and test datasource identities are already readable text.
      }
      return parsed[0]
    }
  } catch {
    // A provider-owned opaque key remains safe display text.
  }
  return key
}

/**
 * readableIdentityPart names a canonical declaration identity by its declared name. The identity
 * tuple (`["tao.declaration", 1, "hnreader", "@workspace", "HNReader", "datasource", "StubSource"]`)
 * is an address for machines; the person reading the Data panel wants `StubSource`.
 */
function readableIdentityPart(part: unknown): string {
  const canonical = (() => {
    if (Array.isArray(part)) {
      return part
    }
    if (typeof part !== 'string') {
      return undefined
    }
    try {
      const parsed = JSON.parse(part) as unknown
      return Array.isArray(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  })()
  if (canonical !== undefined && canonical.length > 0 && canonical[0] === 'tao.declaration') {
    return String(canonical[canonical.length - 1])
  }
  return typeof part === 'string' ? part : String(part)
}

function fixtureProposalSource(name: string, plan: StudioFixturePlan): string {
  const entries = [
    ...plan.accounts.map(account => `   account ${account.name} { ${fixtureProposalFields(account.fields)} }`),
    ...plan.creates.map(create =>
      `   ${create.name} = create ${create.entity} { ${fixtureProposalFields(create.fields)} }`
    ),
  ]
  return `fixture ${name} {\n${entries.join('\n')}\n}`
}

function fixtureProposalSourceAction(options: {
  fixtureName: string
  identity: StudioSourceActionIdentity
  origin?: 'captured' | 'generated'
  plan: StudioFixturePlan
  requestId: string
}): StudioSourceActionEnvelope {
  return StudioInspector.singleAction({
    action: {
      fixtureName: options.fixtureName,
      kind: 'insert-captured-fixture',
      plan: options.plan,
    },
    checkpointId: `${options.origin ?? 'captured'}-fixture:${options.requestId}`,
    identity: options.identity,
    requestId: options.requestId,
  })
}

function generatedFixtureFailureMessage(result: { error: string; issues?: readonly string[] }): string {
  const issues = result.issues?.filter(issue => issue.trim().length > 0) ?? []
  return issues.length === 0 ? result.error : `${result.error} ${issues.join(' ')}`
}

export const StudioFixtureProposal = {
  source: fixtureProposalSource,
  sourceAction: fixtureProposalSourceAction,
} as const

export const StudioFixtureGenerationFeedback = {
  failure: generatedFixtureFailureMessage,
} as const

function fixtureProposalFields(fields: Readonly<Record<string, StudioFixtureValue>>): string {
  return Object.entries(fields).map(([name, value]) => `${name}: ${fixtureProposalValue(value)}`).join(', ')
}

function fixtureProposalValue(value: StudioFixtureValue): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return value.kind === 'now' ? 'now' : value.handle
}

export function currentSourceIdentity(
  handshake: StudioHandshake,
  preview: StudioPreviewConnection | undefined,
  file: StudioDraftFile | undefined,
): StudioSourceActionIdentity | undefined {
  return preview === undefined
      || file === undefined
      || preview.cellIdentity !== undefined && preview.cell === undefined
    ? undefined
    : {
      ...handshake.identity,
      ...(preview.cellIdentity ?? {}),
      path: absoluteSourcePath(handshake.identity.project, file.path),
      previewInstanceId: preview.previewInstanceId,
      ...(preview.cell === undefined ? {} : { scenarioId: preview.cell.scenarioId }),
      sourceVersion: file.sourceVersion,
    }
}

export function postEditorSelection(
  preview: StudioPreviewConnection | undefined,
  handshake: StudioHandshake,
  activeFile: StudioDraftFile | undefined,
  editor: EditorView,
): void {
  if (
    preview === undefined
    || activeFile === undefined
    || activeFile.content !== editor.state.doc.toString()
    || preview.iframe.contentWindow === null
  ) {
    return
  }
  const selection = editor.state.selection.main
  preview.iframe.contentWindow.postMessage({
    channel: studioProtocolChannel,
    identity: {
      ...handshake.identity,
      path: absoluteSourcePath(handshake.identity.project, activeFile.path),
      previewInstanceId: preview.previewInstanceId,
      sourceVersion: activeFile.sourceVersion,
    },
    protocolVersion: studioProtocolVersion,
    range: { end: selection.to, start: selection.from },
    type: 'highlight-source',
  }, preview.origin)
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
  const wholeApp = previews.find(preview => preview.cell === undefined)
  const plan = previewMatrixPlan(manifest.cells.length, wholeApp !== undefined)
  if (plan === 'keep-whole-app') {
    if (!parent.contains(wholeApp!.iframe)) {
      parent.replaceChildren(wholeApp!.iframe)
    }
    return
  }
  if (plan === 'create-whole-app') {
    disconnectPreviews(previews, 'This app no longer declares scenarios, so its cells were replaced.')
    previews.splice(0, previews.length, await connectWholeAppPreview(parent, previewUrl, origin, handshake))
    return
  }
  const previousByCell = new Map(
    previews.flatMap(preview => preview.cell === undefined ? [] : [[preview.cell.cellId, preview] as const]),
  )
  const interactionMode = previews[0]?.interactionMode ?? 'edit'
  const setInteractionMode = previews[0]?.setInteractionMode
  const nextConnections = await Promise.all(manifest.cells.map(async cell => {
    const previous = previousByCell.get(cell.cellId)
    if (previous !== undefined) {
      return previous
    }
    const connection = await connectCellPreview(previewUrl, origin, handshake, manifest, cell)
    connection.interactionMode = interactionMode
    connection.setInteractionMode = setInteractionMode
    connection.iframe.addEventListener('load', () => {
      invalidatePreviewJourneyRecording(connection)
      postInteractionMode(connection, handshake)
    })
    return connection
  }))
  const nextIds = new Set(manifest.cells.map(cell => cell.cellId))
  for (const preview of previews) {
    if (preview.cell !== undefined && nextIds.has(preview.cell.cellId)) {
      continue
    }
    disconnectPreviews([preview], 'The preview cell was removed before live data arrived.')
  }
  previews.splice(0, previews.length, ...nextConnections)
  StudioMatrixView.reconcile(parent, connectionGroups(manifest, nextConnections), (frame, connection) => {
    connection.frame = frame
    renderCellPreview(frame, connection, previewUrl, manifest)
  })
  const canvas = parent.querySelector<HTMLElement>(':scope > .studio-preview-grid')
  if (canvas !== null) {
    canvas.dataset['taoReviewManifest'] = StudioReviewDom.manifest(manifest)
  }
  const sketchState = mountedSketches.get(parent)
  if (sketchState !== undefined) {
    renderMatrixSketches(parent, sketchState.project, sketchState.catalog)
  }

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
    if (preview.revisionTimeout !== undefined) {
      clearTimeout(preview.revisionTimeout)
      preview.revisionTimeout = undefined
    }
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
        preview.runtimeCaptureRequest.reject(new Error('The preview remounted before live data arrived.'))
        preview.runtimeCaptureRequest = undefined
      }
      preview.cell = runtime.cell
      preview.cellIdentity = runtime.identity
      preview.iframe.title = `${runtime.cell.scenarioId} live preview`
      expectPreviewRevision(preview, runtime.identity.compileRevision)
      postPreviewRuntimeUpdate(preview, runtime)
      postInteractionMode(preview, handshake)
      if (preview.frame !== undefined) {
        renderCellPreview(preview.frame, preview, previewUrl, manifest)
      }
    }
    preview.refresh = (preview.refresh ?? Promise.resolve()).catch(() => {}).then(refresh)
    await preview.refresh
  }))
}
