import TR from '@runtime/TR'
import { CodeEditor } from '@tao/code-editor'
import React from 'react'
import { createPortal } from 'react-dom'
import { StudioApiClient } from './client/StudioApiClient'
import { mountStudio } from './client/StudioApp'
import { fileUri } from './client/StudioEditor'
import {
  rejectPendingStudioProductHostActions,
  requestStudioProductHostApplyActiveCellEnvironment,
  requestStudioProductHostChangeActiveFile,
  requestStudioProductHostCreateFile,
  requestStudioProductHostDeleteFile,
  requestStudioProductHostOpenFile,
  requestStudioProductHostRenameFile,
  requestStudioProductHostSelectActiveFile,
  studioProductHostState,
  subscribeStudioProductHostState,
} from './StudioProductHostProtocol'

export type TaoStudioProductHostProps = Readonly<{
  children?: React.ReactNode
  Layout?: Readonly<{ style?: React.CSSProperties }>
  Slots?: Readonly<Record<string, React.ReactNode>>
  Tag?: string
}>

type TaoStudioHostVisualProps = Readonly<{
  Layout?: Readonly<{ style?: React.CSSProperties }>
  Tag?: string
}>

type TaoStudioHostAction = TR.ActionValue<[]>
type TaoStudioHostTextAction = TR.ActionValue<[TR.Value<string>]>
type TaoStudioHostNumberAction = TR.ActionValue<[TR.Value<number>]>
type StudioContextPanelSlotProps = Readonly<{
  ActiveCellId?: TR.Value<string>
  CellRevision?: TR.Value<number>
  ActiveFileContent?: TR.Value<string>
  ActiveFilePath?: TR.Value<string>
  ActiveFileVersion?: TR.Value<string>
  ActiveScenarioId?: TR.Value<string>
  NetworkErrorMessage?: TR.Value<string>
  NetworkErrorStatus?: TR.Value<number>
  NetworkLatencyMs?: TR.Value<number>
  NetworkOutcome?: TR.Value<string>
  ProjectRoot?: TR.Value<string>
  Revision?: TR.Value<number>
  SchemeRequested?: TR.Value<string>
  SchemeStatus?: TR.Value<string>
  SelectedRenderId?: TR.Value<string>
  SelectedRenderPath?: TR.Value<string>
  SelectedRenderVersion?: TR.Value<string>
  SelectionAnchor?: TR.Value<number>
  SelectionHead?: TR.Value<number>
  ViewportHeight?: TR.Value<number>
  ViewportPresetId?: TR.Value<string>
  ViewportWidth?: TR.Value<number>
}>

