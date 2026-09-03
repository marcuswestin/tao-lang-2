import { AST, Langium } from '@parser'
import { Assert, Diagnostics, Errors, FS, Repo, TaoFiles } from '@shared'
import SourceActions, {
  type StudioComponentKind,
  type StudioInsertCapturedFixturePatchRequest,
  type StudioLayoutEntry,
  type StudioRenderInspection,
  type StudioScenarioArgumentValue,
  StudioSourceOccurrenceConflictError,
  type StudioSourcePatchRequest,
  type StudioStyleEntry,
  type StudioStyleLandingScope,
} from '@source-actions'
import { Workspace } from '@workspace'
import {
  type StudioCompileCompletion,
  StudioCompileCoordinator,
  type StudioCompileCoordinatorOptions,
  type StudioCompileSnapshot,
  type StudioSourceChange,
  type StudioWatchResult,
} from './StudioCompileCoordinator'
import { studioGeneratedSourceHeader, StudioGeneratedSources } from './StudioGeneratedSources'
import {
  type StudioCellReconfigureRequest,
  type StudioCellRuntime,
  StudioMatrixSession,
} from './StudioMatrixSession'
import {
  type StudioCellEnvironment,
  type StudioCellIdentity,
  type StudioCellInstanceIdentity,
  type StudioPreviewManifestV2,
} from './StudioPreviewManifest'
import {
  type StudioJsonObject,
  type StudioPreviewLayoutMeasurement,
  type StudioPreviewLayoutMeasurementsMessage,
  type StudioProjectIdentity,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
  type StudioSourceActionIdentity,
  type StudioSourceActionUndoEnvelope,
  studioSourceActionVersion,
} from './StudioProtocol'
import {
  type StudioSketch,
  StudioSketchCatalog,
  type StudioSketchCatalogAction,
  StudioSketchCatalogConflictError,
  studioSketchCatalogFormatVersion,
  type StudioSketchCatalogIO,
  type StudioSketchCatalogRequest,
  type StudioSketchCatalogResult,
  type StudioSketchCatalogSnapshot,
  type StudioSketchRect,
  type StudioSketchRenderTarget,
  type StudioSnappedRect,
} from './StudioSketchCatalog'
import { StudioSketchProjection } from './StudioSketchProjection'
import { StudioSketchSnap, type StudioSketchSnapTree } from './StudioSketchSnap'
import { StudioSketchSource } from './StudioSketchSource'

export type StudioProjectFile = {
  diagnosticCount: number
  dirty: boolean
  kind: 'file'
  path: string
  sourceVersion: string
}

export type StudioProjectFileContent = StudioProjectFile & {
  content: string
}

export type StudioProjectSessionOptions = {
  appName?: string
  compile: StudioCompileCoordinatorOptions['compile']
  entryPath?: string
  projectRoot: string
  sketchCatalogIO?: StudioSketchCatalogIO
}

export type StudioAppVariant = Readonly<{
  appName: string
  entryPath: string
}>

export type StudioDraftWriteRequest = {
  content: string
  path: string
  sourceVersion: string
  writeId: string
}

export type StudioDraftWriteResult = {
  compile?: StudioCompileCompletion
  diagnostics: readonly string[]
  file: StudioProjectFileContent
  saved: boolean
}

export type StudioCreateFileRequest = {
  path: string
  writeId: string
}

export type StudioRenameFileRequest = {
  path: string
  sourceVersion: string
  targetPath: string
  writeId: string
}

export type StudioDeleteFileRequest = {
  path: string
  sourceVersion: string
  writeId: string
}

export type StudioMoveGeneratedSourceRequest = {
  path: string
  sourceVersion: string
  targetPackage: string
  writeId: string
}

export type StudioCreateFileResult = {
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  files: readonly StudioProjectFile[]
}

export type StudioRenameFileResult = StudioCreateFileResult & {
  previousPath: string
}

export type StudioDeleteFileResult = {
  compile: StudioCompileCompletion
  deleted: StudioProjectFile
  files: readonly StudioProjectFile[]
}

export type StudioMoveGeneratedSourceResult =
  | {
    conflicts: readonly string[]
    name: string
    status: 'confirmation-required'
    targetPackage: string
  }
  | {
    compile: StudioCompileCompletion
    file: StudioProjectFileContent
    files: readonly StudioProjectFile[]
    previousPath: string
    rewritten: readonly StudioProjectFileContent[]
    status: 'moved'
  }

export type StudioFileDraftState = {
  diagnostics: readonly string[]
  dirty: boolean
}

export type StudioCheckpointSummary = {
  afterSourceVersion: string
  beforeSourceVersion: string
  id: string
  path: string
  status: 'committed' | 'open' | 'undone'
}

export type StudioInspectRenderRequest = {
  path: string
  renderId: string
  sourceVersion: string
}

export type StudioDesignValue =
  & Readonly<{ designName: string; end: number; start: number }>
  & (
    | { entries: readonly string[]; kind: 'bundle'; name: string }
    | { kind: 'color'; name: string; value: string }
    | { entries: readonly string[]; kind: 'default'; name: string }
    | { kind: 'screen'; name: string; value: string }
    | { kind: 'size'; name: string; value: string }
    | { entries: readonly string[]; kind: 'style'; name: string }
    | { entries: readonly string[]; kind: 'text'; name: string }
    | { kind: 'token'; name: string; value: string }
  )

function studioDesignSource(node: AST.Node): { end: number; start: number } {
  const cst = node.$cstNode
  Assert.input(cst, 'Cannot inspect a structured design value without source coordinates.')
  return { end: cst.end, start: cst.offset }
}

function normalizedTargetPackage(input: string): string {
  const targetPackage = input.trim()
  Assert.input(
    /^@[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z0-9_-]+)*$/.test(targetPackage),
    'Move to package requires an authored @package or @package/subfolder path.',
  )
  return targetPackage
}

function rewriteGeneratedStudioImports(
  content: string,
  file: AST.TaoFile,
  name: string,
  targetPackage: string,
): string | undefined {
  const uses = file.statements.filter(AST.isUseStatement)
  const sourceUses = uses.filter(statement =>
    statement.importPath === '@/studio'
    && statement.importedDeclarations.some(reference => reference.$refText === name)
  )
  if (sourceUses.length === 0) {
    return undefined
  }
  const targetUse = uses.find(statement => statement.importPath === targetPackage)
  const edits: Array<{ end: number; replacement: string; start: number }> = sourceUses.map(statement => {
    Assert.defined(statement.$cstNode, 'parsed use statement has source coordinates')
    const remaining = statement.importedDeclarations
      .map(reference => reference.$refText)
      .filter(imported => imported !== name)
    return {
      end: statement.$cstNode.end,
      replacement: remaining.length === 0 ? '' : `use ${remaining.join(', ')} from @/studio`,
      start: statement.$cstNode.offset,
    }
  })
  if (targetUse === undefined) {
    const lastUse = uses.at(-1)
    if (lastUse?.$cstNode) {
      edits.push({
        end: lastUse.$cstNode.end,
        replacement: `\nuse ${name} from ${targetPackage}`,
        start: lastUse.$cstNode.end,
      })
    } else {
      edits.push({ end: 0, replacement: `use ${name} from ${targetPackage}\n\n`, start: 0 })
    }
  } else if (!targetUse.importedDeclarations.some(reference => reference.$refText === name)) {
    Assert.defined(targetUse.$cstNode, 'parsed target use statement has source coordinates')
    const names = [...targetUse.importedDeclarations.map(reference => reference.$refText), name].toSorted()
    edits.push({
      end: targetUse.$cstNode.end,
      replacement: `use ${names.join(', ')} from ${targetPackage}`,
      start: targetUse.$cstNode.offset,
    })
  }
  return edits
    .toSorted((left, right) => right.start - left.start)
    .reduce((rewritten, edit) => rewritten.slice(0, edit.start) + edit.replacement + rewritten.slice(edit.end), content)
}

export type StudioPreviewRegistration = {
  previewInstanceId: string
}

export type StudioSourceActionResult = {
  checkpoint: {
    id: string
    status: 'committed' | 'open'
  }
  compile: StudioCompileCompletion
  content: string
  edits: readonly {
    end: number
    replacement: string
    start: number
  }[]
  path: string
  requestId: string
  sourceVersion: string
}

export type StudioSourceActionProposal = {
  content: string
  diff: string
  edits: readonly {
    end: number
    replacement: string
    start: number
  }[]
  path: string
  proposedSourceVersion: string
  requestId: string
  sourceVersion: string
}

export type StudioSourceActionUndoResult = {
  checkpoint: {
    id: string
    status: 'undone'
  }
  compile: StudioCompileCompletion
  content: string
  path: string
  requestId: string
  sourceVersion: string
}

export type StudioSketchActionResult =
  & StudioSketchCatalogResult
  & Readonly<{
    compile?: StudioCompileCompletion
    generatedFile?: StudioProjectFileContent
  }>

export type StudioSketchSnapRequest = Readonly<{
  checkpointId: string
  confirmedProposalVersion?: string
  expectedCatalogRevision: number
  rectIds: readonly string[]
  requestId: string
  sketchId: string
  sourceVersion: string
}>

export type StudioSketchUnsnapRequest = Readonly<
  Omit<StudioSketchSnapRequest, 'confirmedProposalVersion'>
>

export type StudioSketchFlowAction =
  | Readonly<{ kind: 'toggle-direction'; rectId: string }>
  | Readonly<{ afterRectId: string; beforeRectId?: string; kind: 'insert-separator' }>
  | Readonly<{
    afterRectId: string
    beforeRectId: string
    kind: 'insert-spacer'
    ratio: readonly [number, number]
  }>

/** Browser-safe flow intent; render identities remain a server/catalog implementation detail. */
export type StudioSketchFlowActionRequest = Readonly<{
  action: StudioSketchFlowAction
  checkpointId: string
  expectedCatalogRevision: number
  requestId: string
  sketchId: string
  sourceVersion: string
}>

export type StudioSketchSnapProposalResult = Readonly<{
  content: string
  diff: string
  needsConfirmation: boolean
  path: string
  projectedRectIds: readonly string[]
  proposedSourceVersion: string
  requestId: string
  sourceVersion: string
  tree: StudioSketchSnapTree
}>

export type StudioSketchSnapApplyResult = Readonly<{
  catalog: StudioSketchCatalogSnapshot
  checkpoint: { id: string; status: 'committed' }
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  projectedRectIds: readonly string[]
  requestId: string
}>

export type StudioSketchSnapUndoRequest = Readonly<{
  checkpointId: string
  expectedCatalogRevision: number
  requestId: string
  sourceVersion: string
}>

export type StudioSketchSnapUndoResult = Readonly<{
  catalog: StudioSketchCatalogSnapshot
  checkpoint: { id: string; status: 'undone' }
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  requestId: string
}>

export type StudioSessionHandshake = {
  apps: readonly StudioAppVariant[]
  capabilities: {
    drafts: 'disk-synced-parsable'
    language: readonly string[]
    sourceActions: {
      canonicalEnvelope: true
      checkpoints: true
      proposals: true
      undo: true
      version: typeof studioSourceActionVersion
    }
    matrix: {
      concurrentCells: true
      scheme: 'reactive-browser-fixed-light-native'
      version: 2
    }
    sketches: {
      catalogVersion: typeof studioSketchCatalogFormatVersion
      freeGeometry: true
    }
  }
  channel: typeof studioProtocolChannel
  compile: StudioCompileSnapshot
  endpoints: readonly {
    method: 'GET' | 'POST' | 'WS'
    path: string
  }[]
  entryPath: string
  files: readonly StudioProjectFile[]
  identity: StudioProjectIdentity
  previewManifest?: StudioPreviewManifestV2
  sketchCatalog: StudioSketchCatalogSnapshot
  protocolVersion: typeof studioProtocolVersion
  type: 'handshake'
}

export type StudioSessionEvent =
  | {
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    state: StudioCompileSnapshot
    type: 'compile-state'
  }
  | {
    channel: typeof studioProtocolChannel
    file: StudioProjectFile
    protocolVersion: typeof studioProtocolVersion
    type: 'file-changed'
  }
  | {
    channel: typeof studioProtocolChannel
    files: readonly StudioProjectFile[]
    protocolVersion: typeof studioProtocolVersion
    type: 'files-changed'
  }
  | {
    acknowledgements: StudioWatchResult['acknowledgements']
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'studio-writes-acknowledged'
  }
  | {
    channel: typeof studioProtocolChannel
    manifest: StudioPreviewManifestV2
    protocolVersion: typeof studioProtocolVersion
    type: 'preview-manifest-changed'
  }
  | {
    channel: typeof studioProtocolChannel
    checkpoint: Pick<StudioCheckpointSummary, 'id' | 'status'>
    protocolVersion: typeof studioProtocolVersion
    type: 'checkpoint-changed'
  }
  | {
    catalog: StudioSketchCatalogSnapshot
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'sketch-catalog-changed'
  }

type SourceActionCacheEntry = {
  fingerprint: string
  result: StudioSourceActionResult
}

