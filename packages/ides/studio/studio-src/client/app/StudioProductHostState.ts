import type { StudioRenderInspection } from '@source-actions'
import type { EditorView } from 'codemirror'
import type { StudioDeviceLog, StudioDeviceStatus } from '../../device/StudioDeviceStatus'
import type { StudioDraftFile } from '../../StudioDraftSync'
import type { StudioInspectorSelection } from '../../StudioInspector'
import { publishStudioProductHostState } from '../../StudioProductHostProtocol'
import type { StudioTestStatus } from '../../StudioTestRunner'
import type { StudioCompileState, StudioFile } from '../StudioApiClient'
import { absoluteSourcePath, projectRelativePath } from '../StudioEditor'
import {
  StudioJourneyRecorder,
  type StudioPreviewConnection,
  type StudioRuntimeDataTable,
  type StudioRuntimeLog,
} from '../StudioMatrixView'
import { type StudioFeedPanelInput, StudioPanelProjection } from '../StudioPanelProjection'
import type { StudioDrawerTab } from '../StudioProductPanels'
import type { StudioSearchResult } from '../StudioRailPanels'
import { coveringJourneys, projectStudioLensLines } from './StudioLensProjection'

export type StudioDataPanelSnapshot = Readonly<{
  error: string | undefined
  loading: boolean
  result: readonly StudioRuntimeDataTable[]
}>

export type StudioTestPanelSnapshot = Readonly<{
  error: string | undefined
  status: StudioTestStatus | undefined
  watch: boolean
}>

/** Everything the Tao product host renders from, gathered from the parts that own each field. */
export type StudioHostSnapshot = Readonly<{
  activeFile: StudioDraftFile | undefined
  activePath: string | undefined
  canUndo: boolean
  compile: StudioCompileState
  data: StudioDataPanelSnapshot
  deviceLensSamples: NonNullable<StudioDeviceStatus['lensSamples']>
  deviceLogs: readonly StudioDeviceLog[]
  feed?: StudioFeedPanelInput
  drawerTab: StudioDrawerTab
  editor: EditorView | undefined
  inspected: StudioInspectorSelection | undefined
  inspection: StudioRenderInspection | undefined
  journeyBusy: (preview: StudioPreviewConnection) => boolean
  preview: StudioPreviewConnection | undefined
  project: string
  projectFiles: readonly StudioFile[]
  revealRevision: number
  searchResults: readonly StudioSearchResult[]
  sourceActionBusy: boolean
  tests: StudioTestPanelSnapshot
}>

/** Both the project-relative and the absolute path of every file, keyed to its source version. */
export function studioSourceVersions(project: string, files: readonly StudioFile[]): Record<string, string> {
  return Object.fromEntries(files.flatMap(file => [
    [file.path, file.sourceVersion],
    [absoluteSourcePath(project, file.path), file.sourceVersion],
  ]))
}

export function studioPanelLogs(
  previewLogs: readonly StudioRuntimeLog[],
  deviceLogs: readonly StudioDeviceLog[],
): readonly StudioRuntimeLog[] {
  return [
    ...previewLogs,
    ...deviceLogs.map(log => ({
      arguments: [`Device ${log.deviceName}: ${log.message}`],
      level: log.level,
      timestamp: log.timestamp,
    })),
  ].sort((left, right) => left.timestamp - right.timestamp)
}

export function publishStudioHostSnapshot(snapshot: StudioHostSnapshot): void {
  const { activeFile, editor, inspected, preview } = snapshot
  const selection = editor?.state.selection.main
  const cellSource = preview?.cell === undefined
    ? undefined
    : { cellId: preview.cell.cellId, cellRevision: preview.cell.cellRevision }
  const selectedRender = inspected === undefined
    ? undefined
    : {
      path: inspected.identity.path,
      renderId: inspected.renderId,
      sourceVersion: inspected.identity.sourceVersion,
    }
  const journeySource = coveringJourneys(selectedRender, snapshot.tests.status?.lastRun?.journeyObservations)[0]
    ?.checkSource.filePath
  const relativeJourneyPath = journeySource === undefined
    ? undefined
    : projectRelativePath(snapshot.project, journeySource)
  publishStudioProductHostState({
    focusedCell: preview?.cell === undefined
      ? undefined
      : {
        cellId: preview.cell.cellId,
        cellRevision: preview.cell.cellRevision,
        networkErrorMessage: preview.cell.environment.network.error?.message,
        networkErrorStatus: preview.cell.environment.network.error?.status,
        networkLatencyMs: preview.cell.environment.network.latencyMs,
        networkOutcome: preview.cell.environment.network.outcome,
        journeyRecordable: StudioJourneyRecorder.canStart(preview),
        journeyRecording: JSON.stringify(
          preview.journeyRecording === undefined
            ? null
            : { ...preview.journeyRecording, busy: snapshot.journeyBusy(preview) },
        ),
        scenarioModel: JSON.stringify(preview.scenarioModel ?? null),
        scenarioId: preview.cell.scenarioId,
        schemeCapability: preview.cell.environment.scheme.capability,
        schemeRequested: preview.cell.environment.scheme.requested,
        schemeResolved: preview.cell.environment.scheme.resolved,
        schemeSource: preview.cell.environment.scheme.source,
        viewportHeight: preview.cell.environment.viewport.height,
        viewportPresetId: preview.cell.environment.viewport.presetId,
        viewportWidth: preview.cell.environment.viewport.width,
      },
    activeFile: activeFile === undefined || editor === undefined
      ? undefined
      : {
        content: editor.state.doc.toString(),
        path: activeFile.path,
        revealRevision: snapshot.revealRevision,
        saved: editor.state.doc.toString() === activeFile.content,
        selectionAnchor: selection?.anchor ?? 0,
        selectionHead: selection?.head ?? selection?.anchor ?? 0,
        sourceVersion: activeFile.sourceVersion,
      },
    projectRoot: snapshot.project,
    inspector: {
      busy: snapshot.sourceActionBusy,
      canUndo: snapshot.canUndo,
      currentSourceVersion: activeFile?.sourceVersion,
      inspection: snapshot.inspection,
      selection: inspected,
    },
    lensLines: projectStudioLensLines(
      selectedRender,
      preview?.lensSamples ?? [],
      snapshot.inspection,
      snapshot.tests.status?.lastRun?.journeyObservations,
      snapshot.deviceLensSamples,
    ),
    lensJourneyPath: relativeJourneyPath !== undefined
        && snapshot.projectFiles.some(file => file.path === relativeJourneyPath)
      ? relativeJourneyPath
      : undefined,
    panels: StudioPanelProjection.project({
      compile: snapshot.compile,
      data: snapshot.data.result,
      feed: snapshot.feed,
      dataError: snapshot.data.error,
      dataLoading: snapshot.data.loading,
      dataSource: cellSource,
      debug: preview?.debug,
      logs: studioPanelLogs(preview?.runtimeLogs ?? [], snapshot.deviceLogs),
      logSource: cellSource,
      search: snapshot.searchResults,
      sourceVersions: studioSourceVersions(snapshot.project, snapshot.projectFiles),
      tab: snapshot.drawerTab,
      testError: snapshot.tests.error,
      testStatus: snapshot.tests.status,
      testWatch: snapshot.tests.watch,
    }),
    selectedRender,
  })
}
