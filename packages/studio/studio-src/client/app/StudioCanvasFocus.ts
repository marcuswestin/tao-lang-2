import { StudioMatrixView } from '../StudioMatrixView'

export type StudioCanvasFocusDeps = Readonly<{
  button: HTMLButtonElement
  preview: HTMLElement
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

  function leave(): void {
    StudioMatrixView.focusView(preview, undefined, leave)
    update()
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
  })
  return { update }
}
