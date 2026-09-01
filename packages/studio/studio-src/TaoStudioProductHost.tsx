import TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import type {
  StudioLayoutContentTerm,
  StudioLayoutEntry,
  StudioRenderInspection,
  StudioStyleEntry,
  StudioStyleLandingScope,
} from '@source-actions'
import { CodeEditor, type CodeEditorDrop, type CodeEditorLsp } from '@tao/code-editor'
import React from 'react'
import { createPortal } from 'react-dom'
import { StudioApiClient } from './client/StudioApiClient'
import { mountStudio } from './client/StudioApp'
import { fileUri, StudioEditorInsertion } from './client/StudioEditor'
import {
  type StudioTaoDrawerPanelModel,
  StudioTaoPanelProjection,
  type StudioTaoSearchRow,
} from './client/StudioPanelProjection'
import {
  type StudioScenarioControlModel,
  StudioScenarioControls,
} from './client/StudioScenarioControls'
import {
  studioPaletteMime,
  StudioPaletteTransfer,
} from './client/StudioVisualEditing'
import {
  StudioInspector,
  type StudioInspectorSelection,
  studioPaletteComponents,
  studioStyleProperties,
} from './StudioInspector'
import { StudioPanelPayloads } from './StudioPanelPayloads'
import { StudioProductHostLspLifecycle } from './StudioProductHostLsp'
import {
  rejectPendingStudioProductHostActions,
  requestStudioProductHostApplyActiveCellEnvironment,
  requestStudioProductHostApplyInspectorAction,
  requestStudioProductHostChangeActiveFile,
  requestStudioProductHostCreateFile,
  requestStudioProductHostDeleteFile,
  requestStudioProductHostInsertComponent,
  requestStudioProductHostInsertProjectView,
  requestStudioProductHostOpenFile,
  requestStudioProductHostOpenScreen,
  requestStudioProductHostPanelAction,
  requestStudioProductHostRenameFile,
  requestStudioProductHostSelectActiveFile,
  requestStudioProductHostUndoInspectorAction,
  studioProductHostState,
  subscribeStudioProductHostState,
} from './StudioProductHostProtocol'
import type { StudioJsonObject, StudioJsonValue } from './StudioProtocol'

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
  InspectorBusy?: TR.Value<boolean>
  InspectorCanUndo?: TR.Value<boolean>
  InspectorInspection?: TR.Value<string>
  InspectorSelection?: TR.Value<string>
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
  SchemeCapability?: TR.Value<string>
  SchemeRequested?: TR.Value<string>
  SchemeResolved?: TR.Value<string>
  SchemeSource?: TR.Value<string>
  SelectedRenderId?: TR.Value<string>
  SelectedRenderPath?: TR.Value<string>
  SelectedRenderVersion?: TR.Value<string>
  SelectionAnchor?: TR.Value<number>
  SelectionHead?: TR.Value<number>
  ViewportHeight?: TR.Value<number>
  ViewportPresetId?: TR.Value<string>
  ViewportWidth?: TR.Value<number>
}>

type StudioStateSlotProps = Readonly<{
  ResolvedAppearance?: TR.Value<string>
  State?: TR.Value<string>
}>

type StudioDrawerSlotProps = Readonly<{
  Compile?: TR.Value<StudioTaoDrawerPanelModel['Compile']>
  Data?: TR.Value<StudioTaoDrawerPanelModel['Data']>
  Logs?: TR.Value<StudioTaoDrawerPanelModel['Logs']>
  Problems?: TR.Value<StudioTaoDrawerPanelModel['Problems']>
  Tab?: TR.Value<string>
  Tests?: TR.Value<StudioTaoDrawerPanelModel['Tests']>
}>

