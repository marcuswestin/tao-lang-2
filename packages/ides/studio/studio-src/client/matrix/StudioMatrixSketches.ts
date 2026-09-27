import { Assert, Switch } from '@shared/core'
import type { StudioFeedState } from '../../StudioFeedProtocol'
import type {
  StudioSketchFlowActionRequest,
  StudioSketchSnapRequest,
  StudioSketchSnapUndoRequest,
  StudioSketchUnsnapRequest,
} from '../../StudioProjectSession'
import type { StudioPreviewFeedDropMessage } from '../../StudioProtocol'
import type { StudioSketch, StudioSketchCatalogAction, StudioSketchCatalogSnapshot } from '../../StudioSketchCatalog'
import { StudioMountSignal } from '../app/StudioMountSignal'
import { StudioApiClient } from '../StudioApiClient'
import { StudioDialog } from '../StudioDialog'
import type { StudioFeedDrop } from '../StudioFeedController'
import type { StudioFeedExampleValues } from '../StudioFeedSamples'
import {
  type MountedStudioSketchView,
  type StudioSketchRectChange,
  StudioSketchView,
  type StudioSketchViewFlowActionRequest,
} from '../StudioSketchView'
import { type StudioSketchGeometry, StudioSketchUndo } from './StudioSketchUndo'

const mountedSketches = new WeakMap<HTMLElement, MountedMatrixSketches>()

type MountedMatrixSketches = {
  catalog: StudioSketchCatalogSnapshot
  exampleValues?: StudioFeedExampleValues
  feedDrop?: (payload: StudioFeedDrop, sketchId: string, rectId?: string) => Promise<void>
  mount?: MountedStudioSketchView
  mutationLane: StudioSketchMutationLane
  project: string
  recordEdit?: (edit: StudioSketchEdit) => void
  renderableViews: readonly string[]
  sourceVersions: Record<string, string>
}

/**
 * One Draw edit the shared undo stack can walk back. `undo` answers false, changing nothing, when the
 * sketch no longer holds what the edit left, because something else has changed it since.
 */
export type StudioSketchEdit = Readonly<{
  label: string
  /** The sketch's name, which the edit log shows as the edit's place. */
  path: string
  /** The sketch the edit changed: once one of its edits goes stale, every earlier one has too. */
  scope: string
  undo: () => Promise<boolean>
}>

export type StudioSketchSnapMutationState = {
  catalog: StudioSketchCatalogSnapshot
  mutationLane: StudioSketchMutationLane
}

export type StudioSketchSnapApi = Pick<
  typeof StudioApiClient,
  'sketchSnapApply' | 'sketchSnapProposal' | 'sketchUnsnapApply' | 'undoSketchSnap'
>

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

export class StudioSketchMutationLane {
  #lane: Promise<void> = Promise.resolve()

  run<Result>(mutation: () => Promise<Result>): Promise<Result> {
    const result = this.#lane.then(mutation, mutation)
    this.#lane = result.then(() => undefined, () => undefined)
    return result
  }
}

/** Sketch boards mounted on the Draw canvas, keyed by the preview parent. */
export const StudioDrawCanvas = {
  /** ensure mounts the Draw-preset host beside the preview grid so a compile remount cannot steal it. */
  ensure(parent: HTMLElement): HTMLElement {
    const document = parent.ownerDocument
    let host = parent.querySelector<HTMLElement>(':scope > [data-tao-studio-draw-canvas]')
    if (host === null) {
      host = document.createElement('section')
      host.className = 'studio-draw-canvas'
      host.dataset['taoStudioDrawCanvas'] = 'true'
      host.setAttribute('aria-label', 'Draw canvas')
      parent.append(host)
    }
    for (const child of [...parent.children]) {
      if (child.classList.contains('studio-empty')) {
        child.remove()
      }
    }
    return host
  },
  /** retain keeps the Draw host, and the tool strip beside it, across a preview parent replacement. */
  retain(parent: HTMLElement, replace: () => void): void {
    const kept = [
      parent.querySelector<HTMLElement>(':scope > [data-tao-studio-draw-canvas]'),
      parent.querySelector<HTMLElement>(':scope > [data-tao-studio-draw-tools]'),
    ]
    replace()
    for (const node of kept) {
      if (node !== null && !parent.contains(node)) {
        parent.append(node)
      }
    }
  },
} as const

