import {
  type StudioCreateFileRequest,
  type StudioCreateFileResult,
  type StudioDeleteFileRequest,
  type StudioDeleteFileResult,
  type StudioDraftWriteRequest,
  type StudioDraftWriteResult,
  type StudioJsonPostInit,
  type StudioRenameFileRequest,
  type StudioRenameFileResult,
  StudioRoutes,
  StudioSessionPath,
  type StudioSourceActionEnvelope,
  type StudioSourceActionUndoEnvelope,
  StudioTransport,
} from './StudioProtocol'

const fileConflictSentence = 'This file changed under this edit.'

export const studioServerForeignActionContract = {
  ApplySourceAction: {
    endpoint: StudioRoutes.session.sourceAction.path,
    failures: { Conflict: fileConflictSentence },
  },
  CreateFile: {
    endpoint: StudioRoutes.session.fileCreate.path,
    failures: { Conflict: fileConflictSentence },
  },
  DeleteFile: {
    endpoint: StudioRoutes.session.fileDelete.path,
    failures: { Conflict: fileConflictSentence },
  },
  RenameFile: {
    endpoint: StudioRoutes.session.fileRename.path,
    failures: { Conflict: fileConflictSentence },
  },
  SyncDraft: { endpoint: StudioRoutes.session.fileDraft.path, runs: 'latest' },
  UndoSourceAction: {
    endpoint: StudioRoutes.session.sourceActionUndo.path,
    failures: { Conflict: fileConflictSentence },
  },
} as const

export class StudioForeignActionFailure extends Error {
  override readonly name = 'StudioForeignActionFailure'

  constructor(
    readonly caseName: 'Conflict' | 'Server',
    message: string,
    readonly status?: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
  }
}

export type StudioForeignActionFetch = (
  input: string,
  init: StudioJsonPostInit,
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>

/** HTTP adapter consumed by the shipped Tao foreign actions and injectable host tests. */
export class StudioServerForeignActions {
  readonly #basePath: string
  readonly #fetch: StudioForeignActionFetch

  constructor(options: { basePath?: string; fetch?: StudioForeignActionFetch } = {}) {
    this.#basePath = options.basePath?.replace(/\/$/, '') ?? studioSessionBasePath()
    this.#fetch = options.fetch ?? fetch
  }

  async applySourceAction<Result>(request: StudioSourceActionEnvelope): Promise<Result> {
    return await this.#post(
      studioServerForeignActionContract.ApplySourceAction.endpoint,
      request,
      studioServerForeignActionContract.ApplySourceAction.failures.Conflict,
    )
  }

  async createFile(request: StudioCreateFileRequest): Promise<StudioCreateFileResult> {
    return await this.#post(
      studioServerForeignActionContract.CreateFile.endpoint,
      request,
      studioServerForeignActionContract.CreateFile.failures.Conflict,
    )
  }

  async deleteFile(request: StudioDeleteFileRequest): Promise<StudioDeleteFileResult> {
    return await this.#post(
      studioServerForeignActionContract.DeleteFile.endpoint,
      request,
      studioServerForeignActionContract.DeleteFile.failures.Conflict,
    )
  }

  async renameFile(request: StudioRenameFileRequest): Promise<StudioRenameFileResult> {
    return await this.#post(
      studioServerForeignActionContract.RenameFile.endpoint,
      request,
      studioServerForeignActionContract.RenameFile.failures.Conflict,
    )
  }

  async syncDraft(request: StudioDraftWriteRequest): Promise<StudioDraftWriteResult> {
    return await this.#post(studioServerForeignActionContract.SyncDraft.endpoint, request)
  }

  async undoSourceAction<Result>(request: StudioSourceActionUndoEnvelope): Promise<Result> {
    return await this.#post(
      studioServerForeignActionContract.UndoSourceAction.endpoint,
      request,
      studioServerForeignActionContract.UndoSourceAction.failures.Conflict,
    )
  }

  async #post<Result>(endpoint: string, request: unknown, conflictSentence?: string): Promise<Result> {
    const reply = await StudioTransport.readJsonReply<Result>(
      await this.#fetch(`${this.#basePath}${endpoint}`, StudioTransport.jsonPostInit(request)),
    )
    if (reply.ok) {
      return reply.body
    }
    if (conflictSentence !== undefined && reply.status === 409) {
      throw new StudioForeignActionFailure('Conflict', conflictSentence, reply.status, reply.details)
    }
    throw new StudioForeignActionFailure(
      'Server',
      reply.error ?? `Studio action failed (${reply.status}).`,
      reply.status,
      reply.details,
    )
  }
}

function studioSessionBasePath(): string {
  const pathname = (globalThis as { location?: { pathname?: string } }).location?.pathname ?? ''
  const sessionId = StudioSessionPath.sessionIdOf(pathname)
  return sessionId === undefined ? '' : StudioSessionPath.window(sessionId)
}

const taoStudioActions = new StudioServerForeignActions()
let nextTaoStudioWriteId = 1

/** Named exports are the executable Tao-to-StudioServer write boundary. */
export async function SyncDraft(path: string, sourceVersion: string, content: string): Promise<void> {
  await taoStudioActions.syncDraft({ content, path, sourceVersion, writeId: writeId('draft') })
}

export async function ApplySourceAction(envelope: string): Promise<void> {
  await taoStudioActions.applySourceAction(parseEnvelope<StudioSourceActionEnvelope>(envelope, 'source action'))
}

export async function UndoSourceAction(envelope: string): Promise<void> {
  await taoStudioActions.undoSourceAction(parseEnvelope<StudioSourceActionUndoEnvelope>(envelope, 'source action undo'))
}

function writeId(kind: string): string {
  return `tao-studio-${kind}-${nextTaoStudioWriteId++}`
}

function parseEnvelope<ValueT>(encoded: string, name: string): ValueT {
  const value = parsedJsonObject(encoded)
  if (value === undefined) {
    throw new StudioForeignActionFailure('Server', `Invalid ${name} envelope.`)
  }
  return value as ValueT
}

function parsedJsonObject(encoded: string): object | undefined {
  try {
    const value: unknown = JSON.parse(encoded)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}