type StudioSearchSlotProps = Readonly<{
  Rows?: TR.Value<readonly StudioTaoSearchRow[]>
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
  const [componentsTarget, setComponentsTarget] = React.useState<HTMLElement>()
  const [projectViewsTarget, setProjectViewsTarget] = React.useState<HTMLElement>()
  const [screensTarget, setScreensTarget] = React.useState<HTMLElement>()
  const [tokensTarget, setTokensTarget] = React.useState<HTMLElement>()
  const [drawerTarget, setDrawerTarget] = React.useState<HTMLElement>()
  const [searchTarget, setSearchTarget] = React.useState<HTMLElement>()
  const [scenarioTarget, setScenarioTarget] = React.useState<HTMLElement>()
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
    const mounting = mountStudio({ root, signal: cancellation.signal })
    const reportMountError = (error: unknown): void => {
      if (unmounted && error instanceof Error && error.name === 'AbortError') {
        return
      }
      rejectPendingStudioProductHostActions(error)
      console.error('Could not mount the Tao Studio product host.', error)
      if (!unmounted) {
        const alert = document.createElement('p')
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
    setComponentsTarget(root.querySelector<HTMLElement>('.studio-components') ?? undefined)
    setProjectViewsTarget(root.querySelector<HTMLElement>('.studio-project-views') ?? undefined)
    setScreensTarget(root.querySelector<HTMLElement>('.studio-screens') ?? undefined)
    setTokensTarget(root.querySelector<HTMLElement>('.studio-design-values') ?? undefined)
    setDrawerTarget(root.querySelector<HTMLElement>('.studio-drawer-content') ?? undefined)
    setSearchTarget(root.querySelector<HTMLElement>('.studio-search-results') ?? undefined)
    setScenarioTarget(root.querySelector<HTMLElement>('.studio-scenario-inspector-content') ?? undefined)
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
  const components = props.Slots?.['@components'] ?? props.Slots?.['components']
  const projectViews = props.Slots?.['@projectViews'] ?? props.Slots?.['projectViews']
  const screens = props.Slots?.['@screens'] ?? props.Slots?.['screens']
  const tokens = props.Slots?.['@tokens'] ?? props.Slots?.['tokens']
  const drawer = props.Slots?.['@drawer'] ?? props.Slots?.['drawer']
  const search = props.Slots?.['@search'] ?? props.Slots?.['search']
  const scenario = props.Slots?.['@scenario'] ?? props.Slots?.['scenario']
  const editor = props.Slots?.['@editor'] ?? props.Slots?.['editor']
  const inspector = props.Slots?.['@inspector'] ?? props.Slots?.['inspector']
  const activeFile = hostState.activeFile
  const activeCell = hostState.activeCell
  const selectedRender = hostState.selectedRender
  const panelValues = hostState.panels === undefined
    ? StudioTaoPanelProjection.empty()
    : StudioTaoPanelProjection.project(hostState.panels)
  const refreshedInspector = React.isValidElement<StudioContextPanelSlotProps>(inspector)
    ? React.cloneElement(inspector, {
      key: [
        'studio-context',
        activeCell?.cellId ?? 'none',
        activeCell?.cellRevision ?? 0,
        selectedRender?.renderId ?? 'none',
        selectedRender?.sourceVersion ?? 'none',
        JSON.stringify(hostState.inspector?.selection ?? null),
        JSON.stringify(hostState.inspector?.inspection ?? null),
      ].join(':'),
      ActiveCellId: TR.Value(activeCell?.cellId ?? ''),
      CellRevision: TR.Value(activeCell?.cellRevision ?? 0),
      InspectorBusy: TR.Value(hostState.inspector?.busy ?? false),
      InspectorCanUndo: TR.Value(hostState.inspector?.canUndo ?? false),
      InspectorInspection: TR.Value(JSON.stringify(hostState.inspector?.inspection ?? null)),
      InspectorSelection: TR.Value(JSON.stringify(hostState.inspector?.selection ?? null)),
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
      SchemeCapability: TR.Value(activeCell?.schemeCapability ?? 'reactive-browser'),
      SchemeRequested: TR.Value(activeCell?.schemeRequested ?? 'system'),
      SchemeResolved: TR.Value(activeCell?.schemeResolved ?? 'light'),
      SchemeSource: TR.Value(activeCell?.schemeSource ?? 'system'),
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
  const refreshedDrawer = React.isValidElement<StudioDrawerSlotProps>(drawer)
    ? React.cloneElement(drawer, {
      Compile: TR.Value(panelValues.Drawer.Compile),
      Data: TR.Value(panelValues.Drawer.Data),
      Logs: TR.Value(panelValues.Drawer.Logs),
      Problems: TR.Value(panelValues.Drawer.Problems),
      Tab: TR.Value(panelValues.Drawer.Tab),
      Tests: TR.Value(panelValues.Drawer.Tests),
    })
    : drawer
  const refreshedSearch = React.isValidElement<StudioSearchSlotProps>(search)
    ? React.cloneElement(search, { Rows: TR.Value(panelValues.Search.Rows) })
    : search
  const refreshedScenario = React.isValidElement<StudioStateSlotProps>(scenario)
    ? React.cloneElement(scenario, {
      key: `studio-scenario:${activeCell?.cellId ?? 'none'}:${activeCell?.cellRevision ?? 0}`,
      ResolvedAppearance: TR.Value(activeCell?.schemeResolved ?? 'light'),
      State: TR.Value(activeCell?.scenarioModel ?? 'null'),
    })
    : scenario
  const contents = (
    <>
      {productHost}
      {filesTarget === undefined || files === undefined ? undefined : createPortal(files, filesTarget)}
      {componentsTarget === undefined || components === undefined
        ? undefined
        : createPortal(components, componentsTarget)}
      {projectViewsTarget === undefined || projectViews === undefined
        ? undefined
        : createPortal(projectViews, projectViewsTarget)}
      {screensTarget === undefined || screens === undefined ? undefined : createPortal(screens, screensTarget)}
      {tokensTarget === undefined || tokens === undefined ? undefined : createPortal(tokens, tokensTarget)}
      {drawerTarget === undefined || refreshedDrawer === undefined
        ? undefined
        : createPortal(refreshedDrawer, drawerTarget)}
      {searchTarget === undefined || refreshedSearch === undefined
        ? undefined
        : createPortal(refreshedSearch, searchTarget)}
      {scenarioTarget === undefined || refreshedScenario === undefined
        ? undefined
        : createPortal(
          <React.Fragment key={`${activeCell?.cellId ?? 'none'}:${activeCell?.cellRevision ?? 0}`}>
            {refreshedScenario}
          </React.Fragment>,
          scenarioTarget,
        )}
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

/**
 * Presentation-only label for the scenario inspector. The stylesheet has carried
 * `.studio-scenario-inspector-label` all along, but nothing emitted the class, so those rules were
 * dead and the labels fell back to the react-native-web text defaults.
 */
export function StudioScenarioInspectorLabel(
  props: TaoStudioHostVisualProps & Readonly<{ Label: string }>,
): React.ReactElement {
  return (
    <span className="studio-scenario-inspector-label" data-testid={props.Tag} style={props.Layout?.style}>
      {props.Label}
    </span>
  )
}

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

export type StudioScenarioControlGroupProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Title: string
    children?: React.ReactNode
  }>

/** Presentation-only grouping for Tao-owned scenario controls. */
export function StudioScenarioControlGroup(
  props: StudioScenarioControlGroupProps,
): React.ReactElement {
  return (
    <fieldset
      aria-label={props.Title}
      className="studio-inspector-controls studio-tao-scenario-controls"
      data-testid={props.Tag}
      style={props.Layout?.style}
    >
      <legend>{props.Title}</legend>
      {props.children}
    </fieldset>
  )
}

export type StudioNumericInputProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Change: TaoStudioHostNumberAction
    ChangeValid: TR.ActionValue<[TR.Value<boolean>]>
    Integer: boolean
    Label: string
    Maximum: number
    Minimum: number
    Value: number
  }>

/** Browser numeric input is a leaf: Tao owns the last valid number and validity state. */
export function StudioNumericInput(props: StudioNumericInputProps): React.ReactElement {
  const [draft, setDraft] = React.useState(String(props.Value))
  React.useEffect(() => setDraft(String(props.Value)), [props.Value])
  const constraints: StudioNumericDraftConstraints = {
    ...(props.Integer ? { integer: true } : {}),
    ...(props.Maximum > 0 ? { maximum: props.Maximum } : {}),
    minimum: props.Minimum,
  }
  const parsed = studioNumericDraft(draft, constraints)
  return (
    <label className="studio-inspector-field" data-testid={props.Tag} style={props.Layout?.style}>
      <span>{props.Label}</span>
      <input
        aria-invalid={!parsed.valid}
        max={props.Maximum > 0 ? props.Maximum : undefined}
        min={props.Minimum}
        onChange={event => {
          const nextDraft = event.currentTarget.value
          const next = studioNumericDraft(nextDraft, constraints)
          setDraft(nextDraft)
          void props.ChangeValid.invoke(TR.Value(next.valid))
          if (next.valid) {
            void props.Change.invoke(TR.Value(next.value))
          }
        }}
        step={props.Integer ? 1 : 'any'}
        type="number"
        value={draft}
      />
    </label>
  )
}

export function StudioViewportPresetWidth(preset: string, fallback: number): number {
  return studioViewportPresets[preset]?.width ?? fallback
}

export function StudioViewportPresetHeight(preset: string, fallback: number): number {
  return studioViewportPresets[preset]?.height ?? fallback
}

export function StudioEnvironmentValid(
  widthValid: boolean,
  heightValid: boolean,
  latencyValid: boolean,
  errorStatusValid: boolean,
  network: string,
  errorMessage: string,
): boolean {
  return widthValid
    && heightValid
    && latencyValid
    && (network !== 'error' || (errorStatusValid && errorMessage.trim() !== ''))
}

export function StudioNetworkShowsError(network: string): boolean {
  return network === 'error'
}

type StudioNumericDraftConstraints = Readonly<{
  integer?: boolean
  maximum?: number
  minimum?: number
}>

export type StudioNumericDraft = Readonly<
  | { valid: false }
  | { valid: true; value: number }
>

/** Keeps malformed browser input out of Tao's typed number actions without erasing the user's draft. */
export function studioNumericDraft(
  draft: string,
  constraints: StudioNumericDraftConstraints = {},
): StudioNumericDraft {
  if (draft.trim() === '') {
    return { valid: false }
  }
  const value = Number(draft)
  if (
    !Number.isFinite(value)
    || (constraints.integer === true && !Number.isInteger(value))
    || (constraints.minimum !== undefined && value < constraints.minimum)
    || (constraints.maximum !== undefined && value > constraints.maximum)
  ) {
    return { valid: false }
  }
  return { valid: true, value }
}

const studioViewportPresets: Readonly<Record<string, Readonly<{ height: number; width: number }>>> = {
  laptop: { height: 900, width: 1_440 },
  phone: { height: 844, width: 390 },
  tablet: { height: 1_180, width: 820 },
}

async function highlightTaoSource(content: string) {
  return (await StudioApiClient.highlight(content)).tokens
}

/** StudioEditorSurface is the Tao-mounted CodeEditor boundary over the host's revisioned active tab. */
export function StudioEditorSurface(): React.ReactElement {
  const state = React.useSyncExternalStore(
    subscribeStudioProductHostState,
    studioProductHostState,
    studioProductHostState,
  )
  const file = state.activeFile
  const lsp = useStudioEditorLsp(file?.path, state.projectRoot)
  const change = React.useMemo(() =>
    ({
      invoke(value: TR.Value<string>) {
        requestStudioProductHostChangeActiveFile(value.evaluate().jsValue)
      },
    }) as TR.ActionValue<[TR.Value<string>]>, [])
  const wrapper = React.useRef<HTMLDivElement>(null)
  // The legacy shell wires palette drops onto its own CodeMirror, which is not the editor Tao
  // renders, so a component dropped on the visible editor landed nowhere. Dispatching through the
  // live view also keeps the insertion on CodeMirror's undo history.
  const paletteDrop = React.useMemo<CodeEditorDrop>(() => ({
    accepts: [studioPaletteMime],
    apply(transfer, context) {
      const item = StudioPaletteTransfer.parse(transfer.getData(studioPaletteMime))
      return item === undefined
        ? undefined
        : StudioEditorInsertion.transaction(context.document, item.snippet, context.position)
    },
  }), [])
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
        Drop={paletteDrop}
        Highlight={highlightTaoSource}
        Layout={{ style: editorSurfaceStyle }}
        Lsp={lsp}
        Selection={{ anchor: file.selectionAnchor, head: file.selectionHead }}
        SelectionChange={selection => requestStudioProductHostSelectActiveFile(selection.anchor, selection.head)}
        Tag="studio-active-editor"
      />
    </div>
  )
}

export function StudioPanelSurface(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode; Title: string }>,
): React.ReactElement {
  return (
    <section className="studio-tao-panel" data-testid={props.Tag} style={props.Layout?.style}>
      <h2>{props.Title}</h2>
      {props.children}
    </section>
  )
}

export type StudioPaletteRowProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Detail: string
    Insert: TaoStudioHostAction
    Kind: string
    Label: string
    Name: string
  }>

/** PaletteRow is a native drag/click adapter; the inventory and insertion action remain Tao-owned. */
export function StudioPaletteRow(props: StudioPaletteRowProps): React.ReactElement {
  const component = props.Kind === 'component'
    ? studioPaletteComponents.find(candidate => candidate.component === props.Name)
    : undefined
  return (
    <button
      className="studio-palette-button"
      data-tao-studio-component={component?.label}
      data-tao-studio-project-view={props.Kind === 'project-view' ? props.Name : undefined}
      draggable={component !== undefined}
      onClick={() => void props.Insert.invoke()}
      onDragStart={event => {
        if (component !== undefined) {
          event.dataTransfer.setData(
            studioPaletteMime,
            StudioPaletteTransfer.serialize({
              component: component.component,
              kind: 'component',
              snippet: component.snippet,
            }),
          )
        }
      }}
      style={props.Layout?.style}
      title={`${props.Detail} · insert ${props.Label}`}
      type="button"
    >
      {props.Label}
    </button>
  )
}

export type StudioSourceRowProps =
  & TaoStudioHostVisualProps
  & Readonly<{
    Detail: string
    Label: string
    Open: TaoStudioHostAction
  }>

export function StudioSourceRow(props: StudioSourceRowProps): React.ReactElement {
  return (
    <button
      className="studio-screen-item"
      onClick={() => void props.Open.invoke()}
      style={props.Layout?.style}
      title={props.Detail}
      type="button"
    >
      <strong>{props.Label}</strong>
      <span>{props.Detail}</span>
    </button>
  )
}

export function StudioInspectorSection(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode; Title: string }>,
): React.ReactElement {
  return (
    <section
      className="studio-inspector-accordion"
      data-studio-tao-inspector-context={props.Title}
      data-testid={props.Tag}
      style={props.Layout?.style}
    >
      <h2>{props.Title}</h2>
      <div className="studio-inspector-controls">{props.children}</div>
    </section>
  )
}

