import { Assert } from '@shared/core'
import type { StudioHandshake } from '../StudioApiClient'
import {
  currentSourceIdentity,
  handlePreviewMessage,
  postEditorSelection,
  type StudioActivePreview,
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
  drawer: StudioDrawerPanels
  handshake: StudioHandshake
  inspection: StudioInspection
  mutations: StudioSourceMutations
  preview: HTMLElement
  previews: readonly StudioPreviewConnection[]
  publish: () => void
  session: StudioEditorSession
  status: HTMLElement
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

export type StudioPreviewMessagesDeps =
  & StudioPreviewWiringDeps
  & Readonly<{
    /** Canvas mode follows the selection, so it is re-evaluated after every inspect. */
    onInspected: () => void
  }>

/** The window message bridge from the preview iframes; returns the listener's removal. */
export function connectStudioPreviewMessages(deps: StudioPreviewMessagesDeps): () => void {
  const { activePreview, drawer, handshake, inspection, mutations, previews, session } = deps
  if (previews.length === 0) {
    return () => {}
  }
  const listener = (event: MessageEvent): void => {
    const connection = previews.find(candidate => candidate.iframe.contentWindow === event.source)
    if (connection === undefined) {
      return
    }
    void handlePreviewMessage(event, connection, handshake, path => session.openFile(path), {
      activate: () => activePreview.activate(connection),
      applySourceAction: envelope => mutations.submitPreview(envelope),
      changed() {
        drawer.renderIfLogs()
        drawer.loadDataIfVisible()
        connection.changed?.()
      },
      inspect(selection) {
        inspection.select(selection)
        inspection.selectSourceInEditor(selection)
        deps.publish()
        deps.onInspected()
        void inspection.inspect(selection)
        void inspection.highlightOnDevice(selection)
      },
    })
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