type SourceActionCheckpoint = {
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

type PreparedSourceAction = {
  current: StudioProjectFileContent
  envelope: StudioSourceActionEnvelope
  patch: Awaited<ReturnType<typeof SourceActions.applyStudioPatch>>
  path: string
}

type SourceActionUndoCacheEntry = {
  fingerprint: string
  result: StudioSourceActionUndoResult
}

const sessionEndpoints: StudioSessionHandshake['endpoints'] = [
  { method: 'GET', path: '/api/protocol' },
  { method: 'POST', path: '/api/data/fill' },
  { method: 'GET', path: '/api/files' },
  { method: 'GET', path: '/api/file' },
  { method: 'POST', path: '/api/file/create' },
  { method: 'POST', path: '/api/file/delete' },
  { method: 'POST', path: '/api/file/draft' },
  { method: 'POST', path: '/api/file/move-generated' },
  { method: 'POST', path: '/api/file/rename' },
  { method: 'POST', path: '/api/language/highlight' },
  { method: 'POST', path: '/api/ship/beta' },
  { method: 'POST', path: '/api/source-action' },
  { method: 'POST', path: '/api/source-action/inspect' },
  { method: 'POST', path: '/api/source-action/propose' },
  { method: 'POST', path: '/api/source-action/undo' },
  { method: 'GET', path: '/api/sketches' },
  { method: 'POST', path: '/api/sketches/action' },
  { method: 'POST', path: '/api/sketches/flow/action' },
  { method: 'POST', path: '/api/sketches/snap/apply' },
  { method: 'POST', path: '/api/sketches/snap/propose' },
  { method: 'POST', path: '/api/sketches/snap/undo' },
  { method: 'POST', path: '/api/sketches/unsnap/apply' },
  { method: 'GET', path: '/api/tests/status' },
  { method: 'POST', path: '/api/tests/run' },
  { method: 'GET', path: '/api/ai/availability' },
  { method: 'POST', path: '/api/ai/fixture' },
  { method: 'POST', path: '/api/preview/instance' },
  { method: 'POST', path: '/api/preview/applied' },
  { method: 'POST', path: '/api/preview/layout-measurements' },
  { method: 'GET', path: '/api/preview/manifest' },
  { method: 'GET', path: '/api/preview/cell' },
  { method: 'GET', path: '/api/preview/cell/bootstrap' },
  { method: 'POST', path: '/api/preview/cell/instance' },
  { method: 'POST', path: '/api/preview/cell/reconfigure' },
  { method: 'WS', path: '/events' },
  { method: 'WS', path: '/api/language/lsp' },
]

const sourceActionResultLimit = 100

type PreparedSketchSnap = Readonly<{
  beforeTargets: readonly StudioSketchRenderTarget[]
  current: StudioProjectFileContent
  needsConfirmation: boolean
  patch: Awaited<ReturnType<typeof SourceActions.applyStudioPatch>>
  path: string
  projectedRectIds: readonly string[]
  request: StudioSketchSnapRequest
  tree: StudioSketchSnapTree
}>

type SketchSnapCheckpoint = {
  afterCatalogRevision: number
  afterContent: string
  afterSourceVersion: string
  beforeContent: string
  beforeSourceVersion: string
  id: string
  path: string
  status: 'committed' | 'undone'
  undoAction: StudioSketchCatalogAction
}

/** StudioProjectSession owns one project/app's disk-synced source and serialized compile state. */
export class StudioProjectSession {
  static readonly testing = { measuredUnsnapRect, sourceActionProposalDiff }

  readonly #actionCheckpoints = new Map<string, SourceActionCheckpoint>()
  readonly #actionResults = new Map<string, SourceActionCacheEntry>()
  readonly #actionUndoResults = new Map<string, SourceActionUndoCacheEntry>()
  readonly #checkpointOrder: string[] = []
  readonly #coordinator: StudioCompileCoordinator
  readonly #draftStates = new Map<string, StudioFileDraftState>()
  readonly #listeners = new Set<(event: StudioSessionEvent) => void>()
  readonly #previewLayoutMeasurements = new Map<
    string,
    Readonly<{
      identity: StudioCellInstanceIdentity
      measurements: ReadonlyMap<string, StudioPreviewLayoutMeasurement>
    }>
  >()
  readonly #sketchCatalog: StudioSketchCatalog
  readonly #sketchSnapCheckpoints = new Map<string, SketchSnapCheckpoint>()
  readonly #sketchSnapProposalResults = new Map<
    string,
    Readonly<{ fingerprint: string; result: StudioSketchSnapProposalResult }>
  >()
  readonly #sketchSnapResults = new Map<
    string,
    Readonly<{ fingerprint: string; result: StudioSketchSnapApplyResult }>
  >()
  readonly #sketchSnapUndoResults = new Map<
    string,
    Readonly<{ fingerprint: string; result: StudioSketchSnapUndoResult }>
  >()
  readonly #sketchResults = new Map<string, Readonly<{ fingerprint: string; result: StudioSketchActionResult }>>()
  readonly #workspace: Workspace
  #mutationLane: Promise<void> = Promise.resolve()
  #matrix: StudioMatrixSession | undefined
  #openCheckpointId: string | undefined

  private constructor(
    readonly projectRoot: string,
    readonly entryPath: string,
    readonly appName: string,
    readonly apps: readonly StudioAppVariant[],
    workspace: Workspace,
    compile: StudioCompileCoordinatorOptions['compile'],
    sketchCatalogIO?: StudioSketchCatalogIO,
  ) {
    this.#workspace = workspace
    this.#sketchCatalog = new StudioSketchCatalog(projectRoot, sketchCatalogIO)
    this.#coordinator = new StudioCompileCoordinator({
      appName,
      compile,
      onState: state =>
        this.#emit({
          channel: studioProtocolChannel,
          protocolVersion: studioProtocolVersion,
          state,
          type: 'compile-state',
        }),
      project: projectRoot,
    })
  }

  static async open(options: StudioProjectSessionOptions): Promise<StudioProjectSession> {
    const projectRoot = await requireProjectRoot(options.projectRoot)
    await new StudioGeneratedSources(projectRoot).repair()
    const workspace = await Workspace.open(projectRoot)
    const apps = await discoverAppVariants(projectRoot, workspace)
    const requestedEntryPath = options.entryPath === undefined
      ? undefined
      : FS.relativePath(projectRoot, await resolveEntryPath(projectRoot, options.entryPath))
    const selection = resolveAppSelection(projectRoot, apps, options.appName, requestedEntryPath)
    return new StudioProjectSession(
      projectRoot,
      FS.resolvePath(selection.entryPath, projectRoot),
      selection.appName,
      apps,
      workspace,
      options.compile,
      options.sketchCatalogIO,
    )
  }

  identity(): StudioProjectIdentity {
    return { appName: this.appName, project: this.projectRoot }
  }

  compileSnapshot(): StudioCompileSnapshot {
    return this.#coordinator.snapshot()
  }

  fileDraftState(path: string): StudioFileDraftState {
    return this.#draftStates.get(path) ?? { diagnostics: [], dirty: false }
  }

  checkpoints(): readonly StudioCheckpointSummary[] {
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

  compileInitial(): Promise<StudioCompileCompletion> {
    return this.#coordinator.requestInitialCompile()
  }

  setPreviewInstance(previewInstanceId: string): void {
    Assert.input(previewInstanceId.trim().length > 0, 'Studio preview instance id cannot be empty.')
    this.#coordinator.setPreviewInstance(previewInstanceId)
  }

  registerPreview(input: unknown): StudioCompileSnapshot {
    if (!isRecord(input) || typeof input['previewInstanceId'] !== 'string') {
      Errors.throwUserInput('Expected a Studio preview instance id.')
    }
    this.setPreviewInstance(input['previewInstanceId'])
    return this.compileSnapshot()
  }

  /** setMatrixManifest installs the compiler-derived scenario/cell contract for this compile revision. */
  setMatrixManifest(manifest: StudioPreviewManifestV2): void {
    Assert.input(
      manifest.project.root === this.projectRoot && manifest.project.appName === this.appName,
      'Studio preview manifest does not match the open project and app.',
    )
    this.#matrix = this.#matrix?.rebase(manifest) ?? new StudioMatrixSession(manifest)
    this.#previewLayoutMeasurements.clear()
    this.#emit({
      channel: studioProtocolChannel,
      manifest: this.#matrix.publishedManifest(),
      protocolVersion: studioProtocolVersion,
      type: 'preview-manifest-changed',
    })
  }

  previewManifest(): StudioPreviewManifestV2 | undefined {
    return this.#matrix?.publishedManifest()
  }

  previewCell(cellId: string): StudioCellRuntime {
    return this.#requireMatrix().cell(cellId)
  }

  previewCellInstance(previewInstanceId: string): StudioCellRuntime {
    return this.#requireMatrix().instance(previewInstanceId)
  }

  registerCellPreview(input: unknown): StudioCellRuntime {
    return this.#requireMatrix().registerInstance(cellInstanceIdentity(input))
  }

  reconfigureCell(input: unknown): StudioCellRuntime {
    return this.#requireMatrix().reconfigure(cellReconfigureRequest(input))
  }

  acknowledgePreview(input: unknown): boolean {
    const message = StudioProtocol.parseMessage(input)
    if (message?.type !== 'preview-applied') {
      Errors.throwUserInput('Expected a valid Tao Studio preview-applied message.')
    }
    if (message.identity.cellId !== undefined) {
      const identity = message.identity
      const cellId = identity.cellId
      if (
        cellId === undefined
        || identity.cellRevision === undefined
        || identity.compileRevision === undefined
        || identity.manifestRevision === undefined
      ) {
        Errors.throwUserInput('Expected a complete Studio cell preview identity.')
      }
      this.#requireMatrix().assertCurrentInstance({
        appName: identity.appName,
        cellId,
        cellRevision: identity.cellRevision,
        compileRevision: identity.compileRevision,
        manifestRevision: identity.manifestRevision,
        previewInstanceId: identity.previewInstanceId,
        project: identity.project,
      })
      return this.#coordinator.acknowledgeCompiledRevision(message)
    }
    return this.#coordinator.acknowledgePreview(message)
  }

  /** recordPreviewLayoutMeasurements accepts geometry only from the current registered matrix-cell instance. */
  recordPreviewLayoutMeasurements(input: unknown): Readonly<{ accepted: true }> {
    const message = StudioProtocol.parseMessage(input)
    if (message?.type !== 'preview-layout-measurements') {
      Errors.throwUserInput('Expected a valid Tao Studio preview-layout-measurements message.')
    }
    const cellIdentity = completeCellInstanceIdentity(message)
    this.#requireMatrix().assertCurrentInstance(cellIdentity)
    this.#previewLayoutMeasurements.set(
      previewMeasurementCellKey(cellIdentity),
      {
        identity: cellIdentity,
        measurements: new Map(message.measurements.map(measurement => [measurement.renderId, measurement])),
      },
    )
    return { accepted: true }
  }

  /** previewLayoutMeasurement is the read/testing seam for current cell-relative render geometry. */
  previewLayoutMeasurement(
    identity: StudioCellInstanceIdentity,
    renderId: string,
  ): StudioPreviewLayoutMeasurement | undefined {
    this.#requireMatrix().assertCurrentInstance(identity)
    return this.#previewLayoutMeasurements.get(previewMeasurementCellKey(identity))?.measurements.get(renderId)
  }

  /** measuredUnsnapRect synthesizes fallback free geometry when no retained Snap rectangle is available. */
  measuredUnsnapRect(
    identity: StudioCellInstanceIdentity,
    renderId: string,
    sketch: Pick<StudioSketch, 'height' | 'width'>,
  ): StudioSketchRect {
    const measurement = this.previewLayoutMeasurement(identity, renderId)
    if (measurement === undefined || measurement.studioRectId === undefined) {
      throw new StudioSourceActionConflictError(
        'measurement-unavailable',
        'Current preview geometry is not available yet; retry Unsnap after the preview finishes measuring.',
        { renderId },
      )
    }
    return measuredUnsnapRect(measurement, sketch)
  }

  subscribe(listener: (event: StudioSessionEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async handshake(): Promise<StudioSessionHandshake> {
    return {
      apps: this.apps,
      capabilities: {
        drafts: 'disk-synced-parsable',
        language: ['lsp', 'textmate'],
        sourceActions: {
          canonicalEnvelope: true,
          checkpoints: true,
          proposals: true,
          undo: true,
          version: studioSourceActionVersion,
        },
        matrix: {
          concurrentCells: true,
          scheme: 'reactive-browser-fixed-light-native',
          version: 2,
        },
        sketches: { catalogVersion: studioSketchCatalogFormatVersion, freeGeometry: true },
      },
      channel: studioProtocolChannel,
      compile: this.compileSnapshot(),
      endpoints: sessionEndpoints,
      entryPath: FS.relativePath(this.projectRoot, this.entryPath),
      files: await this.files(),
      identity: this.identity(),
      ...(this.#matrix === undefined ? {} : { previewManifest: this.#matrix.publishedManifest() }),
      sketchCatalog: await this.sketchCatalog(),
      protocolVersion: studioProtocolVersion,
      type: 'handshake',
    }
  }

  sketchCatalog(): Promise<StudioSketchCatalogSnapshot> {
    return this.#mutate(() => this.#reconcileSketchCatalog())
  }

  async #reconcileSketchCatalog(): Promise<StudioSketchCatalogSnapshot> {
    const catalog = await this.#sketchCatalog.read()
    const manifest = this.#matrix?.publishedManifest()
    if (manifest?.renders === undefined || catalog.sketches.every(sketch => sketch.snapped.length === 0)) {
      return catalog
    }
    const rendersByMarker = new Map<string, NonNullable<StudioPreviewManifestV2['renders']>>()
    for (const render of manifest.renders) {
      if (render.studioRectId !== undefined) {
        rendersByMarker.set(render.studioRectId, [...(rendersByMarker.get(render.studioRectId) ?? []), render])
      }
    }
    const currentSourceVersions = new Map<string, string | undefined>()
    for (const path of new Set(catalog.sketches.flatMap(sketch => sketch.snapped.map(item => item.target.path)))) {
      try {
        currentSourceVersions.set(path, (await this.readFile(path)).sourceVersion)
      } catch {
        currentSourceVersions.set(path, undefined)
      }
    }
    let changed = false
    const sketches = catalog.sketches.map(sketch => {
      const retained = [] as typeof sketch.snapped[number][]
      const droppedIds = new Set<string>()
      for (const snapped of sketch.snapped) {
        const absolutePath = FS.resolvePath(snapped.target.path, this.projectRoot)
        const manifestSourceVersion = manifest.sourceVersions[absolutePath]
          ?? manifest.sourceVersions[snapped.target.path]
        if (
          manifestSourceVersion === undefined
          || currentSourceVersions.get(snapped.target.path) !== manifestSourceVersion
        ) {
          retained.push(snapped)
          continue
        }
        const matches = rendersByMarker.get(snapped.target.studioRectId) ?? []
        const match = matches.length === 1 && matches[0]?.elementName === snapped.target.elementName
          ? matches[0]
          : undefined
        if (match === undefined) {
          changed = true
          droppedIds.add(snapped.rect.id)
          continue
        }
        const path = FS.relativePath(this.projectRoot, match.source.path)
        const target = {
          ...snapped.target,
          path,
          renderId: match.renderId,
          sourceVersion: manifest.sourceVersions[match.source.path]
            ?? manifest.sourceVersions[path]
            ?? snapped.target.sourceVersion,
        }
        changed ||= JSON.stringify(target) !== JSON.stringify(snapped.target)
        retained.push({ ...snapped, target })
      }
      if (droppedIds.size === 0 && retained.length === sketch.snapped.length) {
        return retained.every((item, index) => item.target === sketch.snapped[index]?.target)
          ? sketch
          : { ...sketch, snapped: retained }
      }
      return {
        ...sketch,
        rectOrder: sketch.rectOrder.filter(id => !droppedIds.has(id)),
        snapped: retained,
      }
    })
    if (!changed) {
      return catalog
    }
    const reconciled = { ...catalog, revision: catalog.revision + 1, sketches }
    await this.#sketchCatalog.restore(reconciled)
    this.#emitSketchCatalog(reconciled)
    return reconciled
  }

  applySketchAction(input: unknown): Promise<StudioSketchActionResult> {
    return this.#mutate(async () => {
      const request = input as StudioSketchCatalogRequest
      const fingerprint = JSON.stringify(input)
      const requestId = isRecord(input) && typeof input['requestId'] === 'string' ? input['requestId'] : undefined
      const cached = requestId === undefined ? undefined : this.#sketchResults.get(requestId)
      if (cached !== undefined) {
        Assert.input(cached.fingerprint === fingerprint, `Studio sketch request id was reused: ${requestId}`)
        return cached.result
      }
      if (isRecord(input) && isRecord(input['action']) && input['action']['kind'] === 'create-sketch') {
        Assert.input(
          input['action']['project'] === this.identity().project,
          'A Studio sketch can only be created in the active project.',
        )
      }
      if (isRecord(input) && isRecord(input['action']) && input['action']['kind'] === 'delete-sketch') {
        Errors.throwUserInput('Deleting a Studio sketch is not available until its generated-source lifecycle lands.')
      }
      if (isRecord(input) && isRecord(input['action']) && input['action']['kind'] === 'refresh-snap-targets') {
        Errors.throwUserInput('Refreshing Studio Snap targets is owned by generated-source transactions.')
      }

      const prior = await this.#sketchCatalog.read()
      let applied = false
      let createdName: string | undefined
      let createdPath: string | undefined
      let writeRegistered = false
      try {
        const catalogResult = await this.#sketchCatalog.apply(request)
        applied = true
        let result: StudioSketchActionResult = catalogResult
        if (request.action.kind === 'create-sketch') {
          const created = catalogResult.createdSketch
          Assert.defined(created, 'create-sketch catalog result includes the allocated sketch')
          createdName = created.name
          const body = await StudioSketchSource.generate(created)
          const generated = new StudioGeneratedSources(this.projectRoot)
          createdPath = await generated.createView(created.name, body)
          const file = await this.readFile(FS.relativePath(this.projectRoot, createdPath))
          writeRegistered = true
          const compile = await this.#coordinator.noteStudioFileMutation([{
            path: createdPath,
            sourceVersion: file.sourceVersion,
            writeId: request.requestId,
          }])
          if (compile.status === 'error') {
            Errors.throwUserInput(
              `Studio did not create ${created.name} because its generated source failed to compile: ${compile.message}`,
            )
          }
          result = { ...catalogResult, compile, generatedFile: file }
          this.#emitFile(file)
          this.#emitFiles(await this.files())
        }
        this.#sketchResults.set(request.requestId, { fingerprint, result })
        trimMap(this.#sketchResults, sourceActionResultLimit)
        this.#emitSketchCatalog(result.catalog)
        return result
      } catch (error) {
        if (applied) {
          if (createdName !== undefined && createdPath !== undefined && await FS.isFile(createdPath)) {
            await new StudioGeneratedSources(this.projectRoot).removeView(createdName)
          }
          await this.#sketchCatalog.restore(prior)
          if (writeRegistered && createdPath !== undefined) {
            await this.#coordinator.noteStudioFileMutation([{
              path: createdPath,
              writeId: `rollback:${request.requestId}`,
            }])
          }
        }
        throw Errors.fromUnknown(error, { requestId: request.requestId, studioOperation: 'sketch-action' })
      }
    })
  }

  proposeSketchSnap(input: unknown): Promise<StudioSketchSnapProposalResult> {
    return this.#mutate(async () => {
      const request = parseSketchSnapRequest(input)
      const fingerprint = JSON.stringify(request)
      const cached = this.#sketchSnapProposalResults.get(request.requestId)
      if (cached !== undefined) {
        Assert.input(cached.fingerprint === fingerprint, `Studio Snap request id was reused: ${request.requestId}`)
        return cached.result
      }
      const prepared = await this.#prepareSketchSnap(request)
      const result: StudioSketchSnapProposalResult = {
        content: prepared.patch.content,
        diff: sourceActionProposalDiff(prepared.current.path, prepared.current.content, prepared.patch.content),
        needsConfirmation: prepared.needsConfirmation,
        path: prepared.current.path,
        projectedRectIds: prepared.projectedRectIds,
        proposedSourceVersion: prepared.patch.sourceVersion,
        requestId: request.requestId,
        sourceVersion: prepared.current.sourceVersion,
        tree: prepared.tree,
      }
      this.#sketchSnapProposalResults.set(request.requestId, { fingerprint, result })
      trimMap(this.#sketchSnapProposalResults, sourceActionResultLimit)
      return result
    })
  }

  applySketchSnap(input: unknown): Promise<StudioSketchSnapApplyResult> {
    return this.#mutate(async () => {
      const request = parseSketchSnapRequest(input)
      const fingerprint = JSON.stringify(request)
      const cached = this.#sketchSnapResults.get(request.requestId)
      if (cached !== undefined) {
        Assert.input(cached.fingerprint === fingerprint, `Studio Snap request id was reused: ${request.requestId}`)
        return cached.result
      }
      const prepared = await this.#prepareSketchSnap(request)
      if (prepared.needsConfirmation) {
        Assert.input(
          request.confirmedProposalVersion === prepared.patch.sourceVersion,
          'Studio Snap overlap requires confirmation of the current canonical proposal.',
        )
      }
      Assert.input(this.#openCheckpointId === undefined, 'Commit the active Studio source-action checkpoint first.')
      Assert.input(
        !this.#actionCheckpoints.has(request.checkpointId) && !this.#sketchSnapCheckpoints.has(request.checkpointId),
        `Studio source-action checkpoint id was reused: ${request.checkpointId}`,
      )

      const generated = new StudioGeneratedSources(this.projectRoot)
      let sourceWritten = false
      try {
        await generated.rewrite(prepared.path, prepared.patch.content)
        sourceWritten = true
        const compile = await this.#coordinator.noteStudioWrite({
          path: prepared.path,
          sourceVersion: prepared.patch.sourceVersion,
          writeId: request.requestId,
        })
        if (compile.status === 'error') {
          await this.#restoreGeneratedSnap(
            generated,
            prepared,
            `rollback:${request.requestId}`,
          )
          Errors.throwUserInput(
            `Studio did not Snap because the generated Tao source failed to compile: ${compile.message}`,
          )
        }
        const targets = await this.#sketchRenderTargets(
          prepared.path,
          prepared.patch.content,
          prepared.patch.sourceVersion,
          [...prepared.beforeTargets.map(target => target.studioRectId), ...prepared.projectedRectIds],
        )
        const catalogResult = await this.#sketchCatalog.apply({
          action: { kind: 'snap-rects', sketchId: request.sketchId, targets },
          expectedRevision: request.expectedCatalogRevision,
          requestId: `catalog:${request.requestId}`,
        })
        const file: StudioProjectFileContent = {
          content: prepared.patch.content,
          ...this.#projectFile(prepared.current.path, prepared.patch.sourceVersion),
        }
        const checkpoint: SketchSnapCheckpoint = {
          afterCatalogRevision: catalogResult.catalog.revision,
          afterContent: prepared.patch.content,
          afterSourceVersion: prepared.patch.sourceVersion,
          beforeContent: prepared.current.content,
          beforeSourceVersion: prepared.current.sourceVersion,
          id: request.checkpointId,
          path: prepared.path,
          status: 'committed',
          undoAction: {
            kind: 'unsnap-rects',
            rectIds: prepared.projectedRectIds,
            sketchId: request.sketchId,
            targets: prepared.beforeTargets,
          },
        }
        this.#sketchSnapCheckpoints.set(checkpoint.id, checkpoint)
        this.#checkpointOrder.push(checkpoint.id)
        this.#trimSourceActionCheckpoints()
        const result: StudioSketchSnapApplyResult = {
          catalog: catalogResult.catalog,
          checkpoint: { id: checkpoint.id, status: 'committed' },
          compile,
          file,
          projectedRectIds: prepared.projectedRectIds,
          requestId: request.requestId,
        }
        this.#sketchSnapResults.set(request.requestId, { fingerprint, result })
        trimMap(this.#sketchSnapResults, sourceActionResultLimit)
        this.#emitCheckpoint(result.checkpoint)
        this.#emitFile(file)
        this.#emitSketchCatalog(result.catalog)
        return result
      } catch (error) {
        if (sourceWritten && (await FS.readText(prepared.path)) !== prepared.current.content) {
          await this.#restoreGeneratedSnap(generated, prepared, `rollback:${request.requestId}`)
        }
        throw Errors.fromUnknown(error, { requestId: request.requestId, studioOperation: 'sketch-snap' })
      }
    })
  }

  /** Applies an authenticated rect-based flow edit as one generated-source/catalog checkpoint. */
  applySketchFlowAction(input: unknown): Promise<StudioSketchSnapApplyResult> {
    return this.#mutate(async () => {
      const request = parseSketchFlowActionRequest(input)
      const fingerprint = JSON.stringify(request)
      const cached = this.#sketchSnapResults.get(request.requestId)
      if (cached !== undefined) {
        Assert.input(cached.fingerprint === fingerprint, `Studio flow request id was reused: ${request.requestId}`)
        return cached.result
      }
      const catalog = await this.#sketchCatalog.read()
      if (catalog.revision !== request.expectedCatalogRevision) {
        throw new StudioSketchCatalogConflictError(request.expectedCatalogRevision, catalog.revision)
      }
      const sketch = catalog.sketches.find(candidate => candidate.id === request.sketchId)
      Assert.input(sketch, `Studio sketch does not exist: ${request.sketchId}`)
      const generatedSources = new StudioGeneratedSources(this.projectRoot)
      const generated = await generatedSources.readView(sketch.view)
      const current = await this.readFile(FS.relativePath(this.projectRoot, generated.path))
      requireSourceVersion(current, request.sourceVersion)
      const expectedPath = FS.relativePath(this.projectRoot, generated.path)
      const associations = new Map(sketch.snapped.map(item => [item.rect.id, item.target]))
      for (const item of sketch.snapped) {
        Assert.input(
          item.target.path === expectedPath
            && item.target.view === sketch.view
            && item.target.studioRectId === item.rect.id
            && item.target.sourceVersion === current.sourceVersion,
          `Studio snapped rectangle target is stale or not owned by ${sketch.view}: ${item.rect.id}`,
        )
      }
      const target = (rectId: string): StudioSketchRenderTarget => {
        const resolved = associations.get(rectId)
        Assert.input(resolved, `Studio snapped rectangle does not exist: ${rectId}`)
        return resolved
      }
      const action: StudioSourcePatchRequest = request.action.kind === 'toggle-direction'
        ? { kind: 'toggle-flow-direction', renderId: target(request.action.rectId).renderId }
        : request.action.kind === 'insert-separator'
        ? {
          afterId: target(request.action.afterRectId).renderId,
          ...(request.action.beforeRectId === undefined
            ? {}
            : { beforeId: target(request.action.beforeRectId).renderId }),
          kind: 'insert-separator',
        }
        : {
          afterId: target(request.action.afterRectId).renderId,
          beforeId: target(request.action.beforeRectId).renderId,
          kind: 'insert-spacer',
          ratio: request.action.ratio,
        }
      const parsed = await this.#workspace.parse(generated.path)
      Assert.input(
        !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
        `Cannot edit flow until ${current.path} parses.`,
      )
      const patch = await SourceActions.applyStudioPatch(parsed.entry.document, action, {
        files: parsed.files.map(file => file.ast),
        occurrence: { nodeKind: 'render', renderOwner: sketch.view },
      })
      Assert.input(this.#openCheckpointId === undefined, 'Commit the active Studio source-action checkpoint first.')
      Assert.input(
        !this.#actionCheckpoints.has(request.checkpointId) && !this.#sketchSnapCheckpoints.has(request.checkpointId),
        `Studio source-action checkpoint id was reused: ${request.checkpointId}`,
      )
      let sourceWritten = false
      let catalogWritten = false
      try {
        await generatedSources.rewrite(generated.path, patch.content)
        sourceWritten = true
        const compile = await this.#coordinator.noteStudioWrite({
          path: generated.path,
          sourceVersion: patch.sourceVersion,
          writeId: request.requestId,
        })
        if (compile.status === 'error') {
          Errors.throwUserInput(
            `Studio did not edit flow because the generated Tao source failed to compile: ${compile.message}`,
          )
        }
        const refreshedTargets = await this.#sketchRenderTargets(
          generated.path,
          patch.content,
          patch.sourceVersion,
          sketch.snapped.map(item => item.rect.id),
        )
        const catalogResult = await this.#sketchCatalog.apply({
          action: { kind: 'refresh-snap-targets', sketchId: sketch.id, targets: refreshedTargets },
          expectedRevision: catalog.revision,
          requestId: `catalog:${request.requestId}`,
        })
        catalogWritten = true
        const file: StudioProjectFileContent = {
          content: patch.content,
          ...this.#projectFile(current.path, patch.sourceVersion),
        }
        const checkpoint: SketchSnapCheckpoint = {
          afterCatalogRevision: catalogResult.catalog.revision,
          afterContent: patch.content,
          afterSourceVersion: patch.sourceVersion,
          beforeContent: current.content,
          beforeSourceVersion: current.sourceVersion,
          id: request.checkpointId,
          path: generated.path,
          status: 'committed',
          undoAction: {
            kind: 'refresh-snap-targets',
            sketchId: sketch.id,
            targets: sketch.snapped.map(item => item.target),
          },
        }
        this.#sketchSnapCheckpoints.set(checkpoint.id, checkpoint)
        this.#checkpointOrder.push(checkpoint.id)
        this.#trimSourceActionCheckpoints()
        const rectIds = request.action.kind === 'toggle-direction'
          ? [request.action.rectId]
          : [
            request.action.afterRectId,
            ...(request.action.beforeRectId === undefined ? [] : [request.action.beforeRectId]),
          ]
        const result: StudioSketchSnapApplyResult = {
          catalog: catalogResult.catalog,
          checkpoint: { id: checkpoint.id, status: 'committed' },
          compile,
          file,
          projectedRectIds: rectIds,
          requestId: request.requestId,
        }
        this.#sketchSnapResults.set(request.requestId, { fingerprint, result })
        trimMap(this.#sketchSnapResults, sourceActionResultLimit)
        this.#emitCheckpoint(result.checkpoint)
        this.#emitFile(file)
        this.#emitSketchCatalog(result.catalog)
        return result
      } catch (error) {
        if (catalogWritten) {
          await this.#sketchCatalog.restore(catalog)
        }
        if (sourceWritten && (await FS.readText(generated.path)) !== current.content) {
          await this.#restoreGeneratedContent(
            generatedSources,
            generated.path,
            current.content,
            current.sourceVersion,
            `rollback:${request.requestId}`,
          )
        }
        throw Errors.fromUnknown(error, { requestId: request.requestId, studioOperation: 'sketch-flow-action' })
      }
    })
  }

  applySketchUnsnap(input: unknown): Promise<StudioSketchSnapApplyResult> {
    return this.#mutate(async () => {
      const request = parseSketchUnsnapRequest(input)
      const fingerprint = JSON.stringify(request)
      const cached = this.#sketchSnapResults.get(request.requestId)
      if (cached !== undefined) {
        Assert.input(cached.fingerprint === fingerprint, `Studio Unsnap request id was reused: ${request.requestId}`)
        return cached.result
      }
      const catalog = await this.#sketchCatalog.read()
      if (catalog.revision !== request.expectedCatalogRevision) {
        throw new StudioSketchCatalogConflictError(request.expectedCatalogRevision, catalog.revision)
      }
      const sketch = catalog.sketches.find(candidate => candidate.id === request.sketchId)
      Assert.input(sketch, `Studio sketch does not exist: ${request.sketchId}`)
      const requestedIds = new Set(request.rectIds)
      const retained = new Map(sketch.snapped.map(item => [item.rect.id, item]))
      const selected = request.rectIds.map(rectId =>
        retained.get(rectId) ?? this.#measuredUnsnapSelection(sketch, rectId)
      )
      const rectIds = selected.map(item => item.rect.id)
      const remainingIds = sketch.snapped.filter(item => !requestedIds.has(item.rect.id)).map(item => item.rect.id)
      const generatedSources = new StudioGeneratedSources(this.projectRoot)
      const generated = await generatedSources.readView(sketch.view)
      const current = await this.readFile(FS.relativePath(this.projectRoot, generated.path))
      requireSourceVersion(current, request.sourceVersion)
      const parsed = await this.#workspace.parse(generated.path)
      Assert.input(
        !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
        `Cannot Unsnap until ${current.path} parses.`,
      )
      const patch = await SourceActions.applyStudioPatch(parsed.entry.document, {
        fallback: { height: sketch.height, label: sketch.view, width: sketch.width },
        kind: 'unsnap-sketch-from-flow',
        rectIds,
        sketchId: sketch.id,
        viewName: sketch.view,
      }, { files: parsed.files.map(file => file.ast) })
      const content = patch.content
      const sourceVersion = patch.sourceVersion
      Assert.input(this.#openCheckpointId === undefined, 'Commit the active Studio source-action checkpoint first.')
      Assert.input(
        !this.#actionCheckpoints.has(request.checkpointId) && !this.#sketchSnapCheckpoints.has(request.checkpointId),
        `Studio source-action checkpoint id was reused: ${request.checkpointId}`,
      )
      let sourceWritten = false
      try {
        await generatedSources.rewrite(generated.path, content)
        sourceWritten = true
        const compile = await this.#coordinator.noteStudioWrite({
          path: generated.path,
          sourceVersion,
          writeId: request.requestId,
        })
        if (compile.status === 'error') {
          await this.#restoreGeneratedContent(
            generatedSources,
            generated.path,
            current.content,
            current.sourceVersion,
            `rollback:${request.requestId}`,
          )
          Errors.throwUserInput(
            `Studio did not Unsnap because the generated Tao source failed to compile: ${compile.message}`,
          )
        }
        const survivingTargets = await this.#sketchRenderTargets(
          generated.path,
          content,
          sourceVersion,
          remainingIds,
        )
        const synthetic = selected.some(item => !retained.has(item.rect.id))
        const catalogResult = synthetic
          ? await this.#restoreMeasuredUnsnapCatalog(
            catalog,
            sketch,
            selected,
            requestedIds,
            survivingTargets,
            request.requestId,
          )
          : await this.#sketchCatalog.apply({
            action: { kind: 'unsnap-rects', rectIds, sketchId: sketch.id, targets: survivingTargets },
            expectedRevision: request.expectedCatalogRevision,
            requestId: `catalog:${request.requestId}`,
          })
        const file: StudioProjectFileContent = {
          content,
          ...this.#projectFile(current.path, sourceVersion),
        }
        const checkpoint: SketchSnapCheckpoint = {
          afterCatalogRevision: catalogResult.catalog.revision,
          afterContent: content,
          afterSourceVersion: sourceVersion,
          beforeContent: current.content,
          beforeSourceVersion: current.sourceVersion,
          id: request.checkpointId,
          path: generated.path,
          status: 'committed',
          undoAction: {
            kind: 'snap-rects',
            sketchId: sketch.id,
            targets: [
              ...sketch.snapped.map(item => item.target),
              ...selected.filter(item => !retained.has(item.rect.id)).map(item => item.target),
            ],
          },
        }
        this.#sketchSnapCheckpoints.set(checkpoint.id, checkpoint)
        this.#checkpointOrder.push(checkpoint.id)
        this.#trimSourceActionCheckpoints()
        const result: StudioSketchSnapApplyResult = {
          catalog: catalogResult.catalog,
          checkpoint: { id: checkpoint.id, status: 'committed' },
          compile,
          file,
          projectedRectIds: rectIds,
          requestId: request.requestId,
        }
        this.#sketchSnapResults.set(request.requestId, { fingerprint, result })
        trimMap(this.#sketchSnapResults, sourceActionResultLimit)
        this.#emitCheckpoint(result.checkpoint)
        this.#emitFile(file)
        this.#emitSketchCatalog(result.catalog)
        return result
      } catch (error) {
        if (sourceWritten && (await FS.readText(generated.path)) !== current.content) {
          await this.#restoreGeneratedContent(
            generatedSources,
            generated.path,
            current.content,
            current.sourceVersion,
            `rollback:${request.requestId}`,
          )
        }
        throw Errors.fromUnknown(error, { requestId: request.requestId, studioOperation: 'sketch-unsnap' })
      }
    })
  }

  undoSketchSnap(input: unknown): Promise<StudioSketchSnapUndoResult> {
    return this.#mutate(async () => {
      const request = parseSketchSnapUndoRequest(input)
      const fingerprint = JSON.stringify(request)
      const cached = this.#sketchSnapUndoResults.get(request.requestId)
      if (cached !== undefined) {
        Assert.input(cached.fingerprint === fingerprint, `Studio Snap undo request id was reused: ${request.requestId}`)
        return cached.result
      }
      Assert.input(
        this.#checkpointOrder.at(-1) === request.checkpointId,
        'Studio can only undo the latest committed source-action checkpoint.',
      )
      const checkpoint = this.#sketchSnapCheckpoints.get(request.checkpointId)
      Assert.input(
        checkpoint?.status === 'committed',
        `Studio Snap checkpoint is not undoable: ${request.checkpointId}`,
      )
      const current = await this.readFile(FS.relativePath(this.projectRoot, checkpoint.path))
      requireSourceVersion(current, request.sourceVersion)
      requireSourceVersion(current, checkpoint.afterSourceVersion)
      const catalog = await this.#sketchCatalog.read()
      if (
        catalog.revision !== request.expectedCatalogRevision || catalog.revision !== checkpoint.afterCatalogRevision
      ) {
        throw new StudioSketchCatalogConflictError(request.expectedCatalogRevision, catalog.revision)
      }

      const generated = new StudioGeneratedSources(this.projectRoot)
      await generated.rewrite(checkpoint.path, checkpoint.beforeContent)
      const compile = await this.#coordinator.noteStudioWrite({
        path: checkpoint.path,
        sourceVersion: checkpoint.beforeSourceVersion,
        writeId: request.requestId,
      })
      if (compile.status === 'error') {
        await generated.rewrite(checkpoint.path, checkpoint.afterContent)
        await this.#coordinator.noteStudioWrite({
          path: checkpoint.path,
          sourceVersion: checkpoint.afterSourceVersion,
          writeId: `rollback:${request.requestId}`,
        })
        Errors.throwUserInput(
          `Studio did not undo Snap because the original Tao source failed to compile: ${compile.message}`,
        )
      }
      let undoneCatalog: StudioSketchCatalogSnapshot
      try {
        undoneCatalog = (await this.#sketchCatalog.apply({
          action: checkpoint.undoAction,
          expectedRevision: catalog.revision,
          requestId: `catalog:${request.requestId}`,
        })).catalog
      } catch (error) {
        await generated.rewrite(checkpoint.path, checkpoint.afterContent)
        await this.#coordinator.noteStudioWrite({
          path: checkpoint.path,
          sourceVersion: checkpoint.afterSourceVersion,
          writeId: `rollback:${request.requestId}`,
        })
        throw error
      }
      checkpoint.status = 'undone'
      this.#checkpointOrder.pop()
      const file: StudioProjectFileContent = {
        content: checkpoint.beforeContent,
        ...this.#projectFile(FS.relativePath(this.projectRoot, checkpoint.path), checkpoint.beforeSourceVersion),
      }
      const result: StudioSketchSnapUndoResult = {
        catalog: undoneCatalog,
        checkpoint: { id: checkpoint.id, status: 'undone' },
        compile,
        file,
        requestId: request.requestId,
      }
      this.#sketchSnapUndoResults.set(request.requestId, { fingerprint, result })
      trimMap(this.#sketchSnapUndoResults, sourceActionResultLimit)
      this.#emitCheckpoint(result.checkpoint)
      this.#emitFile(file)
      this.#emitSketchCatalog(result.catalog)
      return result
    })
  }

  async #prepareSketchSnap(request: StudioSketchSnapRequest): Promise<PreparedSketchSnap> {
    const catalog = await this.#sketchCatalog.read()
    if (catalog.revision !== request.expectedCatalogRevision) {
      throw new StudioSketchCatalogConflictError(request.expectedCatalogRevision, catalog.revision)
    }
    const sketch = catalog.sketches.find(candidate => candidate.id === request.sketchId)
    Assert.input(sketch, `Studio sketch does not exist: ${request.sketchId}`)
    const selected = request.rectIds.map(id => {
      const rect = sketch.rects.find(candidate => candidate.id === id)
      Assert.input(rect, `Studio rectangle does not exist: ${id}`)
      return rect
    })
    const projection = StudioSketchProjection.project({ height: sketch.height, rects: selected, width: sketch.width })
    const combinedProjection = StudioSketchProjection.project({
      height: sketch.height,
      rects: [...sketch.snapped.map(item => item.rect), ...selected],
      width: sketch.width,
    })
    const merge = sketch.snapped.length === 0
      ? {
        direction: combinedProjection.tree.type === 'container' ? combinedProjection.tree.direction : 'Row' as const,
        position: 'after' as const,
      }
      : StudioSketchSnap.mergePlan({
        existingRectIds: sketch.snapped.map(item => item.rect.id),
        projectedRectIds: request.rectIds,
        projection: combinedProjection,
      })
    const prepared = StudioSketchSnap.prepare({
      expectedCatalogRevision: request.expectedCatalogRevision,
      mergeDirection: merge.direction,
      mergePosition: merge.position,
      projection,
      rects: selected,
      sketchId: sketch.id,
      viewName: sketch.view,
    })
    const generated = await new StudioGeneratedSources(this.projectRoot).readView(sketch.view)
    const current = await this.readFile(FS.relativePath(this.projectRoot, generated.path))
    requireSourceVersion(current, request.sourceVersion)
    const parsed = await this.#workspace.parse(generated.path)
    Assert.input(
      !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
      `Cannot Snap until ${current.path} parses.`,
    )
    const patch = await SourceActions.applyStudioPatch(parsed.entry.document, prepared.action, {
      files: parsed.files.map(file => file.ast),
    })
    return {
      beforeTargets: sketch.snapped.map(item => item.target),
      current,
      needsConfirmation: projection.needsOverlay || combinedProjection.needsOverlay,
      patch,
      path: generated.path,
      projectedRectIds: request.rectIds,
      request,
      tree: prepared.action.tree,
    }
  }

  async #restoreGeneratedSnap(
    generated: StudioGeneratedSources,
    prepared: PreparedSketchSnap,
    writeId: string,
  ): Promise<void> {
    await this.#restoreGeneratedContent(
      generated,
      prepared.path,
      prepared.current.content,
      prepared.current.sourceVersion,
      writeId,
    )
  }

  async #restoreGeneratedContent(
    generated: StudioGeneratedSources,
    path: string,
    content: string,
    sourceVersion: string,
    writeId: string,
  ): Promise<void> {
    await generated.rewrite(path, content)
    await this.#coordinator.noteStudioWrite({
      path,
      sourceVersion,
      writeId,
    })
  }

  async #sketchRenderTargets(
    path: string,
    content: string,
    sourceVersion: string,
    rectIds: readonly string[],
  ): Promise<readonly StudioSketchRenderTarget[]> {
    const parsed = await this.#workspace.parseSource(content, Langium.URI.file(path))
    Assert.input(
      !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
      'Studio Snap compiled source must remain parseable while associations are recorded.',
    )
    const targets = new Map<string, StudioSketchRenderTarget>()
    for (const render of AST.streamAllContents(parsed.entry.ast).filter(AST.isRender)) {
      const tag = AST.testTagForRender(render)
      const rectId = tag === undefined ? undefined : decodeStudioRectTag(tag)
      if (rectId === undefined || !rectIds.includes(rectId)) {
        continue
      }
      Assert.input(!targets.has(rectId), `Studio Snap emitted duplicate rectangle identity: ${rectId}`)
      const cst = render.$cstNode
      Assert.input(cst, `Studio Snap emitted rectangle ${rectId} without source coordinates.`)
      const elementName = render.view?.$refText
      Assert.input(elementName, `Studio Snap emitted rectangle ${rectId} without an element name.`)
      const relativePath = FS.relativePath(this.projectRoot, path)
      targets.set(rectId, {
        elementName,
        path: relativePath,
        renderId: `${path}:${cst.offset}:${cst.end}`,
        sourceVersion,
        studioRectId: rectId,
        view: AST.findOwningView(render)?.name ?? '',
      })
    }
    return rectIds.map(rectId => {
      const target = targets.get(rectId)
      Assert.input(target, `Studio Snap did not emit a render identity for rectangle: ${rectId}`)
      return target
    })
  }

  #measuredUnsnapSelection(sketch: StudioSketch, studioRectId: string): StudioSnappedRect {
    const manifest = this.#matrix?.publishedManifest()
    const matches = manifest?.renders?.filter(render => render.studioRectId === studioRectId) ?? []
    if (matches.length !== 1) {
      throw measurementUnavailable(studioRectId)
    }
    const render = matches[0]!
    const measurements: StudioPreviewLayoutMeasurement[] = []
    for (const cached of this.#previewLayoutMeasurements.values()) {
      try {
        this.#requireMatrix().assertCurrentInstance(cached.identity)
      } catch {
        continue
      }
      const measurement = cached.measurements.get(render.renderId)
      if (measurement !== undefined) {
        measurements.push(measurement)
      }
    }
    if (measurements.length !== 1 || measurements[0]!.elementName !== render.elementName) {
      throw measurementUnavailable(render.renderId)
    }
    const path = FS.relativePath(this.projectRoot, render.source.path)
    const sourceVersion = manifest?.sourceVersions[render.source.path] ?? manifest?.sourceVersions[path]
    if (sourceVersion === undefined) {
      throw measurementUnavailable(render.renderId)
    }
    return {
      rect: measuredUnsnapRect(measurements[0]!, sketch),
      target: {
        elementName: render.elementName,
        path,
        renderId: render.renderId,
        sourceVersion,
        studioRectId,
        view: sketch.view,
      },
    }
  }

  async #restoreMeasuredUnsnapCatalog(
    catalog: StudioSketchCatalogSnapshot,
    sketch: StudioSketch,
    selected: readonly StudioSnappedRect[],
    requestedIds: ReadonlySet<string>,
    survivingTargets: readonly StudioSketchRenderTarget[],
    requestId: string,
  ): Promise<StudioSketchCatalogResult> {
    const order = [...sketch.rectOrder]
    for (const item of selected) {
      if (!order.includes(item.rect.id)) {
        order.push(item.rect.id)
      }
    }
    const positions = new Map(order.map((id, index) => [id, index]))
    const targets = new Map(survivingTargets.map(target => [target.studioRectId, target]))
    const replacement = {
      ...sketch,
      rectOrder: order,
      rects: [...sketch.rects, ...selected.map(item => item.rect)]
        .toSorted((left, right) => positions.get(left.id)! - positions.get(right.id)!),
      snapped: sketch.snapped.filter(item => !requestedIds.has(item.rect.id)).map(item => {
        const target = targets.get(item.rect.id)
        Assert.defined(target, `Studio measured Unsnap did not refresh surviving rectangle ${item.rect.id}.`)
        return { ...item, target }
      }),
    }
    const next = {
      ...catalog,
      revision: catalog.revision + 1,
      sketches: catalog.sketches.map(candidate => candidate.id === sketch.id ? replacement : candidate),
    }
    await this.#sketchCatalog.restore(next)
    return { catalog: next, requestId: `catalog:${requestId}` }
  }

  #requireMatrix(): StudioMatrixSession {
    Assert.input(this.#matrix, 'Studio preview manifest is not available yet.')
    return this.#matrix
  }

  async files(): Promise<StudioProjectFile[]> {
    const paths = await Repo.filesUnder(this.projectRoot, {
      excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
      extensions: ['.tao'],
    })
    const files = await Promise.all(paths.map(async path => {
      try {
        const content = await FS.readText(path)
        return this.#projectFile(
          FS.relativePath(this.projectRoot, path),
          SourceActions.studioSourceVersion(content),
        )
      } catch (error) {
        // A watcher may remove a file after discovery but before this snapshot reads it.
        if (!await FS.isFile(path)) {
          return undefined
        }
        throw error
      }
    }))
    return files.filter(file => file !== undefined)
  }

  async readFile(path: string): Promise<StudioProjectFileContent> {
    const resolved = await this.#resolveTaoFile(path)
    const content = await FS.readText(resolved)
    return {
      content,
      ...this.#projectFile(
        FS.relativePath(this.projectRoot, resolved),
        SourceActions.studioSourceVersion(content),
      ),
    }
  }

  createFile(request: StudioCreateFileRequest): Promise<StudioCreateFileResult> {
    return this.#mutate(async () => {
      const path = await this.#resolveNewTaoFile(request.path)
      const content = ''
      const sourceVersion = SourceActions.studioSourceVersion(content)
      await FS.writeText(path, content)
      const compile = await this.#coordinator.noteStudioFileMutation([{
        path,
        sourceVersion,
        writeId: request.writeId,
      }])
      const file: StudioProjectFileContent = {
        content,
        ...this.#projectFile(FS.relativePath(this.projectRoot, path), sourceVersion),
      }
      this.#emitFile(file)
      const files = await this.files()
      this.#emitFiles(files)
      return { compile, file, files }
    })
  }

  renameFile(request: StudioRenameFileRequest): Promise<StudioRenameFileResult> {
    return this.#mutate(async () => {
      const current = await this.readFile(request.path)
      requireSourceVersion(current, request.sourceVersion)
      this.#requireFileMutationAllowed(current.path)
      const path = await this.#resolveTaoFile(current.path)
      Assert.input(await FS.realPath(path) !== this.entryPath, 'Studio cannot rename the active app entry file.')
      const targetPath = await this.#resolveNewTaoFile(request.targetPath)
      await FS.move(path, targetPath)
      const compile = await this.#coordinator.noteStudioFileMutation([
        { path, writeId: request.writeId },
        { path: targetPath, sourceVersion: current.sourceVersion, writeId: request.writeId },
      ])
      const file: StudioProjectFileContent = {
        content: current.content,
        ...this.#projectFile(FS.relativePath(this.projectRoot, targetPath), current.sourceVersion),
      }
      const files = await this.files()
      this.#emitFiles(files)
      return { compile, file, files, previousPath: current.path }
    })
  }

  moveGeneratedSource(request: StudioMoveGeneratedSourceRequest): Promise<StudioMoveGeneratedSourceResult> {
    return this.#mutate(async () => {
      const current = await this.readFile(request.path)
      requireSourceVersion(current, request.sourceVersion)
      const match = current.path.match(/^@\/studio\/([A-Z][A-Za-z0-9_]*)\.tao$/)
      Assert.input(match, 'Move to package requires a generated @/studio/<Name>.tao source.')
      Assert.input(
        current.content.startsWith(`${studioGeneratedSourceHeader}\n`),
        `${current.path} is not a Studio-generated source.`,
      )
      const name = match[1]!
      const targetPackage = normalizedTargetPackage(request.targetPackage)
      const conflicts = await this.#targetPackageDeclarationConflicts(targetPackage, name)
      if (conflicts.length > 0) {
        return { conflicts, name, status: 'confirmation-required', targetPackage }
      }

      const sourcePath = FS.resolvePath(current.path, this.projectRoot)
      const beforeCatalog = await this.#sketchCatalog.read()
      const catalogSketches = beforeCatalog.sketches.filter(sketch => sketch.view === name)
      Assert.input(catalogSketches.length <= 1, `Move to package found multiple sketches for generated view ${name}.`)
      const catalogSketch = catalogSketches[0]

      const sourceFiles = await this.files()
      const rewrites: Array<{ content: string; current: StudioProjectFileContent; path: string }> = []
      for (const file of sourceFiles) {
        const fileContent = file.path === current.path ? current : await this.readFile(file.path)
        const rewritten = await this.#rewriteGeneratedImport(fileContent, name, targetPackage)
        if (rewritten !== undefined) {
          rewrites.push({
            content: rewritten,
            current: fileContent,
            path: FS.resolvePath(file.path, this.projectRoot),
          })
        }
      }
      const movedContent = rewrites.find(rewrite => rewrite.current.path === current.path)?.content ?? current.content
      const generated = new StudioGeneratedSources(this.projectRoot)
      let targetPath: string | undefined
      let retiredCatalog: StudioSketchCatalogSnapshot | undefined
      try {
        targetPath = await generated.moveView(name, targetPackage, movedContent)
        const rewritten: StudioProjectFileContent[] = []
        for (const rewrite of rewrites.filter(candidate => candidate.current.path !== current.path)) {
          if (rewrite.current.path.startsWith('@/studio/')) {
            await generated.rewrite(rewrite.path, rewrite.content)
          } else {
            await FS.writeText(rewrite.path, rewrite.content)
          }
          const sourceVersion = SourceActions.studioSourceVersion(rewrite.content)
          rewritten.push({
            content: rewrite.content,
            ...this.#projectFile(rewrite.current.path, sourceVersion),
          })
        }
        const targetContent = await FS.readText(targetPath)
        const targetSourceVersion = SourceActions.studioSourceVersion(targetContent)
        const file: StudioProjectFileContent = {
          content: targetContent,
          ...this.#projectFile(FS.relativePath(this.projectRoot, targetPath), targetSourceVersion),
        }
        const compile = await this.#coordinator.noteStudioFileMutation([
          { path: sourcePath, writeId: request.writeId },
          { path: targetPath, sourceVersion: targetSourceVersion, writeId: request.writeId },
          ...rewritten.map(candidate => ({
            path: FS.resolvePath(candidate.path, this.projectRoot),
            sourceVersion: candidate.sourceVersion,
            writeId: request.writeId,
          })),
        ])
        if (compile.status === 'error') {
          Errors.throwUserInput(
            `Studio did not move ${name} because the authored Tao source failed to compile: ${compile.message}`,
          )
        }
        const files = await this.files()
        if (catalogSketch !== undefined) {
          retiredCatalog = (await this.#sketchCatalog.apply({
            action: { id: catalogSketch.id, kind: 'delete-sketch' },
            expectedRevision: beforeCatalog.revision,
            requestId: `catalog:${request.writeId}`,
          })).catalog
        }
        for (const changed of rewritten) {
          this.#emitFile(changed)
        }
        this.#emitFiles(files)
        if (retiredCatalog !== undefined) {
          this.#emitSketchCatalog(retiredCatalog)
        }
        return { compile, file, files, previousPath: current.path, rewritten, status: 'moved' }
      } catch (error) {
        if (targetPath !== undefined) {
          const rollbackFailures: unknown[] = []
          try {
            if (await FS.isFile(targetPath)) {
              if (await FS.exists(sourcePath)) {
                await FS.remove(targetPath)
              } else {
                await FS.move(targetPath, sourcePath)
              }
            }
            if (await FS.isFile(sourcePath)) {
              await generated.rewrite(sourcePath, current.content)
            } else {
              await FS.writeText(sourcePath, current.content)
              await FS.chmod(sourcePath, 0o444)
            }
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError)
          }
          for (const rewrite of rewrites.filter(candidate => candidate.current.path !== current.path)) {
            try {
              if (rewrite.current.path.startsWith('@/studio/')) {
                await generated.rewrite(rewrite.path, rewrite.current.content)
              } else {
                await FS.writeText(rewrite.path, rewrite.current.content)
              }
            } catch (rollbackError) {
              rollbackFailures.push(rollbackError)
            }
          }
          if (retiredCatalog !== undefined) {
            try {
              await this.#sketchCatalog.restore(beforeCatalog)
            } catch (rollbackError) {
              rollbackFailures.push(rollbackError)
            }
          }
          try {
            const rollback = await this.#coordinator.noteStudioFileMutation([
              { path: sourcePath, sourceVersion: current.sourceVersion, writeId: `rollback:${request.writeId}` },
              { path: targetPath, writeId: `rollback:${request.writeId}` },
              ...rewrites.filter(candidate => candidate.current.path !== current.path).map(rewrite => ({
                path: rewrite.path,
                sourceVersion: rewrite.current.sourceVersion,
                writeId: `rollback:${request.writeId}`,
              })),
            ])
            if (rollback.status === 'error') {
              rollbackFailures.push(new Errors.HostEnvironmentError(rollback.message))
            }
          } catch (rollbackError) {
            rollbackFailures.push(rollbackError)
          }
          if (rollbackFailures.length > 0) {
            Errors.throwHostEnvironment(
              `Studio could not completely roll back the failed move of ${name}.`,
              { cause: rollbackFailures[0] },
            )
          }
        }
        throw Errors.fromUnknown(error, { studioOperation: 'move-generated-source', writeId: request.writeId })
      }
    })
  }

  async #targetPackageDeclarationConflicts(targetPackage: string, name: string): Promise<string[]> {
    const directory = FS.resolvePath(targetPackage, this.projectRoot)
    Assert.input(await FS.isDirectory(directory), `Target Tao package does not exist: ${targetPackage}`)
    const conflicts: string[] = []
    for (const child of await FS.listDir(directory)) {
      if (!child.endsWith('.tao')) {
        continue
      }
      const path = FS.resolvePath(child, directory)
      const parsed = await this.#workspace.parseSource(await FS.readText(path), Langium.URI.file(path))
      Assert.input(
        !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
        `Cannot move generated source until ${FS.relativePath(this.projectRoot, path)} parses.`,
      )
      if (parsed.entry.ast.statements.some(statement => AST.isDeclaration(statement) && statement.name === name)) {
        conflicts.push(FS.relativePath(this.projectRoot, path))
      }
    }
    return conflicts
  }

  async #rewriteGeneratedImport(
    file: StudioProjectFileContent,
    name: string,
    targetPackage: string,
  ): Promise<string | undefined> {
    const path = FS.resolvePath(file.path, this.projectRoot)
    const parsed = await this.#workspace.parseSource(file.content, Langium.URI.file(path))
    Assert.input(
      !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
      `Cannot move generated source until ${file.path} parses.`,
    )
    return rewriteGeneratedStudioImports(file.content, parsed.entry.ast, name, targetPackage)
  }

  deleteFile(request: StudioDeleteFileRequest): Promise<StudioDeleteFileResult> {
    return this.#mutate(async () => {
      const current = await this.readFile(request.path)
      requireSourceVersion(current, request.sourceVersion)
      this.#requireFileMutationAllowed(current.path)
      const path = await this.#resolveTaoFile(current.path)
      Assert.input(await FS.realPath(path) !== this.entryPath, 'Studio cannot delete the active app entry file.')
      await FS.remove(path)
      const compile = await this.#coordinator.noteStudioFileMutation([{ path, writeId: request.writeId }])
      const deleted = this.#projectFile(current.path, current.sourceVersion)
      const files = await this.files()
      this.#emitFiles(files)
      return { compile, deleted, files }
    })
  }

  syncDraft(request: StudioDraftWriteRequest): Promise<StudioDraftWriteResult> {
    return this.#mutate(async () => {
      const current = await this.readFile(request.path)
      requireSourceVersion(current, request.sourceVersion)
      const resolved = await this.#resolveTaoFile(request.path)
      const parsed = await this.#workspace.parseSource(request.content, Langium.URI.file(resolved))
      const diagnostics = Diagnostics.errorMessages(parsed.diagnostics, 'lexer', 'parser')
      if (diagnostics.length > 0) {
        this.#draftStates.set(current.path, { diagnostics, dirty: true })
        const file = { ...current, ...this.#projectFile(current.path, current.sourceVersion) }
        this.#emitFile(file)
        return { diagnostics, file, saved: false }
      }

      const sourceVersion = SourceActions.studioSourceVersion(request.content)
      await FS.writeText(resolved, request.content)
      const compile = await this.#coordinator.noteStudioWrite({
        path: resolved,
        sourceVersion,
        writeId: request.writeId,
      })
      this.#draftStates.delete(current.path)
      const file: StudioProjectFileContent = {
        content: request.content,
        ...this.#projectFile(current.path, sourceVersion),
      }
      this.#emitFile(file)
      return { compile, diagnostics: [], file, saved: true }
    })
  }

  applySourceAction(input: unknown): Promise<StudioSourceActionResult> {
    return this.#mutate(async () => {
      const envelope = StudioProtocol.parseSourceActionEnvelope(input)
      Assert.input(envelope, 'Expected a valid Tao Studio source-action v2 envelope.')
      requireSessionIdentity(envelope, this.identity())
      this.#acceptPreviewIdentity(envelope)

      const fingerprint = JSON.stringify(envelope)
      const cached = this.#actionResults.get(envelope.requestId)
      if (cached !== undefined) {
        Assert.input(
          cached.fingerprint === fingerprint,
          `Studio source-action request id was reused: ${envelope.requestId}`,
        )
        return cached.result
      }

      const { current, patch, path } = await this.#prepareSourceAction(envelope)
      const checkpoint = this.#prepareSourceActionCheckpoint(envelope, current)
      await FS.writeText(path, patch.content)
      const compile = await this.#coordinator.noteStudioWrite({
        path,
        sourceVersion: patch.sourceVersion,
        writeId: envelope.requestId,
      })
      if (envelope.action.kind === 'insert-captured-fixture' && compile.status === 'error') {
        await FS.writeText(path, current.content)
        const rollback = await this.#coordinator.noteStudioWrite({
          path,
          sourceVersion: current.sourceVersion,
          writeId: `rollback:${envelope.requestId}`,
        })
        this.#emitFile(current)
        const compileMessage = compile.diagnostics[0]?.message ?? compile.message
        const rollbackMessage = rollback.status === 'compiled'
          ? 'The original Tao source was restored.'
          : `The original Tao source was restored, but its preview still failed to compile: ${rollback.message}`
        Errors.throwUserInput(
          `Studio did not save the fixture because its Tao source failed to compile: ${compileMessage} ${rollbackMessage}`,
        )
      }
      const result: StudioSourceActionResult = {
        checkpoint: this.#recordSourceActionCheckpoint(envelope, checkpoint, patch.sourceVersion),
        compile,
        content: patch.content,
        edits: patch.edits,
        path: current.path,
        requestId: envelope.requestId,
        sourceVersion: patch.sourceVersion,
      }
      this.#emitCheckpoint(result.checkpoint)
      this.#actionResults.set(envelope.requestId, { fingerprint, result })
      trimMap(this.#actionResults, sourceActionResultLimit)
      this.#emitFile({
        ...this.#projectFile(current.path, patch.sourceVersion),
      })
      return result
    })
  }

  /** Produces the exact canonical patch and compact diff without writing source or reserving a checkpoint. */
  proposeSourceAction(input: unknown): Promise<StudioSourceActionProposal> {
    return this.#mutate(async () => {
      const envelope = StudioProtocol.parseSourceActionEnvelope(input)
      Assert.input(envelope, 'Expected a valid Tao Studio source-action v2 envelope.')
      requireSessionIdentity(envelope, this.identity())
      const { current, patch } = await this.#prepareSourceAction(envelope)
      return {
        content: patch.content,
        diff: sourceActionProposalDiff(current.path, current.content, patch.content),
        edits: patch.edits,
        path: current.path,
        proposedSourceVersion: patch.sourceVersion,
        requestId: envelope.requestId,
        sourceVersion: current.sourceVersion,
      }
    })
  }

  async #prepareSourceAction(envelope: StudioSourceActionEnvelope): Promise<PreparedSourceAction> {
    this.#acceptPreviewIdentity(envelope)
    const current = await this.readFile(envelope.identity.path)
    requireSourceVersion(current, envelope.identity.sourceVersion)
    const path = await this.#resolveTaoFile(current.path)
    const parsed = await this.#workspace.parse(path)
    Assert.input(
      !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
      `Cannot apply a Studio source action until ${current.path} parses.`,
    )
    const request = sourcePatchRequest(envelope)
    requireSourceActionPreconditions(envelope, request)
    this.#requireScenarioActionIdentity(envelope, request)
    try {
      const patch = await SourceActions.applyStudioPatch(parsed.entry.document, request, {
        files: parsed.files.map(file => file.ast),
        ...(envelope.identity.occurrence === undefined ? {} : { occurrence: envelope.identity.occurrence }),
      })
      return { current, envelope, patch, path }
    } catch (error) {
      if (error instanceof StudioSourceOccurrenceConflictError) {
        throw new StudioSourceActionConflictError(error.code, error.message, {
          actual: error.actual,
          expected: error.expected,
          path: current.path,
          renderId: error.renderId,
        })
      }
      throw error
    }
  }

  inspectRender(request: StudioInspectRenderRequest): Promise<StudioRenderInspection> {
    return this.#mutate(async () => {
      const current = await this.readFile(request.path)
      requireSourceVersion(current, request.sourceVersion)
      const path = await this.#resolveTaoFile(current.path)
      const parsed = await this.#workspace.parse(path)
      Assert.input(
        !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
        `Cannot inspect a Studio render until ${current.path} parses.`,
      )
      return SourceActions.inspectStudioRender(parsed.entry.document, request.renderId, {
        files: parsed.files.map(file => file.ast),
      })
    })
  }

  inspectDesign(
    request: Pick<StudioInspectRenderRequest, 'path' | 'sourceVersion'>,
  ): Promise<readonly StudioDesignValue[]> {
    return this.#mutate(async () => {
      const current = await this.readFile(request.path)
      requireSourceVersion(current, request.sourceVersion)
      const path = await this.#resolveTaoFile(current.path)
      const parsed = await this.#workspace.parse(path)
      Assert.input(
        !Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser'),
        `Cannot inspect Studio design values until ${current.path} parses.`,
      )
      const values: StudioDesignValue[] = []
      for (const design of parsed.entry.ast.statements.filter(AST.isDesignDeclaration)) {
        for (const member of design.block.members) {
          if (AST.isDesignToken(member)) {
            values.push({
              designName: design.name,
              ...studioDesignSource(member),
              kind: 'token',
              name: member.name,
              value: member.value,
            })
          } else if (AST.isDesignBundle(member)) {
            values.push({
              designName: design.name,
              ...studioDesignSource(member),
              entries: member.spec.entries.flatMap(entry => entry.$cstNode?.text ?? []),
              kind: 'bundle',
              name: member.name,
            })
          } else if (AST.isDesignColorsBlock(member)) {
            for (const entry of member.entries) {
              values.push({
                designName: design.name,
                ...studioDesignSource(entry),
                kind: 'color',
                name: entry.name,
                value: entry.value.$cstNode?.text ?? '',
              })
              for (const family of entry.family?.members ?? []) {
                values.push({
                  designName: design.name,
                  ...studioDesignSource(family),
                  kind: 'color',
                  name: `${entry.name}.${family.name}`,
                  value: family.value.$cstNode?.text ?? '',
                })
              }
            }
          } else if (AST.isDesignSizesBlock(member)) {
            for (const entry of member.entries) {
              values.push({
                designName: design.name,
                ...studioDesignSource(entry),
                kind: 'size',
                name: entry.name,
                value: entry.value.$cstNode?.text ?? '',
              })
            }
          } else if (AST.isDesignTextBlock(member)) {
            for (const entry of member.entries) {
              values.push({
                designName: design.name,
                ...studioDesignSource(entry),
                entries: entry.spec.entries.flatMap(candidate => candidate.$cstNode?.text ?? []),
                kind: 'text',
                name: entry.name,
              })
            }
          } else if (AST.isDesignScreensBlock(member)) {
            for (const entry of member.entries) {
              values.push({
                designName: design.name,
                ...studioDesignSource(entry),
                kind: 'screen',
                name: entry.name,
                value: entry.threshold === undefined ? 'otherwise' : `below ${entry.threshold.$cstNode?.text ?? ''}`,
              })
            }
          } else if (AST.isDesignStylesBlock(member)) {
            for (const entry of member.entries) {
              values.push({
                designName: design.name,
                ...studioDesignSource(entry),
                entries: entry.spec.entries.flatMap(candidate => candidate.$cstNode?.text ?? []),
                kind: /^[A-Z]/.test(entry.name) ? 'default' : 'style',
                name: entry.name,
              })
            }
          }
        }
      }
      return values
    })
  }

  undoSourceAction(input: unknown): Promise<StudioSourceActionUndoResult> {
    return this.#mutate(async () => {
      const envelope = StudioProtocol.parseSourceActionUndoEnvelope(input)
      Assert.input(envelope, 'Expected a valid Tao Studio source-action undo v2 envelope.')
      requireSessionIdentity(envelope, this.identity())
      this.#acceptPreviewIdentity(envelope)

      const fingerprint = JSON.stringify(envelope)
      const cached = this.#actionUndoResults.get(envelope.requestId)
      if (cached !== undefined) {
        Assert.input(
          cached.fingerprint === fingerprint,
          `Studio source-action undo request id was reused: ${envelope.requestId}`,
        )
        return cached.result
      }

      Assert.input(
        this.#openCheckpointId === undefined,
        'Commit the active Studio source-action checkpoint before undoing.',
      )
      const latestCheckpointId = this.#checkpointOrder.at(-1)
      Assert.input(
        latestCheckpointId === envelope.checkpointId,
        'Studio can only undo the latest committed source-action checkpoint.',
      )
      const checkpoint = this.#actionCheckpoints.get(envelope.checkpointId)
      if (checkpoint === undefined || checkpoint.status !== 'committed') {
        Errors.throwUserInput(`Studio source-action checkpoint is not undoable: ${envelope.checkpointId}`)
      }
      const current = await this.readFile(envelope.identity.path)
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
      requireSourceVersion(current, envelope.identity.sourceVersion)
      requireSourceVersion(current, checkpoint.afterSourceVersion)
      const path = await this.#resolveTaoFile(current.path)
      await FS.writeText(path, checkpoint.beforeContent)
      const compile = await this.#coordinator.noteStudioWrite({
        path,
        sourceVersion: checkpoint.beforeSourceVersion,
        writeId: envelope.requestId,
      })
      checkpoint.status = 'undone'
      this.#checkpointOrder.pop()
      const result: StudioSourceActionUndoResult = {
        checkpoint: { id: checkpoint.id, status: 'undone' },
        compile,
        content: checkpoint.beforeContent,
        path: checkpoint.path,
        requestId: envelope.requestId,
        sourceVersion: checkpoint.beforeSourceVersion,
      }
      this.#emitCheckpoint(result.checkpoint)
      this.#actionUndoResults.set(envelope.requestId, { fingerprint, result })
      trimMap(this.#actionUndoResults, sourceActionResultLimit)
      this.#emitFile({
        ...this.#projectFile(checkpoint.path, checkpoint.beforeSourceVersion),
      })
      return result
    })
  }

  async noteWatchChanges(changes: readonly StudioSourceChange[]): Promise<StudioWatchResult> {
    const normalized = await Promise.all(changes.map(async change => ({
      ...change,
      path: await this.#resolveTaoWatchPath(change.path),
    })))
    const result = await this.#coordinator.noteWatchChanges(normalized)
    if (result.acknowledgements.length > 0) {
      this.#emit({
        acknowledgements: result.acknowledgements,
        channel: studioProtocolChannel,
        protocolVersion: studioProtocolVersion,
        type: 'studio-writes-acknowledged',
      })
    }
    return result
  }

  async #resolveTaoWatchPath(path: string): Promise<string> {
    const resolved = FS.resolvePath(path, this.projectRoot)
    Assert.input(FS.extname(resolved) === '.tao', `Studio path is not a Tao file in the project: ${path}`)
    const missingParts = [FS.basename(resolved)]
    let ancestor = FS.dirname(resolved)
    while (!await FS.isDirectory(ancestor)) {
      const parent = FS.dirname(ancestor)
      Assert.input(parent !== ancestor, `Studio path is not a Tao file in the project: ${path}`)
      missingParts.unshift(FS.basename(ancestor))
      ancestor = parent
    }
    const canonical = FS.resolvePath(missingParts.join('/'), await FS.realPath(ancestor))
    Assert.input(
      FS.pathIsWithin(canonical, this.projectRoot),
      `Studio path is not a Tao file in the project: ${path}`,
    )
    if (await FS.isFile(canonical)) {
      const realPath = await FS.realPath(canonical)
      Assert.input(
        FS.pathIsWithin(realPath, this.projectRoot),
        `Studio path resolves outside the project: ${path}`,
      )
    }
    return canonical
  }

  async #resolveTaoFile(path: string): Promise<string> {
    const resolved = FS.resolvePath(path, this.projectRoot)
    Assert.input(
      FS.pathIsWithin(resolved, this.projectRoot) && FS.extname(resolved) === '.tao' && await FS.isFile(resolved),
      `Studio path is not a Tao file in the project: ${path}`,
    )
    const realPath = await FS.realPath(resolved)
    Assert.input(
      FS.pathIsWithin(realPath, this.projectRoot),
      `Studio path resolves outside the project: ${path}`,
    )
    return resolved
  }

  async #resolveNewTaoFile(path: string): Promise<string> {
    const resolved = FS.resolvePath(path, this.projectRoot)
    Assert.input(
      FS.pathIsWithin(resolved, this.projectRoot) && FS.extname(resolved) === '.tao',
      `Studio path is not a Tao file in the project: ${path}`,
    )
    Assert.input(
      !await FS.exists(resolved),
      `Studio file already exists: ${FS.relativePath(this.projectRoot, resolved)}`,
    )
    const missingParts = [FS.basename(resolved)]
    let ancestor = FS.dirname(resolved)
    while (!await FS.isDirectory(ancestor)) {
      Assert.input(!await FS.exists(ancestor), `Studio file parent is not a folder: ${path}`)
      const parent = FS.dirname(ancestor)
      Assert.input(parent !== ancestor, `Studio path is not a Tao file in the project: ${path}`)
      missingParts.unshift(FS.basename(ancestor))
      ancestor = parent
    }
    const canonical = FS.resolvePath(missingParts.join('/'), await FS.realPath(ancestor))
    Assert.input(
      FS.pathIsWithin(canonical, this.projectRoot),
      `Studio path resolves outside the project: ${path}`,
    )
    return resolved
  }

  #requireFileMutationAllowed(path: string): void {
    Assert.input(
      !this.fileDraftState(path).dirty,
      `Save or discard the unsaved Studio draft before changing ${path}.`,
    )
  }

  #projectFile(path: string, sourceVersion: string): StudioProjectFile {
    const draft = this.fileDraftState(path)
    const diagnosticCount = draft.diagnostics.length + this.#coordinator.snapshot().diagnostics.filter(diagnostic => {
      if (diagnostic.filePath === undefined) {
        return false
      }
      const diagnosticPath = FS.resolvePath(diagnostic.filePath, this.projectRoot)
      return FS.pathIsWithin(diagnosticPath, this.projectRoot)
        && FS.relativePath(this.projectRoot, diagnosticPath) === path
    }).length
    return { diagnosticCount, dirty: draft.dirty, kind: 'file', path, sourceVersion }
  }

  #acceptPreviewIdentity(envelope: StudioSourceActionEnvelope | StudioSourceActionUndoEnvelope): void {
    const identity = envelope.identity
    if (identity.cellId !== undefined) {
      if (
        identity.cellRevision === undefined
        || identity.compileRevision === undefined
        || identity.manifestRevision === undefined
      ) {
        Errors.throwUserInput('Studio source action has an incomplete cell identity.')
      }
      const runtime = this.#requireMatrix().assertCurrentInstance({
        appName: identity.appName,
        cellId: identity.cellId,
        cellRevision: identity.cellRevision,
        compileRevision: identity.compileRevision,
        manifestRevision: identity.manifestRevision,
        previewInstanceId: identity.previewInstanceId,
        project: identity.project,
      })
      if (identity.scenarioId === undefined || identity.scenarioId !== runtime.cell.scenarioId) {
        throw new StudioSourceActionConflictError(
          'stale-scenario',
          'Studio source action targets a scenario that is no longer active in this cell.',
          {
            actual: runtime.cell.scenarioId,
            expected: identity.scenarioId,
            path: identity.path,
          },
        )
      }
      return
    }
    Assert.input(
      identity.scenarioId === undefined,
      'Studio source action has scenario identity without cell identity.',
    )
    const active = this.#coordinator.snapshot().previewInstanceId
    if (active === undefined) {
      this.#coordinator.setPreviewInstance(envelope.identity.previewInstanceId)
      return
    }
    if (active !== envelope.identity.previewInstanceId) {
      throw new StudioSourceActionConflictError(
        'stale-preview',
        'Studio source action came from a stale preview instance.',
        {
          actual: active,
          expected: envelope.identity.previewInstanceId,
          path: identity.path,
        },
      )
    }
  }

  #prepareSourceActionCheckpoint(
    envelope: StudioSourceActionEnvelope,
    current: StudioProjectFileContent,
  ): SourceActionCheckpoint {
    const { id, phase } = envelope.checkpoint
    const existing = this.#actionCheckpoints.get(id)
    if (phase === 'begin' || phase === 'single') {
      if (this.#openCheckpointId !== undefined && this.#openCheckpointId !== id) {
        this.#commitAbandonedCheckpoint(this.#openCheckpointId)
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

  #requireScenarioActionIdentity(
    envelope: StudioSourceActionEnvelope,
    request: StudioSourcePatchRequest,
  ): void {
    if (request.kind !== 'set-scenario-arguments') {
      return
    }
    Assert.input(
      envelope.identity.cellId !== undefined && envelope.identity.scenarioId !== undefined,
      'Studio scenario source actions require cell and scenario identity.',
    )
    const scenario = this.#requireMatrix().publishedManifest().scenarios
      .find(candidate => candidate.scenarioId === envelope.identity.scenarioId)
    if (scenario === undefined) {
      throw new StudioSourceActionConflictError(
        'stale-scenario',
        'Studio source action targets a scenario that is no longer in the active manifest.',
        { expected: envelope.identity.scenarioId, path: envelope.identity.path },
      )
    }
    if (scenario.group !== request.scenarioGroupName || scenario.label !== request.scenarioName) {
      throw new StudioSourceActionConflictError(
        'scenario-action-mismatch',
        'Studio scenario source action does not match its authenticated scenario identity.',
        {
          actual: `${request.scenarioGroupName}/${request.scenarioName}`,
          expected: `${scenario.group}/${scenario.label}`,
          path: envelope.identity.path,
        },
      )
    }
  }

  #commitAbandonedCheckpoint(id: string): void {
    const checkpoint = this.#actionCheckpoints.get(id)
    if (checkpoint === undefined || checkpoint.status !== 'open') {
      this.#openCheckpointId = undefined
      return
    }
    checkpoint.status = 'committed'
    this.#openCheckpointId = undefined
    this.#checkpointOrder.push(id)
    this.#trimSourceActionCheckpoints()
    this.#emitCheckpoint({ id, status: 'committed' })
  }

  #recordSourceActionCheckpoint(
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
    this.#checkpointOrder.push(checkpoint.id)
    this.#trimSourceActionCheckpoints()
    return { id: checkpoint.id, status: 'committed' }
  }

  #trimSourceActionCheckpoints(): void {
    while (this.#checkpointOrder.length > 100) {
      const expired = this.#checkpointOrder.shift()
      if (expired !== undefined) {
        this.#actionCheckpoints.delete(expired)
        this.#sketchSnapCheckpoints.delete(expired)
      }
    }
  }

  #emit(event: StudioSessionEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch {
        // A disconnected or faulty observer must not interrupt source writes or strand compile waiters.
      }
    }
  }

  #emitFile(file: StudioProjectFile): void {
    this.#emit({
      channel: studioProtocolChannel,
      file,
      protocolVersion: studioProtocolVersion,
      type: 'file-changed',
    })
  }

  #emitFiles(files: readonly StudioProjectFile[]): void {
    this.#emit({
      channel: studioProtocolChannel,
      files,
      protocolVersion: studioProtocolVersion,
      type: 'files-changed',
    })
  }

  #emitCheckpoint(checkpoint: Pick<StudioCheckpointSummary, 'id' | 'status'>): void {
    this.#emit({
      channel: studioProtocolChannel,
      checkpoint,
      protocolVersion: studioProtocolVersion,
      type: 'checkpoint-changed',
    })
  }

  #emitSketchCatalog(catalog: StudioSketchCatalogSnapshot): void {
    this.#emit({
      catalog,
      channel: studioProtocolChannel,
      protocolVersion: studioProtocolVersion,
      type: 'sketch-catalog-changed',
    })
  }

  #mutate<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.#mutationLane.then(mutation, mutation)
    this.#mutationLane = result.then(() => undefined, () => undefined)
    return result
  }
}