export function StudioInspectorSummarySurface(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return (
    <div className="studio-inspector-summary" data-testid={props.Tag} style={props.Layout?.style}>
      {props.children}
    </div>
  )
}

export function StudioInspectorField(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode; Label: string }>,
): React.ReactElement {
  return (
    <div className="studio-inspector-field" data-inspector-field={props.Label} style={props.Layout?.style}>
      {props.children}
    </div>
  )
}

export function StudioInspectorUndoMarker(
  props: TaoStudioHostVisualProps & Readonly<{ children?: React.ReactNode }>,
): React.ReactElement {
  return <div data-tao-studio-undo="true" style={props.Layout?.style}>{props.children}</div>
}

type StudioInspectorDraftMap = Readonly<Record<string, string>>

const inspectorLayoutFieldIds = [
  'gap',
  'padding',
  'margin',
  'width-mode',
  'width-value',
  'max-width',
  'height-mode',
  'height-value',
  'growth-mode',
  'growth-value',
  'shrink',
  'alignment',
  'content',
] as const

const inspectorLayoutActionIds = [
  'gap',
  'padding',
  'margin',
  'width',
  'max-width',
  'height',
  'growth',
  'shrink',
  'alignment',
  'content',
  'wrap-stack',
] as const

const inspectorLayoutFieldLabels: Readonly<Record<string, string>> = {
  alignment: 'Self alignment',
  content: 'Content alignment',
  gap: 'Gap',
  'growth-mode': 'Growth mode',
  'growth-value': 'Claim weight',
  'height-mode': 'Height mode',
  'height-value': 'Height value',
  margin: 'Margin',
  'max-width': 'Max width',
  padding: 'Padding',
  shrink: 'Shrink',
  'width-mode': 'Width mode',
  'width-value': 'Width value',
}

const inspectorLayoutActionLabels: Readonly<Record<string, string>> = {
  alignment: 'Apply alignment',
  content: 'Apply content alignment',
  gap: 'Apply gap',
  growth: 'Apply growth',
  height: 'Apply height',
  margin: 'Apply margin',
  'max-width': 'Apply max width',
  padding: 'Apply padding',
  shrink: 'Apply shrink',
  width: 'Apply width',
  'wrap-stack': 'Wrap in Stack',
}

