import { StudioApiClient } from '../StudioApiClient'
import type { StudioClientView } from '../StudioShell'
import { showSourceActionError } from '../StudioVisualEditing'

export type StudioBetaShipDeps = Readonly<{
  appName: string
  requireAllTabsSaved: (message: string) => boolean
  view: StudioClientView
}>

export type StudioBetaShipHandle = Readonly<{
  /** A ship in flight keeps the window from unloading. */
  active: () => boolean
  dispose: () => void
}>

/** The Beta Ship button: one ship at a time, behind an overlay, from saved files only. */
export function mountStudioBetaShip(deps: StudioBetaShipDeps): StudioBetaShipHandle {
  const { view } = deps
  let active = false
  const listener = (): void => {
    if (active || !deps.requireAllTabsSaved('Save or revert unsaved files before beta shipping.')) {
      return
    }
    active = true
    view.betaShip.disabled = true
    view.shipOverlay.hidden = false
    view.shipOverlay.setAttribute('aria-busy', 'true')
    const heading = view.shipOverlay.querySelector<HTMLElement>('strong')
    if (heading !== null) {
      heading.textContent = `Beta shipping ${deps.appName}…`
    }
    view.status.dataset['state'] = 'compiling'
    view.status.textContent = `Beta shipping ${deps.appName}…`
    void StudioApiClient.betaShip().then(result => {
      view.status.dataset['state'] = 'compiled'
      view.status.textContent = result.message
    }).catch(error => {
      showSourceActionError(view.status, error)
    }).finally(() => {
      active = false
      view.betaShip.disabled = false
      view.shipOverlay.hidden = true
      view.shipOverlay.removeAttribute('aria-busy')
    })
  }
  view.betaShip.addEventListener('click', listener)
  return {
    active: () => active,
    dispose: () => view.betaShip.removeEventListener('click', listener),
  }
}