/** ProductHostBoundary is the single foreign seam between Tao-owned navigation and the product workbench. */
export function ProductHostBoundary(props: TaoStudioProductHostProps): React.ReactElement {
  const mount = React.useRef<HTMLDivElement>(null)
  const hostState = React.useSyncExternalStore(
    subscribeStudioProductHostState,
    studioProductHostState,
    studioProductHostState,
  )
  const [editorTarget, setEditorTarget] = React.useState<HTMLElement>()
  const [filesTarget, setFilesTarget] = React.useState<HTMLElement>()
  const [inspectorTarget, setInspectorTarget] = React.useState<HTMLElement>()
  React.useEffect(() => {
    const root = mount.current
    if (root === null) {
      return
    }
    let cleanup: (() => void) | undefined
    let unmounted = false
    const cancellation = new AbortController()
    const mounting = mountStudio({ embedded: true, root, signal: cancellation.signal })
    const reportMountError = (error: unknown): void => {
      if (unmounted && error instanceof Error && error.name === 'AbortError') {
        return
      }
      rejectPendingStudioProductHostActions(error)
      console.error('Could not mount the Tao Studio product host.', error)
      if (!unmounted) {
        const alert = document.createElement('p')
        alert.className = 'studio-product-host-error'
        alert.role = 'alert'
        alert.textContent = error instanceof Error ? error.message : String(error)
        root.replaceChildren(alert)
      }
    }
    const unmount = (): void => {
      unmounted = true
      cancellation.abort()
      const error = new Error('Tao Studio product host unmounted before the requested action could run.')
      error.name = 'AbortError'
      rejectPendingStudioProductHostActions(error)
      cleanup?.()
    }
    const target = root.querySelector<HTMLElement>('.studio-files')
    if (target === null) {
      void mounting.catch(reportMountError)
      return unmount
    }
    setFilesTarget(target)
    const editor = root.querySelector<HTMLElement>('.studio-editor')
    if (editor !== null) {
      setEditorTarget(editor)
    }
    const inspector = root.querySelector<HTMLElement>('.studio-inspector-tao-context')
    if (inspector !== null) {
      setInspectorTarget(inspector)
    }
    void mounting.then(dispose => {
      if (unmounted) {
        dispose()
      } else {
        cleanup = dispose
      }
    }).catch(reportMountError)
    return unmount
  }, [])
  const productHost = (
    <div
      className="tao-studio-product-host"
      data-tao-studio="product-host"
      data-testid={props.Tag}
      ref={mount}
      style={productHostStyle(props.Layout?.style)}
    />
  )
  const files = props.Slots?.['@files'] ?? props.Slots?.['files'] ?? props.children
  const editor = props.Slots?.['@editor'] ?? props.Slots?.['editor']
  const inspector = props.Slots?.['@inspector'] ?? props.Slots?.['inspector']
  const activeFile = hostState.activeFile
  const activeCell = hostState.activeCell
  const selectedRender = hostState.selectedRender
  const refreshedInspector = React.isValidElement<StudioContextPanelSlotProps>(inspector)
    ? React.cloneElement(inspector, {
      ActiveCellId: TR.Value(activeCell?.cellId ?? ''),
      CellRevision: TR.Value(activeCell?.cellRevision ?? 0),
      ActiveFileContent: TR.Value(activeFile?.content ?? ''),
      ActiveFilePath: TR.Value(activeFile?.path ?? ''),
      ActiveFileVersion: TR.Value(activeFile?.sourceVersion ?? ''),
      ActiveScenarioId: TR.Value(activeCell?.scenarioId ?? ''),
      NetworkErrorMessage: TR.Value(activeCell?.networkErrorMessage ?? 'Injected Studio network failure'),
      NetworkErrorStatus: TR.Value(activeCell?.networkErrorStatus ?? 503),
      NetworkLatencyMs: TR.Value(activeCell?.networkLatencyMs ?? 0),
      NetworkOutcome: TR.Value(activeCell?.networkOutcome ?? 'normal'),
      ProjectRoot: TR.Value(hostState.projectRoot ?? ''),
      Revision: TR.Value(hostState.revision),
      SchemeRequested: TR.Value(activeCell?.schemeRequested ?? 'light'),
      SchemeStatus: TR.Value(activeCell?.schemeStatus ?? 'inert'),
      SelectedRenderId: TR.Value(selectedRender?.renderId ?? ''),
      SelectedRenderPath: TR.Value(selectedRender?.path ?? ''),
      SelectedRenderVersion: TR.Value(selectedRender?.sourceVersion ?? ''),
      SelectionAnchor: TR.Value(activeFile?.selectionAnchor ?? 0),
      SelectionHead: TR.Value(activeFile?.selectionHead ?? 0),
      ViewportHeight: TR.Value(activeCell?.viewportHeight ?? 0),
      ViewportPresetId: TR.Value(activeCell?.viewportPresetId ?? 'custom'),
      ViewportWidth: TR.Value(activeCell?.viewportWidth ?? 0),
    })
    : inspector
  const contents = (
    <>
      {productHost}
      {filesTarget === undefined || files === undefined ? undefined : createPortal(files, filesTarget)}
      {editorTarget === undefined || editor === undefined ? undefined : createPortal(editor, editorTarget)}
      {inspectorTarget === undefined || refreshedInspector === undefined
        ? undefined
        : createPortal(
          <React.Fragment key={`${activeCell?.cellId ?? 'none'}:${activeCell?.cellRevision ?? 0}`}>
            {refreshedInspector}
          </React.Fragment>,
          inspectorTarget,
        )}
    </>
  )
  const viewport = typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('#tao-studio-viewport')
  return viewport === null ? contents : createPortal(contents, viewport)
}

