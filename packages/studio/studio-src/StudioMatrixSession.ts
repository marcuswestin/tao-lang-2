import { Errors } from '@shared'
import {
  type StudioCellEnvironment,
  type StudioCellIdentity,
  type StudioCellInstanceIdentity,
  type StudioPreviewCell,
  StudioPreviewManifest,
  type StudioPreviewManifestV1,
} from './StudioPreviewManifest'
import type { StudioJsonObject } from './StudioProtocol'
import { type StudioResolvedState, StudioStateLibrary } from './StudioStateLibrary'

export type StudioCellReconfigureRequest = StudioCellIdentity & {
  args?: StudioJsonObject
  environment?: StudioCellEnvironment
  stateLayers?: readonly string[]
}

export type StudioCellRuntime = {
  cell: StudioPreviewCell
  identity: StudioCellIdentity
  resolvedState: StudioResolvedState
}

type StudioCellOverrides = {
  args?: StudioJsonObject
  environment?: StudioCellEnvironment
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
  readonly #instanceByCell = new Map<string, string>()
  readonly #instances = new Map<string, StudioCellInstanceIdentity>()
  readonly #overrides = new Map<string, StudioCellOverrides>()
  readonly #states: StudioStateLibrary

  constructor(readonly manifest: StudioPreviewManifestV1) {
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

  /** rebase carries compatible explicit cell configuration onto a fresh compiler manifest. */
  rebase(manifest: StudioPreviewManifestV1): StudioMatrixSession {
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
    const previousId = this.#instanceByCell.get(identity.cellId)
    if (previousId !== undefined) {
      this.#instances.delete(previousId)
    }
    this.#instances.set(identity.previewInstanceId, identity)
    this.#instanceByCell.set(identity.cellId, identity.previewInstanceId)
    return this.cell(identity.cellId)
  }

  assertCurrentInstance(identity: StudioCellInstanceIdentity): StudioCellRuntime {
    this.#assertCellIdentity(identity)
    const current = this.#instances.get(identity.previewInstanceId)
    if (current === undefined || this.#instanceByCell.get(identity.cellId) !== identity.previewInstanceId) {
      throw new StudioMatrixConflictError('stale-instance', 'Studio preview instance is no longer current.')
    }
    return this.cell(identity.cellId)
  }

  /** instance returns bootstrap configuration only for a currently registered opaque instance id. */
  instance(previewInstanceId: string): StudioCellRuntime {
    const identity = this.#instances.get(previewInstanceId)
    if (identity === undefined || this.#instanceByCell.get(identity.cellId) !== previewInstanceId) {
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
    this.#states.resolve(next.stateLayers)
    this.#cells.set(next.cellId, next)
    this.#overrides.set(next.cellId, {
      ...this.#overrides.get(next.cellId),
      ...(request.args === undefined ? {} : { args: request.args }),
      ...(request.environment === undefined ? {} : { environment: request.environment }),
      ...(request.stateLayers === undefined ? {} : { stateLayers: request.stateLayers }),
    })
    const previousId = this.#instanceByCell.get(next.cellId)
    if (previousId !== undefined) {
      this.#instances.delete(previousId)
    }
    this.#instanceByCell.delete(next.cellId)
    return this.#runtime(next)
  }

  unregisterInstance(previewInstanceId: string): void {
    const identity = this.#instances.get(previewInstanceId)
    if (identity === undefined) {
      return
    }
    this.#instances.delete(previewInstanceId)
    if (this.#instanceByCell.get(identity.cellId) === previewInstanceId) {
      this.#instanceByCell.delete(identity.cellId)
    }
  }

  #runtime(cell: StudioPreviewCell): StudioCellRuntime {
    return {
      cell,
      identity: StudioPreviewManifest.cellIdentity(this.manifest, cell),
      resolvedState: this.#states.resolve(cell.stateLayers),
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