function trimMap<Key, Value>(map: Map<Key, Value>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next()
    if (oldest.done) {
      return
    }
    map.delete(oldest.value)
  }
}

function parseSketchSnapRequest(value: unknown): StudioSketchSnapRequest {
  Assert.input(isRecord(value), 'Studio Snap request must be an object.')
  requireOnlyInputKeys(
    value,
    [
      'checkpointId',
      'confirmedProposalVersion',
      'expectedCatalogRevision',
      'rectIds',
      'requestId',
      'sketchId',
      'sourceVersion',
    ],
    'Studio Snap request',
  )
  const checkpointId = requireInputText(value['checkpointId'], 'Studio Snap checkpointId')
  const requestId = requireInputText(value['requestId'], 'Studio Snap requestId')
  const sketchId = requireInputText(value['sketchId'], 'Studio Snap sketchId')
  const sourceVersion = requireInputText(value['sourceVersion'], 'Studio Snap sourceVersion')
  Assert.input(
    Number.isSafeInteger(value['expectedCatalogRevision']) && Number(value['expectedCatalogRevision']) >= 0,
    'Studio Snap expectedCatalogRevision must be a nonnegative integer.',
  )
  Assert.input(Array.isArray(value['rectIds']) && value['rectIds'].length > 0, 'Studio Snap rectIds must not be empty.')
  const rectIds = value['rectIds'].map((id, index) => requireInputText(id, `Studio Snap rectIds[${index}]`))
  Assert.input(new Set(rectIds).size === rectIds.length, 'Studio Snap rectIds must be unique.')
  const confirmedProposalVersion = value['confirmedProposalVersion'] === undefined
    ? undefined
    : requireInputText(value['confirmedProposalVersion'], 'Studio Snap confirmedProposalVersion')
  return {
    checkpointId,
    ...(confirmedProposalVersion === undefined ? {} : { confirmedProposalVersion }),
    expectedCatalogRevision: Number(value['expectedCatalogRevision']),
    rectIds,
    requestId,
    sketchId,
    sourceVersion,
  }
}

