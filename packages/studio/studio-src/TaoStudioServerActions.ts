import type {
  StudioCreateFileRequest,
  StudioCreateFileResult,
  StudioDeleteFileRequest,
  StudioDeleteFileResult,
  StudioDraftWriteRequest,
  StudioDraftWriteResult,
  StudioRenameFileRequest,
  StudioRenameFileResult,
} from './StudioProjectSession'
import type {
  StudioSourceActionEnvelope,
  StudioSourceActionUndoEnvelope,
} from './StudioProtocol'

const fileConflictSentence = 'This file changed under this edit.'

export const studioServerForeignActionContract = {
  ApplySourceAction: {
    endpoint: '/api/source-action',
    failures: { Conflict: fileConflictSentence },
  },
  CreateFile: {
    endpoint: '/api/file/create',
    failures: { Conflict: fileConflictSentence },
  },
  DeleteFile: {
    endpoint: '/api/file/delete',
    failures: { Conflict: fileConflictSentence },
  },
  RenameFile: {
    endpoint: '/api/file/rename',
    failures: { Conflict: fileConflictSentence },
  },
  SyncDraft: { endpoint: '/api/file/draft', runs: 'latest' },
  UndoSourceAction: {
    endpoint: '/api/source-action/undo',
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
  init: { body: string; headers: Readonly<Record<string, string>>; method: 'POST' },
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
    const response = await this.#fetch(`${this.#basePath}${endpoint}`, {
      body: JSON.stringify(request),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const body = await response.json() as Result | {
      details?: Readonly<Record<string, unknown>>
      error?: string
    }
    if (response.ok) {
      return body as Result
    }
    if (conflictSentence !== undefined && response.status === 409) {
      const details = typeof body === 'object' && body !== null && 'details' in body ? body.details : undefined
      throw new StudioForeignActionFailure('Conflict', conflictSentence, response.status, details)
    }
    const message = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined
    throw new StudioForeignActionFailure(
      'Server',
      message ?? `Studio action failed (${response.status}).`,
      response.status,
      typeof body === 'object' && body !== null && 'details' in body ? body.details : undefined,
    )
  }
}

function studioSessionBasePath(): string {
  const pathname = (globalThis as { location?: { pathname?: string } }).location?.pathname ?? ''
  const matched = pathname.match(/^\/sessions\/([A-Za-z0-9_-]{1,128})(?:\/|$)/)
  return matched === null ? '' : `/sessions/${matched[1]}`
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