export function StudioContextPanelSurface(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return (
    <section
      aria-label="Active workbench context"
      className="studio-context-panel-surface"
      data-testid={props.Tag}
      style={props.Layout?.style}
    >
      {props.children}
    </section>
  )
}

export type StudioContextSummaryProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    CellId: string
    FilePath: string
    RenderId: string
    ScenarioId: string
    ViewportHeight: number
    ViewportWidth: number
  }>

/** Compact presentation-only adapter; Tao owns the StudioContext query and supplied values. */
export function StudioContextSummary(props: StudioContextSummaryProps): React.ReactElement {
  const scenario = compactIdentity(props.ScenarioId) || 'No active scenario'
  return (
    <div className="studio-context-summary" data-active-cell={props.CellId} data-testid={props.Tag}>
      <strong title={props.FilePath}>{props.FilePath || 'No open file'}</strong>
      <span title={props.ScenarioId}>{scenario}</span>
      {props.ViewportWidth > 0 && props.ViewportHeight > 0
        ? <span>{props.ViewportWidth}×{props.ViewportHeight}</span>
        : undefined}
      {props.RenderId === '' ? undefined : <span className="studio-context-selected">render selected</span>}
    </div>
  )
}

export type StudioScenarioEnvironmentControlsProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Apply: TaoStudioHostAction
    ChangeErrorMessage: TaoStudioHostTextAction
    ChangeErrorStatus: TaoStudioHostNumberAction
    ChangeHeight: TaoStudioHostNumberAction
    ChangeLatency: TaoStudioHostNumberAction
    ChangeNetwork: TaoStudioHostTextAction
    ChangePreset: TaoStudioHostTextAction
    ChangeWidth: TaoStudioHostNumberAction
    ErrorMessage: string
    ErrorStatus: number
    Height: number
    Latency: number
    Network: string
    Preset: string
    SchemeRequested: string
    SchemeStatus: string
    Width: number
  }>

