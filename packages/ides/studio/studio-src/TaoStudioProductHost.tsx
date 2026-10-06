import TR from '@runtime/TR'
import { Errors } from '@shared/core'
import React from 'react'
import { createPortal } from 'react-dom'
import { mountStudio } from './client/StudioApp'
import {
  type StudioDrawerPanelModel,
  StudioPanelProjection,
  type StudioSearchPanelRow,
} from './client/StudioPanelProjection'
import {
  rejectPendingStudioProductHostActions,
  type StudioProductHostState,
  studioProductHostState,
  subscribeStudioProductHostState,
} from './StudioProductHostProtocol'
import { reactiveBrowserSchemeCapability } from './StudioProtocol'

// The Tao client names every foreign view and function in this file; each family lives in its own
// module under ./product-host and is re-exported here so that contract stays in one place.
export { StudioContextPanelSurface, StudioContextSummary } from './product-host/StudioContextViews'
export {
  StudioActions,
  StudioButton,
  StudioChoice,
  StudioInspectorRow,
  studioNumericDraft,
  StudioNumericInput,
  StudioRadioKeys,
  StudioScenarioControlGroup,
  StudioScenarioIdentity,
  StudioScenarioInspectorLabel,
  StudioScenarioSource,
  StudioSchemeNote,
  StudioSegmented,
} from './product-host/StudioControlViews'
// The editor boundary is exported from here, beside every other product-host view, so the Tao
// client reaches one module: the host publishes its revisioned state into the same
// StudioProductHostProtocol instance the editor subscribes to.
export { StudioCodeEditor } from './product-host/StudioEditorSurface'
export {
  StudioEnvironmentValid,
  StudioNetworkShowsError,
  StudioViewportPresetHeight,
  StudioViewportPresetWidth,
} from './product-host/StudioEnvironment'
export {
  FileCreateBar,
  FilesPanelSurface,
  TreeFileRow,
  type TreeFileRowProps,
  TreeFolder,
} from './product-host/StudioFilesPanel'
export {
  ApplyFocusedCellEnvironment,
  ApplyInspectorAction,
  CreateFile,
  DeleteFile,
  InsertComponent,
  InsertProjectView,
  MoveGeneratedSource,
  OpenFile,
  OpenScreen,
  OpenSource,
  ProductPanelAction,
  RenameFile,
  UndoInspectorAction,
} from './product-host/StudioHostActions'
export {
  StudioInspectorLayoutAction,
  StudioInspectorLayoutActionIds,
  StudioInspectorLayoutActionLabel,
  StudioInspectorLayoutActionValid,
  StudioInspectorLayoutDrafts,
  StudioInspectorLayoutFieldIds,
  StudioInspectorLayoutFieldLabel,
  StudioInspectorLayoutFieldOptions,
  StudioInspectorLayoutFieldUsesPicker,
} from './product-host/StudioInspectorLayout'
export {
  StudioInspectorDraft,
  StudioInspectorReady,
  StudioInspectorStatus,
  StudioInspectorSummaryLines,
  StudioInspectorUndoAvailable,
  StudioInspectorUpdateDraft,
} from './product-host/StudioInspectorModel'
export {
  StudioInspectorAction,
  StudioInspectorActionIds,
  StudioInspectorActionLabel,
  StudioInspectorActionValid,
  StudioInspectorDataLines,
  StudioInspectorDraftsFor,
} from './product-host/StudioInspectorSections'
export {
  StudioInspectorStyleAction,
  StudioInspectorStyleActionValid,
  StudioInspectorStyleDrafts,
  StudioInspectorStyleFieldIds,
  StudioInspectorStyleFieldLabel,
  StudioInspectorStyleFieldOptions,
  StudioInspectorStyleFieldUsesPicker,
  StudioInspectorStyleNotes,
  StudioInspectorStylePromotionAction,
  StudioInspectorStylePromotionIds,
  StudioInspectorStylePromotionLabel,
  StudioInspectorStylePromotionValid,
} from './product-host/StudioInspectorStyle'
export {
  StudioInspectorBindTextAction,
  StudioInspectorSetTextAction,
  StudioInspectorSetTextValid,
  StudioInspectorTextActionValid,
  StudioInspectorTextAvailable,
  StudioInspectorTextBindingLabel,
  StudioInspectorTextCandidates,
  StudioInspectorTextDraft,
  StudioInspectorTextLiteral,
  StudioInspectorTextStatus,
  StudioInspectorTextUpdateDraft,
} from './product-host/StudioInspectorText'
export {
  StudioInspectorField,
  StudioInspectorSection,
  StudioInspectorSummarySurface,
  StudioInspectorUndoMarker,
} from './product-host/StudioInspectorViews'
export {
  StudioDataRows,
  StudioDataTableTitle,
  StudioDesignTokenRow,
  StudioDesignTokenSection,
  StudioFeedDrag,
  StudioFeedEntityPayload,
  StudioFeedRowControl,
  StudioFeedSeedPayload,
  StudioFeedSourcePayload,
  StudioPaletteRow,
  StudioPanelSelected,
  StudioPanelSurface,
  StudioSearchHit,
  StudioSearchLocation,
  StudioSourceRow,
} from './product-host/StudioPanelRows'
export {
  StudioScenarioJourneyActive,
  StudioScenarioJourneyAvailable,
  StudioScenarioJourneyBusy,
  StudioScenarioJourneyButtonLabel,
  StudioScenarioJourneyCanRecord,
  StudioScenarioJourneyCanSave,
  StudioScenarioJourneyCommand,
  StudioScenarioJourneyLines,
  StudioScenarioJourneyPayload,
  StudioScenarioJourneyStatus,
} from './product-host/StudioScenarioJourney'
export {
  StudioFailureCaptureInput,
  StudioScenarioArgumentDraft,
  StudioScenarioArgumentDrafts,
  StudioScenarioArgumentIds,
  StudioScenarioArgumentIssues,
  StudioScenarioArgumentLabel,
  StudioScenarioArgumentOptions,
  studioScenarioArguments,
  StudioScenarioArgumentsPayload,
  StudioScenarioArgumentsValid,
  StudioScenarioArgumentUsesPicker,
  StudioScenarioAvailable,
  StudioScenarioCapturedLayers,
  StudioScenarioCellIdentity,
  StudioScenarioEntryLabel,
  StudioScenarioFailureAvailable,
  StudioScenarioFixtureNameValid,
  StudioScenarioFixturePayload,
  StudioScenarioGroupLabel,
  StudioScenarioIdentityPayload,
  StudioScenarioPanelSurface,
  StudioScenarioReplayPayload,
  StudioScenarioSubjectId,
  StudioScenarioUpdateArgumentDraft,
} from './product-host/StudioScenarioPanel'

