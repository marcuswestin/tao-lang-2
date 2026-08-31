import { AST, Langium } from '@parser'
import { Diagnostics, Errors, FS, Repo, TaoFiles } from '@shared'
import SourceActions, {
  type StudioComponentKind,
  type StudioInsertCapturedFixturePatchRequest,
  type StudioLayoutEntry,
  type StudioScenarioArgumentValue,
  type StudioSourcePatchRequest,
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
  type StudioPreviewManifestV1,
} from './StudioPreviewManifest'
import {
  type StudioJsonObject,
  type StudioProjectIdentity,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
  type StudioSourceActionUndoEnvelope,
  studioSourceActionVersion,
} from './StudioProtocol'

export type StudioProjectFile = {
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
  capabilities: {
    drafts: 'disk-synced-parsable'
    language: readonly string[]
    sourceActions: {
      canonicalEnvelope: true
      checkpoints: true
      undo: true
      version: typeof studioSourceActionVersion
    }
    matrix: {
      concurrentCells: true
      scheme: 'inert'
      version: 1
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
  previewManifest?: StudioPreviewManifestV1
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
    acknowledgements: StudioWatchResult['acknowledgements']
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'studio-writes-acknowledged'
  }
  | {
    channel: typeof studioProtocolChannel
    manifest: StudioPreviewManifestV1
    protocolVersion: typeof studioProtocolVersion
    type: 'preview-manifest-changed'
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
  path: string
  previewInstanceId: string
  status: 'committed' | 'open' | 'undone'
}

type SourceActionUndoCacheEntry = {
  fingerprint: string
  result: StudioSourceActionUndoResult
}

const sessionEndpoints: StudioSessionHandshake['endpoints'] = [
  { method: 'GET', path: '/api/protocol' },
  { method: 'GET', path: '/api/files' },
  { method: 'GET', path: '/api/file' },
  { method: 'POST', path: '/api/file/draft' },
  { method: 'POST', path: '/api/language/highlight' },
  { method: 'POST', path: '/api/source-action' },
  { method: 'POST', path: '/api/source-action/undo' },
  { method: 'GET', path: '/api/ai/availability' },
  { method: 'POST', path: '/api/ai/fixture' },
  { method: 'POST', path: '/api/preview/instance' },
  { method: 'POST', path: '/api/preview/applied' },
  { method: 'GET', path: '/api/preview/manifest' },
  { method: 'GET', path: '/api/preview/cell' },
  { method: 'GET', path: '/api/preview/cell/bootstrap' },
  { method: 'POST', path: '/api/preview/cell/instance' },
  { method: 'POST', path: '/api/preview/cell/reconfigure' },
  { method: 'WS', path: '/events' },
  { method: 'WS', path: '/api/language/lsp' },
]

const sourceActionResultLimit = 100

/** StudioProjectSession owns one project/app's disk-synced source and serialized compile state. */
export class StudioProjectSession {
  readonly #actionCheckpoints = new Map<string, SourceActionCheckpoint>()
  readonly #actionResults = new Map<string, SourceActionCacheEntry>()
  readonly #actionUndoResults = new Map<string, SourceActionUndoCacheEntry>()
  readonly #checkpointOrder: string[] = []
  readonly #coordinator: StudioCompileCoordinator
  readonly #listeners = new Set<(event: StudioSessionEvent) => void>()
  readonly #workspace: Workspace
  #mutationLane: Promise<void> = Promise.resolve()
  #matrix: StudioMatrixSession | undefined
  #openCheckpointId: string | undefined

  private constructor(
    readonly projectRoot: string,
    readonly entryPath: string,
    readonly appName: string,
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
    const selection = await resolveAppSelection(projectRoot, workspace, options.entryPath, options.appName)
    return new StudioProjectSession(projectRoot, selection.entryPath, selection.appName, workspace, options.compile)
  }

  identity(): StudioProjectIdentity {
    return { appName: this.appName, project: this.projectRoot }
  }

  compileSnapshot(): StudioCompileSnapshot {
    return this.#coordinator.snapshot()
  }

  compileInitial(): Promise<StudioCompileCompletion> {
    return this.#coordinator.requestInitialCompile()
  }

  setPreviewInstance(previewInstanceId: string): void {
    if (previewInstanceId.trim().length === 0) {
      throw new Errors.UserInputError('Studio preview instance id cannot be empty.')
    }
    this.#coordinator.setPreviewInstance(previewInstanceId)
  }

  registerPreview(input: unknown): StudioCompileSnapshot {
    if (!isRecord(input) || typeof input['previewInstanceId'] !== 'string') {
      throw new Errors.UserInputError('Expected a Studio preview instance id.')
    }
    this.setPreviewInstance(input['previewInstanceId'])
    return this.compileSnapshot()
  }

  /** setMatrixManifest installs the compiler-derived scenario/cell contract for this compile revision. */
  setMatrixManifest(manifest: StudioPreviewManifestV1): void {
    if (manifest.project.root !== this.projectRoot || manifest.project.appName !== this.appName) {
      throw new Errors.UserInputError('Studio preview manifest does not match the open project and app.')
    }
    this.#matrix = this.#matrix?.rebase(manifest) ?? new StudioMatrixSession(manifest)
    this.#emit({
      channel: studioProtocolChannel,
      manifest: this.#matrix.manifest,
      protocolVersion: studioProtocolVersion,
      type: 'preview-manifest-changed',
    })
  }

  previewManifest(): StudioPreviewManifestV1 | undefined {
    return this.#matrix?.manifest
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
      throw new Errors.UserInputError('Expected a valid Tao Studio preview-applied message.')
    }
    return this.#coordinator.acknowledgePreview(message)
  }

  subscribe(listener: (event: StudioSessionEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async handshake(): Promise<StudioSessionHandshake> {
    return {
      capabilities: {
        drafts: 'disk-synced-parsable',
        language: ['lsp', 'textmate'],
        sourceActions: {
          canonicalEnvelope: true,
          checkpoints: true,
          undo: true,
          version: studioSourceActionVersion,
        },
        matrix: {
          concurrentCells: true,
          scheme: 'inert',
          version: 1,
        },
      },
      channel: studioProtocolChannel,
      compile: this.compileSnapshot(),
      endpoints: sessionEndpoints,
      entryPath: FS.relativePath(this.projectRoot, this.entryPath),
      files: await this.files(),
      identity: this.identity(),
      ...(this.#matrix === undefined ? {} : { previewManifest: this.#matrix.manifest }),
      protocolVersion: studioProtocolVersion,
      type: 'handshake',
    }
  }

  #requireMatrix(): StudioMatrixSession {
    if (this.#matrix === undefined) {
      throw new Errors.UserInputError('Studio preview manifest is not available yet.')
    }
    return this.#matrix
  }

  async files(): Promise<StudioProjectFile[]> {
    const paths = await Repo.filesUnder(this.projectRoot, {
      excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
      extensions: ['.tao'],
    })
    return await Promise.all(paths.map(async path => {
      const content = await FS.readText(path)
      return {
        kind: 'file' as const,
        path: FS.relativePath(this.projectRoot, path),
        sourceVersion: SourceActions.studioSourceVersion(content),
      }
    }))
  }

  async readFile(path: string): Promise<StudioProjectFileContent> {
    const resolved = await this.#resolveTaoFile(path)
    const content = await FS.readText(resolved)
    return {
      content,
      kind: 'file',
      path: FS.relativePath(this.projectRoot, resolved),
      sourceVersion: SourceActions.studioSourceVersion(content),
    }
  }

  syncDraft(request: StudioDraftWriteRequest): Promise<StudioDraftWriteResult> {
    return this.#mutate(async () => {
      const current = await this.readFile(request.path)
      requireSourceVersion(current, request.sourceVersion)
      const resolved = await this.#resolveTaoFile(request.path)
      const parsed = await this.#workspace.parseSource(request.content, Langium.URI.file(resolved))
      const diagnostics = Diagnostics.errorMessages(parsed.diagnostics, 'lexer', 'parser')
      if (diagnostics.length > 0) {
        return { diagnostics, file: current, saved: false }
      }

      const sourceVersion = SourceActions.studioSourceVersion(request.content)
      await FS.writeText(resolved, request.content)
      const compile = await this.#coordinator.noteStudioWrite({
        path: resolved,
        sourceVersion,
        writeId: request.writeId,
      })
      const file: StudioProjectFileContent = {
        content: request.content,
        kind: 'file',
        path: current.path,
        sourceVersion,
      }
      this.#emitFile(file)
      return { compile, diagnostics: [], file, saved: true }
    })
  }

  applySourceAction(input: unknown): Promise<StudioSourceActionResult> {
    return this.#mutate(async () => {
      const envelope = StudioProtocol.parseSourceActionEnvelope(input)
      if (envelope === undefined) {
        throw new Errors.UserInputError('Expected a valid Tao Studio source-action v1 envelope.')
      }
      requireSessionIdentity(envelope, this.identity())
      this.#acceptPreviewIdentity(envelope)

      const fingerprint = JSON.stringify(envelope)
      const cached = this.#actionResults.get(envelope.requestId)
      if (cached !== undefined) {
        if (cached.fingerprint !== fingerprint) {
          throw new Errors.UserInputError(`Studio source-action request id was reused: ${envelope.requestId}`)
        }
        return cached.result
      }

      const current = await this.readFile(envelope.identity.path)
      requireSourceVersion(current, envelope.identity.sourceVersion)
      const checkpoint = this.#prepareSourceActionCheckpoint(envelope, current)
      const path = await this.#resolveTaoFile(current.path)
      const parsed = await this.#workspace.parse(path)
      if (Diagnostics.hasError(parsed.diagnostics, 'lexer', 'parser')) {
        throw new Errors.UserInputError(`Cannot apply a Studio source action until ${current.path} parses.`)
      }
      const patch = await SourceActions.applyStudioPatch(parsed.entry.document, sourcePatchRequest(envelope))
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
        throw new Errors.UserInputError(
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
      this.#actionResults.set(envelope.requestId, { fingerprint, result })
      trimMap(this.#actionResults, sourceActionResultLimit)
      this.#emitFile({
        kind: 'file',
        path: current.path,
        sourceVersion: patch.sourceVersion,
      })
      return result
    })
  }

  undoSourceAction(input: unknown): Promise<StudioSourceActionUndoResult> {
    return this.#mutate(async () => {
      const envelope = StudioProtocol.parseSourceActionUndoEnvelope(input)
      if (envelope === undefined) {
        throw new Errors.UserInputError('Expected a valid Tao Studio source-action undo v1 envelope.')
      }
      requireSessionIdentity(envelope, this.identity())
      this.#acceptPreviewIdentity(envelope)

      const fingerprint = JSON.stringify(envelope)
      const cached = this.#actionUndoResults.get(envelope.requestId)
      if (cached !== undefined) {
        if (cached.fingerprint !== fingerprint) {
          throw new Errors.UserInputError(`Studio source-action undo request id was reused: ${envelope.requestId}`)
        }
        return cached.result
      }

      if (this.#openCheckpointId !== undefined) {
        throw new Errors.UserInputError('Commit the active Studio source-action checkpoint before undoing.')
      }
      const latestCheckpointId = this.#checkpointOrder.at(-1)
      if (latestCheckpointId !== envelope.checkpointId) {
        throw new Errors.UserInputError('Studio can only undo the latest committed source-action checkpoint.')
      }
      const checkpoint = this.#actionCheckpoints.get(envelope.checkpointId)
      if (checkpoint === undefined || checkpoint.status !== 'committed') {
        throw new Errors.UserInputError(`Studio source-action checkpoint is not undoable: ${envelope.checkpointId}`)
      }
      const current = await this.readFile(envelope.identity.path)
      if (
        checkpoint.path !== current.path
        || checkpoint.previewInstanceId !== envelope.identity.previewInstanceId
      ) {
        throw new Errors.UserInputError('Studio source-action undo targets a different source or preview instance.')
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
      this.#actionUndoResults.set(envelope.requestId, { fingerprint, result })
      trimMap(this.#actionUndoResults, sourceActionResultLimit)
      this.#emitFile({
        kind: 'file',
        path: checkpoint.path,
        sourceVersion: checkpoint.beforeSourceVersion,
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
    if (FS.extname(resolved) !== '.tao') {
      throw new Errors.UserInputError(`Studio path is not a Tao file in the project: ${path}`)
    }
    const missingParts = [FS.basename(resolved)]
    let ancestor = FS.dirname(resolved)
    while (!await FS.isDirectory(ancestor)) {
      const parent = FS.dirname(ancestor)
      if (parent === ancestor) {
        throw new Errors.UserInputError(`Studio path is not a Tao file in the project: ${path}`)
      }
      missingParts.unshift(FS.basename(ancestor))
      ancestor = parent
    }
    const canonical = FS.resolvePath(missingParts.join('/'), await FS.realPath(ancestor))
    if (!FS.pathIsWithin(canonical, this.projectRoot)) {
      throw new Errors.UserInputError(`Studio path is not a Tao file in the project: ${path}`)
    }
    if (await FS.isFile(canonical)) {
      const realPath = await FS.realPath(canonical)
      if (!FS.pathIsWithin(realPath, this.projectRoot)) {
        throw new Errors.UserInputError(`Studio path resolves outside the project: ${path}`)
      }
    }
    return canonical
  }

  async #resolveTaoFile(path: string): Promise<string> {
    const resolved = FS.resolvePath(path, this.projectRoot)
    if (!FS.pathIsWithin(resolved, this.projectRoot) || FS.extname(resolved) !== '.tao' || !await FS.isFile(resolved)) {
      throw new Errors.UserInputError(`Studio path is not a Tao file in the project: ${path}`)
    }
    const realPath = await FS.realPath(resolved)
    if (!FS.pathIsWithin(realPath, this.projectRoot)) {
      throw new Errors.UserInputError(`Studio path resolves outside the project: ${path}`)
    }
    return resolved
  }

  #acceptPreviewIdentity(envelope: StudioSourceActionEnvelope | StudioSourceActionUndoEnvelope): void {
    const identity = envelope.identity
    if (identity.cellId !== undefined) {
      if (
        identity.cellRevision === undefined
        || identity.compileRevision === undefined
        || identity.manifestRevision === undefined
      ) {
        throw new Errors.UserInputError('Studio source action has an incomplete cell identity.')
      }
      this.#requireMatrix().assertCurrentInstance({
        appName: identity.appName,
        cellId: identity.cellId,
        cellRevision: identity.cellRevision,
        compileRevision: identity.compileRevision,
        manifestRevision: identity.manifestRevision,
        previewInstanceId: identity.previewInstanceId,
        project: identity.project,
      })
      return
    }
    const active = this.#coordinator.snapshot().previewInstanceId
    if (active === undefined) {
      this.#coordinator.setPreviewInstance(envelope.identity.previewInstanceId)
      return
    }
    if (active !== envelope.identity.previewInstanceId) {
      throw new Errors.UserInputError('Studio source action came from a stale preview instance.')
    }
  }

  #prepareSourceActionCheckpoint(
    envelope: StudioSourceActionEnvelope,
    current: StudioProjectFileContent,
  ): SourceActionCheckpoint {
    const { id, phase } = envelope.checkpoint
    const existing = this.#actionCheckpoints.get(id)
    if (phase === 'begin' || phase === 'single') {
      if (existing !== undefined) {
        throw new Errors.UserInputError(`Studio source-action checkpoint id was reused: ${id}`)
      }
      if (this.#openCheckpointId !== undefined) {
        throw new Errors.UserInputError(`Studio source-action checkpoint is still open: ${this.#openCheckpointId}`)
      }
      return {
        afterSourceVersion: current.sourceVersion,
        beforeContent: current.content,
        beforeSourceVersion: current.sourceVersion,
        id,
        path: current.path,
        previewInstanceId: envelope.identity.previewInstanceId,
        status: phase === 'single' ? 'committed' : 'open',
      }
    }
    if (
      existing === undefined
      || existing.status !== 'open'
      || this.#openCheckpointId !== id
      || existing.path !== current.path
      || existing.previewInstanceId !== envelope.identity.previewInstanceId
    ) {
      throw new Errors.UserInputError(`Studio source-action checkpoint is not open: ${id}`)
    }
    return existing
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
  if (!await FS.isDirectory(resolved)) {
    throw new Errors.UserInputError(`Studio project folder does not exist: ${resolved}`)
  }
  return await FS.realPath(resolved)
}

