import { StudioApiClient, StudioApiRoutes, type StudioHandshake } from '../StudioApiClient'
import { type StudioClientView, StudioGlobalLoading } from '../StudioShell'
import { showSourceActionError } from '../StudioVisualEditing'
import { StudioMountSignal } from './StudioMountSignal'
import { StudioProjectContext } from './StudioProjectContext'

export type StudioSessionPickersDeps = Readonly<{
  handshake: StudioHandshake
  /** Refuses a switch with `message` while a tab is unsaved; the status line says so. */
  requireAllTabsSaved: (message: string) => boolean
  signal: AbortSignal | undefined
  view: StudioClientView
}>

/**
 * The toolbar's project and app pickers. Both switch the managed session and navigate the window,
 * so each is enabled only when there is somewhere else to go and every tab is saved.
 */
export async function configureStudioSessionPickers(deps: StudioSessionPickersDeps): Promise<void> {
  const { handshake, view } = deps
  let projectChoices = StudioProjectContext.choices(handshake.identity, [])
  const currentSessionId = StudioApiRoutes.currentSessionId(window.location.pathname)
  if (currentSessionId !== undefined) {
    try {
      const listing = await StudioApiClient.sessions(deps.signal)
      StudioMountSignal.throwIfAborted(deps.signal)
      projectChoices = StudioProjectContext.choices(handshake.identity, listing.recent)
    } catch (error) {
      if (StudioMountSignal.isAbortError(error)) {
        throw error
      }
    }
  }

  async function selectProject(): Promise<void> {
    const selected = projectChoices[Number(view.project.value)]
    if (selected === undefined || selected.project === handshake.identity.project) {
      view.project.value = '0'
      return
    }
    if (!deps.requireAllTabsSaved('Save or revert unsaved files before choosing another project.')) {
      view.project.value = '0'
      return
    }
    view.project.disabled = true
    view.appPicker.disabled = true
    view.status.dataset['state'] = 'compiling'
    view.status.textContent = `Opening ${selected.label}…`
    StudioGlobalLoading.show(
      view.globalLoading,
      `Opening ${selected.label}…`,
      'Please wait while Studio loads the project and prepares its preview.',
    )
    try {
      const transition = await StudioApiClient.switchSession({
        appName: selected.appName,
        projectPath: selected.project,
      })
      window.location.assign(StudioApiRoutes.transitionUrl(transition, new URL(window.location.href)))
    } catch (error) {
      StudioGlobalLoading.hide(view.globalLoading)
      view.project.disabled = projectChoices.length < 2
      view.appPicker.disabled = handshake.apps.length < 2
      view.project.value = '0'
      showSourceActionError(view.status, error)
    }
  }

  async function selectAppVariant(): Promise<void> {
    const selected = handshake.apps[Number(view.appPicker.value)]
    const currentIndex = handshake.apps.findIndex(app =>
      app.appName === handshake.identity.appName && app.entryPath === handshake.entryPath
    )
    if (
      selected === undefined || (
        selected.appName === handshake.identity.appName && selected.entryPath === handshake.entryPath
      )
    ) {
      return
    }
    if (!deps.requireAllTabsSaved('Save or revert unsaved files before switching app variants.')) {
      view.appPicker.value = String(currentIndex)
      return
    }
    view.appPicker.disabled = true
    view.project.disabled = true
    view.status.dataset['state'] = 'compiling'
    view.status.textContent = `Opening ${selected.appName}…`
    StudioGlobalLoading.show(
      view.globalLoading,
      `Switching to ${selected.appName}…`,
      'Please wait while Studio loads the app and prepares its preview.',
    )
    try {
      const transition = await StudioApiClient.switchSession({
        appName: selected.appName,
        entryPath: selected.entryPath,
        projectPath: handshake.identity.project,
      })
      window.location.assign(StudioApiRoutes.transitionUrl(transition, new URL(window.location.href)))
    } catch (error) {
      StudioGlobalLoading.hide(view.globalLoading)
      view.appPicker.disabled = false
      view.project.disabled = projectChoices.length < 2
      view.appPicker.value = String(currentIndex)
      showSourceActionError(view.status, error)
    }
  }

  const currentProject = document.createElement('option')
  currentProject.value = '0'
  currentProject.textContent = projectChoices[0]!.label
  currentProject.selected = true
  const recentProjects = document.createElement('optgroup')
  recentProjects.label = 'Recent projects'
  recentProjects.append(
    ...projectChoices.slice(1).map((project, index) => {
      const option = document.createElement('option')
      option.value = String(index + 1)
      option.textContent = project.label
      return option
    }),
  )
  view.project.replaceChildren(currentProject, ...projectChoices.length > 1 ? [recentProjects] : [])
  view.project.disabled = currentSessionId === undefined || projectChoices.length < 2
  view.project.title = currentSessionId === undefined
    ? 'Project selection requires a managed Studio window.'
    : projectChoices.length < 2
    ? 'No other recent projects'
    : 'Recent projects'
  view.project.addEventListener('change', () => void selectProject())

  const duplicateNames = new Set(
    handshake.apps.filter((app, index) =>
      handshake.apps.some((candidate, candidateIndex) => candidateIndex !== index && candidate.appName === app.appName)
    ).map(app => app.appName),
  )
  view.appPicker.replaceChildren(...handshake.apps.map((app, index) => {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = duplicateNames.has(app.appName)
      ? `app ${app.appName} — ${app.entryPath}`
      : `app ${app.appName}`
    option.selected = app.appName === handshake.identity.appName && app.entryPath === handshake.entryPath
    return option
  }))
  view.appPicker.disabled = currentSessionId === undefined || handshake.apps.length < 2
  view.appPicker.addEventListener('change', () => void selectAppVariant())
}