type TaoStudioProductHostProps = Readonly<{
  children?: React.ReactNode
  Layout?: Readonly<{ style?: React.CSSProperties }>
  Slots?: Readonly<{
    '@inspector'?: TR.SlotRenderer<StudioContextPanelSlotProps> | null
    '@environment'?: TR.SlotRenderer<StudioEnvironmentSlotProps> | null
    '@drawer'?: TR.SlotRenderer<StudioDrawerSlotProps> | null
    '@data'?: TR.SlotRenderer<StudioDataSlotProps> | null
    '@search'?: TR.SlotRenderer<StudioSearchSlotProps> | null
    '@scenario'?: TR.SlotRenderer<StudioStateSlotProps> | null
    '@files'?: React.ReactNode
    '@components'?: React.ReactNode
    '@projectViews'?: React.ReactNode
    '@screens'?: React.ReactNode
    '@tokens'?: React.ReactNode
    '@editor'?: React.ReactNode
  }>
  Tag?: string
}>

type StudioContextPanelSlotProps = Readonly<{
  FocusedCellId: TR.Value<string>
  CellRevision: TR.Value<number>
  InspectorBusy: TR.Value<boolean>
  InspectorCanUndo: TR.Value<boolean>
  InspectorInspection: TR.Value<string>
  LensLines: TR.Value<readonly string[]>
  LensJourneyPath: TR.Value<string>
  InspectorSelection: TR.Value<string>
  ActiveFileContent: TR.Value<string>
  ActiveFilePath: TR.Value<string>
  ActiveFileVersion: TR.Value<string>
  FocusedScenarioId: TR.Value<string>
  ProjectRoot: TR.Value<string>
  Revision: TR.Value<number>
  SelectedRenderId: TR.Value<string>
  SelectedRenderPath: TR.Value<string>
  SelectedRenderVersion: TR.Value<string>
  SelectionAnchor: TR.Value<number>
  SelectionHead: TR.Value<number>
  ViewportHeight: TR.Value<number>
  ViewportWidth: TR.Value<number>
}>

