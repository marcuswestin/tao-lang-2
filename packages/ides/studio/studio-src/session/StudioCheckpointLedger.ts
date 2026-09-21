import { Assert, Errors, FS } from '@shared'
import type {
  StudioCheckpointSummary,
  StudioProjectFileContent,
  StudioSourceActionEnvelope,
  StudioSourceActionIdentity,
  StudioSourceActionResult,
  StudioSourceActionUndoEnvelope,
} from '../StudioProtocol'
import type { StudioSketchCatalogAction } from '../StudioSketchCatalog'
import { StudioSourceActionConflictError } from './StudioSourceConflicts'

export type SourceActionCheckpoint = {
  afterSourceVersion: string
  beforeContent: string
  beforeSourceVersion: string
  id: string
  identity: SourceActionCheckpointIdentity
  path: string
  status: 'committed' | 'open' | 'undone'
}

type SourceActionCheckpointIdentity = Pick<StudioSourceActionIdentity, 'appName' | 'path' | 'project'> & {
  cellId?: string
  occurrence?: StudioSourceActionIdentity['occurrence']
  scenarioId?: string
}

export type SketchSnapCheckpoint = {
  afterCatalogRevision: number
  afterContent: string
  afterSourceVersion: string
  beforeContent: string
  beforeSourceVersion: string
  id: string
  /** Absolute path of the generated source the Snap rewrote. */
  path: string
  status: 'committed' | 'undone'
  undoAction: StudioSketchCatalogAction
}

const checkpointLimit = 100

/**
 * StudioCheckpointLedger is the session's undo ledger: source-action checkpoints (which may stay open
 * across a visual gesture) and sketch Snap checkpoints share one commit order, and only the latest
 * committed checkpoint is undoable.
 */
export class StudioCheckpointLedger {
  readonly #actionCheckpoints = new Map<string, SourceActionCheckpoint>()
  readonly #order: string[] = []
  readonly #sketchSnapCheckpoints = new Map<string, SketchSnapCheckpoint>()
  #openCheckpointId: string | undefined

  constructor(
    readonly projectRoot: string,
    private readonly onCommitted: (checkpoint: Pick<StudioCheckpointSummary, 'id' | 'status'>) => void,
  ) {}

