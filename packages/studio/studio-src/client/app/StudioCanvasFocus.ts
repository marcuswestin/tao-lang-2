import { StudioMatrixView, type StudioPreviewConnection } from '../StudioMatrixView'

type StudioCanvasFocusRect = Readonly<{ height: number; width: number; x: number; y: number }>

export type StudioCanvasFocusDeps = Readonly<{
  button: HTMLButtonElement
  /** The measured rectangle of that view's root render, when the selecting cell reported one. */
  ownerFrame: (viewId: string) => StudioCanvasFocusRect | undefined
  onError: (error: unknown) => void
  preview: HTMLElement
  previews: () => readonly StudioPreviewConnection[]
  /** The view owning the selected element, when the inspector has one. */
  selectedOwner: () => Readonly<{ id: string; name: string }> | undefined
  status: HTMLElement
  /** Test seam for keyed matrix state; production uses StudioMatrixView. */
  matrix?: Pick<typeof StudioMatrixView, 'focusedView' | 'focusView'>
}>

/** Serial mutation lane for persistent cell viewport overrides. */
export class StudioCanvasFocusLane {
  #tail = Promise.resolve()
  readonly #onError: (error: unknown) => void

  constructor(onError: (error: unknown) => void) {
    this.#onError = onError
  }

  enqueue(operation: () => Promise<void>): void {
    this.#tail = this.#tail.then(operation).catch(this.#onError)
  }

  async settled(): Promise<void> {
    await this.#tail
  }
}

/**
 * Canvas mode: the selected element's owning view is shown alone when the project already renders
 * that view in a focused scenario group, and every edit then lands in that one definition.
 */
export function mountStudioCanvasFocus(
  deps: StudioCanvasFocusDeps,
): Readonly<{ dispose: () => void; update: () => void }> {
  const { button, preview } = deps
  const matrix = deps.matrix ?? StudioMatrixView

  function group(viewId: string): HTMLElement | undefined {
    return [...preview.querySelectorAll<HTMLElement>('[data-tao-studio-group-view-id]')]
      .find(candidate => candidate.dataset['taoStudioGroupViewId'] === viewId)
  }

  function focusableView(): Readonly<{ id: string; name: string }> | undefined {
    const owner = deps.selectedOwner()
    if (owner === undefined) {
      return undefined
    }
    return group(owner.id) === undefined ? undefined : owner
  }

  function update(): void {
    const focused = matrix.focusedView(preview)
    const candidate = focusableView()
    if (focused !== undefined) {
      button.hidden = false
      button.textContent = 'Back to app'
      button.dataset['state'] = 'focused'
      // Focus can be entered before the owning cell has reported its rectangle, and the first
      // reframe then has no size to apply. Every later inspection retries it, so a focused view is
      // never left at the device size once a measurement exists.
      if (framedViewports.size === 0 && deps.ownerFrame(focused) !== undefined) {
        lane.enqueue(async () => await frameCells({ id: focused, name: focused }))
      }
      return
    }
    delete button.dataset['state']
    button.hidden = candidate === undefined
    button.textContent = candidate === undefined ? 'Focus view' : `Focus ${candidate.name}`
  }

  /**
   * A focused view is framed at the size its occurrence had in the app, not at the device size: the
   * cells of its group take the owner's measured rectangle as a custom viewport while focus lasts,
   * and get their scenario viewport back on the way out.
   */
  const framedViewports = new Map<
    StudioPreviewConnection,
    NonNullable<StudioPreviewConnection['cell']>['environment']['viewport']
  >()
  async function frameCells(candidate: Readonly<{ id: string; name: string }>): Promise<void> {
    const rect = deps.ownerFrame(candidate.id)
    const row = group(candidate.id)
    // Already framed: a retry queued while the first attempt was still in flight has nothing to do.
    if (framedViewports.size > 0 || rect === undefined || row === undefined || rect.width < 1 || rect.height < 1) {
      return
    }
    const viewport = { height: Math.ceil(rect.height), width: Math.ceil(rect.width) }
    for (const connection of deps.previews()) {
      const cell = connection.cell
      if (
        cell === undefined
        || connection.reconfigureEnvironment === undefined
        || !row.contains(connection.frame ?? null)
      ) {
        continue
      }
      await connection.reconfigureEnvironment({ ...cell.environment, viewport })
      // Record only successful reframes. A queued leave restores every recorded cell even when a
      // later cell rejects, and the lane prevents that restore from racing this request.
      framedViewports.set(connection, cell.environment.viewport)
    }
  }

  // Reconfiguration persists on the server. Serialize enter/leave so Back cannot restore first and
  // then be overwritten by an older enter completion.
  let disposed = false
  const lane = new StudioCanvasFocusLane(error => {
    if (!disposed) {
      deps.onError(error)
    }
  })
  async function unframeCells(): Promise<void> {
    const framed = [...framedViewports]
    framedViewports.clear()
    for (const [connection, viewport] of framed) {
      if (connection.cell !== undefined && connection.reconfigureEnvironment !== undefined) {
        await connection.reconfigureEnvironment({ ...connection.cell.environment, viewport })
      }
    }
  }

  function leave(): void {
    matrix.focusView(preview, undefined, leave)
    update()
    lane.enqueue(unframeCells)
  }

  const onClick = (): void => {
    if (matrix.focusedView(preview) !== undefined) {
      leave()
      return
    }
    const candidate = focusableView()
    if (candidate === undefined) {
      deps.status.dataset['state'] = 'error'
      deps.status.textContent = 'Select an element whose view has a focused scenario group before entering canvas mode.'
      return
    }
    matrix.focusView(preview, candidate.id, leave)
    update()
    lane.enqueue(async () => await frameCells(candidate))
  }
  button.addEventListener('click', onClick)
  return {
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      button.removeEventListener('click', onClick)
      lane.enqueue(unframeCells)
    },
    update,
  }
}