function parseSketchSnapUndoRequest(value: unknown): StudioSketchSnapUndoRequest {
  Assert.input(isRecord(value), 'Studio Snap undo request must be an object.')
  requireOnlyInputKeys(
    value,
    ['checkpointId', 'expectedCatalogRevision', 'requestId', 'sourceVersion'],
    'Studio Snap undo request',
  )
  Assert.input(
    Number.isSafeInteger(value['expectedCatalogRevision']) && Number(value['expectedCatalogRevision']) >= 0,
    'Studio Snap undo expectedCatalogRevision must be a nonnegative integer.',
  )
  return {
    checkpointId: requireInputText(value['checkpointId'], 'Studio Snap undo checkpointId'),
    expectedCatalogRevision: Number(value['expectedCatalogRevision']),
    requestId: requireInputText(value['requestId'], 'Studio Snap undo requestId'),
    sourceVersion: requireInputText(value['sourceVersion'], 'Studio Snap undo sourceVersion'),
  }
}

function parseSketchFlowActionRequest(value: unknown): StudioSketchFlowActionRequest {
  Assert.input(isRecord(value), 'Studio flow request must be an object.')
  requireOnlyInputKeys(
    value,
    ['action', 'checkpointId', 'expectedCatalogRevision', 'requestId', 'sketchId', 'sourceVersion'],
    'Studio flow request',
  )
  Assert.input(
    Number.isSafeInteger(value['expectedCatalogRevision']) && Number(value['expectedCatalogRevision']) >= 0,
    'Studio flow expectedCatalogRevision must be a nonnegative integer.',
  )
  Assert.input(isRecord(value['action']), 'Studio flow action must be an object.')
  const raw = value['action']
  let action: StudioSketchFlowAction
  if (raw['kind'] === 'toggle-direction') {
    requireOnlyInputKeys(raw, ['kind', 'rectId'], 'Studio toggle-direction action')
    action = { kind: 'toggle-direction', rectId: requireInputText(raw['rectId'], 'Studio flow rectId') }
  } else if (raw['kind'] === 'insert-separator') {
    requireOnlyInputKeys(raw, ['afterRectId', 'beforeRectId', 'kind'], 'Studio insert-separator action')
    action = {
      afterRectId: requireInputText(raw['afterRectId'], 'Studio flow afterRectId'),
      ...(raw['beforeRectId'] === undefined
        ? {}
        : { beforeRectId: requireInputText(raw['beforeRectId'], 'Studio flow beforeRectId') }),
      kind: 'insert-separator',
    }
  } else if (raw['kind'] === 'insert-spacer') {
    requireOnlyInputKeys(raw, ['afterRectId', 'beforeRectId', 'kind', 'ratio'], 'Studio insert-spacer action')
    Assert.input(
      Array.isArray(raw['ratio'])
        && raw['ratio'].length === 2
        && raw['ratio'].every(value => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100),
      'Studio flow Spacer ratio must contain two integers from 1 through 100.',
    )
    action = {
      afterRectId: requireInputText(raw['afterRectId'], 'Studio flow afterRectId'),
      beforeRectId: requireInputText(raw['beforeRectId'], 'Studio flow beforeRectId'),
      kind: 'insert-spacer',
      ratio: [Number(raw['ratio'][0]), Number(raw['ratio'][1])],
    }
  } else {
    Errors.throwUserInput(`Unsupported Studio flow action: ${String(raw['kind'])}`)
  }
  return {
    action,
    checkpointId: requireInputText(value['checkpointId'], 'Studio flow checkpointId'),
    expectedCatalogRevision: Number(value['expectedCatalogRevision']),
    requestId: requireInputText(value['requestId'], 'Studio flow requestId'),
    sketchId: requireInputText(value['sketchId'], 'Studio flow sketchId'),
    sourceVersion: requireInputText(value['sourceVersion'], 'Studio flow sourceVersion'),
  }
}

