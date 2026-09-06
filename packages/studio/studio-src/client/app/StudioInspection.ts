import type { StudioRenderInspection } from '@source-actions'
import type { StudioInspectorSelection } from '../../StudioInspector'
import { StudioApiClient } from '../StudioApiClient'
import { projectRelativePath } from '../StudioEditor'
import { showOpenFile, type StudioClientView } from '../StudioShell'
import { showSourceActionError } from '../StudioVisualEditing'
import type { StudioActiveEditor } from './StudioEditorSession'

export type StudioInspectionDeps = Readonly<{
  active: () => StudioActiveEditor | undefined
  project: string
  publish: () => void
  view: StudioClientView
}>

/**
 * The element selected in a preview and what the server says about its render. The Tao product host
 * portals React trees into the inspector containers, so the shell never fills them: publishing state
 * and naming the selection in the breadcrumb is the whole job.
 */
export class StudioInspection {
  readonly #deps: StudioInspectionDeps
  #inspection: StudioRenderInspection | undefined
  #requestRevision = 0
  #selected: StudioInspectorSelection | undefined

  constructor(deps: StudioInspectionDeps) {
    this.#deps = deps
  }

  inspection(): StudioRenderInspection | undefined {
    return this.#inspection
  }

  selected(): StudioInspectorSelection | undefined {
    return this.#selected
  }

  /** The view owning the selected element, when the render reports one. */
  selectedOwner(): string | undefined {
    return this.#selected?.identity.occurrence?.renderOwner
  }

  select(selection: StudioInspectorSelection): void {
    this.#selected = selection
  }

  /** A source mutation invalidates the selection: render ids do not survive a recompile. */
  clear(): void {
    this.#selected = undefined
    this.#inspection = undefined
  }

  render(): void {
    this.#deps.publish()
    const activePath = this.#deps.active()?.path
    if (activePath !== undefined) {
      showOpenFile(this.#deps.view, activePath, this.#breadcrumbTrail(activePath))
    }
  }

  async inspect(selection: StudioInspectorSelection): Promise<void> {
    const revision = ++this.#requestRevision
    this.#inspection = undefined
    this.render()
    const path = projectRelativePath(this.#deps.project, selection.identity.path) ?? selection.identity.path
    try {
      const result = await StudioApiClient.inspectRender({
        path,
        renderId: selection.renderId,
        sourceVersion: selection.identity.sourceVersion,
      })
      if (revision === this.#requestRevision && this.#selected?.renderId === selection.renderId) {
        this.#inspection = result
        this.render()
      }
    } catch (error) {
      if (revision === this.#requestRevision) {
        showSourceActionError(this.#deps.view.status, error)
      }
    }
  }

  /**
   * Selecting an element in the preview selects its source in the editor, the other half of
   * "click both ways". The model tab publishes the selection and the visible editor scrolls to it;
   * a preview built from older source is left alone because its ranges no longer line up.
   */
  selectSourceInEditor(selection: StudioInspectorSelection): void {
    const active = this.#deps.active()
    if (active === undefined) {
      return
    }
    const path = projectRelativePath(this.#deps.project, selection.identity.path) ?? selection.identity.path
    if (path !== active.file.path || selection.identity.sourceVersion !== active.file.sourceVersion) {
      return
    }
    const length = active.editor.state.doc.length
    if (selection.range.start > length || selection.range.end > length) {
      return
    }
    active.editor.dispatch({ selection: { anchor: selection.range.start, head: selection.range.end } })
  }

  /**
   * Outlines on the phone what was just selected in the browser canvas — the other half of
   * selecting both ways. It is best-effort: with no device connected the gateway answers that
   * nothing was delivered, and a failure here must never interrupt selecting on the Mac.
   */
  async highlightOnDevice(selection: StudioInspectorSelection): Promise<void> {
    try {
      await StudioApiClient.deviceHighlight({
        occurrence: {
          end: selection.range.end,
          ...(selection.identity.occurrence?.renderOwner === undefined
            ? {}
            : { ownerName: selection.identity.occurrence.renderOwner }),
          sourcePath: selection.identity.path,
          sourceVersion: selection.identity.sourceVersion,
          start: selection.range.start,
        },
      })
    } catch {
      // A device that is not connected is the normal case, not an error worth showing.
    }
  }

  /** The breadcrumb names what is selected in the active file: the owning view, then the element. */
  #breadcrumbTrail(activePath: string): readonly string[] {
    if (this.#selected === undefined) {
      return []
    }
    const path = projectRelativePath(this.#deps.project, this.#selected.identity.path) ?? this.#selected.identity.path
    if (path !== activePath) {
      return []
    }
    const owner = this.#selected.identity.occurrence?.renderOwner
    const element = this.#inspection?.renderId === this.#selected.renderId ? this.#inspection.elementName : undefined
    return [...(owner === undefined ? [] : [`view ${owner}`]), ...(element === undefined ? [] : [element])]
  }
}