export function StudioInspectorReady(inspection: string, selection: string): boolean {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  return parsed !== undefined && selected !== undefined && parsed.renderId === selected.renderId
}

export function StudioInspectorStatus(inspection: string, selection: string): string {
  return studioInspectorSelection(selection) === undefined
    ? 'Select a rendered element in the preview.'
    : studioInspectorInspection(inspection) === undefined
    ? 'Reading parsed render values…'
    : ''
}

export function StudioInspectorSummaryLines(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
): string[] {
  const selected = studioInspectorSelection(selection)
  if (selected === undefined) {
    return ['Select a rendered element in the preview.']
  }
  const candidate = studioInspectorInspection(inspection)
  const parsed = candidate?.renderId === selected.renderId ? candidate : undefined
  const occurrence = selected.identity.occurrence
  return [
    `Source: ${selected.identity.path}`,
    `Range: ${selected.range.start}–${selected.range.end}`,
    `Version: ${
      selected.identity.sourceVersion === currentSourceVersion ? 'Current' : 'Waiting for refreshed preview'
    }`,
    `Render: ${selected.renderId}`,
    ...(occurrence?.renderOwner === undefined ? [] : [`View: ${occurrence.renderOwner}`]),
    ...(occurrence?.nodeKind === undefined ? [] : [`Node kind: ${occurrence.nodeKind}`]),
    ...(parsed?.elementName === undefined ? [] : [`Element: ${parsed.elementName}`]),
  ]
}

export function StudioInspectorUndoAvailable(busy: boolean, canUndo: boolean): boolean {
  return !busy && canUndo
}

export function StudioInspectorLayoutDrafts(inspection: string): string {
  const parsed = studioInspectorInspection(inspection)
  if (parsed === undefined) {
    return '{}'
  }
  const model = StudioInspector.layout(parsed)
  return JSON.stringify({
    alignment: model.alignment.mode === 'aligned' ? model.alignment.value : model.alignment.mode,
    content: model.content?.join(' ') ?? '',
    gap: model.gap === undefined ? '' : String(model.gap),
    'growth-mode': model.growth.mode,
    'growth-value': model.growth.mode === 'claim' ? String(model.growth.value) : '',
    'height-mode': model.height.mode,
    'height-value': model.height.mode === 'fixed' ? String(model.height.value) : '',
    margin: model.margin?.[0] === 'margin' ? model.margin.slice(1).join(' ') : '',
    'max-width': model.widthCap === undefined ? '' : String(model.widthCap),
    padding: model.padding?.[0] === 'pad' ? model.padding.slice(1).join(' ') : '',
    shrink: model.shrink,
    'width-mode': model.width.mode,
    'width-value': model.width.mode === 'fixed' ? String(model.width.value) : '',
  })
}

export function StudioInspectorLayoutFieldIds(): string[] {
  return [...inspectorLayoutFieldIds]
}

export function StudioInspectorLayoutFieldLabel(fieldId: string): string {
  return inspectorLayoutFieldLabels[fieldId] ?? fieldId
}

export function StudioInspectorLayoutFieldUsesPicker(fieldId: string): boolean {
  return fieldId === 'alignment'
    || fieldId === 'growth-mode'
    || fieldId === 'height-mode'
    || fieldId === 'shrink'
    || fieldId === 'width-mode'
}

export function StudioInspectorLayoutFieldOptions(fieldId: string): string[] {
  if (fieldId === 'width-mode' || fieldId === 'height-mode') {
    return ['unset', 'fill', 'fixed']
  }
  if (fieldId === 'growth-mode') {
    return ['unset', 'fill', 'claim', 'hug']
  }
  if (fieldId === 'shrink') {
    return ['unset', 'compress', 'rigid']
  }
  if (fieldId === 'alignment') {
    return ['unset', 'fill', 'centered', 'baseline', 'bottom', 'center', 'left', 'right', 'top']
  }
  return []
}

export function StudioInspectorDraft(drafts: string, fieldId: string): string {
  return studioInspectorDraftMap(drafts)[fieldId] ?? ''
}

export function StudioInspectorUpdateDraft(drafts: string, fieldId: string, value: string): string {
  return JSON.stringify({ ...studioInspectorDraftMap(drafts), [fieldId]: value })
}

export function StudioInspectorLayoutActionIds(): string[] {
  return [...inspectorLayoutActionIds]
}

export function StudioInspectorLayoutActionLabel(actionId: string): string {
  return inspectorLayoutActionLabels[actionId] ?? actionId
}

export function StudioInspectorLayoutActionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  drafts: string,
  busy: boolean,
  actionId: string,
): boolean {
  const parsedInspection = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  if (
    busy
    || parsedInspection === undefined
    || selected === undefined
    || parsedInspection.renderId !== selected.renderId
    || selected.identity.sourceVersion !== currentSourceVersion
  ) {
    return false
  }
  if (actionId === 'wrap-stack') {
    return true
  }
  return studioInspectorLayoutEntry(parsedInspection, studioInspectorDraftMap(drafts), actionId) !== undefined
}

export function StudioInspectorLayoutAction(
  inspection: string,
  selection: string,
  drafts: string,
  actionId: string,
): string {
  const parsedInspection = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  if (parsedInspection === undefined || selected === undefined || parsedInspection.renderId !== selected.renderId) {
    Errors.throwUserInput('Select a parsed rendered element before editing its layout.')
  }
  if (actionId === 'wrap-stack') {
    return JSON.stringify({ kind: 'wrap-render', renderId: selected.renderId, wrapper: 'Stack' })
  }
  const entry = studioInspectorLayoutEntry(parsedInspection, studioInspectorDraftMap(drafts), actionId)
  Assert.input(entry, `The ${StudioInspectorLayoutActionLabel(actionId)} draft is invalid.`)
  return JSON.stringify(StudioInspector.layoutAction(selected.renderId, entry))
}

export function StudioInspectorStyleDrafts(inspection: string): string {
  const parsed = studioInspectorInspection(inspection)
  if (parsed === undefined) {
    return '{}'
  }
  const current = studioInspectorCurrentStyle(parsed)
  const landings = studioInspectorStyleLandings(parsed, current)
  const bundle = parsed.styleProvenance.find(provenance =>
    provenance.editable !== false && provenance.landing.kind === 'style-bundle'
  )
  const bundleName = bundle?.landing.kind === 'style-bundle' ? bundle.landing.bundleName : undefined
  const landing = bundleName !== undefined
    ? landings.find(candidate =>
      candidate.landing.kind === 'style-bundle'
      && candidate.landing.bundleName === bundleName
      && candidate.landing.mode !== 'fork'
    )
    : undefined
  return JSON.stringify({
    landing: landing?.label ?? landings[0]!.label,
    property: String(current[0]),
    value: current.slice(1).join(' '),
  })
}

export function StudioInspectorStyleFieldIds(): string[] {
  return ['property', 'value', 'landing']
}

export function StudioInspectorStyleFieldLabel(fieldId: string): string {
  return fieldId === 'property' ? 'Property' : fieldId === 'landing' ? 'Landing' : 'Value'
}