export const StudioMatrixSketches = {
  render: renderMatrixSketches,
  feedTarget(parent: HTMLElement, message: StudioPreviewFeedDropMessage): { rectId: string; sketchId: string } {
    const state = mountedSketches.get(parent)
    Assert.input(state !== undefined, 'The sketch catalog is not available for this Feed drop.')
    return StudioSketchFeedTarget.resolve(state.catalog, state.project, message)
  },
  examples(parent: HTMLElement, values: StudioFeedExampleValues): void {
    const state = mountedSketches.get(parent)
    if (state === undefined || JSON.stringify(state.exampleValues ?? {}) === JSON.stringify(values)) {
      return
    }
    state.exampleValues = values
    state.mount?.render(state.catalog.sketches, state.sourceVersions, values)
  },
  /** renderable records which views a badge can switch a drawn rectangle to render. */
  renderable(parent: HTMLElement, views: readonly string[]): void {
    const state = mountedSketches.get(parent)
    if (state !== undefined) {
      state.renderableViews = views
    }
  },
  sketchForView(parent: HTMLElement, viewName: string): string | undefined {
    return mountedSketches.get(parent)?.catalog.sketches.find(sketch => sketch.view === viewName)?.id
  },
  connectFeed(
    parent: HTMLElement,
    drop: (payload: StudioFeedDrop, sketchId: string, rectId?: string) => Promise<void>,
  ): () => void {
    const state = mountedSketches.get(parent)
    Assert.defined(state, 'mounted Studio sketches before connecting Feed')
    state.feedDrop = drop
    return () => {
      state.feedDrop = undefined
    }
  },
  /** connectEdits hands each covered Draw edit to the shared undo stack until the returned disconnect. */
  connectEdits(parent: HTMLElement, record: (edit: StudioSketchEdit) => void): () => void {
    const state = mountedSketches.get(parent)
    Assert.defined(state, 'mounted Studio sketches before connecting undo')
    state.recordEdit = record
    return () => {
      state.recordEdit = undefined
    }
  },
  async runFeed<Result extends StudioFeedState>(
    parent: HTMLElement,
    run: (revision: number) => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> {
    const state = mountedSketches.get(parent)
    Assert.defined(state, 'mounted Studio sketches before editing Feed')
    return await state.mutationLane.run(async () => {
      StudioMountSignal.throwIfAborted(signal)
      const result = await run(state.catalog.revision)
      StudioMountSignal.throwIfAborted(signal)
      renderMatrixSketches(parent, state.project, result.catalog)
      return result
    })
  },
  /**
   * refresh re-reads the catalog after a preview manifest update: the server marks a render card
   * broken once its scenario entry leaves the manifest, and only a fresh read carries that mark.
   * Runs in the mutation lane, so it never lands between a catalog edit and its answer.
   */
  async refresh(
    parent: HTMLElement,
    project: string,
    read: () => Promise<StudioSketchCatalogSnapshot> = StudioApiClient.sketches,
    render: typeof renderMatrixSketches = renderMatrixSketches,
  ): Promise<void> {
    const state = mountedSketches.get(parent)
    const catalog = state === undefined ? await read() : await state.mutationLane.run(read)
    render(parent, state?.project ?? project, catalog)
  },
  /** rerender re-lays the boards already mounted under `parent` after the grid reconciled its hosts. */
  rerender(parent: HTMLElement, sourceVersions?: Readonly<Record<string, string>>): void {
    const state = mountedSketches.get(parent)
    if (state !== undefined) {
      renderMatrixSketches(parent, state.project, state.catalog, sourceVersions)
    }
  },
} as const

/** Maps a rendered iframe leaf back to the exact current snapped catalog target. */
export const StudioSketchFeedTarget = {
  resolve(
    catalog: StudioSketchCatalogSnapshot,
    project: string,
    message: Pick<StudioPreviewFeedDropMessage, 'identity' | 'renderId' | 'studioRectId'>,
  ): { rectId: string; sketchId: string } {
    Assert.input(message.studioRectId !== undefined, 'Drop a Feed field on a snapped sketch rectangle.')
    const path = normalizedSourcePath(project, message.identity.path)
    const matches = catalog.sketches.flatMap(sketch =>
      sketch.snapped.flatMap(item =>
        item.target.studioRectId === message.studioRectId
          && normalizedRenderId(project, item.target.renderId) === normalizedRenderId(project, message.renderId)
          && normalizedSourcePath(project, item.target.path) === path
          && item.target.sourceVersion === message.identity.sourceVersion
          ? [{ rectId: item.rect.id, sketchId: sketch.id }]
          : []
      )
    )
    Assert.input(
      matches.length === 1,
      'The Feed drop target changed or is not a snapped sketch rectangle. Refresh the preview and try again.',
    )
    return matches[0]!
  },
} as const

function normalizedSourcePath(project: string, path: string): string {
  return new URL(path.startsWith('/') ? path : `${project.replace(/\/$/, '')}/${path}`, 'file:///').pathname
}

function normalizedRenderId(project: string, renderId: string): string {
  const match = /^(.*):(\d+):(\d+)$/.exec(renderId)
  Assert.input(match !== null, 'The Feed drop has an invalid render identity.')
  return `${normalizedSourcePath(project, match[1]!)}:${match[2]}:${match[3]}`
}

function renderMatrixSketches(
  parent: HTMLElement,
  project: string,
  catalog: StudioSketchCatalogSnapshot,
  sourceVersions?: Readonly<Record<string, string>>,
): void {
  const state = mountedSketches.get(parent) ?? {
    catalog,
    mutationLane: new StudioSketchMutationLane(),
    project,
    renderableViews: [],
    sourceVersions: {},
  }
  if (catalog.revision >= state.catalog.revision) {
    state.catalog = catalog
  }
  state.project = project
  if (sourceVersions !== undefined) {
    state.sourceVersions = { ...state.sourceVersions, ...sourceVersions }
  }
  mountedSketches.set(parent, state)
  const host = StudioDrawCanvas.ensure(parent)
  host.toggleAttribute('data-tao-studio-sketch-create-surface', true)
  const attached = host.querySelector(':scope > [data-tao-studio-sketch-workspace]')
  if (state.mount !== undefined && attached === null) {
    state.mount.dispose()
    state.mount = undefined
  }
  if (state.mount === undefined) {
    state.mount = StudioSketchView.mount(host, {
      onCreateSketch: async size => {
        const id = crypto.randomUUID()
        const result = await applySketchAction(state, {
          height: size.height,
          id,
          kind: 'create-sketch',
          project: state.project,
          rects: [],
          width: size.width,
          x: size.x,
          y: size.y,
        })
        const created = result.createdSketch ?? result.catalog.sketches.find(sketch => sketch.id === id)
        if (created !== undefined && result.generatedFile !== undefined) {
          state.sourceVersions[created.view] = result.generatedFile.sourceVersion
        }
        delete host.dataset['taoStudioSketchError']
        renderMatrixSketches(parent, state.project, result.catalog)
      },
      onError: error => {
        host.dataset['taoStudioSketchError'] = error instanceof Error ? error.message : String(error)
      },
      onFeedDrop: async (payload, sketchId, rectId) => {
        await state.feedDrop?.(payload, sketchId, rectId)
      },
      onConvert: async intent => {
        const result = await state.mutationLane.run(async () => {
          const converted = await StudioApiClient.sketchConvert({
            ...intent,
            expectedCatalogRevision: state.catalog.revision,
            requestId: crypto.randomUUID(),
          })
          state.catalog = converted.catalog
          return converted
        })
        delete host.dataset['taoStudioSketchError']
        return result.catalog.sketches
      },
      onFlowAction: async request => await applySketchFlowAction(state, request),
      onRectChange: async change => {
        const sketches = await applyRecordedSketchActions(parent, state, change.sketchId, [sketchAction(change)])
        delete host.dataset['taoStudioSketchError']
        return sketches
      },
      onMove: async move => {
        const sketches = await applyRecordedSketchActions(parent, state, move.sketchId, [
          { id: move.sketchId, kind: 'move-sketch', x: move.x, y: move.y },
        ])
        delete host.dataset['taoStudioSketchError']
        return sketches
      },
      onDeleteRects: async (sketchId, rectIds) => {
        const sketches = await applyRecordedSketchActions(
          parent,
          state,
          sketchId,
          rectIds.map(rectId => ({ kind: 'delete-rect', rectId, sketchId })),
        )
        delete host.dataset['taoStudioSketchError']
        return sketches
      },
      confirmRemove: async question =>
        await StudioDialog.confirm({ cancelLabel: 'Cancel', confirmLabel: 'OK', title: question }),
      onRemove: async sketchId => {
        // A source-backed card leaves the catalog only; the code it showed stays as it is. A drawn
        // definition takes its generated `@/studio` file with it, which the server refuses while
        // another file still uses the view.
        const result = await applySketchAction(state, { id: sketchId, kind: 'delete-sketch' })
        delete host.dataset['taoStudioSketchError']
        return result.catalog.sketches
      },
      onSnap: async request => await applySketchSnap(state, request),
      onUnsnap: async request => await applySketchUnsnap(state, request),
      onUndoSnap: async request => await undoSketchSnap(state, request),
      renderableViews: () => state.renderableViews,
      sketches: state.catalog.sketches,
      exampleValues: state.exampleValues,
      sourceVersions: state.sourceVersions,
    })
  } else {
    state.mount.render(state.catalog.sketches, state.sourceVersions, state.exampleValues)
  }
}

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

/**
 * Applies one Draw gesture's catalog actions in a single turn of the mutation lane, then hands the
 * gesture to the undo stack with the sketch's geometry before and after it.
 */
async function applyRecordedSketchActions(
  parent: HTMLElement,
  state: MountedMatrixSketches,
  sketchId: string,
  actions: readonly StudioSketchCatalogAction[],
): Promise<readonly StudioSketch[]> {
  return await state.mutationLane.run(async () => {
    const before = state.catalog.sketches.find(sketch => sketch.id === sketchId)
    for (const action of actions) {
      const result = await StudioApiClient.sketchAction({
        action,
        expectedRevision: state.catalog.revision,
        requestId: crypto.randomUUID(),
      })
      state.catalog = result.catalog
    }
    const after = state.catalog.sketches.find(sketch => sketch.id === sketchId)
    const label = before === undefined ? undefined : StudioSketchUndo.label(actions, before)
    if (before !== undefined && after !== undefined && label !== undefined) {
      state.recordEdit?.({
        label,
        path: before.name,
        scope: sketchId,
        undo: () =>
          undoSketchEdit(parent, state, sketchId, StudioSketchUndo.geometry(before), StudioSketchUndo.geometry(after)),
      })
    }
    return state.catalog.sketches
  })
}

async function undoSketchEdit(
  parent: HTMLElement,
  state: MountedMatrixSketches,
  sketchId: string,
  before: StudioSketchGeometry,
  after: StudioSketchGeometry,
): Promise<boolean> {
  const restored = await state.mutationLane.run(async () => {
    const current = state.catalog.sketches.find(sketch => sketch.id === sketchId)
    if (current === undefined || !StudioSketchUndo.same(StudioSketchUndo.geometry(current), after)) {
      return undefined
    }
    const result = await StudioApiClient.sketchAction({
      action: StudioSketchUndo.restore(sketchId, before),
      expectedRevision: state.catalog.revision,
      requestId: crypto.randomUUID(),
    })
    state.catalog = result.catalog
    return result.catalog
  })
  if (restored === undefined) {
    return false
  }
  renderMatrixSketches(parent, state.project, restored)
  return true
}

function sketchAction(change: StudioSketchRectChange): StudioSketchCatalogAction {
  return Switch.property<StudioSketchRectChange, 'kind', StudioSketchCatalogAction>(change, 'kind', {
    add: () => ({ kind: 'add-rect', rect: change.rect, sketchId: change.sketchId }),
    duplicate: () => {
      Assert.input(change.sourceRectId, 'A duplicated Studio rectangle requires its source identity.')
      return {
        id: change.rect.id,
        kind: 'duplicate-rect',
        rectId: change.sourceRectId,
        sketchId: change.sketchId,
        x: change.rect.x,
        y: change.rect.y,
      }
    },
    update: () => ({ kind: 'update-rect', rect: change.rect, rectId: change.rect.id, sketchId: change.sketchId }),
  })
}
