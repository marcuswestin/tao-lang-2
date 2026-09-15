import { Assert, Switch } from '@shared/core'
import type {
  StudioSketchFlowActionRequest,
  StudioSketchSnapRequest,
  StudioSketchSnapUndoRequest,
  StudioSketchUnsnapRequest,
} from '../../StudioProjectSession'
import type { StudioSketchCatalogAction, StudioSketchCatalogSnapshot } from '../../StudioSketchCatalog'
import { StudioApiClient } from '../StudioApiClient'
import {
  type MountedStudioSketchView,
  type StudioSketchRectChange,
  StudioSketchView,
  type StudioSketchViewFlowActionRequest,
} from '../StudioSketchView'

const mountedSketches = new WeakMap<HTMLElement, MountedMatrixSketches>()

type MountedMatrixSketches = {
  catalog: StudioSketchCatalogSnapshot
  mount?: MountedStudioSketchView
  mutationLane: StudioSketchMutationLane
  project: string
  sourceVersions: Record<string, string>
}

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
  /** retain keeps the Draw host across a preview parent replacement. */
  retain(parent: HTMLElement, replace: () => void): void {
    const host = parent.querySelector<HTMLElement>(':scope > [data-tao-studio-draw-canvas]')
    replace()
    if (host !== null && !parent.contains(host)) {
      parent.append(host)
    }
  },
} as const

export const StudioMatrixSketches = {
  render: renderMatrixSketches,
  /** rerender re-lays the boards already mounted under `parent` after the grid reconciled its hosts. */
  rerender(parent: HTMLElement, sourceVersions?: Readonly<Record<string, string>>): void {
    const state = mountedSketches.get(parent)
    if (state !== undefined) {
      renderMatrixSketches(parent, state.project, state.catalog, sourceVersions)
    }
  },
} as const

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
      onFlowAction: async request => await applySketchFlowAction(state, request),
      onRectChange: async change => {
        const result = await applySketchAction(state, sketchAction(change))
        delete host.dataset['taoStudioSketchError']
        return result.catalog.sketches
      },
      onSnap: async request => await applySketchSnap(state, request),
      onUnsnap: async request => await applySketchUnsnap(state, request),
      onUndoSnap: async request => await undoSketchSnap(state, request),
      sketches: state.catalog.sketches,
      sourceVersions: state.sourceVersions,
    })
  } else {
    state.mount.render(state.catalog.sketches, state.sourceVersions)
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
