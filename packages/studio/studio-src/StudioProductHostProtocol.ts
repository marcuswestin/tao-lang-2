import { StudioApiError } from './client/StudioApiClient'
import { StudioForeignActionFailure } from './TaoStudioServerActions'

export type StudioProductHostActions = Readonly<{
  applyActiveCellEnvironment: (environment: StudioProductHostEnvironment) => Promise<void>
  changeActiveFile: (content: string) => void
  createFile: (path: string) => Promise<void>
  deleteFile: (path: string, sourceVersion: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  renameFile: (path: string, sourceVersion: string, targetPath: string) => Promise<void>
  selectActiveFile: (anchor: number, head: number) => void
}>

export type StudioProductHostEnvironment = Readonly<{
  network: Readonly<{
    error?: Readonly<{ message: string; status: number }>
    latencyMs: number
    outcome: 'error' | 'normal' | 'offline'
  }>
  viewport: Readonly<{
    height: number
    presetId?: string
    width: number
  }>
}>

export type StudioProductHostState = Readonly<{
  activeCell?: Readonly<{
    cellId: string
    cellRevision: number
    networkErrorMessage?: string
    networkErrorStatus?: number
    networkLatencyMs: number
    networkOutcome: StudioProductHostEnvironment['network']['outcome']
    scenarioId: string
    schemeRequested: 'dark' | 'light'
    schemeStatus: 'inert'
    viewportHeight: number
    viewportPresetId?: string
    viewportWidth: number
  }>
  activeFile?: Readonly<{
    content: string
    path: string
    selectionAnchor: number
    selectionHead: number
    sourceVersion: string
  }>
  projectRoot?: string
  revision: number
  selectedRender?: Readonly<{
    path: string
    renderId: string
    sourceVersion: string
  }>
}>

type StudioProductHostRequest =
  | Readonly<{ environment: StudioProductHostEnvironment; kind: 'apply-active-cell-environment' }>
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
const stateListeners = new Set<() => void>()
let activeState: StudioProductHostState = Object.freeze({ revision: 0 })

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

/** Publishes transient browser-local selection state without making StudioServer its authority. */
export function publishStudioProductHostState(
  state: Omit<StudioProductHostState, 'revision'>,
): StudioProductHostState {
  activeState = Object.freeze({
    ...state,
    activeCell: freezeOptional(state.activeCell),
    activeFile: freezeOptional(state.activeFile),
    revision: activeState.revision + 1,
    selectedRender: freezeOptional(state.selectedRender),
  })
  for (const listener of stateListeners) {
    listener()
  }
  return activeState
}

export function studioProductHostState(): StudioProductHostState {
  return activeState
}

export function subscribeStudioProductHostState(listener: () => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

/** Sends a Tao-mounted editor change through the existing tab/draft controller. */
export function requestStudioProductHostChangeActiveFile(content: string): void {
  if (typeof content !== 'string') {
    throw new Error('Tao Studio editor changes require text content.')
  }
  if (activeActions === undefined) {
    throw new Error('Tao Studio editor is not ready yet.')
  }
  activeActions.changeActiveFile(content)
}

export function requestStudioProductHostSelectActiveFile(anchor: number, head: number): void {
  if (!Number.isInteger(anchor) || !Number.isInteger(head) || anchor < 0 || head < 0) {
    throw new Error('Tao Studio editor selection offsets must be non-negative integers.')
  }
  if (activeActions === undefined) {
    throw new Error('Tao Studio editor is not ready yet.')
  }
  activeActions.selectActiveFile(anchor, head)
}

export async function requestStudioProductHostCreateFile(path: string): Promise<void> {
  assertStudioProductHostPath(path)
  await requestFileAction({ kind: 'create-file', path })
}

export async function requestStudioProductHostApplyActiveCellEnvironment(
  environment: StudioProductHostEnvironment,
): Promise<void> {
  assertStudioProductHostEnvironment(environment)
  await requestConflictAction(
    { environment, kind: 'apply-active-cell-environment' },
    'This preview changed while its environment was being edited.',
  )
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
  await requestConflictAction(action, 'This file changed under this edit.')
}

async function requestConflictAction(action: StudioProductHostRequest, message: string): Promise<void> {
  try {
    await request(action)
  } catch (error) {
    if (error instanceof StudioApiError && error.status === 409) {
      throw new StudioForeignActionFailure('Conflict', message, error.status)
    }
    throw error
  }
}

async function execute(actions: StudioProductHostActions, action: StudioProductHostRequest): Promise<void> {
  switch (action.kind) {
    case 'apply-active-cell-environment':
      await actions.applyActiveCellEnvironment(action.environment)
      return
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

function assertStudioProductHostEnvironment(environment: StudioProductHostEnvironment): void {
  const viewport = environment.viewport
  const network = environment.network
  if (
    !Number.isFinite(viewport.width)
    || !Number.isFinite(viewport.height)
    || viewport.width <= 0
    || viewport.height <= 0
    || !Number.isFinite(network.latencyMs)
    || network.latencyMs < 0
    || !['error', 'normal', 'offline'].includes(network.outcome)
  ) {
    throw new Error('Tao Studio requires a valid viewport and network environment.')
  }
  if (
    network.outcome === 'error'
    && (
      network.error === undefined
      || network.error.message.trim() === ''
      || !Number.isInteger(network.error.status)
      || network.error.status < 100
      || network.error.status > 599
    )
  ) {
    throw new Error('Tao Studio error-mode networks require a message and HTTP status from 100 through 599.')
  }
}

function freezeOptional<ValueT extends object>(value: ValueT | undefined): Readonly<ValueT> | undefined {
  return value === undefined ? undefined : Object.freeze({ ...value })
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
