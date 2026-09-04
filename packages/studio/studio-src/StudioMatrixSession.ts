import { Errors } from '@shared'
import {
  type StudioCellEnvironment,
  type StudioCellIdentity,
  type StudioCellInstanceIdentity,
  type StudioPreviewCell,
  StudioPreviewManifest,
  type StudioPreviewManifestV2,
} from './StudioPreviewManifest'
import type { StudioJsonObject, StudioRuntimeCaptureArtifact } from './StudioProtocol'
import { type StudioResolvedState, StudioStateLibrary } from './StudioStateLibrary'

export type StudioCellReconfigureRequest = StudioCellIdentity & {
  args?: StudioJsonObject
  environment?: StudioCellEnvironment
  replay?: StudioRuntimeCaptureArtifact
  stateLayers?: readonly string[]
}

export type StudioCellRuntime = {
  cell: StudioPreviewCell
  identity: StudioCellIdentity
  replay?: StudioRuntimeCaptureArtifact
  resolvedState: StudioResolvedState
}

type StudioCellOverrides = {
  args?: StudioJsonObject
  environment?: StudioCellEnvironment
  replay?: StudioRuntimeCaptureArtifact
  stateLayers?: readonly string[]
}

export class StudioMatrixConflictError extends Errors.UserInputError {
  constructor(
    readonly code: 'stale-cell' | 'stale-compile' | 'stale-instance' | 'stale-manifest',
    message: string,
  ) {
    super(message)
  }
}

/** StudioMatrixSession owns independent cell configuration and concurrent preview instance identity. */
export class StudioMatrixSession {
  readonly #cells = new Map<string, StudioPreviewCell>()
  readonly #instancesByCell = new Map<string, Set<string>>()
  readonly #instances = new Map<string, StudioCellInstanceIdentity>()
  readonly #overrides = new Map<string, StudioCellOverrides>()
  readonly #states: StudioStateLibrary

  constructor(readonly manifest: StudioPreviewManifestV2) {
    StudioPreviewManifest.define(manifest)
    this.#states = new StudioStateLibrary(manifest.states, manifest.capabilities.captureDomains)
    for (const cell of manifest.cells) {
      this.#cells.set(cell.cellId, cell)
    }
  }

  cells(): readonly StudioCellRuntime[] {
    return [...this.#cells.values()].map(cell => this.#runtime(cell))
  }

  cell(cellId: string): StudioCellRuntime {
    const cell = this.#cells.get(cellId)
    if (cell === undefined) {
      throw new Errors.UserInputError(`Studio cell does not exist: ${cellId}`)
    }
    return this.#runtime(cell)
  }

  /** publishedManifest exposes the live rebased cell contract, including retained override revisions. */
  publishedManifest(): StudioPreviewManifestV2 {
    return {
      ...this.manifest,
      cells: this.manifest.cells.map(cell => this.#cells.get(cell.cellId) ?? cell),
    }
  }

  /** rebase carries compatible explicit cell configuration onto a fresh compiler manifest. */
  rebase(manifest: StudioPreviewManifestV2): StudioMatrixSession {
    const rebased = new StudioMatrixSession(manifest)
    for (const [cellId, overrides] of this.#overrides) {
      const base = rebased.#cells.get(cellId)
      const previous = this.#cells.get(cellId)
      if (base === undefined || previous === undefined) {
        continue
      }
      const accepted: StudioCellOverrides = {}
      let cell = base
      if (overrides.args !== undefined) {
        const candidate = { ...cell, args: overrides.args }
        if (rebased.#valid(candidate)) {
          accepted.args = overrides.args
          cell = candidate
        }
      }
      if (overrides.environment !== undefined) {
        const candidate = { ...cell, environment: overrides.environment }
        if (rebased.#valid(candidate)) {
          accepted.environment = overrides.environment
          cell = candidate
        }
      }
      if (overrides.stateLayers !== undefined) {
        const candidate = { ...cell, stateLayers: overrides.stateLayers }
        if (rebased.#valid(candidate)) {
          accepted.stateLayers = overrides.stateLayers
          cell = candidate
        }
      }
      if (Object.keys(accepted).length === 0) {
        continue
      }
      cell = { ...cell, cellRevision: Math.max(base.cellRevision, previous.cellRevision) }
      rebased.#cells.set(cellId, cell)
      rebased.#overrides.set(cellId, accepted)
    }
    return rebased
  }

  registerInstance(identity: StudioCellInstanceIdentity): StudioCellRuntime {
    this.#assertCellIdentity(identity)
    if (identity.previewInstanceId.trim() === '') {
      throw new Errors.UserInputError('Studio preview instance id must not be empty.')
    }
    // A cell may have several live renderers at once, such as the browser iframe and a paired
    // device; each is an opaque instance, and only a reconfiguration or a new manifest ends them.
    this.#instances.set(identity.previewInstanceId, identity)
    const instances = this.#instancesByCell.get(identity.cellId) ?? new Set<string>()
    instances.add(identity.previewInstanceId)
    this.#instancesByCell.set(identity.cellId, instances)
    return this.cell(identity.cellId)
  }

  assertCurrentInstance(identity: StudioCellInstanceIdentity): StudioCellRuntime {
    this.#assertCellIdentity(identity)
    const current = this.#instances.get(identity.previewInstanceId)
    if (current === undefined || !this.#instancesByCell.get(identity.cellId)?.has(identity.previewInstanceId)) {
      throw new StudioMatrixConflictError('stale-instance', 'Studio preview instance is no longer current.')
    }
    return this.cell(identity.cellId)
  }

  /** instance returns bootstrap configuration only for a currently registered opaque instance id. */
  instance(previewInstanceId: string): StudioCellRuntime {
    const identity = this.#instances.get(previewInstanceId)
    if (identity === undefined || !this.#instancesByCell.get(identity.cellId)?.has(previewInstanceId)) {
      throw new StudioMatrixConflictError('stale-instance', 'Studio preview instance is no longer current.')
    }
    return this.cell(identity.cellId)
  }

  reconfigure(request: StudioCellReconfigureRequest): StudioCellRuntime {
    this.#assertCellIdentity(request)
    const current = this.#cells.get(request.cellId)!
    const next: StudioPreviewCell = {
      ...current,
      ...(request.args === undefined ? {} : { args: request.args }),
      ...(request.environment === undefined ? {} : { environment: request.environment }),
      ...(request.stateLayers === undefined ? {} : { stateLayers: request.stateLayers }),
      cellRevision: current.cellRevision + 1,
    }
    StudioPreviewManifest.validateArgs(this.manifest, next.scenarioId, next.args)
    StudioPreviewManifest.validateEnvironment(next.environment)
    if (request.replay !== undefined) {
      this.#validateReplay(request.replay)
    }
    this.#states.resolve(next.stateLayers)
    this.#cells.set(next.cellId, next)
    this.#overrides.set(next.cellId, {
      ...this.#overrides.get(next.cellId),
      ...(request.args === undefined ? {} : { args: request.args }),
      ...(request.environment === undefined ? {} : { environment: request.environment }),
      replay: request.replay,
      ...(request.stateLayers === undefined ? {} : { stateLayers: request.stateLayers }),
    })
    for (const previousId of this.#instancesByCell.get(next.cellId) ?? []) {
      this.#instances.delete(previousId)
    }
    this.#instancesByCell.delete(next.cellId)
    return this.#runtime(next)
  }

