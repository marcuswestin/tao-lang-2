import { StudioApiError } from './client/StudioApiClient'
import { StudioForeignActionFailure } from './TaoStudioServerActions'

export type StudioProductHostActions = Readonly<{
  createFile: (path: string) => Promise<void>
  deleteFile: (path: string, sourceVersion: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  renameFile: (path: string, sourceVersion: string, targetPath: string) => Promise<void>
}>

type StudioProductHostRequest =
  | Readonly<{ kind: 'create-file'; path: string }>
  | Readonly<{ kind: 'delete-file'; path: string; sourceVersion: string }>
  | Readonly<{ kind: 'open-file'; path: string }>
  | Readonly<{ kind: 'rename-file'; path: string; sourceVersion: string; targetPath: string }>

type PendingRequest = Readonly<{
  action: StudioProductHostRequest
  reject: (reason: unknown) => void
  resolve: () => void
}>

let activeActions: StudioProductHostActions | undefined
const pendingRequests: PendingRequest[] = []

/** Installs the workbench controller behind the Tao-owned Files panel and drains early requests. */
export function registerStudioProductHostActions(actions: StudioProductHostActions): () => void {
  if (activeActions !== undefined) {
    throw new Error('Tao Studio product host actions are already registered.')
  }
  activeActions = actions
  for (const pending of pendingRequests.splice(0)) {
    void execute(actions, pending.action).then(pending.resolve, pending.reject)
  }
  return () => {
    if (activeActions === actions) {
      activeActions = undefined
    }
  }
}

/** Rejects actions queued while a product host was mounting when that mount cannot complete. */
export function rejectPendingStudioProductHostActions(reason: unknown): void {
  for (const pending of pendingRequests.splice(0)) {
    pending.reject(reason)
  }
}

export async function requestStudioProductHostCreateFile(path: string): Promise<void> {
  assertStudioProductHostPath(path)
  await requestFileAction({ kind: 'create-file', path })
}

export async function requestStudioProductHostDeleteFile(path: string, sourceVersion: string): Promise<void> {
  assertStudioProductHostPath(path)
  assertSourceVersion(sourceVersion)
  await requestFileAction({ kind: 'delete-file', path, sourceVersion })
}

export async function requestStudioProductHostOpenFile(path: string): Promise<void> {
  assertStudioProductHostPath(path)
  await request({ kind: 'open-file', path })
}

export async function requestStudioProductHostRenameFile(
  path: string,
  sourceVersion: string,
  targetPath: string,
): Promise<void> {
  assertStudioProductHostPath(path)
  assertSourceVersion(sourceVersion)
  assertStudioProductHostPath(targetPath)
  await requestFileAction({ kind: 'rename-file', path, sourceVersion, targetPath })
}

export function validStudioProductHostPath(path: string): boolean {
  return path.length > 0
    && path.length <= 1_024
    && path.endsWith('.tao')
    && !path.startsWith('/')
    && !path.includes('\\')
    && !path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
}

async function request(action: StudioProductHostRequest): Promise<void> {
  if (activeActions !== undefined) {
    await execute(activeActions, action)
    return
  }
  await new Promise<void>((resolve, reject) => pendingRequests.push({ action, reject, resolve }))
}

async function requestFileAction(action: StudioProductHostRequest): Promise<void> {
  try {
    await request(action)
  } catch (error) {
    if (error instanceof StudioApiError && error.status === 409) {
      throw new StudioForeignActionFailure('Conflict', 'This file changed under this edit.', error.status)
    }
    throw error
  }
}

async function execute(actions: StudioProductHostActions, action: StudioProductHostRequest): Promise<void> {
  switch (action.kind) {
    case 'create-file':
      await actions.createFile(action.path)
      return
    case 'delete-file':
      await actions.deleteFile(action.path, action.sourceVersion)
      return
    case 'open-file':
      await actions.openFile(action.path)
      return
    case 'rename-file':
      await actions.renameFile(action.path, action.sourceVersion, action.targetPath)
  }
}

function assertStudioProductHostPath(path: string): void {
  if (!validStudioProductHostPath(path)) {
    throw new Error('Tao Studio accepts only project-relative Tao file paths.')
  }
}

function assertSourceVersion(sourceVersion: string): void {
  if (sourceVersion.length === 0 || sourceVersion.length > 1_024) {
    throw new Error('Tao Studio file actions require a source version.')
  }
}