function parseSketchUnsnapRequest(value: unknown): StudioSketchUnsnapRequest {
  Assert.input(isRecord(value), 'Studio Unsnap request must be an object.')
  requireOnlyInputKeys(
    value,
    ['checkpointId', 'expectedCatalogRevision', 'rectIds', 'requestId', 'sketchId', 'sourceVersion'],
    'Studio Unsnap request',
  )
  const parsed = parseSketchSnapRequest(value)
  return {
    checkpointId: parsed.checkpointId,
    expectedCatalogRevision: parsed.expectedCatalogRevision,
    rectIds: parsed.rectIds,
    requestId: parsed.requestId,
    sketchId: parsed.sketchId,
    sourceVersion: parsed.sourceVersion,
  }
}

function requireOnlyInputKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(value).filter(key => !allowed.includes(key))
  Assert.input(unsupported.length === 0, `${label} has unsupported fields: ${unsupported.join(', ')}`)
}

function requireInputText(value: unknown, label: string): string {
  Assert.input(typeof value === 'string' && value.trim().length > 0, `${label} must be a nonempty string.`)
  return value
}

function decodeStudioRectTag(tag: string): string | undefined {
  const encoded = tag.match(/^studio_rect_([0-9a-f]+)$/)?.[1]
  if (encoded === undefined || encoded.length % 4 !== 0) {
    return undefined
  }
  let decoded = ''
  for (let index = 0; index < encoded.length; index += 4) {
    decoded += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 4), 16))
  }
  for (let index = 0; index < decoded.length; index += 1) {
    const codeUnit = decoded.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = decoded.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return undefined
      }
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return undefined
    }
  }
  return decoded
}

