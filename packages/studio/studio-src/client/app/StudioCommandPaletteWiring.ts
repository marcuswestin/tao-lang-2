import { StudioInspector, type studioPaletteComponents } from '../../StudioInspector'
import type { StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import type { StudioFile } from '../StudioApiClient'
import { projectRelativePath } from '../StudioEditor'
import type { StudioActivePreview, StudioPreviewConnection } from '../StudioMatrixView'
import {
  renderCommandResults,
  type StudioCommandItem,
  StudioCommandPalette,
  type StudioDrawerTab,
} from '../StudioProductPanels'
import type { StudioClientView } from '../StudioShell'

export type StudioCommandPaletteDeps = Readonly<{
  activePreview: StudioActivePreview
  insertComponent: (component: (typeof studioPaletteComponents)[number]) => void
  insertProjectView: (projectView: ReturnType<typeof StudioInspector.projectViews>[number]) => void
  /** The drawer follows a scenario the palette activates. */
  onScenarioActivated: () => void
  openFile: (path: string) => Promise<unknown>
  previewManifest: () => StudioPreviewManifestV2 | undefined
  previews: readonly StudioPreviewConnection[]
  project: string
  projectFiles: () => readonly StudioFile[]
  selectDrawer: (tab: StudioDrawerTab) => void
  view: StudioClientView
}>

export type StudioCommandPaletteHandle = Readonly<{
  close: () => void
  /** Re-indexes the palette after the files or the manifest changed. */
  render: () => void
  toggle: () => void
}>

/** The ⌘K palette: files, views, scenarios, insertions, and the toolbar commands by name. */
export function mountStudioCommandPalette(deps: StudioCommandPaletteDeps): StudioCommandPaletteHandle {
  const { view } = deps

  function items(): readonly StudioCommandItem[] {
    const manifest = deps.previewManifest()
    return StudioCommandPalette.items({
      files: deps.projectFiles(),
      manifest,
      projectViews: StudioInspector.projectViews(manifest),
    })
  }

  function render(): void {
    renderCommandResults(
      view.commandResults,
      StudioCommandPalette.filter(items(), view.commandInput.value),
      execute,
    )
  }

  function close(): void {
    view.commandOverlay.hidden = true
  }

  function execute(item: StudioCommandItem): void {
    close()
    const target = item.target
    if (target.kind === 'file') {
      void deps.openFile(target.path)
    } else if (target.kind === 'view') {
      const path = projectRelativePath(deps.project, target.path)
      if (path !== undefined) {
        void deps.openFile(path)
      }
    } else if (target.kind === 'scenario') {
      const preview = deps.previews.find(candidate => candidate.cell?.scenarioId === target.scenarioId)
      if (preview !== undefined) {
        deps.activePreview.activate(preview)
        deps.onScenarioActivated()
        preview.frame?.scrollIntoView({ block: 'center' })
        preview.iframe.focus()
      }
    } else if (target.kind === 'insert-component') {
      deps.insertComponent(target.component)
    } else if (target.kind === 'insert-view') {
      deps.insertProjectView(target.view)
    } else if (target.command === 'reload') {
      view.reload.click()
    } else if (target.command === 'toggle-mode') {
      view.interactionMode.click()
    } else {
      deps.selectDrawer(target.command === 'compile' ? 'Compile' : target.command === 'data' ? 'Data' : 'Problems')
    }
  }

  function toggle(): void {
    view.commandOverlay.hidden = !view.commandOverlay.hidden
    if (!view.commandOverlay.hidden) {
      view.commandInput.value = ''
      render()
      view.commandInput.focus()
    }
  }

  view.commandButton.addEventListener('click', toggle)
  view.commandInput.addEventListener('input', render)
  view.commandInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      view.commandResults.querySelector<HTMLButtonElement>('button')?.click()
    }
  })
  return { close, render, toggle }
}