async function resolveAppSelection(
  projectRoot: string,
  workspace: Workspace,
  entryInput: string | undefined,
  requestedAppName: string | undefined,
): Promise<{ appName: string; entryPath: string }> {
  const candidates = entryInput === undefined
    ? await Repo.filesUnder(projectRoot, {
      excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
      extensions: ['.tao'],
    })
    : [await resolveEntryPath(projectRoot, entryInput)]
  const apps: Array<{ appName: string; entryPath: string }> = []
  for (const entryPath of candidates) {
    const parsed = await workspace.parse(entryPath)
    for (const declaration of AST.appValueDeclarationsInFile(parsed.entry.ast)) {
      apps.push({ appName: declaration.name, entryPath })
    }
  }
  const matching = requestedAppName === undefined ? apps : apps.filter(app => app.appName === requestedAppName)
  if (matching.length === 0) {
    const available = apps.map(app => app.appName)
    throw new Errors.UserInputError(
      requestedAppName === undefined
        ? `No Tao app declaration found under ${projectRoot}`
        : `No Tao app named '${requestedAppName}' found. Available apps: ${available.join(', ') || 'none'}.`,
    )
  }
  if (matching.length > 1) {
    throw new Errors.UserInputError(
      requestedAppName === undefined
        ? `Multiple Tao apps found: ${matching.map(app => app.appName).join(', ')}. Select an appName.`
        : `Multiple Tao app declarations named '${requestedAppName}' were found. Select an entryPath.`,
    )
  }
  return matching[0]!
}