async function requireProjectRoot(input: string): Promise<string> {
  const resolved = FS.resolvePath(input)
  Assert.input(await FS.isDirectory(resolved), `Studio project folder does not exist: ${resolved}`)
  return await FS.realPath(resolved)
}

async function discoverAppVariants(
  projectRoot: string,
  workspace: Workspace,
): Promise<StudioAppVariant[]> {
  const candidates = await Repo.filesUnder(projectRoot, {
    excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
    extensions: ['.tao'],
  })
  const apps: StudioAppVariant[] = []
  for (const entryPath of candidates) {
    const parsed = await workspace.parse(entryPath)
    for (const declaration of AST.appValueDeclarationsInFile(parsed.entry.ast)) {
      apps.push({ appName: declaration.name, entryPath: FS.relativePath(projectRoot, entryPath) })
    }
  }
  return apps.toSorted((left, right) =>
    left.appName.localeCompare(right.appName) || left.entryPath.localeCompare(right.entryPath)
  )
}

function resolveAppSelection(
  projectRoot: string,
  apps: readonly StudioAppVariant[],
  requestedAppName: string | undefined,
  requestedEntryPath: string | undefined,
): StudioAppVariant {
  const matching = apps.filter(app =>
    (requestedAppName === undefined || app.appName === requestedAppName)
    && (requestedEntryPath === undefined || app.entryPath === requestedEntryPath)
  )
  if (matching.length === 0) {
    const available = apps.map(app => app.appName)
    Errors.throwUserInput(
      requestedAppName === undefined && requestedEntryPath === undefined
        ? `No Tao app declaration found under ${projectRoot}`
        : `No matching Tao app found. Available apps: ${available.join(', ') || 'none'}.`,
    )
  }
  Assert.input(
    matching.length === 1,
    requestedAppName === undefined && requestedEntryPath === undefined
      ? `Multiple Tao apps found: ${matching.map(app => app.appName).join(', ')}. Select an appName.`
      : `Multiple matching Tao app declarations were found. Select an appName and entryPath.`,
  )
  return matching[0]!
}

