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
  type StudioProjectIdentity,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
  type StudioSourceActionIdentity,
  type StudioSourceActionUndoEnvelope,
  studioSourceActionVersion,
} from './StudioProtocol'

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
  /**
   * One cell was reconfigured — new arguments, environment, state layers, or a replayed capture.
   * Reconfiguring invalidates every live instance of that cell, so a canvas rendering it holds an
   * instance the session will refuse from that moment on. The browser learns this by driving the
   * reconfigure itself; anything else rendering the same cell has to be told.
   */
  | {
    cellId: string
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'cell-reconfigured'
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
  { method: 'POST', path: '/api/file/rename' },
  { method: 'POST', path: '/api/language/highlight' },
  { method: 'POST', path: '/api/ship/beta' },
  { method: 'POST', path: '/api/source-action' },
  { method: 'POST', path: '/api/source-action/inspect' },
  { method: 'POST', path: '/api/source-action/propose' },
  { method: 'POST', path: '/api/source-action/undo' },
  { method: 'GET', path: '/api/tests/status' },
  { method: 'POST', path: '/api/tests/run' },
  { method: 'GET', path: '/api/ai/availability' },
  { method: 'POST', path: '/api/ai/fixture' },
  { method: 'POST', path: '/api/preview/instance' },
  { method: 'POST', path: '/api/preview/applied' },
  { method: 'GET', path: '/api/preview/manifest' },
  { method: 'GET', path: '/api/preview/cell' },
  { method: 'GET', path: '/api/preview/cell/bootstrap' },
  { method: 'POST', path: '/api/preview/cell/instance' },
  { method: 'POST', path: '/api/preview/cell/reconfigure' },
  { method: 'GET', path: '/api/device/status' },
  { method: 'POST', path: '/api/device/pairing/open' },
  { method: 'POST', path: '/api/device/pairing/confirm' },
  { method: 'POST', path: '/api/device/pairing/decline' },
  { method: 'POST', path: '/api/device/revoke' },
  { method: 'POST', path: '/api/device/reconnect' },
  { method: 'POST', path: '/api/device/select-cell' },
  { method: 'GET', path: '/api/device/launch' },
  { method: 'POST', path: '/api/device/launch/open' },
  { method: 'WS', path: '/events' },
  { method: 'WS', path: '/api/language/lsp' },
]

const sourceActionResultLimit = 100

/** StudioProjectSession owns one project/app's disk-synced source and serialized compile state. */
export class StudioProjectSession {
  static readonly testing = { sourceActionProposalDiff }

  readonly #actionCheckpoints = new Map<string, SourceActionCheckpoint>()
  readonly #actionResults = new Map<string, SourceActionCacheEntry>()
  readonly #actionUndoResults = new Map<string, SourceActionUndoCacheEntry>()
  readonly #checkpointOrder: string[] = []
  readonly #coordinator: StudioCompileCoordinator
  readonly #draftStates = new Map<string, StudioFileDraftState>()
  readonly #listeners = new Set<(event: StudioSessionEvent) => void>()
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
  ) {
    this.#workspace = workspace
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
    return [...this.#actionCheckpoints.values()].map(checkpoint => ({
      afterSourceVersion: checkpoint.afterSourceVersion,
      beforeSourceVersion: checkpoint.beforeSourceVersion,
      id: checkpoint.id,
      path: checkpoint.path,
      status: checkpoint.status,
    }))
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

  /** unregisterCellPreview releases one live instance; a stale or unknown id is a no-op. */
  unregisterCellPreview(previewInstanceId: string): void {
    this.#matrix?.unregisterInstance(previewInstanceId)
  }

  reconfigureCell(input: unknown): StudioCellRuntime {
    const request = cellReconfigureRequest(input)
    const runtime = this.#requireMatrix().reconfigure(request)
    this.#emit({
      cellId: request.cellId,
      channel: studioProtocolChannel,
      protocolVersion: studioProtocolVersion,
      type: 'cell-reconfigured',
    })
    return runtime
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
      },
      channel: studioProtocolChannel,
      compile: this.compileSnapshot(),
      endpoints: sessionEndpoints,
      entryPath: FS.relativePath(this.projectRoot, this.entryPath),
      files: await this.files(),
      identity: this.identity(),
      ...(this.#matrix === undefined ? {} : { previewManifest: this.#matrix.publishedManifest() }),
      protocolVersion: studioProtocolVersion,
      type: 'handshake',
    }
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
