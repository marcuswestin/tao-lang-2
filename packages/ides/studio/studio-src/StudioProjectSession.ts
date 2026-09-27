import { loadSemanticSnapshot, type SemanticSnapshot, Workspace } from '@compiler/workspace'
import { AST, Langium, type ParseResult } from '@parser'
import { Assert, Diagnostics, Errors, FS, Json, ReleaseToolchain } from '@shared'
import SourceActions, {
  type StudioRenderInspection,
  StudioSourceOccurrenceConflictError,
  type StudioSourcePatchRequest,
} from '@source-actions'
import { discoverStudioApp, requireStudioProjectRoot } from './session/StudioAppDiscovery'
import {
  type SketchSnapCheckpoint,
  type SourceActionCheckpoint,
  StudioCheckpointLedger,
} from './session/StudioCheckpointLedger'
import { type StudioDesignValue, studioDesignValues } from './session/StudioDesignInspection'
import { StudioFileOperations } from './session/StudioFileOperations'
import { type StudioFileDraftState, StudioProjectFiles, type StudioProjectFilesIO } from './session/StudioProjectFiles'
import { StudioSessionRequests } from './session/StudioSessionRequests'
import {
  requireSourceVersion,
  StudioSourceActionConflictError,
  StudioSourceConflictError,
} from './session/StudioSourceConflicts'
import { StudioCanvasViewportStore } from './StudioCanvasViewportStore'
import {
  type StudioCompileCompletion,
  StudioCompileCoordinator,
  type StudioCompileCoordinatorOptions,
  type StudioCompileSnapshot,
  type StudioSourceChange,
  type StudioWatchResult,
} from './StudioCompileCoordinator'
import type { StudioFeedBrowseResult, StudioFeedState } from './StudioFeedProtocol'
import { StudioFeedSession } from './StudioFeedSession'
import { StudioGeneratedSources } from './StudioGeneratedSources'
import { type StudioCellRuntime, StudioMatrixSession } from './StudioMatrixSession'
import type { StudioCellInstanceIdentity, StudioPreviewManifestV2 } from './StudioPreviewManifest'
import {
  type StudioAppVariant,
  type StudioCanvasViewport,
  type StudioCheckpointSummary,
  type StudioCreateFileRequest,
  type StudioCreateFileResult,
  type StudioDeleteFileRequest,
  type StudioDeleteFileResult,
  type StudioDraftWriteRequest,
  type StudioDraftWriteResult,
  type StudioInspectRenderRequest,
  type StudioMoveGeneratedSourceRequest,
  type StudioMoveGeneratedSourceResult,
  type StudioPreviewIdentity,
  type StudioPreviewLayoutMeasurement,
  type StudioProjectFile,
  type StudioProjectFileContent,
  type StudioProjectIdentity,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioRenameFileRequest,
  type StudioRenameFileResult,
  studioSessionEndpoints,
  type StudioSessionEvent,
  type StudioSessionHandshake,
  type StudioSketchActionResult,
  type StudioSketchSnapApplyResult,
  type StudioSketchSnapProposalResult,
  type StudioSketchSnapRequest,
  type StudioSketchSnapUndoResult,
  type StudioSourceActionEnvelope,
  type StudioSourceActionProposal,
  type StudioSourceActionResult,
  type StudioSourceActionUndoEnvelope,
  type StudioSourceActionUndoResult,
  studioSourceActionVersion,
} from './StudioProtocol'
import {
  type StudioSketch,
  StudioSketchCatalog,
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

/** The session's wire DTOs live in StudioProtocol; they are republished here for the package facade. */
export type {
  StudioAppVariant,
  StudioCheckpointSummary,
  StudioCreateFileRequest,
  StudioCreateFileResult,
  StudioDeleteFileRequest,
  StudioDeleteFileResult,
  StudioDraftWriteRequest,
  StudioDraftWriteResult,
  StudioInspectRenderRequest,
  StudioMoveGeneratedSourceRequest,
  StudioMoveGeneratedSourceResult,
  StudioProjectFile,
  StudioProjectFileContent,
  StudioRenameFileRequest,
  StudioRenameFileResult,
  StudioSessionEvent,
  StudioSessionHandshake,
  StudioSketchActionResult,
  StudioSketchFlowAction,
  StudioSketchFlowActionRequest,
  StudioSketchSnapApplyResult,
  StudioSketchSnapProposalResult,
  StudioSketchSnapRequest,
  StudioSketchSnapUndoRequest,
  StudioSketchSnapUndoResult,
  StudioSketchUnsnapRequest,
  StudioSourceActionProposal,
  StudioSourceActionResult,
  StudioSourceActionUndoResult,
} from './StudioProtocol'

/** The session's own value types are split across `session/`; the facade and its tests import them from here. */
export {
  StudioSourceActionConflictError,
  StudioSourceConflictError,
} from './session/StudioSourceConflicts'
export type { StudioDesignValue, StudioFileDraftState }

export type StudioProjectSessionOptions = {
  appName?: string
  compile: StudioCompileCoordinatorOptions['compile']
  entryPath?: string
  projectRoot: string
  /** Substitutes the disk behind the file listing; tests use it to count scans and reads. */
  projectFilesIO?: StudioProjectFilesIO
  sketchCatalogIO?: StudioSketchCatalogIO
}

/** A session event as its emitter writes it; `#emit` stamps the channel and protocol version on. */
type StudioSessionEventBody = StudioSessionEvent extends infer EventT
  ? EventT extends object ? Omit<EventT, 'channel' | 'protocolVersion'> : never
  : never

/** One request id's cached result. A repeated id replays it instead of acting twice. */
type StudioRequestCache<ResultT> = Map<string, Readonly<{ fingerprint: string; result: ResultT }>>

/** The identifying half of one request, as the result caches key and validate it. */
type StudioRequestKey = Readonly<{ fingerprint: string; requestId: string }>

type PreparedSourceAction = {
  current: StudioProjectFileContent
  envelope: StudioSourceActionEnvelope
  patch: Awaited<ReturnType<typeof SourceActions.applyStudioPatch>>
  path: string
}

type AgentUndoFile = {
  path: string
  beforeContent: string
  beforeSourceVersion: string
  appliedContent: string
  appliedSourceVersion: string
}

const sourceActionResultLimit = 100

type PreparedSketchSnap = Readonly<{
  beforeTargets: readonly StudioSketchRenderTarget[]
  current: StudioProjectFileContent
  needsConfirmation: boolean
  patch: Awaited<ReturnType<typeof SourceActions.applyStudioPatch>>
  path: string
  projectedRectIds: readonly string[]
  tree: StudioSketchSnapTree
}>

/**
 * StudioProjectSession owns one project/app's disk-synced source and serialized compile state. It
 * coordinates the file listing (`session/StudioProjectFiles`), file mutations
 * (`session/StudioFileOperations`), the undo ledger (`session/StudioCheckpointLedger`), the compile
 * coordinator, the matrix session, and the sketch catalog behind one mutation lane.
 */
export class StudioProjectSession {
  static readonly testing = { measuredUnsnapRect, sourceActionProposalDiff }

  readonly #actionResults: StudioRequestCache<StudioSourceActionResult> = new Map()
  readonly #actionUndoResults: StudioRequestCache<StudioSourceActionUndoResult> = new Map()
  readonly #coordinator: StudioCompileCoordinator
  readonly #fileOperations: StudioFileOperations
  readonly #files: StudioProjectFiles
  readonly #feed: StudioFeedSession
  readonly #ledger: StudioCheckpointLedger
  readonly #listeners = new Set<(event: StudioSessionEvent) => void>()
  readonly #previewLayoutMeasurements = new Map<
    string,
    Readonly<{
      identity: StudioCellInstanceIdentity
      measurements: ReadonlyMap<string, StudioPreviewLayoutMeasurement>
    }>
  >()
  readonly #sketchCatalog: StudioSketchCatalog
  readonly #sketchSnapProposalResults: StudioRequestCache<StudioSketchSnapProposalResult> = new Map()
  readonly #sketchSnapResults: StudioRequestCache<StudioSketchSnapApplyResult> = new Map()
  readonly #sketchSnapUndoResults: StudioRequestCache<StudioSketchSnapUndoResult> = new Map()
  readonly #sketchResults: StudioRequestCache<StudioSketchActionResult> = new Map()
  readonly #workspace: Workspace
  #mutationLane: Promise<void> = Promise.resolve()
  #matrix: StudioMatrixSession | undefined
  #canvasViewportStore: StudioCanvasViewportStore | undefined
  #canvasViewport: StudioCanvasViewport | undefined
  readonly #canvasViewportSequences = new Map<string, number>()

  private constructor(
    readonly projectRoot: string,
    readonly entryPath: string,
    readonly appName: string,
    readonly apps: readonly StudioAppVariant[],
    workspace: Workspace,
    files: StudioProjectFiles,
    compile: StudioCompileCoordinatorOptions['compile'],
    sketchCatalogIO?: StudioSketchCatalogIO,
  ) {
    this.#workspace = workspace
    this.#files = files
    this.#sketchCatalog = new StudioSketchCatalog(projectRoot, sketchCatalogIO)
    this.#ledger = new StudioCheckpointLedger(projectRoot, checkpoint => this.#emitCheckpoint(checkpoint))
    this.#coordinator = new StudioCompileCoordinator({
      appName,
      compile,
      onState: state => this.#emit({ state, type: 'compile-state' }),
      project: projectRoot,
    })
    this.#fileOperations = new StudioFileOperations({
      coordinator: this.#coordinator,
      entryPath,
      files,
      onFileChanged: file => this.#emitFile(file),
      onFilesChanged: listed => this.#emitFiles(listed),
      onSketchCatalogChanged: catalog => this.#emitSketchCatalog(catalog),
      projectRoot,
      sketchCatalog: this.#sketchCatalog,
      workspace,
    })
    this.#feed = new StudioFeedSession({
      catalog: this.#sketchCatalog,
      compile: writes => this.#coordinator.noteStudioFileMutation(writes),
      entryPath,
      files,
      manifest: () => this.previewManifest(),
      projectRoot,
      publish: catalog => {
        this.#emitSketchCatalog(catalog)
        this.#emitFiles(this.#files.list())
      },
    })
  }

  static async open(options: StudioProjectSessionOptions): Promise<StudioProjectSession> {
    const projectRoot = await requireStudioProjectRoot(options.projectRoot)
    await ReleaseToolchain.requireMatchingProjectRelease(projectRoot, 'Studio')
    await new StudioGeneratedSources(projectRoot).repair()
    const workspace = await Workspace.open(projectRoot)
    // The listing reports compile diagnostics per file, and the coordinator that owns them is built by the
    // session, which in turn needs the listing scanned before it can discover its app: bind late.
    let session: StudioProjectSession | undefined
    const files = await StudioProjectFiles.open(
      projectRoot,
      () => session?.compileSnapshot().diagnostics ?? [],
      options.projectFilesIO,
    )
    const selection = await discoverStudioApp(projectRoot, workspace, files.absolutePaths(), options)
    session = new StudioProjectSession(
      projectRoot,
      selection.entryPath,
      selection.appName,
      selection.apps,
      workspace,
      files,
      options.compile,
      options.sketchCatalogIO,
    )
    return session
  }

  identity(): StudioProjectIdentity {
    return { appName: this.appName, project: this.projectRoot }
  }

  /** The server installs its device-local preferences store before exposing this session. */
  setCanvasViewportStore(store: StudioCanvasViewportStore): void {
    this.#canvasViewportStore = store
  }

  async saveCanvasViewport(request: unknown): Promise<StudioCanvasViewport> {
    if (
      !Json.isRecord(request)
      || typeof request['clientId'] !== 'string' || request['clientId'].length === 0
      || request['clientId'].length > 128
      || typeof request['sequence'] !== 'number' || !Number.isSafeInteger(request['sequence'])
      || request['sequence'] < 0
    ) {
      Errors.throwUserInput('Expected a canvas viewport client id and nonnegative sequence number.')
    }
    const viewport = StudioCanvasViewportStore.normalize(request['viewport'])
    const previous = this.#canvasViewportSequences.get(request['clientId'])
    if (previous !== undefined && request['sequence'] <= previous) {
      return this.#canvasViewport ?? viewport
    }
    this.#canvasViewportSequences.set(request['clientId'], request['sequence'])
    this.#canvasViewport = viewport
    try {
      await this.#canvasViewportStore?.save(this.projectRoot, viewport)
    } catch (error) {
      if (this.#canvasViewportSequences.get(request['clientId']) === request['sequence']) {
        this.#canvasViewportSequences.delete(request['clientId'])
      }
      throw error
    }
    return viewport
  }

  /**
   * One entry per applied agent change, most recent last. A chat applies several changes in a conversation,
   * and a single slot would make every change but the last one unrecoverable while still offering "undo".
   */
  #agentUndoStack: AgentUndoFile[][] = []

  /**
   * applyAgentFiles writes several files as one mutation, compiles once, and rolls every
   * file back when the compile fails. It keeps one undo record outside the source-action checkpoint bus.
   */
  applyAgentFiles(
    request: {
      edits: readonly { path: string; content: string }[]
      writeId: string
      /**
       * The versions the change was computed against. An agent reads a file, plans an edit, and a person
       * approves it some time later; without this, a change made in between is silently overwritten by
       * content that never saw it.
       */
      expect?: readonly { path: string; sourceVersion: string }[]
    },
  ): Promise<{
    compile: StudioCompileCompletion
    rolledBack: boolean
    sourceVersions: readonly { path: string; sourceVersion: string }[]
  }> {
    return this.#edit(async () => {
      const before = await Promise.all(request.edits.map(async edit => {
        const current = await this.readFile(edit.path)
        return { content: current.content, path: current.path, sourceVersion: current.sourceVersion }
      }))
      for (const expected of request.expect ?? []) {
        const current = before.find(file => file.path === expected.path)
        const version = current?.sourceVersion ?? (await this.readFile(expected.path)).sourceVersion
        if (version !== expected.sourceVersion) {
          throw new StudioSourceConflictError(expected.path, expected.sourceVersion, version)
        }
      }
      const writes = await Promise.all(request.edits.map(async edit => ({
        path: await this.#files.resolveTaoFile(edit.path),
        sourceVersion: SourceActions.studioSourceVersion(edit.content),
        writeId: request.writeId,
      })))
      await Promise.all(request.edits.map(async (edit, index) => FS.writeText(writes[index]!.path, edit.content)))
      for (const write of writes) {
        this.#files.note(write.path, write.sourceVersion)
      }
      const compile = await this.#coordinator.noteStudioFileMutation(writes)
      if (compile.status === 'error') {
        await this.#restoreAgentFiles(before, `rollback:${request.writeId}`)
        return {
          compile,
          rolledBack: true,
          sourceVersions: before.map(file => ({ path: file.path, sourceVersion: file.sourceVersion })),
        }
      }
      this.#agentUndoStack.push(before.map((file, index) => ({
        appliedContent: request.edits[index]!.content,
        appliedSourceVersion: writes[index]!.sourceVersion,
        beforeContent: file.content,
        beforeSourceVersion: file.sourceVersion,
        path: file.path,
      })))
      for (const [index, write] of writes.entries()) {
        this.#emitFile(this.#files.projectFile(before[index]!.path, write.sourceVersion))
      }
      return {
        compile,
        rolledBack: false,
        sourceVersions: writes.map((write, index) => ({
          path: before[index]!.path,
          sourceVersion: write.sourceVersion,
        })),
      }
    })
  }

  undoAgentFiles(writeId: string): Promise<{ compile: StudioCompileCompletion; restored: string[] }> {
    return this.#edit(async () => {
      const before = this.#agentUndoStack[this.#agentUndoStack.length - 1]
      Assert.input(before !== undefined, 'Nothing applied by the agent to undo.')
      // Undo is another delayed source write. A person may have edited one of these files after the agent
      // changed it; restoring the old body without this check would erase that work under an innocent Undo.
      for (const file of before) {
        const current = await this.readFile(file.path)
        if (current.sourceVersion !== file.appliedSourceVersion) {
          throw new StudioSourceConflictError(file.path, file.appliedSourceVersion, current.sourceVersion)
        }
      }
      const compile = await this.#restoreAgentFiles(
        before.map(file => ({
          content: file.beforeContent,
          path: file.path,
          sourceVersion: file.beforeSourceVersion,
        })),
        writeId,
      )
      this.#agentUndoStack.pop()
      return { compile, restored: before.map(file => file.path) }
    })
  }

  /** The exact reverse patch the next agent undo would apply, shown before a person approves it. */
  agentUndoPreview(): { diff: string; restored: readonly string[] } | undefined {
    const files = this.#agentUndoStack[this.#agentUndoStack.length - 1]
    if (files === undefined) {
      return undefined
    }
    return {
      diff: files.map(file => sourceActionProposalDiff(file.path, file.appliedContent, file.beforeContent)).join(
        '\n\n',
      ),
      restored: files.map(file => file.path),
    }
  }

  async #restoreAgentFiles(
    files: readonly { path: string; content: string; sourceVersion: string }[],
    writeId: string,
  ): Promise<StudioCompileCompletion> {
    await Promise.all(files.map(async file => FS.writeText(await this.#files.resolveTaoFile(file.path), file.content)))
    for (const file of files) {
      this.#files.note(file.path, file.sourceVersion)
    }
    const compile = await this.#coordinator.noteStudioFileMutation(files.map(file => ({
      path: FS.resolvePath(file.path, this.projectRoot),
      sourceVersion: file.sourceVersion,
      writeId,
    })))
    for (const file of files) {
      this.#emitFile(this.#files.projectFile(file.path, file.sourceVersion))
    }
    return compile
  }

  semanticSnapshot(): Promise<SemanticSnapshot> {
    return loadSemanticSnapshot({
      appName: this.appName,
      entryPath: this.entryPath,
      projectRoot: this.projectRoot,
      validate: async entryPath => await this.#workspace.validate(entryPath),
    })
  }

  compileSnapshot(): StudioCompileSnapshot {
    return this.#coordinator.snapshot()
  }

  fileDraftState(path: string): StudioFileDraftState {
    return this.#files.draftState(path)
  }

  checkpoints(): readonly StudioCheckpointSummary[] {
    return this.#ledger.summaries()
  }

  compileInitial(): Promise<StudioCompileCompletion> {
    return this.#coordinator.requestInitialCompile()
  }

  setPreviewInstance(previewInstanceId: string): void {
    Assert.input(previewInstanceId.trim().length > 0, 'Studio preview instance id cannot be empty.')
    this.#coordinator.setPreviewInstance(previewInstanceId)
  }

  registerPreview(input: unknown): StudioCompileSnapshot {
    if (!Json.isRecord(input) || typeof input['previewInstanceId'] !== 'string') {
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
    this.#emit({ manifest: this.#matrix.publishedManifest(), type: 'preview-manifest-changed' })
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
    return this.#requireMatrix().registerInstance(StudioSessionRequests.cellInstanceIdentity(input))
  }

  /** unregisterCellPreview releases one live instance; a stale or unknown id is a no-op. */
  unregisterCellPreview(previewInstanceId: string): void {
    this.#matrix?.unregisterInstance(previewInstanceId)
  }

  reconfigureCell(input: unknown): StudioCellRuntime {
    const request = StudioSessionRequests.cellReconfigureRequest(input)
    const runtime = this.#requireMatrix().reconfigure(request)
    this.#emit({ cellId: request.cellId, type: 'cell-reconfigured' })
    return runtime
  }

  acknowledgePreview(input: unknown): boolean {
    const message = StudioProtocol.parseMessage(input)
    if (message?.type !== 'preview-applied') {
      Errors.throwUserInput('Expected a valid Tao Studio preview-applied message.')
    }
    if (message.identity.cellId !== undefined) {
      const cell = cellInstanceIdentity(message.identity)
      if (cell === undefined) {
        Errors.throwUserInput('Expected a complete Studio cell preview identity.')
      }
      this.#requireMatrix().assertCurrentInstance(cell)
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
    const cellIdentity = StudioSessionRequests.completeCellInstanceIdentity(message)
    this.#requireMatrix().assertCurrentInstance(cellIdentity)
    this.#previewLayoutMeasurements.set(
      previewMeasurementCellKey(cellIdentity),
      {
        identity: cellIdentity,
        // Scrolled, clipped renders still supply viewport geometry to the client; source layout
        // operations retain their original nonnegative canvas-coordinate eligibility.
        measurements: new Map(
          message.measurements.filter(measurement => measurement.rect.x >= 0 && measurement.rect.y >= 0)
            .map(measurement => [measurement.renderId, measurement]),
        ),
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
      throw measurementUnavailable(renderId)
    }
    return measuredUnsnapRect(measurement, sketch)
  }

  subscribe(listener: (event: StudioSessionEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async handshake(): Promise<StudioSessionHandshake> {
    const canvasViewport = this.#canvasViewportStore === undefined
      ? this.#canvasViewport
      : await this.#canvasViewportStore.load(this.projectRoot)
    return {
      apps: this.apps,
      ...(canvasViewport === undefined ? {} : { canvasViewport }),
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
      endpoints: studioSessionEndpoints,
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
    return this.#mutate(async () => this.#feed.catalog() ?? await this.#reconcileSketchCatalog())
  }

  feedSourceOverrides(): Readonly<Record<string, string>> | undefined {
    return this.#feed.sourceOverrides()
  }

  browseFeed(input: unknown): Promise<StudioFeedBrowseResult> {
    return this.#mutate(() => this.#feed.browse(input))
  }

  applyFeedAction(input: unknown): Promise<StudioFeedState> {
    return this.#mutate(() => this.#feed.action(input))
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
    // Bind refreshes (host-absolute renderId, compile offsets, sourceVersion) are session-local.
    // The catalog already lives inside the project; persisting a checkout-specific locator
    // would rewrite committed sketches.jsonc on every open from another worktree.
    if (!sketchMembershipChanged(catalog.sketches, sketches)) {
      return { ...catalog, sketches }
    }
    const reconciled = { ...catalog, revision: catalog.revision + 1, sketches }
    await this.#sketchCatalog.restore(reconciled, catalog.revision)
    this.#emitSketchCatalog(reconciled)
    return reconciled
  }

  applySketchAction(input: unknown): Promise<StudioSketchActionResult> {
    return this.#edit(() =>
      this.#sketchCatalog.transaction(async transaction => {
        const request = input as StudioSketchCatalogRequest
        const identified = Json.isRecord(input) && typeof input['requestId'] === 'string'
        // A body that is not a record still reaches `transaction.apply`, which refuses it by name.
        const key: StudioRequestKey = {
          fingerprint: JSON.stringify(input),
          requestId: identified ? request.requestId : '',
        }
        const cached = identified ? cachedResult(this.#sketchResults, key, 'sketch') : undefined
        if (cached !== undefined) {
          if ((await transaction.read()).revision === cached.catalog.revision) {
            return cached
          }
          this.#sketchResults.delete(key.requestId)
        }
        const action = Json.isRecord(input) && Json.isRecord(input['action']) ? input['action'] : undefined
        if (action?.['kind'] === 'create-sketch') {
          Assert.input(
            action['project'] === this.identity().project,
            'A Studio sketch can only be created in the active project.',
          )
        }
        if (action?.['kind'] === 'delete-sketch') {
          Errors.throwUserInput('Deleting a Studio sketch is not available until its generated-source lifecycle lands.')
        }
        if (action?.['kind'] === 'refresh-snap-targets') {
          Errors.throwUserInput('Refreshing Studio Snap targets is owned by generated-source transactions.')
        }

        const prior = await transaction.read()
        let applied = false
        let createdName: string | undefined
        let createdPath: string | undefined
        let writeRegistered = false
        try {
          const catalogResult = await transaction.apply(request)
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
          rememberResult(this.#sketchResults, key, result)
          this.#emitSketchCatalog(result.catalog)
          return result
        } catch (error) {
          if (applied) {
            if (createdName !== undefined && createdPath !== undefined && await FS.isFile(createdPath)) {
              await new StudioGeneratedSources(this.projectRoot).removeView(createdName)
              this.#files.forget(createdPath)
            }
            await transaction.restore(prior, prior.revision + 1)
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
    )
  }

  proposeSketchSnap(input: unknown): Promise<StudioSketchSnapProposalResult> {
    return this.#mutate(async () => {
      const request = StudioSessionRequests.parseSketchSnapRequest(input)
      const key = requestKey(request)
      const cached = cachedResult(this.#sketchSnapProposalResults, key, 'Snap')
      if (cached !== undefined) {
        return cached
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
      return rememberResult(this.#sketchSnapProposalResults, key, result)
    })
  }

  applySketchSnap(input: unknown): Promise<StudioSketchSnapApplyResult> {
    return this.#edit(async () => {
      const request = StudioSessionRequests.parseSketchSnapRequest(input)
      const key = requestKey(request)
      const cached = cachedResult(this.#sketchSnapResults, key, 'Snap')
      if (cached !== undefined) {
        return cached
      }
      const prepared = await this.#prepareSketchSnap(request)
      if (prepared.needsConfirmation) {
        Assert.input(
          request.confirmedProposalVersion === prepared.patch.sourceVersion,
          'Studio Snap overlap requires confirmation of the current canonical proposal.',
        )
      }
      return this.#commitSketchSource({
        applyCatalog: async () =>
          this.#sketchCatalog.apply({
            action: {
              kind: 'snap-rects',
              sketchId: request.sketchId,
              targets: await this.#sketchRenderTargets(
                prepared.path,
                prepared.patch.content,
                prepared.patch.sourceVersion,
                [...prepared.beforeTargets.map(target => target.studioRectId), ...prepared.projectedRectIds],
              ),
            },
            expectedRevision: request.expectedCatalogRevision,
            requestId: `catalog:${request.requestId}`,
          }),
        checkpointId: request.checkpointId,
        current: prepared.current,
        key,
        operation: 'sketch-snap',
        patch: prepared.patch,
        path: prepared.path,
        projectedRectIds: prepared.projectedRectIds,
        purpose: 'Snap',
        undoAction: {
          kind: 'unsnap-rects',
          rectIds: prepared.projectedRectIds,
          sketchId: request.sketchId,
          targets: prepared.beforeTargets,
        },
      })
    })
  }

  /** Applies an authenticated rect-based flow edit as one generated-source/catalog checkpoint. */
  applySketchFlowAction(input: unknown): Promise<StudioSketchSnapApplyResult> {
    return this.#edit(() =>
      this.#sketchCatalog.transaction(async transaction => {
        const request = StudioSessionRequests.parseSketchFlowActionRequest(input)
        const key = requestKey(request)
        const catalog = await transaction.read()
        const cached = cachedResult(
          this.#sketchSnapResults,
          key,
          'flow',
          result => catalog.revision === result.catalog.revision,
        )
        if (cached !== undefined) {
          return cached
        }
        const sketch = requireSketch(catalog, request)
        const generatedSources = new StudioGeneratedSources(this.projectRoot)
        const generated = await generatedSources.readView(sketch.view)
        // Targets carry the unresolved relative path, while `readFile` answers with the real one.
        const expectedPath = FS.relativePath(this.projectRoot, generated.path)
        const current = await this.readFile(expectedPath)
        requireSourceVersion(current, request.sourceVersion)
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
        let catalogWritten = false
        return this.#commitSketchSource({
          applyCatalog: async () => {
            const refreshedTargets = await this.#sketchRenderTargets(
              generated.path,
              patch.content,
              patch.sourceVersion,
              sketch.snapped.map(item => item.rect.id),
            )
            const catalogResult = await transaction.apply({
              action: { kind: 'refresh-snap-targets', sketchId: sketch.id, targets: refreshedTargets },
              expectedRevision: catalog.revision,
              requestId: `catalog:${request.requestId}`,
            })
            catalogWritten = true
            return catalogResult
          },
          checkpointId: request.checkpointId,
          current,
          key,
          operation: 'sketch-flow-action',
          patch,
          path: generated.path,
          projectedRectIds: request.action.kind === 'toggle-direction'
            ? [request.action.rectId]
            : [
              request.action.afterRectId,
              ...(request.action.beforeRectId === undefined ? [] : [request.action.beforeRectId]),
            ],
          purpose: 'edit flow',
          rollback: async () => {
            if (catalogWritten) {
              await transaction.restore(catalog, catalog.revision + 1)
            }
          },
          undoAction: {
            kind: 'refresh-snap-targets',
            sketchId: sketch.id,
            targets: sketch.snapped.map(item => item.target),
          },
        })
      })
    )
  }

  applySketchUnsnap(input: unknown): Promise<StudioSketchSnapApplyResult> {
    return this.#edit(async () => {
      const request = StudioSessionRequests.parseSketchUnsnapRequest(input)
      const key = requestKey(request)
      const cached = cachedResult(this.#sketchSnapResults, key, 'Unsnap')
      if (cached !== undefined) {
        return cached
      }
      const catalog = await this.#sketchCatalog.read()
      const sketch = requireSketch(catalog, request)
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
      return this.#commitSketchSource({
        applyCatalog: async () => {
          const survivingTargets = await this.#sketchRenderTargets(
            generated.path,
            patch.content,
            patch.sourceVersion,
            remainingIds,
          )
          return selected.some(item => !retained.has(item.rect.id))
            ? this.#restoreMeasuredUnsnapCatalog(
              catalog,
              sketch,
              selected,
              requestedIds,
              survivingTargets,
              request.requestId,
            )
            : this.#sketchCatalog.apply({
              action: { kind: 'unsnap-rects', rectIds, sketchId: sketch.id, targets: survivingTargets },
              expectedRevision: request.expectedCatalogRevision,
              requestId: `catalog:${request.requestId}`,
            })
        },
        checkpointId: request.checkpointId,
        current,
        key,
        operation: 'sketch-unsnap',
        patch,
        path: generated.path,
        projectedRectIds: rectIds,
        purpose: 'Unsnap',
        undoAction: {
          kind: 'snap-rects',
          sketchId: sketch.id,
          targets: [
            ...sketch.snapped.map(item => item.target),
            ...selected.filter(item => !retained.has(item.rect.id)).map(item => item.target),
          ],
        },
      })
    })
  }

  undoSketchSnap(input: unknown): Promise<StudioSketchSnapUndoResult> {
    return this.#edit(async () => {
      const request = StudioSessionRequests.parseSketchSnapUndoRequest(input)
      const key = requestKey(request)
      const cached = cachedResult(this.#sketchSnapUndoResults, key, 'Snap undo')
      if (cached !== undefined) {
        return cached
      }
      const checkpoint = this.#ledger.sketchSnapUndoTarget(request.checkpointId)
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
      await this.#rewriteGenerated(generated, checkpoint.path, checkpoint.beforeContent, checkpoint.beforeSourceVersion)
      const compile = await this.#coordinator.noteStudioWrite({
        path: checkpoint.path,
        sourceVersion: checkpoint.beforeSourceVersion,
        writeId: request.requestId,
      })
      let undoneCatalog: StudioSketchCatalogSnapshot
      try {
        if (compile.status === 'error') {
          Errors.throwUserInput(
            `Studio did not undo Snap because the original Tao source failed to compile: ${compile.message}`,
          )
        }
        undoneCatalog = (await this.#sketchCatalog.apply({
          action: checkpoint.undoAction,
          expectedRevision: catalog.revision,
          requestId: `catalog:${request.requestId}`,
        })).catalog
      } catch (error) {
        await this.#restoreGeneratedContent(
          generated,
          checkpoint.path,
          checkpoint.afterContent,
          checkpoint.afterSourceVersion,
          `rollback:${request.requestId}`,
        )
        throw error
      }
      this.#ledger.markUndone(checkpoint)
      return this.#publishSketchResult(this.#sketchSnapUndoResults, key, {
        catalog: undoneCatalog,
        checkpoint: { id: checkpoint.id, status: 'undone' },
        compile,
        file: {
          content: checkpoint.beforeContent,
          ...this.#files.projectFile(
            FS.relativePath(this.projectRoot, checkpoint.path),
            checkpoint.beforeSourceVersion,
          ),
        },
        requestId: request.requestId,
      })
    })
  }

  /**
   * #commitSketchSource writes one generated Tao source, compiles it, records the catalog change and
   * its undo checkpoint, and restores the source whenever any of that fails. It is the one
   * transaction shape behind Snap, Unsnap, and flow edits; only the catalog change differs.
   */
  async #commitSketchSource(gesture: {
    applyCatalog: () => Promise<StudioSketchCatalogResult>
    checkpointId: string
    current: StudioProjectFileContent
    key: StudioRequestKey
    operation: string
    patch: Readonly<{ content: string; sourceVersion: string }>
    path: string
    projectedRectIds: readonly string[]
    /** Names the gesture in "Studio did not <purpose> because …" when the generated source fails to compile. */
    purpose: string
    rollback?: () => Promise<void>
    undoAction: SketchSnapCheckpoint['undoAction']
  }): Promise<StudioSketchSnapApplyResult> {
    const { current, key, patch, path } = gesture
    this.#ledger.requireSketchCheckpointSlot(gesture.checkpointId)
    const generated = new StudioGeneratedSources(this.projectRoot)
    let sourceWritten = false
    try {
      await this.#rewriteGenerated(generated, path, patch.content, patch.sourceVersion)
      sourceWritten = true
      const compile = await this.#coordinator.noteStudioWrite({
        path,
        sourceVersion: patch.sourceVersion,
        writeId: key.requestId,
      })
      if (compile.status === 'error') {
        Errors.throwUserInput(
          `Studio did not ${gesture.purpose} because the generated Tao source failed to compile: ${compile.message}`,
        )
      }
      const catalogResult = await gesture.applyCatalog()
      const checkpoint: SketchSnapCheckpoint = {
        afterCatalogRevision: catalogResult.catalog.revision,
        afterContent: patch.content,
        afterSourceVersion: patch.sourceVersion,
        beforeContent: current.content,
        beforeSourceVersion: current.sourceVersion,
        id: gesture.checkpointId,
        path,
        status: 'committed',
        undoAction: gesture.undoAction,
      }
      this.#ledger.recordSketchSnap(checkpoint)
      return this.#publishSketchResult(this.#sketchSnapResults, key, {
        catalog: catalogResult.catalog,
        checkpoint: { id: checkpoint.id, status: 'committed' },
        compile,
        file: { content: patch.content, ...this.#files.projectFile(current.path, patch.sourceVersion) },
        projectedRectIds: gesture.projectedRectIds,
        requestId: key.requestId,
      })
    } catch (error) {
      await gesture.rollback?.()
      if (sourceWritten && (await FS.readText(path)) !== current.content) {
        await this.#restoreGeneratedContent(
          generated,
          path,
          current.content,
          current.sourceVersion,
          `rollback:${key.requestId}`,
        )
      }
      throw Errors.fromUnknown(error, { requestId: key.requestId, studioOperation: gesture.operation })
    }
  }

  /** #publishSketchResult caches one sketch result and announces the checkpoint, file, and catalog it moved. */
  #publishSketchResult<
    ResultT extends Readonly<{
      catalog: StudioSketchCatalogSnapshot
      checkpoint: Pick<StudioCheckpointSummary, 'id' | 'status'>
      file: StudioProjectFile
    }>,
  >(cache: StudioRequestCache<ResultT>, key: StudioRequestKey, result: ResultT): ResultT {
    rememberResult(cache, key, result)
    this.#emitCheckpoint(result.checkpoint)
    this.#emitFile(result.file)
    this.#emitSketchCatalog(result.catalog)
    return result
  }

  async #prepareSketchSnap(request: StudioSketchSnapRequest): Promise<PreparedSketchSnap> {
    const catalog = await this.#sketchCatalog.read()
    const sketch = requireSketch(catalog, request)
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
      tree: prepared.action.tree,
    }
  }

  /** #rewriteGenerated rewrites one generated source and records its version before the coordinator is told. */
  async #rewriteGenerated(
    generated: StudioGeneratedSources,
    path: string,
    content: string,
    sourceVersion: string,
  ): Promise<void> {
    await generated.rewrite(path, content)
    this.#files.note(path, sourceVersion)
  }

  async #restoreGeneratedContent(
    generated: StudioGeneratedSources,
    path: string,
    content: string,
    sourceVersion: string,
    writeId: string,
  ): Promise<void> {
    await this.#rewriteGenerated(generated, path, content, sourceVersion)
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
    await this.#sketchCatalog.restore(next, catalog.revision)
    return { catalog: next, requestId: `catalog:${requestId}` }
  }

  #requireMatrix(): StudioMatrixSession {
    Assert.input(this.#matrix, 'Studio preview manifest is not available yet.')
    return this.#matrix
  }

  /**
   * files describes every project Tao file at its current source version. The listing is maintained
   * incrementally by the session's own writes and the watcher's reports, so this reads no disk.
   */
  async files(): Promise<StudioProjectFile[]> {
    return this.#files.list()
  }

  readFile(path: string): Promise<StudioProjectFileContent> {
    return this.#files.readFile(path)
  }

  createFile(request: StudioCreateFileRequest): Promise<StudioCreateFileResult> {
    return this.#edit(() => this.#fileOperations.createFile(request))
  }

  renameFile(request: StudioRenameFileRequest): Promise<StudioRenameFileResult> {
    return this.#edit(() => this.#fileOperations.renameFile(request))
  }

  moveGeneratedSource(request: StudioMoveGeneratedSourceRequest): Promise<StudioMoveGeneratedSourceResult> {
    return this.#edit(() => this.#fileOperations.moveGeneratedSource(request))
  }

  deleteFile(request: StudioDeleteFileRequest): Promise<StudioDeleteFileResult> {
    return this.#edit(() => this.#fileOperations.deleteFile(request))
  }

  syncDraft(request: StudioDraftWriteRequest): Promise<StudioDraftWriteResult> {
    return this.#edit(() => this.#fileOperations.syncDraft(request))
  }

  applySourceAction(input: unknown): Promise<StudioSourceActionResult> {
    return this.#edit(async () => {
      const envelope = StudioProtocol.parseSourceActionEnvelope(input)
      Assert.input(envelope, 'Expected a valid Tao Studio source-action v2 envelope.')
      StudioSessionRequests.requireSessionIdentity(envelope, this.identity())
      this.#acceptPreviewIdentity(envelope)

      const key = requestKey(envelope)
      const cached = cachedResult(this.#actionResults, key, 'source-action')
      if (cached !== undefined) {
        return cached
      }

      const { current, patch, path } = await this.#prepareSourceAction(envelope)
      const checkpoint = this.#ledger.prepareSourceAction(envelope, current)
      await FS.writeText(path, patch.content)
      this.#files.note(path, patch.sourceVersion)
      const compile = await this.#coordinator.noteStudioWrite({
        path,
        sourceVersion: patch.sourceVersion,
        writeId: envelope.requestId,
      })
      if (envelope.action.kind === 'insert-captured-fixture' && compile.status === 'error') {
        await FS.writeText(path, current.content)
        this.#files.note(path, current.sourceVersion)
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
        checkpoint: this.#ledger.recordSourceAction(envelope, checkpoint, patch.sourceVersion),
        compile,
        content: patch.content,
        edits: patch.edits,
        path: current.path,
        requestId: envelope.requestId,
        sourceVersion: patch.sourceVersion,
      }
      this.#emitCheckpoint(result.checkpoint)
      rememberResult(this.#actionResults, key, result)
      this.#emitFile(this.#files.projectFile(current.path, patch.sourceVersion))
      return result
    })
  }

  /** Produces the exact canonical patch and compact diff without writing source or reserving a checkpoint. */
  proposeSourceAction(input: unknown): Promise<StudioSourceActionProposal> {
    return this.#mutate(async () => {
      const envelope = StudioProtocol.parseSourceActionEnvelope(input)
      Assert.input(envelope, 'Expected a valid Tao Studio source-action v2 envelope.')
      StudioSessionRequests.requireSessionIdentity(envelope, this.identity())
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
    const loaded = await this.#parseVersionedFile(
      envelope.identity,
      'apply a Studio source action',
    )
    const { current, path } = loaded
    let parsed = loaded.parsed
    const request = StudioSessionRequests.sourcePatchRequest(envelope)
    StudioSessionRequests.requireSourceActionPreconditions(envelope, request)
    this.#requireScenarioActionIdentity(envelope, request)
    try {
      let workspaceFiles = parsed.files.map(file => file.ast)
      if (request.kind === 'insert-project-view' && request.viewSourcePath !== undefined) {
        const viewPath = await this.#files.resolveTaoFile(request.viewSourcePath)
        request.viewSourcePath = viewPath
        const entries = await this.#workspace.parseFiles([path, viewPath])
        parsed = entries[0]!
        workspaceFiles = [...new Set(entries.flatMap(entry => entry.files.map(file => file.ast)))]
      }
      if (request.kind === 'wrap-render') {
        const directory = FS.dirname(path)
        for (const siblingPath of this.#files.absolutePaths()) {
          if (siblingPath === path || FS.dirname(siblingPath) !== directory) {
            continue
          }
          const sibling = await this.#workspace.parse(siblingPath)
          workspaceFiles.push(sibling.entry.ast)
        }
      }
      const patch = await SourceActions.applyStudioPatch(parsed.entry.document, request, {
        files: workspaceFiles,
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
      const { parsed } = await this.#parseVersionedFile(request, 'inspect a Studio render')
      const inspection = SourceActions.inspectStudioRender(parsed.entry.document, request.renderId, {
        files: parsed.files.map(file => file.ast),
      })
      // The owner's root render is what a focused frame should be sized to; the preview measured it
      // for the selecting cell if that cell is still current. A stale or unmeasured cell reports no rect.
      const owner = inspection.owner
      const cell = request.identity === undefined ? undefined : cellInstanceIdentity(request.identity)
      if (owner === undefined || cell === undefined) {
        return inspection
      }
      let rect: StudioPreviewLayoutMeasurement['rect'] | undefined
      try {
        rect = this.previewLayoutMeasurement(cell, owner.renderId)?.rect
      } catch {
        rect = undefined
      }
      return rect === undefined ? inspection : { ...inspection, owner: { ...owner, rect } }
    })
  }

  inspectDesign(
    request: Pick<StudioInspectRenderRequest, 'path' | 'sourceVersion'>,
  ): Promise<readonly StudioDesignValue[]> {
    return this.#mutate(async () => {
      const { parsed } = await this.#parseVersionedFile(request, 'inspect Studio design values')
      return studioDesignValues(parsed.entry.ast)
    })
  }

  /** #parseVersionedFile parses one project file after checking the version the request was computed against. */
  async #parseVersionedFile(
    request: Pick<StudioInspectRenderRequest, 'path' | 'sourceVersion'>,
    purpose: string,
  ): Promise<{ current: StudioProjectFileContent; parsed: ParseResult; path: string }> {
    const current = await this.readFile(request.path)
    requireSourceVersion(current, request.sourceVersion)
    const path = await this.#files.resolveTaoFile(current.path)
    const parsed = await this.#workspace.parse(path)
    Assert.input(
      !Diagnostics.hasError(parsed.diagnostics.filter(diagnostic => diagnostic.filePath === path), 'lexer', 'parser'),
      `Cannot ${purpose} until ${current.path} parses.`,
    )
    return { current, parsed, path }
  }

  undoSourceAction(input: unknown): Promise<StudioSourceActionUndoResult> {
    return this.#edit(async () => {
      const envelope = StudioProtocol.parseSourceActionUndoEnvelope(input)
      Assert.input(envelope, 'Expected a valid Tao Studio source-action undo v2 envelope.')
      StudioSessionRequests.requireSessionIdentity(envelope, this.identity())
      this.#acceptPreviewIdentity(envelope)

      const key = requestKey(envelope)
      const cached = cachedResult(this.#actionUndoResults, key, 'source-action undo')
      if (cached !== undefined) {
        return cached
      }

      const checkpoint: SourceActionCheckpoint = this.#ledger.undoableSourceAction(envelope.checkpointId)
      const current = await this.readFile(envelope.identity.path)
      this.#ledger.requireUndoIdentity(checkpoint, envelope, current)
      requireSourceVersion(current, envelope.identity.sourceVersion)
      requireSourceVersion(current, checkpoint.afterSourceVersion)
      const path = await this.#files.resolveTaoFile(current.path)
      await FS.writeText(path, checkpoint.beforeContent)
      this.#files.note(path, checkpoint.beforeSourceVersion)
      const compile = await this.#coordinator.noteStudioWrite({
        path,
        sourceVersion: checkpoint.beforeSourceVersion,
        writeId: envelope.requestId,
      })
      this.#ledger.markUndone(checkpoint)
      const result: StudioSourceActionUndoResult = {
        checkpoint: { id: checkpoint.id, status: 'undone' },
        compile,
        content: checkpoint.beforeContent,
        path: checkpoint.path,
        requestId: envelope.requestId,
        sourceVersion: checkpoint.beforeSourceVersion,
      }
      this.#emitCheckpoint(result.checkpoint)
      rememberResult(this.#actionUndoResults, key, result)
      this.#emitFile(this.#files.projectFile(checkpoint.path, checkpoint.beforeSourceVersion))
      return result
    })
  }

  async noteWatchChanges(changes: readonly StudioSourceChange[]): Promise<StudioWatchResult> {
    return this.#mutate(() => this.#applyWatchChanges(changes))
  }

  /** Reconciles the cached file map after watcher startup and periodically while the session is open. */
  async reconcileProjectFiles(): Promise<StudioWatchResult | undefined> {
    return this.#mutate(async () => {
      const changes = await this.#files.changesOnDisk()
      return changes.length === 0 ? undefined : await this.#applyWatchChanges(changes)
    })
  }

  async #applyWatchChanges(changes: readonly StudioSourceChange[]): Promise<StudioWatchResult> {
    const normalized = await Promise.all(changes.map(async change => ({
      ...change,
      path: await this.#files.resolveTaoWatchPath(change.path),
    })))
    for (const change of normalized) {
      await this.#files.noteChange(change)
    }
    const result = await this.#coordinator.noteWatchChanges(normalized)
    if (result.acknowledgements.length > 0) {
      this.#emit({ acknowledgements: result.acknowledgements, type: 'studio-writes-acknowledged' })
    }
    return result
  }

  #acceptPreviewIdentity(envelope: StudioSourceActionEnvelope | StudioSourceActionUndoEnvelope): void {
    const identity = envelope.identity
    if (identity.cellId !== undefined) {
      const cell = cellInstanceIdentity(identity)
      if (cell === undefined) {
        Errors.throwUserInput('Studio source action has an incomplete cell identity.')
      }
      const runtime = this.#requireMatrix().assertCurrentInstance(cell)
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

  #requireScenarioActionIdentity(
    envelope: StudioSourceActionEnvelope,
    request: StudioSourcePatchRequest,
  ): void {
    if (request.kind !== 'set-scenario-arguments' && request.kind !== 'append-scenario-steps') {
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

  /** #emit stamps the channel and protocol version every session event carries, then fans it out. */
  #emit(body: StudioSessionEventBody): void {
    const event = {
      ...body,
      channel: studioProtocolChannel,
      protocolVersion: studioProtocolVersion,
    } as StudioSessionEvent
    for (const listener of this.#listeners) {
      try {
        listener(event)
      } catch {
        // A disconnected or faulty observer must not interrupt source writes or strand compile waiters.
      }
    }
  }

  #emitFile(file: StudioProjectFile): void {
    this.#emit({ file, type: 'file-changed' })
  }

  #emitFiles(files: readonly StudioProjectFile[]): void {
    this.#emit({ files, type: 'files-changed' })
  }

  #emitCheckpoint(checkpoint: Pick<StudioCheckpointSummary, 'id' | 'status'>): void {
    this.#emit({ checkpoint, type: 'checkpoint-changed' })
  }

  #emitSketchCatalog(catalog: StudioSketchCatalogSnapshot): void {
    this.#emit({ catalog, type: 'sketch-catalog-changed' })
  }

  #mutate<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.#mutationLane.then(mutation, mutation)
    this.#mutationLane = result.then(() => undefined, () => undefined)
    return result
  }

  #edit<T>(mutation: () => Promise<T>): Promise<T> {
    return this.#mutate(() => {
      this.#feed.requireNoDraft()
      return mutation()
    })
  }
}

