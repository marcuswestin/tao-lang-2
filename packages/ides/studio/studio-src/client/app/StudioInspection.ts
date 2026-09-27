import type { StudioRenderInspection } from '@source-actions'
import type { StudioInspectorSelection } from '../../StudioInspector'
import type { StudioInspectRenderRequest } from '../../StudioProtocol'
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

export function studioInspectionRequest(
  project: string,
  selection: StudioInspectorSelection,
): StudioInspectRenderRequest {
  return {
    identity: selection.identity,
    path: projectRelativePath(project, selection.identity.path) ?? selection.identity.path,
    renderId: selection.renderId,
    sourceVersion: selection.identity.sourceVersion,
  }
}

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
  /** Every selected element, in the order they were added; the selection is always the last. */
  #group: StudioInspectorSelection[] = []

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

  /** Canonical owner identity matches the compiler's Studio scenario subject id. */
  selectedOwnerIdentity(): Readonly<{ id: string; name: string }> | undefined {
    const selected = this.#selected
    const name = selected?.identity.occurrence?.renderOwner
    return selected === undefined || name === undefined ? undefined : { id: `${selected.identity.path}#${name}`, name }
  }

  /** The selected elements, which the preview keeps to one file; a single selection is a group of one. */
  selectedGroup(): readonly StudioInspectorSelection[] {
    return this.#group
  }

  /**
   * An additive selection toggles membership: a new element joins, a member leaves unless it is the
   * last one. The preview applies the same rule to its outlines. A plain selection starts over.
   */
  select(selection: StudioInspectorSelection, additive = false): void {
    const current = this.#selected
    if (!additive || current === undefined || current.identity.path !== selection.identity.path) {
      this.#group = [selection]
    } else if (this.#group.some(member => member.renderId === selection.renderId)) {
      if (this.#group.length > 1) {
        this.#group = this.#group.filter(member => member.renderId !== selection.renderId)
      }
    } else {
      this.#group = [...this.#group, selection]
    }
    this.#selected = this.#group.at(-1)
  }

  /** A source mutation invalidates the selection: render ids do not survive a recompile. */
  clear(): void {
    this.#group = []
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
    try {
      const result = await StudioApiClient.inspectRender(studioInspectionRequest(this.#deps.project, selection))
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
