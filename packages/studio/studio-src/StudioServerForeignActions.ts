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

const fileConflictSentence = 'This file changed under this edit.'
import type {
  StudioSourceActionEnvelope,
  StudioSourceActionUndoEnvelope,
} from './StudioProtocol'

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
  UndoSourceAction: { endpoint: '/api/source-action/undo' },
} as const

export class StudioForeignActionFailure extends Error {
  override readonly name = 'StudioForeignActionFailure'

  constructor(
    readonly caseName: 'Conflict' | 'Server',
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export type StudioForeignActionFetch = (
  input: string,
  init: { body: string; headers: Readonly<Record<string, string>>; method: 'POST' },
) => Promise<Pick<Response, 'json' | 'ok' | 'status'>>

/** HTTP adapter consumed by future Tao foreign actions while the Studio shell remains TypeScript-owned. */
export class StudioServerForeignActions {
  readonly #basePath: string
  readonly #fetch: StudioForeignActionFetch

  constructor(options: { basePath?: string; fetch?: StudioForeignActionFetch } = {}) {
    this.#basePath = options.basePath?.replace(/\/$/, '') ?? ''
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
    return await this.#post(studioServerForeignActionContract.UndoSourceAction.endpoint, request)
  }

  async #post<Result>(endpoint: string, request: unknown, conflictSentence?: string): Promise<Result> {
    const response = await this.#fetch(`${this.#basePath}${endpoint}`, {
      body: JSON.stringify(request),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const body = await response.json() as Result | { error?: string }
    if (response.ok) {
      return body as Result
    }
    if (conflictSentence !== undefined && response.status === 409) {
      throw new StudioForeignActionFailure(
        'Conflict',
        conflictSentence,
        response.status,
      )
    }
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? body.error
      : undefined
    throw new StudioForeignActionFailure(
      'Server',
      message ?? `Studio action failed (${response.status}).`,
      response.status,
    )
  }
}

const taoStudioActions = new StudioServerForeignActions()
let nextTaoStudioWriteId = 1

/** Named exports are the Tao foreign-action boundary; the class remains injectable for host tests. */
export async function SyncDraft(path: string, sourceVersion: string, content: string): Promise<void> {
  await taoStudioActions.syncDraft({ content, path, sourceVersion, writeId: writeId('draft') })
}

export async function ApplySourceAction(envelope: string): Promise<void> {
  await taoStudioActions.applySourceAction(parseEnvelope<StudioSourceActionEnvelope>(envelope, 'source action'))
}

export async function UndoSourceAction(envelope: string): Promise<void> {
  await taoStudioActions.undoSourceAction(parseEnvelope<StudioSourceActionUndoEnvelope>(envelope, 'source action undo'))
}

export async function CreateFile(path: string): Promise<void> {
  await taoStudioActions.createFile({ path, writeId: writeId('create') })
}

export async function RenameFile(path: string, sourceVersion: string, targetPath: string): Promise<void> {
  await taoStudioActions.renameFile({ path, sourceVersion, targetPath, writeId: writeId('rename') })
}

export async function DeleteFile(path: string, sourceVersion: string): Promise<void> {
  await taoStudioActions.deleteFile({ path, sourceVersion, writeId: writeId('delete') })
}

function writeId(kind: string): string {
  return `tao-studio-${kind}-${nextTaoStudioWriteId++}`
}

function parseEnvelope<ValueT>(encoded: string, name: string): ValueT {
  try {
    const value = JSON.parse(encoded)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object')
    }
    return value as ValueT
  } catch {
    throw new StudioForeignActionFailure('Server', `Invalid ${name} envelope.`)
  }
}