async function resolveEntryPath(projectRoot: string, input: string): Promise<string> {
  const resolved = FS.resolvePath(input, projectRoot)
  if (FS.extname(resolved) !== '.tao' || !await FS.isFile(resolved)) {
    throw new Errors.UserInputError(`Studio entry is not a Tao file in the project: ${input}`)
  }
  const realPath = await FS.realPath(resolved)
  if (!FS.pathIsWithin(realPath, projectRoot)) {
    throw new Errors.UserInputError(`Studio entry resolves outside the project: ${input}`)
  }
  return realPath
}

function requireSourceVersion(file: StudioProjectFile, expected: string): void {
  if (file.sourceVersion !== expected) {
    throw new StudioSourceConflictError(file.path, expected, file.sourceVersion)
  }
}

function requireSessionIdentity(
  envelope: StudioSourceActionEnvelope | StudioSourceActionUndoEnvelope,
  expected: StudioProjectIdentity,
): void {
  if (envelope.identity.project !== expected.project || envelope.identity.appName !== expected.appName) {
    throw new Errors.UserInputError('Studio source action targets a different project or app.')
  }
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
    return { component: action['component'], kind: action.kind }
  }
  if (action.kind === 'insert-project-view' && typeof action['viewName'] === 'string') {
    return { kind: action.kind, viewName: action['viewName'] }
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
    action.kind === 'set-scenario-arguments'
    && typeof action['scenarioName'] === 'string'
    && isRecord(action['arguments'])
    && Object.values(action['arguments']).every(isStudioScenarioArgumentValue)
  ) {
    return {
      arguments: action['arguments'] as Readonly<Record<string, StudioScenarioArgumentValue>>,
      kind: action.kind,
      scenarioName: action['scenarioName'],
    }
  }
  throw new Errors.UserInputError(`Unsupported or invalid Studio source action: ${action.kind}`)
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
    throw new Errors.UserInputError('Expected a complete Studio cell identity.')
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
    throw new Errors.UserInputError('Expected a Studio cell preview instance id.')
  }
  return { ...identity, previewInstanceId: value['previewInstanceId'] }
}