/** Native controls are a thin adapter; Tao owns their draft state and the apply action. */
export function StudioScenarioEnvironmentControls(
  props: StudioScenarioEnvironmentControlsProps,
): React.ReactElement {
  const changePreset = async (value: string): Promise<void> => {
    await props.ChangePreset.invoke(TR.Value(value))
    const preset = studioViewportPresets[value]
    if (preset !== undefined) {
      await props.ChangeWidth.invoke(TR.Value(preset.width))
      await props.ChangeHeight.invoke(TR.Value(preset.height))
      await props.ChangePreset.invoke(TR.Value(value))
    }
  }
  const numberChange = (action: TaoStudioHostNumberAction) => (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = Number(event.currentTarget.value)
    if (Number.isFinite(value)) {
      void action.invoke(TR.Value(value))
    }
  }
  return (
    <fieldset
      aria-label="Scenario environment"
      className="studio-inspector-controls studio-tao-scenario-controls"
      data-testid={props.Tag}
      style={props.Layout?.style}
    >
      <legend>Environment</legend>
      <label className="studio-inspector-field">
        <span>Device</span>
        <select
          onChange={event => void changePreset(event.currentTarget.value)}
          value={props.Preset}
        >
          <option value="phone">Phone</option>
          <option value="tablet">Tablet</option>
          <option value="laptop">Laptop</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <div className="studio-inspector-inline-controls">
        <label className="studio-inspector-field">
          <span>Width</span>
          <input min={1} onChange={numberChange(props.ChangeWidth)} type="number" value={props.Width} />
        </label>
        <label className="studio-inspector-field">
          <span>Height</span>
          <input min={1} onChange={numberChange(props.ChangeHeight)} type="number" value={props.Height} />
        </label>
      </div>
      <label className="studio-inspector-field">
        <span>Network</span>
        <select
          onChange={event => void props.ChangeNetwork.invoke(TR.Value(event.currentTarget.value))}
          value={props.Network}
        >
          <option value="normal">Normal</option>
          <option value="offline">Offline</option>
          <option value="error">Error</option>
        </select>
      </label>
      <label className="studio-inspector-field">
        <span>Latency ms</span>
        <input min={0} onChange={numberChange(props.ChangeLatency)} type="number" value={props.Latency} />
      </label>
      {props.Network === 'error'
        ? (
          <>
            <label className="studio-inspector-field">
              <span>Error</span>
              <input
                onChange={event => void props.ChangeErrorMessage.invoke(TR.Value(event.currentTarget.value))}
                type="text"
                value={props.ErrorMessage}
              />
            </label>
            <label className="studio-inspector-field">
              <span>Status</span>
              <input
                max={599}
                min={100}
                onChange={numberChange(props.ChangeErrorStatus)}
                type="number"
                value={props.ErrorStatus}
              />
            </label>
          </>
        )
        : undefined}
      <label className="studio-inspector-field">
        <span>Scheme</span>
        <input
          disabled
          title="Scheme remains inert until the Tao runtime exposes reactive Scheme support."
          value={`${props.SchemeRequested} · ${props.SchemeStatus}`}
        />
      </label>
      <button className="studio-inspector-button" onClick={() => void props.Apply.invoke()} type="button">
        Apply & remount
      </button>
    </fieldset>
  )
}

const studioViewportPresets: Readonly<Record<string, Readonly<{ height: number; width: number }>>> = {
  laptop: { height: 900, width: 1_440 },
  phone: { height: 844, width: 390 },
  tablet: { height: 1_180, width: 820 },
}

/** StudioEditorSurface is the Tao-mounted CodeEditor boundary over the host's revisioned active tab. */
export function StudioEditorSurface(): React.ReactElement {
  const state = React.useSyncExternalStore(
    subscribeStudioProductHostState,
    studioProductHostState,
    studioProductHostState,
  )
  const file = state.activeFile
  const lsp = React.useMemo(() =>
    file === undefined || state.projectRoot === undefined
      ? undefined
      : {
        documentUri: fileUri(state.projectRoot, file.path),
        languageId: 'tao',
        rootUri: fileUri(state.projectRoot),
        transport: StudioApiClient.lspTransport(),
      }, [file?.path, state.projectRoot])
  const change = React.useMemo(() =>
    ({
      invoke(value: TR.Value<string>) {
        requestStudioProductHostChangeActiveFile(value.evaluate().jsValue)
      },
    }) as TR.ActionValue<[TR.Value<string>]>, [])
  const wrapper = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const target = wrapper.current?.parentElement
    if (target === null || target === undefined) {
      return
    }
    target.dataset['taoEditorMounted'] = 'true'
    return () => {
      delete target.dataset['taoEditorMounted']
    }
  }, [])
  if (file === undefined) {
    return <div className="studio-editor-tao-surface studio-empty" ref={wrapper}>Open a Tao file to edit.</div>
  }
  return (
    <div
      className="studio-editor-tao-surface"
      data-active-cell={state.activeCell?.cellId}
      data-active-file={file.path}
      data-active-scenario={state.activeCell?.scenarioId}
      data-selected-render={state.selectedRender?.renderId}
      data-state-revision={state.revision}
      ref={wrapper}
    >
      <CodeEditor
        Change={change}
        Content={file.content}
        Layout={{ style: editorSurfaceStyle }}
        Lsp={lsp}
        Selection={{ anchor: file.selectionAnchor, head: file.selectionHead }}
        SelectionChange={selection => requestStudioProductHostSelectActiveFile(selection.anchor, selection.head)}
        Tag="studio-active-editor"
      />
    </div>
  )
}

