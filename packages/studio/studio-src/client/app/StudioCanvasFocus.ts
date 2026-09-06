import { StudioMatrixView, type StudioPreviewConnection } from '../StudioMatrixView'

export type StudioCanvasFocusRect = Readonly<{ height: number; width: number; x: number; y: number }>

export type StudioCanvasFocusDeps = Readonly<{
  button: HTMLButtonElement
  /** The measured rectangle of that view's root render, when the selecting cell reported one. */
  ownerFrame: (view: string) => StudioCanvasFocusRect | undefined
  onError: (error: unknown) => void
  preview: HTMLElement
  previews: () => readonly StudioPreviewConnection[]
  /** The view owning the selected element, when the inspector has one. */
  selectedOwner: () => string | undefined
  status: HTMLElement
}>

/**
 * Canvas mode: the selected element's owning view is shown alone when the project already renders
 * that view in a focused scenario group, and every edit then lands in that one definition.
 */
export function mountStudioCanvasFocus(deps: StudioCanvasFocusDeps): Readonly<{ update: () => void }> {
  const { button, preview } = deps

  function focusableView(): string | undefined {
    const owner = deps.selectedOwner()
    if (owner === undefined) {
      return undefined
    }
    const escaped = owner.replace(/"/g, '\\"')
    return preview.querySelector(`[data-tao-studio-group-view="${escaped}"]`) === null ? undefined : owner
  }

  function update(): void {
    const focused = StudioMatrixView.focusedView(preview)
    const candidate = focusableView()
    if (focused !== undefined) {
      button.hidden = false
      button.textContent = 'Back to app'
      button.dataset['state'] = 'focused'
      return
    }
    delete button.dataset['state']
    button.hidden = candidate === undefined
    button.textContent = candidate === undefined ? 'Focus view' : `Focus ${candidate}`
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
  async function frameCells(candidate: string): Promise<void> {
    const rect = deps.ownerFrame(candidate)
    const escaped = candidate.replace(/"/g, '\\"')
    const row = preview.querySelector(`[data-tao-studio-group-view="${escaped}"]`)
    if (rect === undefined || row === null || rect.width < 1 || rect.height < 1) {
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
      framedViewports.set(connection, cell.environment.viewport)
      await connection.reconfigureEnvironment({ ...cell.environment, viewport })
    }
  }
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
    StudioMatrixView.focusView(preview, undefined, leave)
    update()
    void unframeCells().catch(deps.onError)
  }

  button.addEventListener('click', () => {
    if (StudioMatrixView.focusedView(preview) !== undefined) {
      leave()
      return
    }
    const candidate = focusableView()
    if (candidate === undefined) {
      deps.status.dataset['state'] = 'error'
      deps.status.textContent = 'Select an element whose view has a focused scenario group before entering canvas mode.'
      return
    }
    StudioMatrixView.focusView(preview, candidate, leave)
    update()
    void frameCells(candidate).catch(deps.onError)
  })
  return { update }
}
