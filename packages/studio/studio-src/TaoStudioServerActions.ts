type FailureCase = 'Conflict' | 'Server'

class StudioForeignActionFailure extends Error {
  override readonly name = 'StudioForeignActionFailure'

  constructor(readonly caseName: FailureCase, message: string, readonly status?: number) {
    super(message)
  }
}

let nextWriteId = 1

/** Named exports form the executable Tao-to-StudioServer write boundary. */
export async function SyncDraft(path: string, sourceVersion: string, content: string): Promise<void> {
  await post('/api/file/draft', { content, path, sourceVersion, writeId: writeId('draft') })
}

export async function ApplySourceAction(envelope: string): Promise<void> {
  await post('/api/source-action', parseEnvelope(envelope, 'source action'), true)
}

export async function UndoSourceAction(envelope: string): Promise<void> {
  await post('/api/source-action/undo', parseEnvelope(envelope, 'source action undo'))
}

export async function CreateFile(path: string): Promise<void> {
  await post('/api/file/create', { path, writeId: writeId('create') }, true)
}

export async function RenameFile(path: string, sourceVersion: string, targetPath: string): Promise<void> {
  await post('/api/file/rename', { path, sourceVersion, targetPath, writeId: writeId('rename') }, true)
}

export async function DeleteFile(path: string, sourceVersion: string): Promise<void> {
  await post('/api/file/delete', { path, sourceVersion, writeId: writeId('delete') }, true)
}

function writeId(kind: string): string {
  return `tao-studio-${kind}-${nextWriteId++}`
}

function parseEnvelope(encoded: string, name: string): Readonly<Record<string, unknown>> {
  try {
    const value = JSON.parse(encoded) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object')
    }
    return value as Readonly<Record<string, unknown>>
  } catch {
    throw new StudioForeignActionFailure('Server', `Invalid ${name} envelope.`)
  }
}

async function post(endpoint: string, request: unknown, conflicts = false): Promise<void> {
  const response = await fetch(studioSessionPath(endpoint), {
    body: JSON.stringify(request),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const body = await response.json() as { error?: string }
  if (response.ok) {
    return
  }
  if (conflicts && response.status === 409) {
    throw new StudioForeignActionFailure('Conflict', 'This file changed under this edit.', response.status)
  }
  throw new StudioForeignActionFailure(
    'Server',
    body.error ?? `Studio action failed (${response.status}).`,
    response.status,
  )
}

function studioSessionPath(endpoint: string): string {
  const pathname = (globalThis as { location?: { pathname?: string } }).location?.pathname ?? ''
  const matched = pathname.match(/^\/sessions\/([A-Za-z0-9_-]{1,128})(?:\/|$)/)
  return matched === null ? endpoint : `/sessions/${matched[1]}${endpoint}`
}
