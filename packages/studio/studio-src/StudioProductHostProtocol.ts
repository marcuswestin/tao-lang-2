import { Assert, Errors } from '@shared/core'
import type { StudioRenderInspection } from '@source-actions'
import { StudioApiError } from './client/StudioApiClient'
import type { StudioProductHostPanels } from './client/StudioPanelProjection'
import type { StudioInspectorSelection } from './StudioInspector'
import type { StudioCanonicalSourceAction } from './StudioProtocol'
import { StudioForeignActionFailure } from './TaoStudioServerActions'

export type StudioProductHostActions = Readonly<{
  applyActiveCellEnvironment: (
    identity: StudioProductHostCellIdentity,
    environment: StudioProductHostEnvironment,
  ) => Promise<void>
  changeActiveFile: (content: string) => void
  createFile: (path: string) => Promise<void>
  deleteFile: (path: string, sourceVersion: string) => Promise<void>
  insertComponent: (component: string) => void
  insertProjectView: (viewName: string) => void
  moveGeneratedSource: (path: string, sourceVersion: string, targetPackage: string) => Promise<void>
  applyInspectorAction: (action: StudioCanonicalSourceAction, proposed: boolean) => Promise<void>
  openFile: (path: string) => Promise<void>
  openScreen: (subjectId: string) => Promise<void>
  productPanelAction: (name: string, payload: string) => Promise<void>
  renameFile: (path: string, sourceVersion: string, targetPath: string) => Promise<void>
  selectActiveFile: (anchor: number, head: number) => void
  undoInspectorAction: () => Promise<void>
}>

export type StudioProductHostCellIdentity = Readonly<{
  cellId: string
  cellRevision: number
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
    scenarioModel: string
    scenarioId: string
    schemeCapability: 'fixed-light-native' | 'reactive-browser'
    schemeRequested: 'dark' | 'light' | 'system'
    schemeResolved: 'dark' | 'light'
    schemeSource: 'native-fixed' | 'preference' | 'scenario' | 'system'
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
  inspector?: Readonly<{
    busy: boolean
    canUndo: boolean
    currentSourceVersion?: string
    inspection?: StudioRenderInspection
    selection?: StudioInspectorSelection
  }>
  panels?: StudioProductHostPanels
  selectedRender?: Readonly<{
    path: string
    renderId: string
    sourceVersion: string
  }>
}>

type StudioProductHostRequest =
  | Readonly<{
    environment: StudioProductHostEnvironment
    identity: StudioProductHostCellIdentity
    kind: 'apply-active-cell-environment'
  }>
  | Readonly<{ action: StudioCanonicalSourceAction; kind: 'apply-inspector-action'; proposed: boolean }>
  | Readonly<{ kind: 'create-file'; path: string }>
  | Readonly<{ kind: 'delete-file'; path: string; sourceVersion: string }>
  | Readonly<{ component: string; kind: 'insert-component' }>
  | Readonly<{ kind: 'insert-project-view'; viewName: string }>
  | Readonly<{ kind: 'move-generated-source'; path: string; sourceVersion: string; targetPackage: string }>
  | Readonly<{ kind: 'open-file'; path: string }>
  | Readonly<{ kind: 'open-screen'; subjectId: string }>
  | Readonly<{ kind: 'product-panel-action'; name: string; payload: string }>
  | Readonly<{ kind: 'rename-file'; path: string; sourceVersion: string; targetPath: string }>
  | Readonly<{ kind: 'undo-inspector-action' }>

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
  Assert(activeActions === undefined, 'the Tao Studio product host actions to be registered only once')
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
    inspector: freezeOptional(state.inspector),
    panels: freezeOptional(state.panels),
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
  Assert.input(typeof content === 'string', 'Tao Studio editor changes require text content.')
  Assert.defined(activeActions, 'the Tao Studio editor to be ready before it forwards a change')
  activeActions.changeActiveFile(content)
}

export function requestStudioProductHostSelectActiveFile(anchor: number, head: number): void {
  Assert.input(
    Number.isInteger(anchor) && Number.isInteger(head) && anchor >= 0 && head >= 0,
    'Tao Studio editor selection offsets must be non-negative integers.',
  )
  Assert.defined(activeActions, 'the Tao Studio editor to be ready before it forwards a selection')
  activeActions.selectActiveFile(anchor, head)
}

export async function requestStudioProductHostCreateFile(path: string): Promise<void> {
  assertStudioProductHostPath(path)
  await requestFileAction({ kind: 'create-file', path })
}