async function resolveEntryPath(projectRoot: string, input: string): Promise<string> {
  const resolved = FS.resolvePath(input, projectRoot)
  Assert.input(
    FS.extname(resolved) === '.tao' && await FS.isFile(resolved),
    `Studio entry is not a Tao file in the project: ${input}`,
  )
  const realPath = await FS.realPath(resolved)
  Assert.input(FS.pathIsWithin(realPath, projectRoot), `Studio entry resolves outside the project: ${input}`)
  return realPath
}

function requireSourceVersion(file: StudioProjectFile, expected: string): void {
  if (file.sourceVersion !== expected) {
    throw new StudioSourceConflictError(file.path, expected, file.sourceVersion)
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

function requireSessionIdentity(
  envelope: StudioSourceActionEnvelope | StudioSourceActionUndoEnvelope,
  expected: StudioProjectIdentity,
): void {
  Assert.input(
    envelope.identity.project === expected.project && envelope.identity.appName === expected.appName,
    'Studio source action targets a different project or app.',
  )
}

function sourcePatchRequest(envelope: StudioSourceActionEnvelope): StudioSourcePatchRequest {
  const action = envelope.action
  if (
    action.kind === 'insert-captured-fixture'
    && typeof action['fixtureName'] === 'string'
    && isCapturedFixturePlan(action['plan'])
  ) {
    return {
      fixtureName: action['fixtureName'],
      kind: action.kind,
      plan: action['plan'],
    }
  }
  if (action.kind === 'insert-component' && isStudioComponentKind(action['component'])) {
    return {
      ...(typeof action['afterId'] === 'string' ? { afterId: action['afterId'] } : {}),
      ...(typeof action['beforeId'] === 'string' ? { beforeId: action['beforeId'] } : {}),
      component: action['component'],
      kind: action.kind,
    }
  }
  if (action.kind === 'insert-project-view' && typeof action['viewName'] === 'string') {
    return {
      ...(typeof action['afterId'] === 'string' ? { afterId: action['afterId'] } : {}),
      ...(typeof action['beforeId'] === 'string' ? { beforeId: action['beforeId'] } : {}),
      kind: action.kind,
      viewName: action['viewName'],
    }
  }
  if (
    action.kind === 'move-render'
    && typeof action['draggedId'] === 'string'
    && (action['afterId'] === undefined || typeof action['afterId'] === 'string')
    && (action['beforeId'] === undefined || typeof action['beforeId'] === 'string')
  ) {
    return {
      ...(typeof action['afterId'] === 'string' ? { afterId: action['afterId'] } : {}),
      ...(typeof action['beforeId'] === 'string' ? { beforeId: action['beforeId'] } : {}),
      draggedId: action['draggedId'],
      kind: action.kind,
    }
  }
  if (
    action.kind === 'set-layout-entry'
    && typeof action['renderId'] === 'string'
    && Array.isArray(action['entry'])
    && action['entry'].every(value => typeof value === 'string' || typeof value === 'number')
  ) {
    return {
      entry: action['entry'] as unknown as StudioLayoutEntry,
      kind: action.kind,
      renderId: action['renderId'],
    }
  }
  if (action.kind === 'wrap-render' && typeof action['renderId'] === 'string' && action['wrapper'] === 'Stack') {
    return { kind: action.kind, renderId: action['renderId'], wrapper: action['wrapper'] }
  }
  if (
    action.kind === 'set-style-entry'
    && typeof action['renderId'] === 'string'
    && Array.isArray(action['entry'])
    && action['entry'].length > 0
    && action['entry'].every(value => typeof value === 'string' || typeof value === 'number')
    && isStudioStyleLandingScope(action['landing'])
  ) {
    return {
      entry: action['entry'] as unknown as StudioStyleEntry,
      kind: action.kind,
      landing: action['landing'],
      renderId: action['renderId'],
    }
  }
  if (
    action.kind === 'set-scenario-arguments'
    && (action['appearance'] === undefined || action['appearance'] === 'dark' || action['appearance'] === 'light')
    && typeof action['scenarioGroupName'] === 'string'
    && typeof action['scenarioName'] === 'string'
    && isRecord(action['arguments'])
    && Object.values(action['arguments']).every(isStudioScenarioArgumentValue)
  ) {
    return {
      ...(action['appearance'] === undefined ? {} : { appearance: action['appearance'] }),
      arguments: action['arguments'] as Readonly<Record<string, StudioScenarioArgumentValue>>,
      kind: action.kind,
      scenarioGroupName: action['scenarioGroupName'],
      scenarioName: action['scenarioName'],
    }
  }
  Errors.throwUserInput(`Unsupported or invalid Studio source action: ${action.kind}`)
}

function requireSourceActionPreconditions(
  envelope: StudioSourceActionEnvelope,
  request: StudioSourcePatchRequest,
): void {
  const occurrenceRequired = request.kind === 'move-render'
    || request.kind === 'set-layout-entry'
    || request.kind === 'set-style-entry'
    || request.kind === 'wrap-render'
    || (request.kind === 'insert-component' || request.kind === 'insert-project-view')
      && (request.beforeId !== undefined || request.afterId !== undefined)
  Assert.input(
    !occurrenceRequired || envelope.identity.occurrence !== undefined,
    `Studio source action requires render occurrence identity: ${request.kind}`,
  )
  Assert.input(
    occurrenceRequired || envelope.identity.occurrence === undefined,
    `Studio source action cannot carry render occurrence identity: ${request.kind}`,
  )
}

function isStudioStyleLandingScope(value: unknown): value is StudioStyleLandingScope {
  if (!isRecord(value)) {
    return false
  }
  if (value['kind'] === 'element-inline') {
    return true
  }
  if (value['kind'] === 'style-bundle') {
    return typeof value['bundleName'] === 'string'
      && (value['mode'] === 'edit' || value['mode'] === 'fork')
      && (value['forkName'] === undefined || typeof value['forkName'] === 'string')
  }
  if (value['kind'] === 'element-default') {
    return typeof value['elementName'] === 'string'
  }
  return (value['kind'] === 'token' || value['kind'] === 'size-token') && typeof value['tokenName'] === 'string'
}

function isCapturedFixturePlan(value: unknown): value is StudioInsertCapturedFixturePatchRequest['plan'] {
  return isRecord(value)
    && Array.isArray(value['accounts'])
    && value['accounts'].every(account =>
      isRecord(account)
      && typeof account['name'] === 'string'
      && isFixtureFields(account['fields'])
    )
    && Array.isArray(value['creates'])
    && value['creates'].every(create =>
      isRecord(create)
      && typeof create['entity'] === 'string'
      && typeof create['name'] === 'string'
      && isFixtureFields(create['fields'])
    )
}

function isFixtureFields(value: unknown): value is Readonly<Record<string, StudioScenarioArgumentValue>> {
  return isRecord(value) && Object.values(value).every(isStudioScenarioArgumentValue)
}

function sourceActionProposalDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  let prefix = 0
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < beforeLines.length - prefix
    && suffix < afterLines.length - prefix
    && beforeLines[beforeLines.length - suffix - 1] === afterLines[afterLines.length - suffix - 1]
  ) {
    suffix += 1
  }
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix)
  const added = afterLines.slice(prefix, afterLines.length - suffix)
  const beforeStart = removed.length === 0 ? prefix : prefix + 1
  const afterStart = added.length === 0 ? prefix : prefix + 1
  return [
    `--- ${path}`,
    `+++ ${path} (proposed)`,
    `@@ -${beforeStart},${removed.length} +${afterStart},${added.length} @@`,
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
  ].join('\n')
}