export function StudioInspectorStyleFieldUsesPicker(fieldId: string): boolean {
  return fieldId === 'property' || fieldId === 'landing'
}

export function StudioInspectorStyleFieldOptions(inspection: string, fieldId: string): string[] {
  const parsed = studioInspectorInspection(inspection)
  if (fieldId === 'property') {
    const supported = studioStyleProperties.map(property => property.head)
    const current = parsed === undefined ? undefined : String(studioInspectorCurrentStyle(parsed)[0])
    return current === undefined || supported.includes(current as (typeof supported)[number])
      ? supported
      : [...supported, current]
  }
  if (fieldId === 'landing' && parsed !== undefined) {
    return studioInspectorStyleLandings(parsed, studioInspectorCurrentStyle(parsed)).map(candidate => candidate.label)
  }
  return []
}

export function StudioInspectorStyleActionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  drafts: string,
  busy: boolean,
): boolean {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  if (
    busy
    || parsed === undefined
    || selected === undefined
    || parsed.renderId !== selected.renderId
    || selected.identity.sourceVersion !== currentSourceVersion
  ) {
    return false
  }
  const values = studioInspectorDraftMap(drafts)
  return StudioInspector.styleEntryDraft(values['property'] ?? '', values['value'] ?? '') !== undefined
    && studioInspectorStyleLandings(parsed, studioInspectorCurrentStyle(parsed)).some(candidate =>
      candidate.label === values['landing']
    )
}

export function StudioInspectorStyleAction(inspection: string, selection: string, drafts: string): string {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  const values = studioInspectorDraftMap(drafts)
  const entry = StudioInspector.styleEntryDraft(values['property'] ?? '', values['value'] ?? '')
  const landing = parsed === undefined
    ? undefined
    : studioInspectorStyleLandings(parsed, studioInspectorCurrentStyle(parsed)).find(candidate =>
      candidate.label === values['landing']
    )?.landing
  if (
    parsed === undefined
    || selected === undefined
    || parsed.renderId !== selected.renderId
    || entry === undefined
    || landing === undefined
  ) {
    Errors.throwUserInput('The Studio style draft or landing is invalid.')
  }
  return JSON.stringify(StudioInspector.styleAction({ entry, landing, renderId: selected.renderId }))
}

export function StudioInspectorStylePromotionIds(inspection: string): string[] {
  const parsed = studioInspectorInspection(inspection)
  return parsed === undefined ? [] : studioInspectorStylePromotions(parsed).map((_, index) => String(index))
}

export function StudioInspectorStylePromotionLabel(inspection: string, promotionId: string): string {
  const parsed = studioInspectorInspection(inspection)
  return parsed === undefined ? '' : studioInspectorStylePromotion(parsed, promotionId)?.label ?? ''
}

export function StudioInspectorStylePromotionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  busy: boolean,
  promotionId: string,
): boolean {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  return !busy
    && parsed !== undefined
    && selected !== undefined
    && parsed.renderId === selected.renderId
    && selected.identity.sourceVersion === currentSourceVersion
    && studioInspectorStylePromotion(parsed, promotionId) !== undefined
}

export function StudioInspectorStylePromotionAction(
  inspection: string,
  selection: string,
  promotionId: string,
): string {
  const parsed = studioInspectorInspection(inspection)
  const selected = studioInspectorSelection(selection)
  const promotion = parsed === undefined ? undefined : studioInspectorStylePromotion(parsed, promotionId)
  if (
    parsed === undefined || selected === undefined || parsed.renderId !== selected.renderId || promotion === undefined
  ) {
    Errors.throwUserInput('The Studio style promotion is no longer available.')
  }
  return JSON.stringify(StudioInspector.styleAction({
    entry: promotion.entry,
    landing: promotion.landing,
    renderId: selected.renderId,
  }))
}

export function StudioInspectorStyleNotes(inspection: string): string[] {
  const parsed = studioInspectorInspection(inspection)
  if (parsed === undefined) {
    return []
  }
  return [
    ...parsed.styleProvenance.map(provenance => {
      const landing = studioInspectorLandingName(provenance.landing)
      const access = provenance.editable === false ? 'unavailable' : 'editable'
      const owner = provenance.ownerPath === undefined ? '' : ` · owner ${provenance.ownerPath}`
      const reason = provenance.reason === undefined ? '' : ` · ${provenance.reason}`
      return `${provenance.chain.join(' ← ')} · ${landing} · affects ${provenance.blastRadius} render${
        provenance.blastRadius === 1 ? '' : 's'
      } · ${access}${owner}${reason}`
    }),
    ...(parsed.design?.reason === undefined ? [] : [parsed.design.reason]),
  ]
}

export function StudioInspectorDataLines(
  inspection: string,
  selection: string,
  activeCellId: string,
  activeCellRevision: number,
  activeScenarioId: string,
): string[] {
  const selected = studioInspectorSelection(selection)
  const candidate = studioInspectorInspection(inspection)
  const parsed = selected !== undefined && candidate?.renderId === selected.renderId ? candidate : undefined
  if (selected === undefined) {
    return ['Select a rendered element to inspect its data context.']
  }
  return [
    `Selected view: ${selected.identity.occurrence?.renderOwner ?? 'not published'}`,
    `Selected element: ${parsed?.elementName ?? selected.identity.occurrence?.nodeKind ?? 'not published'}`,
    'Binding metadata: not published for this render.',
    activeCellId === ''
      ? 'Datasource context: no active preview cell.'
      : `Datasource context: cell ${activeCellId} revision ${activeCellRevision}.`,
    activeScenarioId === '' ? 'Scenario context: none.' : `Scenario context: ${activeScenarioId}.`,
    'Entity tables remain in the Data drawer.',
  ]
}

export function StudioInspectorActionIds(inspection: string, selection: string): string[] {
  return StudioInspectorReady(inspection, selection) ? ['wrap-stack'] : []
}

export function StudioInspectorActionLabel(actionId: string): string {
  return actionId === 'wrap-stack' ? 'Wrap in Stack' : actionId
}

export function StudioInspectorActionValid(
  currentSourceVersion: string,
  inspection: string,
  selection: string,
  busy: boolean,
  actionId: string,
): boolean {
  const selected = studioInspectorSelection(selection)
  return actionId === 'wrap-stack'
    && !busy
    && StudioInspectorReady(inspection, selection)
    && selected !== undefined
    && selected.identity.sourceVersion === currentSourceVersion
}

export function StudioInspectorAction(selection: string, actionId: string): string {
  const selected = studioInspectorSelection(selection)
  if (selected === undefined || actionId !== 'wrap-stack') {
    Errors.throwUserInput('The selected element does not expose that Studio action.')
  }
  return JSON.stringify({ kind: 'wrap-render', renderId: selected.renderId, wrapper: 'Stack' })
}

function studioInspectorInspection(value: string): StudioRenderInspection | undefined {
  const parsed = parseStudioJson<StudioRenderInspection>(value)
  return parsed !== undefined
      && Array.isArray(parsed.explorations)
      && Array.isArray(parsed.layoutEntries)
      && Array.isArray(parsed.styleEntries)
      && Array.isArray(parsed.styleProvenance)
      && typeof parsed.renderId === 'string'
    ? parsed
    : undefined
}