/** FilesPanelSurface keeps Tao's query-owned tree inside the shell's existing Files destination. */
export function FilesPanelSurface(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return (
    <section
      data-studio-files-surface="compact"
      data-testid={props.Tag}
      style={{ ...filesPanelStyle, ...props.Layout?.style }}
    >
      {props.children}
    </section>
  )
}

export type FileCreateBarProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Change: TaoStudioHostTextAction
    Create: TaoStudioHostAction
    Path: string
  }>

/** FileCreateBar is a compact adapter; Tao still owns its path state and Create action. */
export function FileCreateBar(props: FileCreateBarProps): React.ReactElement {
  const create = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void props.Create.invoke()
  }
  return (
    <form
      aria-label="Create Tao file"
      data-studio-file-create="compact"
      onSubmit={create}
      style={{ ...inlineEditorStyle, ...props.Layout?.style }}
    >
      <input
        aria-label="New Tao file path"
        onChange={event => void props.Change.invoke(TR.Value(event.currentTarget.value))}
        placeholder="Folder/New.tao"
        spellCheck={false}
        style={inlineInputStyle}
        value={props.Path}
      />
      <button
        aria-label="Create file"
        disabled={props.Path.trim() === ''}
        style={iconButtonStyle}
        title="Create file"
        type="submit"
      >
        +
      </button>
    </form>
  )
}

export type TreeFolderProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Expanded: boolean
    Label: string
    Toggle: TaoStudioHostAction
    children?: React.ReactNode
  }>

/** TreeFolder provides IDE disclosure density while Tao owns expansion state and recursive content. */
export function TreeFolder(props: TreeFolderProps): React.ReactElement {
  return (
    <div data-studio-tree-folder={props.Label} data-testid={props.Tag} style={props.Layout?.style}>
      <button
        aria-expanded={props.Expanded}
        onClick={() => void props.Toggle.invoke()}
        style={treePrimaryButtonStyle}
        title={props.Label}
        type="button"
      >
        <span aria-hidden="true" style={treeIconStyle}>{props.Expanded ? '▾' : '▸'}</span>
        <span style={treeLabelStyle}>{props.Label}</span>
      </button>
      {props.Expanded ? <div style={treeChildrenStyle}>{props.children}</div> : undefined}
    </div>
  )
}

export type TreeFileRowProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    BeginDelete: TaoStudioHostAction
    BeginRename: TaoStudioHostAction
    CancelDelete: TaoStudioHostAction
    CancelRename: TaoStudioHostAction
    ChangeRenamePath: TaoStudioHostTextAction
    ConfirmDelete: boolean
    Delete: TaoStudioHostAction
    DiagnosticCount: number
    Dirty: boolean
    Name: string
    Open: TaoStudioHostAction
    Path: string
    Rename: TaoStudioHostAction
    RenamePath: string
    Renaming: boolean
  }>

