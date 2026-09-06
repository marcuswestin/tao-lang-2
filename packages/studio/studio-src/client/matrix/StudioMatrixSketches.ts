import { Assert, Switch } from '@shared/core'
import type {
  StudioSketchFlowActionRequest,
  StudioSketchSnapRequest,
  StudioSketchSnapUndoRequest,
  StudioSketchUnsnapRequest,
} from '../../StudioProjectSession'
import type { StudioSketch, StudioSketchCatalogAction, StudioSketchCatalogSnapshot } from '../../StudioSketchCatalog'
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
  mounts: Map<HTMLElement, MountedStudioSketchView>
  mutationLane: StudioSketchMutationLane
  project: string
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

/** Sketch boards mounted into the matrix's per-group sketch hosts, keyed by the matrix parent. */
export const StudioMatrixSketches = {
  render: renderMatrixSketches,
  /** rerender re-lays the boards already mounted under `parent` after the grid reconciled its hosts. */
  rerender(parent: HTMLElement): void {
    const state = mountedSketches.get(parent)
    if (state !== undefined) {
      renderMatrixSketches(parent, state.project, state.catalog)
    }
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