function studioInspectorSelection(value: string): StudioInspectorSelection | undefined {
  const parsed = parseStudioJson<StudioInspectorSelection>(value)
  return parsed !== undefined
      && typeof parsed.renderId === 'string'
      && typeof parsed.identity?.path === 'string'
      && typeof parsed.identity?.sourceVersion === 'string'
      && Number.isSafeInteger(parsed.range?.start)
      && Number.isSafeInteger(parsed.range?.end)
    ? parsed
    : undefined
}

function studioInspectorDraftMap(value: string): StudioInspectorDraftMap {
  const parsed = parseStudioJson<Record<string, unknown>>(value)
  return parsed !== undefined && Object.values(parsed).every(candidate => typeof candidate === 'string')
    ? parsed as Record<string, string>
    : {}
}

function studioInspectorLayoutEntry(
  inspection: StudioRenderInspection,
  drafts: StudioInspectorDraftMap,
  actionId: string,
): StudioLayoutEntry | undefined {
  if (actionId === 'gap') {
    const value = StudioInspector.layoutSizeDraft(drafts['gap'] ?? '')
    return value === undefined ? undefined : ['gap', value]
  }
  if (actionId === 'padding' || actionId === 'margin') {
    return StudioInspector.spacingEntryDraft(actionId === 'padding' ? 'pad' : 'margin', drafts[actionId] ?? '')
  }
  if (actionId === 'width' || actionId === 'height') {
    const mode = drafts[`${actionId}-mode`]
    if (mode === 'fill') {
      return [actionId, 'fill']
    }
    const value = StudioInspector.layoutSizeDraft(drafts[`${actionId}-value`] ?? '')
    return mode === 'fixed' && value !== undefined ? [actionId, value] : undefined
  }
  if (actionId === 'max-width') {
    const value = StudioInspector.layoutSizeDraft(drafts['max-width'] ?? '')
    return value === undefined ? undefined : ['width', 'max', value]
  }
  if (actionId === 'growth') {
    const mode = drafts['growth-mode']
    if (mode === 'fill' || mode === 'hug') {
      return [mode]
    }
    const value = StudioInspector.positiveNumberDraft(drafts['growth-value'] ?? '')
    return mode === 'claim' && value !== undefined && StudioInspector.layout(inspection).shrink !== 'rigid'
      ? ['claim', value]
      : undefined
  }
  if (actionId === 'shrink') {
    const shrink = drafts['shrink']
    return (shrink === 'compress' || shrink === 'rigid')
        && !(shrink === 'rigid' && StudioInspector.layout(inspection).growth.mode === 'claim')
      ? [shrink]
      : undefined
  }
  if (actionId === 'alignment') {
    const alignment = drafts['alignment']
    if (alignment === 'fill' || alignment === 'centered') {
      return [alignment]
    }
    return alignment === 'baseline'
        || alignment === 'bottom'
        || alignment === 'center'
        || alignment === 'left'
        || alignment === 'right'
        || alignment === 'top'
      ? ['aligned', alignment]
      : undefined
  }
  if (actionId === 'content') {
    const terms = (drafts['content'] ?? '').trim().split(/\s+/).filter(Boolean) as StudioLayoutContentTerm[]
    return StudioInspector.contentEntry(terms)
  }
  return undefined
}

type StudioInspectorStyleLandingOption = Readonly<{ label: string; landing: StudioStyleLandingScope }>

function studioInspectorCurrentStyle(inspection: StudioRenderInspection): StudioStyleEntry {
  const bundle = inspection.styleProvenance.find(provenance => provenance.landing.kind === 'style-bundle')
  return inspection.explorations.find(entry => studioStyleProperties.some(property => property.head === entry[0]))
    ?? bundle?.chain[1]?.split(/\s+/) as StudioStyleEntry | undefined
    ?? inspection.styleEntries[0]
    ?? ['fg', 'ink']
}

function studioInspectorStyleLandings(
  inspection: StudioRenderInspection,
  current: StudioStyleEntry,
): StudioInspectorStyleLandingOption[] {
  const landings: StudioInspectorStyleLandingOption[] = [
    { label: 'Element inline · selected render only', landing: { kind: 'element-inline' } },
  ]
  for (const provenance of inspection.styleProvenance) {
    if (provenance.editable === false || provenance.landing.kind !== 'style-bundle') {
      continue
    }
    const name = provenance.landing.bundleName
    if (
      !landings.some(candidate => candidate.landing.kind === 'style-bundle' && candidate.landing.bundleName === name)
    ) {
      landings.push({
        label: `Edit style ${name} · affects ${provenance.blastRadius}`,
        landing: provenance.landing,
      })
      landings.push({
        label: `Fork style ${name} · selected render only`,
        landing: { bundleName: name, kind: 'style-bundle', mode: 'fork' },
      })
    }
  }
  if (inspection.elementName !== undefined && inspection.design?.editable !== false) {
    landings.push({
      label: `Promote to ${inspection.elementName} default`,
      landing: { elementName: inspection.elementName, kind: 'element-default' },
    })
  }
  if (studioInspectorRawColor(current) && inspection.design?.editable !== false) {
    landings.push({
      label: `Promote to color token ${String(current[0])}Color`,
      landing: { kind: 'token', tokenName: `${String(current[0])}Color` },
    })
  }
  return landings
}

type StudioInspectorStylePromotion = Readonly<{
  entry: StudioStyleEntry
  label: string
  landing: StudioStyleLandingScope
}>

function studioInspectorStylePromotions(inspection: StudioRenderInspection): StudioInspectorStylePromotion[] {
  const promotions: StudioInspectorStylePromotion[] = []
  const localBundle = inspection.styleProvenance.find(provenance =>
    provenance.editable !== false && provenance.landing.kind === 'style-bundle'
  )
  for (const exploration of inspection.explorations) {
    const entry = exploration as StudioStyleEntry
    const label = exploration.join(' ')
    if (localBundle?.landing.kind === 'style-bundle') {
      promotions.push({
        entry,
        label: `Promote ${label} to forked style`,
        landing: { bundleName: localBundle.landing.bundleName, kind: 'style-bundle', mode: 'fork' },
      })
    }
    if (inspection.elementName !== undefined && inspection.design?.editable !== false) {
      promotions.push({
        entry,
        label: `Promote ${label} to ${inspection.elementName} default`,
        landing: { elementName: inspection.elementName, kind: 'element-default' },
      })
    }
    if (studioInspectorRawColor(exploration) && inspection.design?.editable !== false) {
      promotions.push({
        entry,
        label: `Promote ${label} to token`,
        landing: { kind: 'token', tokenName: `${String(exploration[0])}Color` },
      })
    }
    if (studioInspectorRawSize(exploration) && inspection.design?.editable !== false) {
      promotions.push({
        entry,
        label: `Promote ${label} to size token`,
        landing: { kind: 'size-token', tokenName: `${String(exploration[0])}Size` },
      })
    }
  }
  return promotions
}