/** The environment editor lives in the Scenario pane; it receives only what the focused cell's environment needs. */
type StudioEnvironmentSlotProps = Readonly<{
  FocusedCellId: TR.Value<string>
  CellRevision: TR.Value<number>
  NetworkErrorMessage: TR.Value<string>
  NetworkErrorStatus: TR.Value<number>
  NetworkLatencyMs: TR.Value<number>
  NetworkOutcome: TR.Value<string>
  SchemeCapability: TR.Value<string>
  SchemeRequested: TR.Value<string>
  SchemeResolved: TR.Value<string>
  SchemeSource: TR.Value<string>
  ViewportHeight: TR.Value<number>
  ViewportPresetId: TR.Value<string>
  ViewportWidth: TR.Value<number>
}>

type StudioStateSlotProps = Readonly<{
  JourneyRecordable: TR.Value<boolean>
  JourneyRecording: TR.Value<string>
  ResolvedAppearance: TR.Value<string>
  State: TR.Value<string>
}>

type StudioDrawerSlotProps = Readonly<{
  Compile: TR.Value<StudioDrawerPanelModel['Compile']>
  Data: TR.Value<StudioDrawerPanelModel['Data']>
  Debug: TR.Value<StudioDrawerPanelModel['Debug']>
  Logs: TR.Value<StudioDrawerPanelModel['Logs']>
  Problems: TR.Value<StudioDrawerPanelModel['Problems']>
  Tab: TR.Value<string>
  Tests: TR.Value<StudioDrawerPanelModel['Tests']>
}>

type StudioDataSlotProps = Readonly<{
  Data: TR.Value<StudioDrawerPanelModel['Data']>
}>

type StudioSearchSlotProps = Readonly<{
  Rows: TR.Value<readonly StudioSearchPanelRow[]>
}>