  unregisterInstance(previewInstanceId: string): void {
    const identity = this.#instances.get(previewInstanceId)
    if (identity === undefined) {
      return
    }
    this.#instances.delete(previewInstanceId)
    this.#instancesByCell.get(identity.cellId)?.delete(previewInstanceId)
  }

  #runtime(cell: StudioPreviewCell): StudioCellRuntime {
    const replay = this.#overrides.get(cell.cellId)?.replay
    return {
      cell,
      identity: StudioPreviewManifest.cellIdentity(this.manifest, cell),
      ...(replay === undefined ? {} : { replay }),
      resolvedState: this.#states.resolve(cell.stateLayers),
    }
  }

  #validateReplay(replay: StudioRuntimeCaptureArtifact): void {
    const supported = new Set(this.manifest.capabilities.captureDomains)
    const unsupported = replay.domains.find(domain => !supported.has(domain.domain))
    if (unsupported !== undefined) {
      throw new Errors.UserInputError(`Studio runtime capture domain is not supported: ${unsupported.domain}`)
    }
  }

  #valid(cell: StudioPreviewCell): boolean {
    try {
      StudioPreviewManifest.validateArgs(this.manifest, cell.scenarioId, cell.args)
      StudioPreviewManifest.validateEnvironment(cell.environment)
      this.#states.resolve(cell.stateLayers)
      return true
    } catch (error) {
      if (error instanceof Errors.UserInputError) {
        return false
      }
      throw error
    }
  }

  #assertCellIdentity(identity: StudioCellIdentity): void {
    if (identity.project !== this.manifest.project.root || identity.appName !== this.manifest.project.appName) {
      throw new Errors.UserInputError('Studio cell identity targets a different project or app.')
    }
    if (identity.manifestRevision !== this.manifest.manifestRevision) {
      throw new StudioMatrixConflictError('stale-manifest', 'Studio cell targets a stale manifest revision.')
    }
    if (identity.compileRevision !== this.manifest.compileRevision) {
      throw new StudioMatrixConflictError('stale-compile', 'Studio cell targets a stale compile revision.')
    }
    const cell = this.#cells.get(identity.cellId)
    if (cell === undefined) {
      throw new Errors.UserInputError(`Studio cell does not exist: ${identity.cellId}`)
    }
    if (identity.cellRevision !== cell.cellRevision) {
      throw new StudioMatrixConflictError('stale-cell', 'Studio cell targets a stale configuration revision.')
    }
  }
}