function studioInspectorStylePromotion(
  inspection: StudioRenderInspection,
  promotionId: string,
): StudioInspectorStylePromotion | undefined {
  const index = Number(promotionId)
  return Number.isSafeInteger(index) && index >= 0 ? studioInspectorStylePromotions(inspection)[index] : undefined
}

function studioInspectorRawColor(entry: readonly unknown[]): boolean {
  return studioStyleProperties.some(property => property.head === entry[0] && property.valueKind === 'color')
    && typeof entry[1] === 'string'
    && entry[1].startsWith('#')
}

const studioInspectorSizeHeads = new Set(['gap', 'height', 'line', 'margin', 'pad', 'radius', 'size', 'width'])

function studioInspectorRawSize(entry: readonly unknown[]): boolean {
  if (!studioInspectorSizeHeads.has(String(entry[0]))) {
    return false
  }
  const numbers = entry.slice(1).filter((term): term is number => typeof term === 'number')
  return numbers.length === 1 && numbers[0]! > 0 && Number.isFinite(numbers[0]!)
}

function studioInspectorLandingName(landing: StudioStyleLandingScope): string {
  return landing.kind === 'element-inline'
    ? 'element inline'
    : landing.kind === 'style-bundle'
    ? `${landing.mode === 'fork' ? 'fork' : 'edit'} style ${landing.bundleName}`
    : landing.kind === 'element-default'
    ? `element default ${landing.elementName}`
    : `${landing.kind === 'size-token' ? 'size token' : 'token'} ${landing.tokenName}`
}

function parseStudioJson<ValueT>(value: string): ValueT | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as ValueT : undefined
  } catch {
    return undefined
  }
}

type StudioScenarioArgumentDrafts = Readonly<Record<string, string>>

export function StudioScenarioPanelSurface(
  props:
    & TaoStudioHostVisualProps
    & Readonly<{
      Available: boolean
      children?: React.ReactNode
    }>,
): React.ReactElement {
  return (
    <section
      className="studio-scenario-inspector"
      data-scenario-available={props.Available}
      data-studio-tao-scenario="true"
      style={props.Layout?.style}
    >
      <h2>Scenario</h2>
      {props.children}
    </section>
  )
}

export function StudioFailureCaptureInput(
  props:
    & TaoStudioHostVisualProps
    & Readonly<{ Replay: TaoStudioHostTextAction }>,
): React.ReactElement {
  const [status, setStatus] = React.useState('')
  return (
    <label className="studio-preview-cell-replay-load" data-testid={props.Tag} style={props.Layout?.style}>
      Load failure capture
      <input
        accept="application/json,.json"
        hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0]
          if (file !== undefined) {
            void file.text().then(text => {
              try {
                const capture = JSON.parse(text) as unknown
                Assert.input(
                  capture !== null && typeof capture === 'object',
                  'Failure capture must be a JSON object.',
                )
                setStatus('')
                return props.Replay.invoke(TR.Value(text))
              } catch (error) {
                setStatus(error instanceof Error ? error.message : String(error))
              }
            }, error => setStatus(error instanceof Error ? error.message : String(error)))
          }
        }}
        type="file"
      />
      {status === '' ? undefined : <span role="alert">{status}</span>}
    </label>
  )
}

export function studioScenarioArguments(
  model: Pick<StudioScenarioControlModel, 'parameters'>,
  drafts: StudioScenarioArgumentDrafts,
): Readonly<{ issues: readonly string[]; ok: false }> | Readonly<{ ok: true; value: StudioJsonObject }> {
  const args: Record<string, StudioJsonValue> = {}
  const issues: string[] = []
  for (const parameter of model.parameters) {
    const draft = drafts[parameter.parameterId]
    if (parameter.type.kind === 'boolean') {
      if (draft === 'true' || draft === 'false') {
        args[parameter.parameterId] = draft === 'true'
      } else if (draft !== '' && draft !== undefined) {
        issues.push(`${parameter.label} must be true or false.`)
      }
      continue
    }
    if (typeof draft !== 'string' || draft === '') {
      continue
    }
    if (parameter.type.kind === 'number') {
      const value = Number(draft)
      if (!Number.isFinite(value)) {
        issues.push(`${parameter.label} must be a finite number.`)
      } else {
        args[parameter.parameterId] = value
      }
    } else if (parameter.type.kind === 'json' || parameter.type.kind === 'choice') {
      try {
        args[parameter.parameterId] = JSON.parse(draft) as StudioJsonValue
      } catch {
        issues.push(`${parameter.label} must be valid JSON.`)
      }
    } else {
      args[parameter.parameterId] = draft
    }
  }
  if (issues.length > 0) {
    return { issues, ok: false }
  }
  return StudioScenarioControls.validateArguments(model, args)
}

function scenarioDrafts(model: StudioScenarioControlModel | undefined): StudioScenarioArgumentDrafts {
  if (model === undefined) {
    return {}
  }
  return Object.fromEntries(model.parameters.map(parameter => {
    const value = model.arguments[parameter.parameterId] ?? parameter.defaultValue
    let draft: string
    if (value === undefined) {
      draft = ''
    } else if (parameter.type.kind === 'boolean') {
      draft = String(value === true)
    } else if (parameter.type.kind === 'json' || parameter.type.kind === 'choice') {
      draft = JSON.stringify(value)
    } else {
      draft = String(value)
    }
    return [
      parameter.parameterId,
      draft,
    ]
  }))
}

function isStudioScenarioControlModel(value: unknown): value is StudioScenarioControlModel {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<StudioScenarioControlModel>
  return candidate.version === 1
    && candidate.cell !== undefined
    && typeof candidate.cell.id === 'string'
    && Number.isInteger(candidate.cell.revision)
    && candidate.entry !== undefined
    && typeof candidate.entry.label === 'string'
    && candidate.group !== undefined
    && typeof candidate.group.label === 'string'
    && Array.isArray(candidate.parameters)
    && Array.isArray(candidate.capturedLayers)
}

function studioScenarioModel(state: string): StudioScenarioControlModel | undefined {
  const parsed = parseStudioJson<unknown>(state)
  return isStudioScenarioControlModel(parsed) ? parsed : undefined
}

function studioScenarioDraftMap(drafts: string): StudioScenarioArgumentDrafts {
  const parsed = parseStudioJson<unknown>(drafts)
  if (parsed === undefined || parsed === null || Array.isArray(parsed)) {
    return {}
  }
  const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return Object.fromEntries(entries)
}

function studioScenarioParameter(state: string, parameterId: string) {
  return studioScenarioModel(state)?.parameters.find(parameter => parameter.parameterId === parameterId)
}

export function StudioScenarioAvailable(state: string): boolean {
  return studioScenarioModel(state) !== undefined
}

export function StudioScenarioArgumentDrafts(state: string): string {
  return JSON.stringify(scenarioDrafts(studioScenarioModel(state)))
}

export function StudioScenarioArgumentIds(state: string): string[] {
  return studioScenarioModel(state)?.parameters.map(parameter => parameter.parameterId) ?? []
}