/** Draft-owning panel identities change with the selected scenario, not with either panel's remount. */
export const StudioProductHostMountIdentity = {
  environment(focusedCell: StudioProductHostState['focusedCell']): string {
    return `studio-environment:${focusedCell?.cellId ?? 'none'}`
  },
  scenario(focusedCell: StudioProductHostState['focusedCell']): string {
    return `studio-scenario:${focusedCell?.cellId ?? 'none'}:${focusedCell?.scenarioId ?? 'none'}`
  },
} as const

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
  const [dataTarget, setDataTarget] = React.useState<HTMLElement>()
  const [drawerTarget, setDrawerTarget] = React.useState<HTMLElement>()
  const [searchTarget, setSearchTarget] = React.useState<HTMLElement>()
  const [scenarioTarget, setScenarioTarget] = React.useState<HTMLElement>()
  const [filesTarget, setFilesTarget] = React.useState<HTMLElement>()
  const [inspectorTarget, setInspectorTarget] = React.useState<HTMLElement>()
  const [environmentTarget, setEnvironmentTarget] = React.useState<HTMLElement>()
  React.useEffect(() => {
    const root = mount.current
    if (root === null) {
      return
    }
    let cleanup: (() => void) | undefined
    let unmounted = false
    const cancellation = new AbortController()
    const mounting = mountStudio({
      root,
      signal: cancellation.signal,
      onShellReady: () => {
        if (cancellation.signal.aborted) {
          return
        }
        setFilesTarget(root.querySelector<HTMLElement>('.studio-files') ?? undefined)
        setEditorTarget(root.querySelector<HTMLElement>('.studio-editor') ?? undefined)
        setComponentsTarget(root.querySelector<HTMLElement>('.studio-components') ?? undefined)
        setProjectViewsTarget(root.querySelector<HTMLElement>('.studio-project-views') ?? undefined)
        setScreensTarget(root.querySelector<HTMLElement>('.studio-screens') ?? undefined)
        setTokensTarget(root.querySelector<HTMLElement>('.studio-design-values') ?? undefined)
        setDataTarget(root.querySelector<HTMLElement>('.studio-data') ?? undefined)
        setDrawerTarget(root.querySelector<HTMLElement>('.studio-drawer-content') ?? undefined)
        setSearchTarget(root.querySelector<HTMLElement>('.studio-search-results') ?? undefined)
        setScenarioTarget(root.querySelector<HTMLElement>('.studio-scenario-inspector-content') ?? undefined)
        setEnvironmentTarget(root.querySelector<HTMLElement>('.studio-inspector-tao-environment') ?? undefined)
        setInspectorTarget(root.querySelector<HTMLElement>('.studio-inspector-tao-context') ?? undefined)
      },
    })
    const reportMountError = (error: unknown): void => {
      if (unmounted && error instanceof Error && error.name === 'AbortError') {
        return
      }
      rejectPendingStudioProductHostActions(error)
      console.error('Could not mount the Tao Studio product host.', error)
      if (!unmounted) {
        const alert = document.createElement('p')
        alert.role = 'alert'
        alert.textContent = Errors.messageOf(error)
        root.replaceChildren(alert)
      }
    }
    const unmount = (): void => {
      unmounted = true
      cancellation.abort()
      rejectPendingStudioProductHostActions(
        Errors.abortError('Tao Studio product host unmounted before the requested action could run.'),
      )
      cleanup?.()
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
  const files = props.Slots?.['@files'] ?? props.children
  const components = props.Slots?.['@components']
  const projectViews = props.Slots?.['@projectViews']
  const screens = props.Slots?.['@screens']
  const tokens = props.Slots?.['@tokens']
  const data = props.Slots?.['@data']
  const drawer = props.Slots?.['@drawer']
  const search = props.Slots?.['@search']
  const scenario = props.Slots?.['@scenario']
  const environment = props.Slots?.['@environment']
  const editor = props.Slots?.['@editor']
  const inspector = props.Slots?.['@inspector']
  const activeFile = hostState.activeFile
  const focusedCell = hostState.focusedCell
  const selectedRender = hostState.selectedRender
  const panelValues = hostState.panels ?? StudioPanelProjection.empty()
  const refreshedInspector = inspector === undefined
    ? undefined
    : (
      <TR.RenderSlots.Frame
        renderer={inspector}
        key={[
          'studio-context',
          focusedCell?.cellId ?? 'none',
          focusedCell?.cellRevision ?? 0,
          selectedRender?.renderId ?? 'none',
          selectedRender?.sourceVersion ?? 'none',
          JSON.stringify(hostState.inspector?.selection ?? null),
          JSON.stringify(hostState.inspector?.inspection ?? null),
        ].join(':')}
        args={{
          FocusedCellId: TR.Value(focusedCell?.cellId ?? ''),
          CellRevision: TR.Value(focusedCell?.cellRevision ?? 0),
          InspectorBusy: TR.Value(hostState.inspector?.busy ?? false),
          InspectorCanUndo: TR.Value(hostState.inspector?.canUndo ?? false),
          InspectorInspection: TR.Value(JSON.stringify(hostState.inspector?.inspection ?? null)),
          LensLines: TR.Value(hostState.lensLines ?? []),
          LensJourneyPath: TR.Value(hostState.lensJourneyPath ?? ''),
          InspectorSelection: TR.Value(JSON.stringify(hostState.inspector?.selection ?? null)),
          ActiveFileContent: TR.Value(activeFile?.content ?? ''),
          ActiveFilePath: TR.Value(activeFile?.path ?? ''),
          ActiveFileVersion: TR.Value(activeFile?.saved === false ? '' : activeFile?.sourceVersion ?? ''),
          FocusedScenarioId: TR.Value(focusedCell?.scenarioId ?? ''),
          ProjectRoot: TR.Value(hostState.projectRoot ?? ''),
          Revision: TR.Value(hostState.revision),
          SelectedRenderId: TR.Value(selectedRender?.renderId ?? ''),
          SelectedRenderPath: TR.Value(selectedRender?.path ?? ''),
          SelectedRenderVersion: TR.Value(selectedRender?.sourceVersion ?? ''),
          SelectionAnchor: TR.Value(activeFile?.selectionAnchor ?? 0),
          SelectionHead: TR.Value(activeFile?.selectionHead ?? 0),
          ViewportHeight: TR.Value(focusedCell?.viewportHeight ?? 0),
          ViewportWidth: TR.Value(focusedCell?.viewportWidth ?? 0),
        }}
      />
    )
  const refreshedEnvironment = environment === undefined
    ? undefined
    : (
      <TR.RenderSlots.Frame
        renderer={environment}
        key={StudioProductHostMountIdentity.environment(focusedCell)}
        args={{
          FocusedCellId: TR.Value(focusedCell?.cellId ?? ''),
          CellRevision: TR.Value(focusedCell?.cellRevision ?? 0),
          NetworkErrorMessage: TR.Value(focusedCell?.networkErrorMessage ?? 'Injected Studio network failure'),
          NetworkErrorStatus: TR.Value(focusedCell?.networkErrorStatus ?? 503),
          NetworkLatencyMs: TR.Value(focusedCell?.networkLatencyMs ?? 0),
          NetworkOutcome: TR.Value(focusedCell?.networkOutcome ?? 'normal'),
          SchemeCapability: TR.Value(focusedCell?.schemeCapability ?? reactiveBrowserSchemeCapability),
          SchemeRequested: TR.Value(focusedCell?.schemeRequested ?? 'system'),
          SchemeResolved: TR.Value(focusedCell?.schemeResolved ?? 'light'),
          SchemeSource: TR.Value(focusedCell?.schemeSource ?? 'system'),
          ViewportHeight: TR.Value(focusedCell?.viewportHeight ?? 0),
          ViewportPresetId: TR.Value(focusedCell?.viewportPresetId ?? 'custom'),
          ViewportWidth: TR.Value(focusedCell?.viewportWidth ?? 0),
        }}
      />
    )
  const refreshedDrawer = drawer === undefined
    ? undefined
    : (
      <TR.RenderSlots.Frame
        renderer={drawer}
        args={{
          Compile: TR.Value(panelValues.Drawer.Compile),
          Data: TR.Value(panelValues.Drawer.Data),
          Debug: TR.Value(panelValues.Drawer.Debug),
          Logs: TR.Value(panelValues.Drawer.Logs),
          Problems: TR.Value(panelValues.Drawer.Problems),
          Tab: TR.Value(panelValues.Drawer.Tab),
          Tests: TR.Value(panelValues.Drawer.Tests),
        }}
      />
    )
  const refreshedData = data === undefined
    ? undefined
    : <TR.RenderSlots.Frame renderer={data} args={{ Data: TR.Value(panelValues.Drawer.Data) }} />
  const refreshedSearch = search === undefined
    ? undefined
    : <TR.RenderSlots.Frame renderer={search} args={{ Rows: TR.Value(panelValues.Search.Rows) }} />
  const refreshedScenario = scenario === undefined
    ? undefined
    : (
      <TR.RenderSlots.Frame
        renderer={scenario}
        key={StudioProductHostMountIdentity.scenario(focusedCell)}
        args={{
          JourneyRecordable: TR.Value(focusedCell?.journeyRecordable ?? false),
          JourneyRecording: TR.Value(focusedCell?.journeyRecording ?? 'null'),
          ResolvedAppearance: TR.Value(focusedCell?.schemeResolved ?? 'light'),
          State: TR.Value(focusedCell?.scenarioModel ?? 'null'),
        }}
      />
    )
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
      {dataTarget === undefined || refreshedData === undefined
        ? undefined
        : createPortal(refreshedData, dataTarget)}
      {drawerTarget === undefined || refreshedDrawer === undefined
        ? undefined
        : createPortal(refreshedDrawer, drawerTarget)}
      {searchTarget === undefined || refreshedSearch === undefined
        ? undefined
        : createPortal(refreshedSearch, searchTarget)}
      {scenarioTarget === undefined || refreshedScenario === undefined
        ? undefined
        : createPortal(
          <React.Fragment key={StudioProductHostMountIdentity.scenario(focusedCell)}>
            {refreshedScenario}
          </React.Fragment>,
          scenarioTarget,
        )}
      {environmentTarget === undefined || refreshedEnvironment === undefined
        ? undefined
        : createPortal(
          <React.Fragment key={StudioProductHostMountIdentity.environment(focusedCell)}>
            {refreshedEnvironment}
          </React.Fragment>,
          environmentTarget,
        )}
      {editorTarget === undefined || editor === undefined ? undefined : createPortal(editor, editorTarget)}
      {inspectorTarget === undefined || refreshedInspector === undefined
        ? undefined
        : createPortal(
          <React.Fragment key={`${focusedCell?.cellId ?? 'none'}:${focusedCell?.cellRevision ?? 0}`}>
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