function isStudioScenarioArgumentValue(value: unknown): value is
  | boolean
  | number
  | string
  | { kind: 'now' }
  | { handle: string; kind: 'fixture-reference' }
{
  return typeof value === 'boolean'
    || typeof value === 'string'
    || typeof value === 'number' && Number.isFinite(value)
    || isRecord(value) && value['kind'] === 'now'
    || isRecord(value)
      && value['kind'] === 'fixture-reference'
      && typeof value['handle'] === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cellIdentity(value: unknown): StudioCellIdentity {
  if (
    !isRecord(value)
    || typeof value['appName'] !== 'string'
    || typeof value['cellId'] !== 'string'
    || !nonNegativeInteger(value['cellRevision'])
    || !nonNegativeInteger(value['compileRevision'])
    || typeof value['manifestRevision'] !== 'string'
    || typeof value['project'] !== 'string'
  ) {
    Errors.throwUserInput('Expected a complete Studio cell identity.')
  }
  return {
    appName: value['appName'],
    cellId: value['cellId'],
    cellRevision: value['cellRevision'],
    compileRevision: value['compileRevision'],
    manifestRevision: value['manifestRevision'],
    project: value['project'],
  }
}

function completeCellInstanceIdentity(message: StudioPreviewLayoutMeasurementsMessage): StudioCellInstanceIdentity {
  const identity = message.identity
  if (
    identity.cellId === undefined
    || identity.cellRevision === undefined
    || identity.compileRevision === undefined
    || identity.manifestRevision === undefined
  ) {
    Errors.throwUserInput('Expected a complete Studio cell preview identity for layout measurements.')
  }
  return {
    appName: identity.appName,
    cellId: identity.cellId,
    cellRevision: identity.cellRevision,
    compileRevision: identity.compileRevision,
    manifestRevision: identity.manifestRevision,
    previewInstanceId: identity.previewInstanceId,
    project: identity.project,
  }
}

function previewMeasurementCellKey(identity: StudioCellInstanceIdentity): string {
  return [
    identity.project,
    identity.appName,
    identity.manifestRevision,
    identity.compileRevision,
    identity.cellId,
    identity.cellRevision,
    identity.previewInstanceId,
  ].join('\u0000')
}

function cellInstanceIdentity(value: unknown): StudioCellInstanceIdentity {
  const identity = cellIdentity(value)
  if (!isRecord(value) || typeof value['previewInstanceId'] !== 'string') {
    Errors.throwUserInput('Expected a Studio cell preview instance id.')
  }
  return { ...identity, previewInstanceId: value['previewInstanceId'] }
}

function cellReconfigureRequest(value: unknown): StudioCellReconfigureRequest {
  const identity = cellIdentity(value)
  if (!isRecord(value)) {
    Errors.throwUserInput('Expected a Studio cell reconfiguration.')
  }
  const args = value['args']
  const environment = value['environment']
  const rawReplay = value['replay']
  const replay = rawReplay === undefined ? undefined : StudioProtocol.parseRuntimeCapture(rawReplay)
  const stateLayers = value['stateLayers']
  Assert.input(
    args === undefined || isRecord(args) && isJsonValue(args),
    'Studio cell arguments must be JSON data.',
  )
  Assert.input(environment === undefined || isRecord(environment), 'Studio cell environment must be an object.')
  Assert.input(
    rawReplay === undefined || replay !== undefined,
    'Studio cell replay must be a valid runtime capture artifact.',
  )
  Assert.input(
    stateLayers === undefined || Array.isArray(stateLayers) && stateLayers.every(isString),
    'Studio cell state layers must be names.',
  )
  return {
    ...identity,
    ...(args === undefined ? {} : { args: args as StudioJsonObject }),
    ...(environment === undefined ? {} : { environment: environment as StudioCellEnvironment }),
    ...(replay === undefined ? {} : { replay }),
    ...(stateLayers === undefined ? {} : { stateLayers: stateLayers as readonly string[] }),
  }
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isStudioComponentKind(value: unknown): value is StudioComponentKind {
  return typeof value === 'string' && studioComponentKinds.has(value as StudioComponentKind)
}

const studioComponentKinds = new Set<StudioComponentKind>([
  'Box',
  'Button',
  'Checkbox',
  'Col',
  'DatePicker',
  'FormButton',
  'Image',
  'Number',
  'Panes',
  'Picker',
  'Progress',
  'Row',
  'ScrollView',
  'SegmentedControl',
  'Slider',
  'Spinner',
  'Stack',
  'Switch',
  'Text',
  'TextFrame',
  'TextInput',
  'TextMultiline',
  'WrappingRow',
])

export type StudioSourceActionConflictCode =
  | 'checkpoint-identity-mismatch'
  | 'node-kind-mismatch'
  | 'render-owner-mismatch'
  | 'measurement-unavailable'
  | 'scenario-action-mismatch'
  | 'stale-preview'
  | 'stale-scenario'
  | 'stale-source'

export type StudioSourceActionConflictDetails = {
  actual?: string
  checkpointId?: string
  expected?: string
  path?: string
  renderId?: string
}

/** StudioSourceActionConflictError carries stable, UI-safe conflict details across the Studio server boundary. */
export class StudioSourceActionConflictError extends Error {
  override readonly name: string = 'StudioSourceActionConflictError'

  constructor(
    readonly code: StudioSourceActionConflictCode,
    message: string,
    readonly details: StudioSourceActionConflictDetails,
  ) {
    super(message)
  }
}

/** StudioSourceConflictError reports optimistic source-version mismatches as HTTP 409 at the server boundary. */
export class StudioSourceConflictError extends StudioSourceActionConflictError {
  override readonly name = 'StudioSourceConflictError'

  constructor(
    readonly path: string,
    readonly expectedSourceVersion: string,
    readonly actualSourceVersion: string,
  ) {
    super('stale-source', `Studio source changed before the edit was applied: ${path}`, {
      actual: actualSourceVersion,
      expected: expectedSourceVersion,
      path,
    })
  }
}

/**
 * Converts cell-relative preview geometry to sketch geometry. Both coordinate spaces currently share a zero origin;
 * when the sketch board gains an offset, the caller must subtract that offset before invoking this seam.
 */
function measuredUnsnapRect(
  measurement: StudioPreviewLayoutMeasurement,
  sketch: Pick<StudioSketch, 'height' | 'width'>,
): StudioSketchRect {
  Assert.input(
    measurement.studioRectId !== undefined,
    'A measured Studio Unsnap rectangle requires its Snap marker identity.',
  )
  Assert.input(
    measurement.rect.width > 0 && measurement.rect.height > 0,
    'A measured Studio Unsnap rectangle requires positive geometry.',
  )
  const width = Math.min(measurement.rect.width, sketch.width)
  const height = Math.min(measurement.rect.height, sketch.height)
  const x = Math.min(measurement.rect.x, sketch.width - width)
  const y = Math.min(measurement.rect.y, sketch.height - height)
  return {
    height,
    id: measurement.studioRectId,
    kind: measurement.elementName,
    width,
    x,
    y,
  }
}

function measurementUnavailable(renderId: string): StudioSourceActionConflictError {
  return new StudioSourceActionConflictError(
    'measurement-unavailable',
    'Current preview geometry is not available yet; retry Unsnap after the preview finishes measuring.',
    { renderId },
  )
}