function cellReconfigureRequest(value: unknown): StudioCellReconfigureRequest {
  const identity = cellIdentity(value)
  if (!isRecord(value)) {
    throw new Errors.UserInputError('Expected a Studio cell reconfiguration.')
  }
  const args = value['args']
  const environment = value['environment']
  const stateLayers = value['stateLayers']
  if (args !== undefined && (!isRecord(args) || !isJsonValue(args))) {
    throw new Errors.UserInputError('Studio cell arguments must be JSON data.')
  }
  if (environment !== undefined && !isRecord(environment)) {
    throw new Errors.UserInputError('Studio cell environment must be an object.')
  }
  if (stateLayers !== undefined && (!Array.isArray(stateLayers) || !stateLayers.every(isString))) {
    throw new Errors.UserInputError('Studio cell state layers must be names.')
  }
  return {
    ...identity,
    ...(args === undefined ? {} : { args: args as StudioJsonObject }),
    ...(environment === undefined ? {} : { environment: environment as StudioCellEnvironment }),
    ...(stateLayers === undefined ? {} : { stateLayers }),
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
  return value === 'Button' || value === 'Number' || value === 'Stack' || value === 'Text'
}

/** StudioSourceConflictError reports optimistic source-version mismatches as HTTP 409 at the server boundary. */
export class StudioSourceConflictError extends Error {
  override readonly name = 'StudioSourceConflictError'

  constructor(
    readonly path: string,
    readonly expectedSourceVersion: string,
    readonly actualSourceVersion: string,
  ) {
    super(`Studio source changed before the edit was applied: ${path}`)
  }
}