export async function requestStudioProductHostApplyActiveCellEnvironment(
  identity: StudioProductHostCellIdentity,
  environment: StudioProductHostEnvironment,
): Promise<void> {
  assertStudioProductHostCellIdentity(identity)
  assertStudioProductHostEnvironment(environment)
  await requestConflictAction(
    { environment, identity, kind: 'apply-active-cell-environment' },
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

export async function requestStudioProductHostMoveGeneratedSource(
  path: string,
  sourceVersion: string,
  targetPackage: string,
): Promise<void> {
  assertStudioProductHostPath(path)
  assertSourceVersion(sourceVersion)
  Assert.input(targetPackage.trim() !== '', 'Move to package requires a target package.')
  await requestFileAction({ kind: 'move-generated-source', path, sourceVersion, targetPackage })
}

export async function requestStudioProductHostInsertComponent(component: string): Promise<void> {
  assertNonEmptyProductHostIdentity(component, 'component')
  await request({ component, kind: 'insert-component' })
}

export async function requestStudioProductHostInsertProjectView(viewName: string): Promise<void> {
  assertNonEmptyProductHostIdentity(viewName, 'project view')
  await request({ kind: 'insert-project-view', viewName })
}

export async function requestStudioProductHostOpenScreen(subjectId: string): Promise<void> {
  assertNonEmptyProductHostIdentity(subjectId, 'screen')
  await request({ kind: 'open-screen', subjectId })
}

export async function requestStudioProductHostApplyInspectorAction(
  action: StudioCanonicalSourceAction,
  proposed: boolean,
): Promise<void> {
  await request({ action, kind: 'apply-inspector-action', proposed })
}

export async function requestStudioProductHostUndoInspectorAction(): Promise<void> {
  await request({ kind: 'undo-inspector-action' })
}

export async function requestStudioProductHostPanelAction(name: string, payload: string): Promise<void> {
  assertNonEmptyProductHostIdentity(name, 'panel')
  Assert.input(payload.length <= 1_000_000, 'Tao Studio panel action payloads must be at most one megabyte.')
  await request({ kind: 'product-panel-action', name, payload })
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
      throw new StudioForeignActionFailure('Conflict', message, error.status, error.details)
    }
    throw error
  }
}

async function execute(actions: StudioProductHostActions, action: StudioProductHostRequest): Promise<void> {
  switch (action.kind) {
    case 'apply-inspector-action':
      await actions.applyInspectorAction(action.action, action.proposed)
      return
    case 'apply-active-cell-environment':
      await actions.applyActiveCellEnvironment(action.identity, action.environment)
      return
    case 'create-file':
      await actions.createFile(action.path)
      return
    case 'delete-file':
      await actions.deleteFile(action.path, action.sourceVersion)
      return
    case 'insert-component':
      actions.insertComponent(action.component)
      return
    case 'insert-project-view':
      actions.insertProjectView(action.viewName)
      return
    case 'move-generated-source':
      await actions.moveGeneratedSource(action.path, action.sourceVersion, action.targetPackage)
      return
    case 'open-file':
      await actions.openFile(action.path)
      return
    case 'open-screen':
      await actions.openScreen(action.subjectId)
      return
    case 'product-panel-action':
      await actions.productPanelAction(action.name, action.payload)
      return
    case 'rename-file':
      await actions.renameFile(action.path, action.sourceVersion, action.targetPath)
      return
    case 'undo-inspector-action':
      await actions.undoInspectorAction()
  }
}

function assertNonEmptyProductHostIdentity(value: string, label: string): void {
  Assert.input(
    value.trim() !== '' && value.length <= 1_024,
    `Tao Studio ${label} actions require a stable identity.`,
  )
}

function assertStudioProductHostCellIdentity(identity: StudioProductHostCellIdentity): void {
  Assert.input(
    identity.cellId.trim() !== '' && Number.isInteger(identity.cellRevision) && identity.cellRevision >= 0,
    'Tao Studio scenario actions require a current cell identity and revision.',
  )
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
    Errors.throwUserInput('Tao Studio requires a valid viewport and network environment.')
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
    Errors.throwUserInput('Tao Studio error-mode networks require a message and HTTP status from 100 through 599.')
  }
}

function freezeOptional<ValueT extends object>(value: ValueT | undefined): Readonly<ValueT> | undefined {
  return value === undefined ? undefined : Object.freeze({ ...value })
}

function assertStudioProductHostPath(path: string): void {
  Assert.input(validStudioProductHostPath(path), 'Tao Studio accepts only project-relative Tao file paths.')
}

function assertSourceVersion(sourceVersion: string): void {
  Assert.input(
    sourceVersion.length > 0 && sourceVersion.length <= 1_024,
    'Tao Studio file actions require a source version.',
  )
}