/** TreeFileRow exposes compact editing affordances without moving CRUD state or decisions out of Tao. */
export function TreeFileRow(props: TreeFileRowProps): React.ReactElement {
  const rename = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    void props.Rename.invoke()
  }
  return (
    <div data-studio-tree-file={props.Path} data-testid={props.Tag} style={props.Layout?.style}>
      <div style={treeRowStyle}>
        <button
          onClick={() => void props.Open.invoke()}
          style={treePrimaryButtonStyle}
          title={props.Path}
          type="button"
        >
          <span aria-hidden="true" style={treeIconStyle}>◇</span>
          <span style={treeLabelStyle}>{props.Name}</span>
          {props.Dirty ? <span aria-label="Unsaved draft" style={dirtyStyle}>●</span> : undefined}
          {props.DiagnosticCount > 0
            ? (
              <span aria-label={`${props.DiagnosticCount} problems`} style={diagnosticStyle}>
                {props.DiagnosticCount}
              </span>
            )
            : undefined}
        </button>
        <button
          aria-label={`Rename ${props.Name}`}
          onClick={() => void props.BeginRename.invoke()}
          style={rowActionStyle}
          title="Rename"
          type="button"
        >
          ✎
        </button>
        <button
          aria-label={`Delete ${props.Name}`}
          onClick={() => void props.BeginDelete.invoke()}
          style={rowActionStyle}
          title="Delete"
          type="button"
        >
          ×
        </button>
      </div>
      {props.Renaming
        ? (
          <form aria-label={`Rename ${props.Name}`} onSubmit={rename} style={inlineEditorStyle}>
            <input
              aria-label={`New path for ${props.Name}`}
              autoFocus
              onChange={event => void props.ChangeRenamePath.invoke(TR.Value(event.currentTarget.value))}
              spellCheck={false}
              style={inlineInputStyle}
              value={props.RenamePath}
            />
            <button aria-label="Save rename" style={inlineTextButtonStyle} type="submit">Save</button>
            <button
              aria-label="Cancel rename"
              onClick={() => void props.CancelRename.invoke()}
              style={inlineTextButtonStyle}
              type="button"
            >
              Cancel
            </button>
          </form>
        )
        : undefined}
      {props.ConfirmDelete
        ? (
          <div aria-label={`Confirm delete ${props.Name}`} role="alert" style={deleteConfirmationStyle}>
            <span style={deletePromptStyle}>Delete {props.Name}?</span>
            <button
              onClick={() => void props.CancelDelete.invoke()}
              style={inlineTextButtonStyle}
              type="button"
            >
              Cancel
            </button>
            <button
              onClick={() => void props.Delete.invoke()}
              style={deleteButtonStyle}
              type="button"
            >
              Delete
            </button>
          </div>
        )
        : undefined}
    </div>
  )
}

const filesPanelStyle = {
  color: '#c9cfda',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fontSize: 12,
  minWidth: 0,
} satisfies React.CSSProperties

const editorSurfaceStyle = {
  height: '100%',
  minHeight: 0,
  minWidth: 0,
} satisfies React.CSSProperties

function compactIdentity(value: string): string {
  const marker = value.lastIndexOf('#scenario:')
  return marker < 0 ? value : value.slice(marker + '#scenario:'.length).replaceAll(':', ' · ')
}

// Tao apps require a navigator and safe app frame. Studio is already a complete desktop shell, so
// its sole product boundary owns the viewport instead of inheriting mobile padding or scroll chrome.
const productHostViewportStyle = {
  bottom: 0,
  height: 'auto',
  left: 0,
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
  position: 'fixed',
  right: 0,
  top: 0,
  width: 'auto',
} satisfies React.CSSProperties

/** The desktop product boundary owns the viewport; generated Tao layout must not collapse it. */
export function productHostStyle(layout?: React.CSSProperties): React.CSSProperties {
  return { ...layout, ...productHostViewportStyle }
}

const treeRowStyle = {
  alignItems: 'center',
  display: 'flex',
  minWidth: 0,
} satisfies React.CSSProperties

const treePrimaryButtonStyle = {
  alignItems: 'center',
  background: 'transparent',
  border: 0,
  color: 'inherit',
  cursor: 'default',
  display: 'flex',
  flex: '1 1 auto',
  font: 'inherit',
  gap: 5,
  minHeight: 24,
  minWidth: 0,
  padding: '2px 4px',
  textAlign: 'left',
} satisfies React.CSSProperties

const treeIconStyle = {
  color: '#758091',
  flex: '0 0 12px',
  textAlign: 'center',
} satisfies React.CSSProperties

const treeLabelStyle = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} satisfies React.CSSProperties