/**
 * cellInstanceIdentity narrows a wire preview identity to the matrix cell instance it names. A
 * preview that names no cell, or only part of one, is not a cell instance and reports none.
 */
function cellInstanceIdentity(identity: StudioPreviewIdentity): StudioCellInstanceIdentity | undefined {
  if (
    identity.cellId === undefined
    || identity.cellRevision === undefined
    || identity.compileRevision === undefined
    || identity.manifestRevision === undefined
  ) {
    return undefined
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

/** requestKey identifies one parsed request: its id, and the exact input that id stood for. */
function requestKey(request: Readonly<{ requestId: string }>): StudioRequestKey {
  return { fingerprint: JSON.stringify(request), requestId: request.requestId }
}

/** requireSketch resolves the sketch a request names, on the catalog revision it was computed against. */
function requireSketch(
  catalog: StudioSketchCatalogSnapshot,
  request: Readonly<{ expectedCatalogRevision: number; sketchId: string }>,
): StudioSketch {
  if (catalog.revision !== request.expectedCatalogRevision) {
    throw new StudioSketchCatalogConflictError(request.expectedCatalogRevision, catalog.revision)
  }
  const sketch = catalog.sketches.find(candidate => candidate.id === request.sketchId)
  Assert.input(sketch, `Studio sketch does not exist: ${request.sketchId}`)
  return sketch
}

/**
 * cachedResult replays what a request id already produced. The same id carrying different input is
 * the caller's mistake, and `reusable` discards a cached result the catalog has since moved past.
 */
function cachedResult<ResultT>(
  cache: StudioRequestCache<ResultT>,
  request: StudioRequestKey,
  label: string,
  reusable?: (result: ResultT) => boolean,
): ResultT | undefined {
  const cached = cache.get(request.requestId)
  if (cached === undefined) {
    return undefined
  }
  Assert.input(
    cached.fingerprint === request.fingerprint,
    `Studio ${label} request id was reused: ${request.requestId}`,
  )
  if (reusable !== undefined && !reusable(cached.result)) {
    cache.delete(request.requestId)
    return undefined
  }
  return cached.result
}

/** rememberResult keys one result by its request id, keeping only the most recent requests. */
function rememberResult<ResultT>(
  cache: StudioRequestCache<ResultT>,
  request: StudioRequestKey,
  result: ResultT,
): ResultT {
  cache.set(request.requestId, { fingerprint: request.fingerprint, result })
  while (cache.size > sourceActionResultLimit) {
    const oldest = cache.keys().next()
    if (oldest.done) {
      break
    }
    cache.delete(oldest.value)
  }
  return result
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

function sketchMembershipChanged(before: readonly StudioSketch[], after: readonly StudioSketch[]): boolean {
  return before.length !== after.length || before.some((sketch, index) => {
    const next = after[index]!
    return sketch.id !== next.id
      || !sameIdSequence(sketch.rectOrder, next.rectOrder)
      || !sameIdSequence(sketch.rects.map(rect => rect.id), next.rects.map(rect => rect.id))
      || !sameIdSequence(sketch.snapped.map(item => item.rect.id), next.snapped.map(item => item.rect.id))
  })
}

function sameIdSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
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
