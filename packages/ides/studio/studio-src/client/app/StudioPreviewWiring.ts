import { Assert, Errors } from '@shared/core'
import type {
  StudioPreviewCanvasGestureMessage,
  StudioPreviewCanvasPanKeyMessage,
  StudioPreviewCanvasShortcutMessage,
  StudioPreviewFeedDropMessage,
} from '../../StudioProtocol'
import type { StudioHandshake } from '../StudioApiClient'
import {
  currentSourceIdentity,
  handlePreviewMessage,
  postCanvasGestureOwnership,
  postEditorSelection,
  type StudioActivePreview,
  type StudioCanvasViewportControls,
  type StudioPreviewConnection,
  StudioPreviewSourceSync,
} from '../StudioMatrixView'
import { studioPaletteMime, StudioPaletteTransfer } from '../StudioVisualEditing'
import type { StudioDrawerPanels } from './StudioDrawerPanels'
import type { StudioEditorSession } from './StudioEditorSession'
import type { StudioInspection } from './StudioInspection'
import type { StudioSourceMutations } from './StudioSourceMutations'

export type StudioPreviewWiringDeps = Readonly<{
  activePreview: StudioActivePreview
  canvasGesturesOwned: () => boolean
  drawer: StudioDrawerPanels
  handshake: StudioHandshake
  inspection: StudioInspection
  mutations: StudioSourceMutations
  onReveal: () => void
  preview: HTMLElement
  previews: readonly StudioPreviewConnection[]
  publish: () => void
  session: StudioEditorSession
  status: HTMLElement
  onCanvasGesture?: (preview: StudioPreviewConnection, gesture: StudioPreviewCanvasGestureMessage) => void
  onCanvasPanKey?: (preview: StudioPreviewConnection, message: StudioPreviewCanvasPanKeyMessage) => void
  onCanvasShortcut?: (command: StudioPreviewCanvasShortcutMessage['command'], iframe: HTMLIFrameElement) => void
  onFeedDrop?: (message: StudioPreviewFeedDropMessage) => Promise<void>
}>

/**
 * How the previews talk to the app: source-identity sync and mutation callbacks on each connection,
 * the active-cell follow-through, and palette drops onto the canvas. Returns the wiring so the
 * active-preview set can re-run it after a manifest replaces connections.
 */
export function wireStudioPreviews(deps: StudioPreviewWiringDeps): (preview: StudioPreviewConnection) => void {
  const { activePreview, drawer, handshake, inspection, mutations, session } = deps

  const postActiveSelection = (preview: StudioPreviewConnection): void => {
    const active = session.active()
    if (active !== undefined) {
      postEditorSelection(preview, handshake, active.file, active.editor)
    }
  }

  const wirePreview = (preview: StudioPreviewConnection): void => {
    StudioPreviewSourceSync.connect(preview, () => {
      postCanvasGestureOwnership(preview, handshake, deps.canvasGesturesOwned())
      if (preview === activePreview.current()) {
        postActiveSelection(preview)
      }
    })
    preview.applySourceAction = async envelope => {
      Assert.input(!mutations.busy(), 'Wait for the current Studio source action to finish.')
      Assert.input(
        session.requireActiveDraftSaved(),
        'Save the active draft before changing Tao source through Studio.',
      )
      await mutations.apply(envelope)
    }
    preview.changed = () => {
      if (preview === activePreview.current()) {
        deps.publish()
        inspection.render()
        if (drawer.dataPanelVisible()) {
          void drawer.loadData()
        } else {
          drawer.renderIfLogs()
        }
      }
    }
  }

  activePreview.subscribe(() => {
    drawer.resetData()
    const preview = activePreview.current()
    if (preview !== undefined) {
      postActiveSelection(preview)
    }
    deps.publish()
    inspection.render()
    deps.publish()
    drawer.loadDataIfVisible()
  })
  activePreview.reconcile(wirePreview)

  deps.preview.addEventListener('dragover', event => {
    if (event.dataTransfer?.types.includes(studioPaletteMime)) {
      event.preventDefault()
    }
  })
  deps.preview.addEventListener('drop', event => {
    const item = StudioPaletteTransfer.parse(event.dataTransfer?.getData(studioPaletteMime) ?? '')
    const identity = currentSourceIdentity(handshake, activePreview.current(), session.activeFile())
    if (item === undefined) {
      deps.status.dataset['state'] = 'error'
      deps.status.textContent = 'Studio could not read the dropped palette item.'
      return
    }
    event.preventDefault()
    if (identity === undefined) {
      deps.status.dataset['state'] = 'error'
      deps.status.textContent = 'Wait for the active preview before dropping a component.'
      return
    }
    const inspected = inspection.selected()
    if (inspected === undefined) {
      deps.status.dataset['state'] = 'error'
      deps.status.textContent = 'Select a rendered element before dropping a component into the preview.'
      return
    }
    const gap = { beforeId: inspected.renderId }
    void mutations.submitLocal(
      item.kind === 'component'
        ? { ...gap, component: item.component, kind: 'insert-component' }
        : { ...gap, kind: 'insert-project-view', viewName: item.viewName },
      identity,
    )
  })

  return wirePreview
}

/** Keeps the cross-origin gesture anchored to the iframe viewport where its coordinates originated. */
export function forwardPreviewCanvasGesture(
  viewport: Pick<StudioCanvasViewportControls, 'iframeWheel'> | undefined,
  preview: Pick<StudioPreviewConnection, 'iframe'>,
  gesture: StudioPreviewCanvasGestureMessage,
): void {
  viewport?.iframeWheel(gesture, preview.iframe)
}

export type StudioPreviewMessagesDeps =
  & StudioPreviewWiringDeps
  & Readonly<{
    /** Canvas mode follows the selection, so it is re-evaluated after every inspect. */
    onInspected: () => void
  }>

/** One listener owns preview-originated selection so the editor receives one navigation transaction. */
export function studioPreviewMessageListener(deps: StudioPreviewMessagesDeps): (event: MessageEvent) => void {
  const { activePreview, drawer, handshake, inspection, mutations, previews, session } = deps
  return event => {
    const connection = previews.find(candidate => candidate.iframe.contentWindow === event.source)
    if (connection === undefined) {
      return
    }
    void handlePreviewMessage(event, connection, handshake, path => session.openFile(path), {
      activate: () => activePreview.activate(connection),
      applySourceAction: envelope => mutations.submitPreview(envelope),
      canvasGesture: gesture => deps.onCanvasGesture?.(connection, gesture),
      canvasPanKey: message => deps.onCanvasPanKey?.(connection, message),
      canvasShortcut: message => deps.onCanvasShortcut?.(message.command, connection.iframe),
      feedDrop: deps.onFeedDrop,
      changed() {
        drawer.renderIfLogs()
        drawer.loadDataIfVisible()
        connection.changed?.()
      },
      inspect(selection) {
        inspection.select(selection)
        deps.publish()
        deps.onInspected()
        void inspection.inspect(selection)
        void inspection.highlightOnDevice(selection)
      },
      reveal: deps.onReveal,
    }).catch(error => {
      deps.status.dataset['state'] = 'error'
      deps.status.textContent = Errors.messageOf(error)
    })
  }
}

/** The window message bridge from the preview iframes; returns the listener's removal. */
export function connectStudioPreviewMessages(deps: StudioPreviewMessagesDeps): () => void {
  if (deps.previews.length === 0) {
    return () => {}
  }
  const listener = studioPreviewMessageListener(deps)
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
