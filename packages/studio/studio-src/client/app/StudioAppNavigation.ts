import { Assert } from '@shared/core'
import { EditorView } from 'codemirror'
import type { StudioDeviceStatus } from '../../device/StudioDeviceStatus'
import type { StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import type { StudioTestFailure } from '../../StudioTestRunner'
import type { StudioCompileDiagnostic, StudioFile } from '../StudioApiClient'
import {
  projectRelativePath,
  StudioDefinitionNavigation,
  StudioDiagnosticNavigation,
  StudioSourceNavigation,
} from '../StudioEditor'
import type { StudioActivePreview, StudioPreviewConnection } from '../StudioMatrixView'
import type { StudioScreenItem, StudioSearchResult } from '../StudioRailPanels'
import type { StudioOpenFile } from './StudioEditorSession'

export type StudioAppNavigationDeps = Readonly<{
  activePreview: StudioActivePreview
  focusEditor: () => void
  openFile: (path: string) => Promise<StudioOpenFile | undefined>
  previewManifest: () => StudioPreviewManifestV2 | undefined
  previews: readonly StudioPreviewConnection[]
  project: string
  projectFiles: () => readonly StudioFile[]
  /** A stale search result asks for the search to run again at once. */
  refreshSearch: () => void
  status: HTMLElement
}>

/** Every way into a source location: diagnostics, screens, search hits, test failures, device taps. */
export class StudioAppNavigation {
  readonly #deps: StudioAppNavigationDeps
  #lastDeviceSelection = 0

  constructor(deps: StudioAppNavigationDeps) {
    this.#deps = deps
  }

  async openCompileDiagnostic(diagnostic: StudioCompileDiagnostic): Promise<void> {
    if (diagnostic.filePath === undefined) {
      return
    }
    const path = projectRelativePath(this.#deps.project, diagnostic.filePath)
    if (path === undefined) {
      return
    }
    const opened = await this.#deps.openFile(path)
    if (opened === undefined || diagnostic.range === undefined) {
      return
    }
    this.#reveal(opened.editor, StudioDiagnosticNavigation.selection(opened.editor.state.doc, diagnostic.range))
  }

  async openScreen(item: StudioScreenItem): Promise<void> {
    const scenarioIds = new Set(
      (this.#deps.previewManifest()?.scenarios ?? []).filter(scenario => scenario.subjectId === item.id)
        .map(scenario => scenario.scenarioId),
    )
    const preview = this.#deps.previews.find(candidate =>
      candidate.cell !== undefined && scenarioIds.has(candidate.cell.scenarioId)
    )
    if (preview !== undefined) {
      this.#deps.activePreview.activate(preview)
      preview.frame?.scrollIntoView({ block: 'center' })
    }
    const path = this.#relativePath(item.path)
    const opened = await this.#deps.openFile(path)
    if (opened === undefined) {
      return
    }
    this.#reveal(opened.editor, StudioDefinitionNavigation.selection(opened.editor.state.doc, item.start))
  }

  async openSource(path: string, sourceVersion: string, start: number): Promise<void> {
    const relativePath = this.#relativePath(path)
    const current = this.#deps.projectFiles().find(file => file.path === relativePath)
    Assert.input(current, `Tao Studio source is no longer available: ${relativePath}`)
    Assert.input(
      current.sourceVersion === sourceVersion,
      `Tao Studio source location is stale; reopen ${relativePath} after the current compile.`,
    )
    const opened = await this.#deps.openFile(relativePath)
    if (opened === undefined) {
      return
    }
    this.#reveal(opened.editor, StudioDefinitionNavigation.selection(opened.editor.state.doc, start))
  }

  async openSearchResult(result: StudioSearchResult): Promise<void> {
    const path = this.#relativePath(result.path)
    const current = this.#deps.projectFiles().find(file => file.path === path)
    if (result.sourceVersion !== undefined && current?.sourceVersion !== result.sourceVersion) {
      this.#deps.status.dataset['state'] = 'error'
      this.#deps.status.textContent = 'This search result is stale; refreshing project search.'
      this.#deps.refreshSearch()
      return
    }
    const opened = await this.#deps.openFile(path)
    if (opened === undefined) {
      return
    }
    const selection = result.kind === 'diagnostic' && result.range !== undefined
      ? StudioDiagnosticNavigation.selection(opened.editor.state.doc, result.range)
      : {
        anchor: Math.min(result.start ?? 0, opened.editor.state.doc.length),
        head: Math.min(result.end ?? result.start ?? 0, opened.editor.state.doc.length),
      }
    this.#reveal(opened.editor, selection)
  }

  async openTestFailure(failure: StudioTestFailure): Promise<void> {
    const path = this.#relativePath(failure.filePath)
    const opened = await this.#deps.openFile(path)
    if (opened === undefined || failure.line === undefined) {
      return
    }
    const line = opened.editor.state.doc.line(Math.min(failure.line, opened.editor.state.doc.lines))
    const position = Math.min(line.to, line.from + Math.max(0, (failure.column ?? 1) - 1))
    this.#reveal(opened.editor, { anchor: position })
  }

  /**
   * Opens what a person tapped on the phone.
   *
   * The status snapshot is re-sent whenever anything about the connection changes, so acting on
   * every one of them would yank the editor around while someone is typing; the sequence advances
   * only on a real tap. `openAndSelect` does the rest of the refusing — a device running an older
   * bundle carries an older `sourceVersion`, and selecting its range in newer text would land on
   * whatever now occupies those offsets.
   */
  async revealDeviceSelection(selection: StudioDeviceStatus['selection']): Promise<void> {
    if (selection === undefined || selection.sequence <= this.#lastDeviceSelection) {
      return
    }
    this.#lastDeviceSelection = selection.sequence
    const opened = await StudioSourceNavigation.openAndSelect({
      identity: { path: selection.sourcePath, sourceVersion: selection.sourceVersion },
      openFile: async path => await this.#deps.openFile(path),
      project: this.#deps.project,
      range: { end: selection.end, start: selection.start },
    })
    if (opened === undefined) {
      this.#deps.status.dataset['state'] = 'error'
      this.#deps.status.textContent =
        `The device selected ${selection.sourcePath}, which has changed on the Mac since the device loaded it.`
    }
  }

  #relativePath(path: string): string {
    return projectRelativePath(this.#deps.project, path) ?? path
  }

  /** Scrolls the model editor to the selection; the visible editor mirrors it and takes focus. */
  #reveal(editor: EditorView, selection: Readonly<{ anchor: number; head?: number }>): void {
    editor.dispatch({
      effects: EditorView.scrollIntoView(selection.anchor, { y: 'center' }),
      selection,
    })
    this.#deps.focusEditor()
  }
}
