/**
 * StudioMatrixView composes the preview matrix out of the modules under `./matrix/`: the pure layout,
 * the keyed grid host, the sketch boards mounted into it, one connection per cell iframe, the cell
 * view and its controls, and the message bridge between the previews and the app. The app imports
 * everything preview-related from here, so the composition is also the one public surface.
 */
import { StudioMatrixGrid } from './matrix/StudioMatrixGrid'
import type { StudioMatrixGroup } from './matrix/StudioMatrixLayout'
import { StudioMatrixSketches } from './matrix/StudioMatrixSketches'

export {
  canvasScale,
  mountCanvasViewport,
  type StudioCanvasViewportControls,
  type StudioCanvasViewportState,
} from './matrix/StudioCanvasViewport'
export { StudioFixtureGenerationFeedback, StudioFixtureProposal } from './matrix/StudioFixtureActions'
export {
  awaitPreviewJourneyRecordingAcknowledgement,
  StudioJourneyRecorder,
} from './matrix/StudioJourneyRecording'
export { previewMatrixPlan, StudioMatrixLayout } from './matrix/StudioMatrixLayout'
export {
  applySketchSnapWith,
  StudioSketchMutationLane,
  type StudioSketchSnapApi,
  StudioSketchSnapRequests,
} from './matrix/StudioMatrixSketches'
export {
  configureInteractionMode,
  currentSourceIdentity,
  handlePreviewMessage,
  postEditorSelection,
  requestRuntimeCapture,
} from './matrix/StudioPreviewBridge'
export {
  disconnectPreviews,
  StudioActivePreview,
  type StudioPreviewConnection,
  StudioPreviewFrameUrl,
  StudioPreviewSourceSync,
  StudioPreviewSuspension,
  StudioRetainedPreview,
} from './matrix/StudioPreviewConnection'
export { connectPreviews, refreshCellPreviews } from './matrix/StudioPreviewMatrix'
export { previewBundleNoticeFor, previewNoticeFor, studioPreviewNotice } from './matrix/StudioPreviewNotice'
export { StudioReviewDom } from './matrix/StudioReviewDom'
export {
  runtimeCaptureWithEnvironment,
  studioReplayConfiguration,
  StudioRuntimeData,
  type StudioRuntimeDataTable,
  type StudioRuntimeLog,
} from './matrix/StudioRuntimeCapture'

/** Keyed DOM host for scenario-group rows and their left-to-right preview cells. */
export const StudioMatrixView = {
  render<Item>(
    parent: HTMLElement,
    groups: readonly StudioMatrixGroup<Item>[],
    render: (frame: HTMLElement, item: Item) => void,
  ): void {
    StudioMatrixGrid.reconcile(parent, groups, render)
  },
  reconcile: StudioMatrixGrid.reconcile,
  renderSketches: StudioMatrixSketches.render,
  /** focusView enters or leaves canvas mode for one view; `exit` runs when the bar's Back is pressed. */
  focusView: StudioMatrixGrid.focusView,
  /** focusedView reports the view canvas mode currently shows alone, if any. */
  focusedView: StudioMatrixGrid.focusedView,
} as const