export function StudioScenarioEntryLabel(state: string): string {
  return studioScenarioModel(state)?.entry.label ?? ''
}

export function StudioScenarioGroupLabel(state: string): string {
  return studioScenarioModel(state)?.group.label ?? ''
}

export function StudioScenarioSubjectId(state: string): string {
  return studioScenarioModel(state)?.entry.subjectId ?? ''
}

export function StudioScenarioCellIdentity(state: string): string {
  const model = studioScenarioModel(state)
  return model === undefined
    ? ''
    : `${model.cell.id} · revision ${model.cell.revision} · manifest ${model.cell.manifestRevision}`
}

export function StudioScenarioCapturedLayers(state: string): string[] {
  return [...(studioScenarioModel(state)?.capturedLayers ?? [])]
}

export function StudioScenarioFailureAvailable(state: string): boolean {
  return studioScenarioModel(state)?.failureReplay !== undefined
}

export function StudioScenarioFixtureNameValid(fixtureName: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(fixtureName)
}

export function StudioScenarioArgumentDraft(drafts: string, parameterId: string): string {
  return studioScenarioDraftMap(drafts)[parameterId] ?? ''
}

export function StudioScenarioArgumentUsesPicker(state: string, parameterId: string): boolean {
  const kind = studioScenarioParameter(state, parameterId)?.type.kind
  return kind === 'boolean' || kind === 'choice'
}

export function StudioScenarioArgumentLabel(state: string, parameterId: string): string {
  return studioScenarioParameter(state, parameterId)?.label ?? parameterId
}

export function StudioScenarioArgumentOptions(state: string, parameterId: string): string[] {
  const parameter = studioScenarioParameter(state, parameterId)
  if (parameter?.type.kind === 'boolean') {
    return parameter.required ? ['true', 'false'] : ['', 'true', 'false']
  }
  return parameter?.type.kind === 'choice' ? parameter.type.values.map(value => JSON.stringify(value)) : []
}

export function StudioScenarioUpdateArgumentDraft(drafts: string, parameterId: string, value: string): string {
  return JSON.stringify({ ...studioScenarioDraftMap(drafts), [parameterId]: value })
}

export function StudioScenarioArgumentsValid(state: string, drafts: string): boolean {
  const model = studioScenarioModel(state)
  return model !== undefined && studioScenarioArguments(model, studioScenarioDraftMap(drafts)).ok
}

export function StudioScenarioArgumentIssues(state: string, drafts: string): string {
  const model = studioScenarioModel(state)
  if (model === undefined) {
    return ''
  }
  const checked = studioScenarioArguments(model, studioScenarioDraftMap(drafts))
  return checked.ok ? '' : checked.issues.join(' ')
}

export function StudioScenarioIdentityPayload(state: string): string {
  const model = studioScenarioModel(state)
  Assert.input(model, 'The active Studio scenario is unavailable.')
  return JSON.stringify({ cellId: model.cell.id, cellRevision: model.cell.revision })
}

export function StudioScenarioArgumentsPayload(state: string, drafts: string, appearance: string): string {
  const model = studioScenarioModel(state)
  Assert.input(model, 'The active Studio scenario is unavailable.')
  const checked = studioScenarioArguments(model, studioScenarioDraftMap(drafts))
  if (!checked.ok) {
    Errors.throwUserInput(checked.issues.join(' '))
  }
  if (appearance !== 'dark' && appearance !== 'light') {
    Errors.throwUserInput('Studio can author only the resolved light or dark scenario appearance.')
  }
  return JSON.stringify({
    appearance,
    arguments: checked.value,
    cellId: model.cell.id,
    cellRevision: model.cell.revision,
  })
}

export function StudioScenarioFixturePayload(state: string, fixtureName: string): string {
  Assert.input(StudioScenarioFixtureNameValid(fixtureName), 'Fixture name must be a Tao identifier.')
  return JSON.stringify({ ...JSON.parse(StudioScenarioIdentityPayload(state)), fixtureName })
}

export function StudioScenarioReplayPayload(state: string, capture: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(capture) as unknown
  } catch {
    Errors.throwUserInput('Failure capture must be valid JSON.')
  }
  Assert.input(parsed !== null && typeof parsed === 'object', 'Failure capture must be a JSON object.')
  return JSON.stringify({ ...JSON.parse(StudioScenarioIdentityPayload(state)), capture: parsed })
}

export function StudioPanelSelected(tab: string, panel: string): boolean {
  return tab === panel
}

function useStudioEditorLsp(path: string | undefined, projectRoot: string | undefined): CodeEditorLsp | undefined {
  const [connected, setConnected] = React.useState<
    Readonly<{ lsp: CodeEditorLsp; path: string; projectRoot: string }> | undefined
  >(undefined)
  React.useEffect(() => {
    if (path === undefined || projectRoot === undefined) {
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const lifecycle = new StudioProductHostLspLifecycle(
      () => StudioApiClient.lspTransport(controller.signal),
      () => controller.abort(),
    )
    void lifecycle.open().then(transport => {
      if (transport !== undefined) {
        setConnected({
          lsp: {
            documentUri: fileUri(projectRoot, path),
            languageId: 'tao',
            rootUri: fileUri(projectRoot),
            transport,
          },
          path,
          projectRoot,
        })
      }
    }).catch(error => {
      if (!cancelled) {
        console.error('Tao Studio ProductHost language support could not connect.', error)
      }
    })
    return () => {
      cancelled = true
      lifecycle.close()
    }
  }, [path, projectRoot])
  return connected !== undefined && connected.path === path && connected.projectRoot === projectRoot
    ? connected.lsp
    : undefined
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

export async function InsertComponent(component: string): Promise<void> {
  await requestStudioProductHostInsertComponent(component)
}

export async function InsertProjectView(viewName: string): Promise<void> {
  await requestStudioProductHostInsertProjectView(viewName)
}

export async function OpenScreen(subjectId: string): Promise<void> {
  await requestStudioProductHostOpenScreen(subjectId)
}

export async function ApplyInspectorAction(actionJson: string, proposed: boolean): Promise<void> {
  await requestStudioProductHostApplyInspectorAction(StudioPanelPayloads.sourceAction(actionJson), proposed)
}

export async function UndoInspectorAction(): Promise<void> {
  await requestStudioProductHostUndoInspectorAction()
}

export async function ProductPanelAction(name: string, payload: string): Promise<void> {
  await requestStudioProductHostPanelAction(name, payload)
}

/** Applies Tao-owned scenario environment draft state through the active workbench cell controller. */
export async function ApplyActiveCellEnvironment(
  cellId: string,
  cellRevision: number,
  preset: string,
  width: number,
  height: number,
  network: string,
  latency: number,
  errorMessage: string,
  errorStatus: number,
): Promise<void> {
  if (network !== 'error' && network !== 'normal' && network !== 'offline') {
    Errors.throwUserInput(`Unsupported Studio network outcome: ${network}`)
  }
  await requestStudioProductHostApplyActiveCellEnvironment({ cellId, cellRevision }, {
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
