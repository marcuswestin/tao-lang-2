import { Assert, Errors } from '@shared/core'
import { EditorView } from 'codemirror'
import type { StudioDraftFile } from '../../StudioDraftSync'
import type { StudioRuntimeCaptureArtifact } from '../../StudioProtocol'
import type { StudioHandshake } from '../StudioApiClient'
import { projectRelativePath } from '../StudioEditor'
import type { StudioPreviewConnection } from './StudioPreviewConnection'

export type StudioOpenFile = {
  editor: EditorView
  file: StudioDraftFile
}

/** Puts a runtime failure's message and its source shortcut above the cell viewport it stopped. */
export function showRuntimeFailure(
  preview: StudioPreviewConnection,
  capture: StudioRuntimeCaptureArtifact,
  openSource: () => Promise<void>,
): void {
  const frame = preview.frame
  const failure = capture.failure
  if (frame === undefined || failure === undefined) {
    return
  }
  const panel = document.createElement('section')
  panel.className = 'studio-preview-runtime-failure'
  panel.setAttribute('role', 'alert')
  const heading = document.createElement('strong')
  heading.textContent = failure.stopper ? 'Stopped repeated crash' : 'Runtime failure'
  const message = document.createElement('span')
  message.textContent = failure.error.message
  const context = document.createElement('span')
  context.className = 'studio-preview-runtime-failure-context'
  context.textContent = [failure.frame.boundary, failure.frame.declaration].filter(Boolean).join(' · ')
  const actions = document.createElement('div')
  actions.className = 'studio-preview-runtime-failure-actions'
  const source = document.createElement('button')
  source.textContent = 'Open failing source'
  source.disabled = failure.frame.source === undefined
  const status = document.createElement('span')
  status.setAttribute('role', 'status')
  source.addEventListener('click', () => {
    source.disabled = true
    void openSource().catch(error => {
      source.disabled = false
      status.dataset['state'] = 'error'
      status.textContent = Errors.messageOf(error)
    })
  })
  actions.append(source, status)
  panel.append(heading, message, context, actions)
  const current = frame.querySelector(':scope > .studio-preview-runtime-failure')
  current?.remove()
  const viewport = frame.querySelector(':scope > .studio-preview-cell-viewport')
  frame.insertBefore(panel, viewport)
}

export async function openRuntimeFailureSource(
  capture: StudioRuntimeCaptureArtifact,
  handshake: StudioHandshake,
  openFile: (path: string) => Promise<StudioOpenFile | undefined>,
): Promise<void> {
  const source = capture.failure?.frame.source
  Assert.input(source, 'This runtime failure has no Tao source frame.')
  const path = projectRelativePath(handshake.identity.project, source.path)
    ?? (handshake.files.some(file => file.path === source.path) ? source.path : undefined)
  Assert.input(path, 'The failing source is outside this Studio project.')
  const opened = await openFile(path)
  Assert.input(opened, `Could not open ${path}.`)
  const end = Math.min(source.end, opened.editor.state.doc.length)
  const start = Math.min(source.start, end)
  opened.editor.dispatch({
    effects: EditorView.scrollIntoView(start, { y: 'center' }),
    selection: { anchor: start, head: end },
  })
  opened.editor.focus()
}