const treeChildrenStyle = {
  borderLeft: '1px solid #2b303a',
  marginLeft: 9,
  paddingLeft: 7,
} satisfies React.CSSProperties

const rowActionStyle = {
  background: 'transparent',
  border: 0,
  color: '#8993a2',
  cursor: 'pointer',
  flex: '0 0 24px',
  font: 'inherit',
  height: 24,
  padding: 0,
} satisfies React.CSSProperties

const dirtyStyle = {
  color: '#e7b84b',
  fontSize: 8,
  marginLeft: 'auto',
} satisfies React.CSSProperties

const diagnosticStyle = {
  background: '#7b3f3f',
  borderRadius: 8,
  color: '#fff',
  fontSize: 10,
  lineHeight: '16px',
  minWidth: 16,
  padding: '0 4px',
  textAlign: 'center',
} satisfies React.CSSProperties

const inlineEditorStyle = {
  alignItems: 'center',
  display: 'flex',
  gap: 4,
  minWidth: 0,
  padding: '3px 4px 5px',
} satisfies React.CSSProperties

const inlineInputStyle = {
  background: '#14171d',
  border: '1px solid #343a46',
  borderRadius: 3,
  color: '#e8e7e3',
  font: 'inherit',
  height: 24,
  minWidth: 0,
  outlineColor: '#5d83d3',
  padding: '2px 6px',
  width: '100%',
} satisfies React.CSSProperties

const iconButtonStyle = {
  ...rowActionStyle,
  background: '#304a7d',
  borderRadius: 3,
  color: '#e8eee9',
  fontSize: 16,
} satisfies React.CSSProperties

const inlineTextButtonStyle = {
  background: '#252a33',
  border: '1px solid #3b424f',
  borderRadius: 3,
  color: '#cbd1dc',
  cursor: 'pointer',
  font: 'inherit',
  height: 24,
  padding: '0 6px',
} satisfies React.CSSProperties

const deleteConfirmationStyle = {
  alignItems: 'center',
  background: '#2a2020',
  borderRadius: 3,
  display: 'flex',
  gap: 4,
  margin: '2px 4px 4px',
  padding: 4,
} satisfies React.CSSProperties

const deletePromptStyle = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} satisfies React.CSSProperties

const deleteButtonStyle = {
  ...inlineTextButtonStyle,
  background: '#703f3f',
  borderColor: '#8b5151',
} satisfies React.CSSProperties

/** OpenFile is the Tao Files panel's typed request into the existing editor host. */
export async function OpenFile(path: string): Promise<void> {
  await requestStudioProductHostOpenFile(path)
}

/** File writes share the workbench controller so open drafts and tabs transition atomically. */
export async function CreateFile(path: string): Promise<void> {
  await requestStudioProductHostCreateFile(path)
}

export async function RenameFile(path: string, sourceVersion: string, targetPath: string): Promise<void> {
  await requestStudioProductHostRenameFile(path, sourceVersion, targetPath)
}

export async function DeleteFile(path: string, sourceVersion: string): Promise<void> {
  await requestStudioProductHostDeleteFile(path, sourceVersion)
}

/** Applies Tao-owned scenario environment draft state through the active workbench cell controller. */
export async function ApplyActiveCellEnvironment(
  preset: string,
  width: number,
  height: number,
  network: string,
  latency: number,
  errorMessage: string,
  errorStatus: number,
): Promise<void> {
  if (network !== 'error' && network !== 'normal' && network !== 'offline') {
    throw new Error(`Unsupported Studio network outcome: ${network}`)
  }
  await requestStudioProductHostApplyActiveCellEnvironment({
    network: {
      ...(network === 'error' ? { error: { message: errorMessage, status: errorStatus } } : {}),
      latencyMs: latency,
      outcome: network,
    },
    viewport: {
      ...(preset === 'custom' ? {} : { presetId: preset }),
      height,
      width,
    },
  })
}