  summaries(): readonly StudioCheckpointSummary[] {
    return [
      ...[...this.#actionCheckpoints.values()].map(checkpoint => ({
        afterSourceVersion: checkpoint.afterSourceVersion,
        beforeSourceVersion: checkpoint.beforeSourceVersion,
        id: checkpoint.id,
        path: checkpoint.path,
        status: checkpoint.status,
      })),
      ...[...this.#sketchSnapCheckpoints.values()].map(checkpoint => ({
        afterSourceVersion: checkpoint.afterSourceVersion,
        beforeSourceVersion: checkpoint.beforeSourceVersion,
        id: checkpoint.id,
        path: FS.relativePath(this.projectRoot, checkpoint.path),
        status: checkpoint.status,
      })),
    ]
  }

  /** requireSketchCheckpointSlot admits a new sketch checkpoint id: no gesture open, and the id unused. */
  requireSketchCheckpointSlot(checkpointId: string): void {
    Assert.input(this.#openCheckpointId === undefined, 'Commit the active Studio source-action checkpoint first.')
    Assert.input(
      !this.#actionCheckpoints.has(checkpointId) && !this.#sketchSnapCheckpoints.has(checkpointId),
      `Studio source-action checkpoint id was reused: ${checkpointId}`,
    )
  }

  recordSketchSnap(checkpoint: SketchSnapCheckpoint): void {
    this.#sketchSnapCheckpoints.set(checkpoint.id, checkpoint)
    this.#order.push(checkpoint.id)
    this.#trim()
  }

  /** sketchSnapUndoTarget returns the committed sketch checkpoint an undo request may revert. */
  sketchSnapUndoTarget(checkpointId: string): SketchSnapCheckpoint {
    Assert.input(
      this.#order.at(-1) === checkpointId,
      'Studio can only undo the latest committed source-action checkpoint.',
    )
    const checkpoint = this.#sketchSnapCheckpoints.get(checkpointId)
    Assert.input(checkpoint?.status === 'committed', `Studio Snap checkpoint is not undoable: ${checkpointId}`)
    return checkpoint
  }

  /**
   * prepareSourceAction reserves the checkpoint a source action writes into: a fresh one for `begin` and
   * `single`, or the still-open one for `update` and `end`, whose identity must not have drifted.
   */
  prepareSourceAction(
    envelope: StudioSourceActionEnvelope,
    current: StudioProjectFileContent,
  ): SourceActionCheckpoint {
    const { id, phase } = envelope.checkpoint
    const existing = this.#actionCheckpoints.get(id)
    if (phase === 'begin' || phase === 'single') {
      if (this.#openCheckpointId !== undefined && this.#openCheckpointId !== id) {
        this.#commitAbandoned(this.#openCheckpointId)
      }
      Assert.input(existing === undefined, `Studio source-action checkpoint id was reused: ${id}`)
      Assert.input(
        this.#openCheckpointId === undefined,
        `Studio source-action checkpoint is still open: ${this.#openCheckpointId}`,
      )
      return {
        afterSourceVersion: current.sourceVersion,
        beforeContent: current.content,
        beforeSourceVersion: current.sourceVersion,
        id,
        identity: sourceActionCheckpointIdentity(envelope.identity, current.path),
        path: current.path,
        status: phase === 'single' ? 'committed' : 'open',
      }
    }
    if (
      existing === undefined
      || existing.status !== 'open'
      || this.#openCheckpointId !== id
      || existing.path !== current.path
      || !sameCheckpointIdentity(existing.identity, sourceActionCheckpointIdentity(envelope.identity, current.path))
    ) {
      throw new StudioSourceActionConflictError(
        'checkpoint-identity-mismatch',
        `Studio source-action checkpoint identity changed while it was open: ${id}`,
        { checkpointId: id, path: current.path },
      )
    }
    return existing
  }

  /** recordSourceAction stores the written checkpoint and reports the status the client sees. */
  recordSourceAction(
    envelope: StudioSourceActionEnvelope,
    checkpoint: SourceActionCheckpoint,
    afterSourceVersion: string,
  ): StudioSourceActionResult['checkpoint'] {
    checkpoint.afterSourceVersion = afterSourceVersion
    if (envelope.checkpoint.phase === 'begin') {
      this.#openCheckpointId = checkpoint.id
      checkpoint.status = 'open'
      this.#actionCheckpoints.set(checkpoint.id, checkpoint)
      return { id: checkpoint.id, status: 'open' }
    }
    if (envelope.checkpoint.phase === 'update') {
      return { id: checkpoint.id, status: 'open' }
    }
    checkpoint.status = 'committed'
    this.#openCheckpointId = undefined
    this.#actionCheckpoints.set(checkpoint.id, checkpoint)
    this.#order.push(checkpoint.id)
    this.#trim()
    return { id: checkpoint.id, status: 'committed' }
  }

  /** undoableSourceAction returns the committed source-action checkpoint an undo request may revert. */
  undoableSourceAction(checkpointId: string): SourceActionCheckpoint {
    Assert.input(
      this.#openCheckpointId === undefined,
      'Commit the active Studio source-action checkpoint before undoing.',
    )
    Assert.input(
      this.#order.at(-1) === checkpointId,
      'Studio can only undo the latest committed source-action checkpoint.',
    )
    const checkpoint = this.#actionCheckpoints.get(checkpointId)
    if (checkpoint === undefined || checkpoint.status !== 'committed') {
      Errors.throwUserInput(`Studio source-action checkpoint is not undoable: ${checkpointId}`)
    }
    return checkpoint
  }

  /** requireUndoIdentity rejects an undo whose envelope names a different file or source-action identity. */
  requireUndoIdentity(
    checkpoint: SourceActionCheckpoint,
    envelope: StudioSourceActionUndoEnvelope,
    current: StudioProjectFileContent,
  ): void {
    if (
      checkpoint.path !== current.path
      || !sameCheckpointIdentity(checkpoint.identity, sourceActionCheckpointIdentity(envelope.identity, current.path))
    ) {
      throw new StudioSourceActionConflictError(
        'checkpoint-identity-mismatch',
        'Studio source-action undo targets different source-action identity.',
        { checkpointId: checkpoint.id, path: current.path },
      )
    }
  }

  /** markUndone retires the latest committed checkpoint after its source was restored. */
  markUndone(checkpoint: SketchSnapCheckpoint | SourceActionCheckpoint): void {
    checkpoint.status = 'undone'
    this.#order.pop()
  }

  #commitAbandoned(id: string): void {
    const checkpoint = this.#actionCheckpoints.get(id)
    if (checkpoint === undefined || checkpoint.status !== 'open') {
      this.#openCheckpointId = undefined
      return
    }
    checkpoint.status = 'committed'
    this.#openCheckpointId = undefined
    this.#order.push(id)
    this.#trim()
    this.onCommitted({ id, status: 'committed' })
  }

  #trim(): void {
    while (this.#order.length > checkpointLimit) {
      const expired = this.#order.shift()
      if (expired !== undefined) {
        this.#actionCheckpoints.delete(expired)
        this.#sketchSnapCheckpoints.delete(expired)
      }
    }
  }
}

function sourceActionCheckpointIdentity(
  identity: StudioSourceActionIdentity,
  normalizedPath: string,
): SourceActionCheckpointIdentity {
  return {
    appName: identity.appName,
    ...(identity.cellId === undefined ? {} : { cellId: identity.cellId }),
    ...(identity.occurrence === undefined ? {} : { occurrence: identity.occurrence }),
    path: normalizedPath,
    project: identity.project,
    ...(identity.scenarioId === undefined ? {} : { scenarioId: identity.scenarioId }),
  }
}

function sameCheckpointIdentity(left: SourceActionCheckpointIdentity, right: SourceActionCheckpointIdentity): boolean {
  return left.appName === right.appName
    && left.cellId === right.cellId
    && left.path === right.path
    && left.project === right.project
    && left.scenarioId === right.scenarioId
    && left.occurrence?.nodeKind === right.occurrence?.nodeKind
    && left.occurrence?.renderOwner === right.occurrence?.renderOwner
}
