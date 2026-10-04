import type { CrudNote, CrudStatus, CrudUser } from '../contract'

type NoteDocument = {
  $id: string
  ownerId: string
  text: string
  done: boolean
  updatedAt: number
}

export class AppwriteNotesError extends Error {}

export function isOfflineError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const value = error as { code?: unknown; message?: unknown }
  return value.code === 0 && typeof value.message === 'string'
    && /network (?:request failed|error)|failed to fetch|fetch failed|internet connection|connection (?:lost|failed|timed out)|offline/i
      .test(value.message)
}

export function parseCachedUser(value: string | null): { id: string; email: string } | undefined {
  if (!value) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') {
      return undefined
    }
    const user = parsed as { id?: unknown; email?: unknown }
    if (typeof user.id !== 'string' || !user.id || typeof user.email !== 'string') {
      return undefined
    }
    return { id: user.id, email: user.email }
  } catch {
    return undefined
  }
}

export async function restoreAccount(
  readRemote: () => Promise<CrudUser>,
  storage: {
    getItem(key: string): Promise<string | null>
    setItem(key: string, value: string): Promise<unknown>
    removeItem(key: string): Promise<unknown>
  },
  key: string,
): Promise<CrudUser | undefined> {
  let user: CrudUser
  try {
    user = await readRemote()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 401) {
      await storage.removeItem(key)
      return undefined
    }
    if (isOfflineError(error)) {
      return parseCachedUser(await storage.getItem(key))
    }
    throw error
  }
  await storage.setItem(key, JSON.stringify(user))
  return user
}

export function toNote(document: unknown, userId: string): CrudNote {
  if (!document || typeof document !== 'object') {
    throw new AppwriteNotesError('Appwrite returned an invalid note')
  }
  const row = document as Partial<NoteDocument>
  if (
    typeof row.$id !== 'string' || typeof row.ownerId !== 'string' || typeof row.text !== 'string'
    || typeof row.done !== 'boolean' || typeof row.updatedAt !== 'number'
  ) {
    throw new AppwriteNotesError('Appwrite returned an invalid note')
  }
  if (row.ownerId !== userId) {
    throw new AppwriteNotesError('Appwrite returned a note owned by another account')
  }
  return {
    id: row.$id,
    text: row.text,
    done: row.done,
    updatedAt: row.updatedAt,
  }
}

export function storageName(
  endpoint: string,
  projectId: string,
  databaseId: string,
  tableId: string,
  userId: string,
): string {
  return `hosted-crud-appwrite:${endpoint}:${projectId}:${databaseId}:${tableId}:${userId}`
}

export function syncStatus(state: {
  error?: Error
  isLoaded: boolean
  isGetting?: boolean
  isSetting?: boolean
  numPendingSets?: number
  pendingChanges?: number
}): CrudStatus {
  if (state.error) {
    return 'error'
  }
  if (state.isGetting || state.isSetting || state.numPendingSets) {
    return 'syncing'
  }
  if (!state.isLoaded || state.pendingChanges) {
    return 'local'
  }
  return 'synced'
}
