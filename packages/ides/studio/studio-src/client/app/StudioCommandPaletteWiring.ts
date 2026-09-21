import { Switch } from '@shared/core'
import { StudioInspector, type studioPaletteComponents } from '../../StudioInspector'
import type { StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import type { StudioFile } from '../StudioApiClient'
import { projectRelativePath } from '../StudioEditor'
import { revealCanvasNode, type StudioActivePreview, type StudioPreviewConnection } from '../StudioMatrixView'
import {
  renderCommandResults,
  type StudioCommandItem,
  StudioCommandPalette,
  type StudioCommandTarget,
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

/** ⌘K on a Mac, Ctrl+K elsewhere: the one chord that opens and closes the palette. */
export function isStudioCommandPaletteShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'key' | 'metaKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k'
}

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
    Switch.kind<StudioCommandTarget, void>(item.target, {
      command: ({ command }) =>
        Switch(command, {
          compile: () => deps.selectDrawer('Compile'),
          data: () => deps.selectDrawer('Data'),
          problems: () => deps.selectDrawer('Problems'),
          reload: () => view.reload.click(),
          'toggle-mode': () => view.interactionMode.click(),
        }),
      file: ({ path }) => void deps.openFile(path),
      'insert-component': ({ component }) => deps.insertComponent(component),
      'insert-view': inserted => deps.insertProjectView(inserted.view),
      scenario: ({ scenarioId }) => {
        const preview = deps.previews.find(candidate => candidate.cell?.scenarioId === scenarioId)
        if (preview !== undefined) {
          deps.activePreview.activate(preview)
          deps.onScenarioActivated()
          revealCanvasNode(preview.frame)
          preview.iframe.focus()
        }
      },
      view: viewed => {
        const path = projectRelativePath(deps.project, viewed.path)
        if (path !== undefined) {
          void deps.openFile(path)
        }
      },
    })
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
