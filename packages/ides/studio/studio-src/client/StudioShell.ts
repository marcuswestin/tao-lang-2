import { Assert } from '@shared/core'
import type { StudioDrawerTab } from './StudioPanelProjection'

export type StudioClientConfig = {
  previewUrl?: string
}

export type StudioClientView = {
  appPicker: HTMLSelectElement
  browser: HTMLButtonElement
  breadcrumbs: HTMLElement
  commandButton: HTMLButtonElement
  commandInput: HTMLInputElement
  commandOverlay: HTMLElement
  commandResults: HTMLElement
  device: HTMLButtonElement
  devicePopover: HTMLElement
  drawerContent: HTMLElement
  drawerTabs: HTMLElement
  editorTabs: HTMLElement
  betaShip: HTMLButtonElement
  globalLoading: HTMLElement
  inspector: HTMLElement
  canvasFocus: HTMLButtonElement
  interactionMode: HTMLButtonElement
  preview: HTMLElement
  project: HTMLSelectElement
  rail: HTMLElement
  reload: HTMLButtonElement
  scenarioInspector: HTMLElement
  searchInput: HTMLInputElement
  shipOverlay: HTMLElement
  status: HTMLElement
  dispose: () => void
}

type PaneName = 'bottom' | 'left' | 'preview' | 'right'

const paneDefaults: Record<PaneName, number> = { bottom: 180, left: 360, preview: 440, right: 440 }

/** The shell's fixed chrome, as the stylesheet lays it out; Design mode sizes the canvas around it. */
const dividerWidth = 4
const editorMinimum = 240

/** The pane operations the rest of the shell drives: the rail reopens the left pane, presets reshape the panes. */
type StudioPaneControls = Readonly<{
  dispose: () => void
  presetLayout: (preset: string | undefined) => void
  showLeft: () => void
}>

/** Which shell elements a collapsed pane hides; `true` hides that element. */
export type StudioPaneVisibility = Readonly<{
  bottom: boolean
  editor: boolean
  environment: boolean
  left: boolean
  preview: boolean
  right: boolean
  visual: boolean
}>

/**
 * What collapsing each pane hides in a preset. Draw's workbench frame dissolves the inspector aside
 * into its grid, so hiding the aside would take both inspector panes with it: there the right divider
 * collapses only the selection pane on the right, and the preview divider collapses the code column
 * (the editor and the environment pinned under it) rather than the canvas. Run shows only the
 * preview, so its size never hides it there.
 */
export function studioPaneVisibility(
  preset: string | undefined,
  sizes: Readonly<Record<PaneName, number>>,
): StudioPaneVisibility {
  const draw = preset === 'draw'
  return {
    bottom: sizes.bottom === 0,
    editor: draw && sizes.preview === 0,
    environment: draw && sizes.preview === 0,
    left: sizes.left === 0,
    preview: !draw && preset !== 'run' && sizes.preview === 0,
    right: !draw && sizes.right === 0,
    visual: draw && sizes.right === 0,
  }
}
const paneStorageKey = 'tao-studio:pane-sizes:v4'

/** Emitted after the shell has synchronously committed a new layout preset to its root dataset. */
export const studioLayoutPresetChangedEvent = 'tao-studio-layout-preset-changed'

/** Design alone lends the parent canvas ownership of wheel and pinch gestures inside previews. */
export function studioLayoutOwnsCanvasGestures(preset: string | undefined): boolean {
  return preset === 'design'
}

export const StudioPaneMinimums: Record<PaneName, number> = { bottom: 96, left: 180, preview: 280, right: 320 }

/** The narrowest the flexible middle column of each preset may get while a side pane is dragged wider. */
const studioMiddleFloor: Readonly<Record<string, number>> = { design: 240, draw: 320 }
const studioDefaultMiddleFloor = 360

/**
 * studioDraggedPaneSize turns a dragged width into a pane size: dragging past half the pane's minimum
 * collapses it, as double-click does, so a divider never just stops; short of that the pane holds its
 * minimum, and it never grows past what leaves the rest of the layout usable.
 */
export function studioDraggedPaneSize(requested: number, minimum: number, maximum: number): number {
  if (requested < minimum / 2) {
    return 0
  }
  return Math.max(minimum, Math.min(Math.max(minimum, maximum), requested))
}

/** Responsive Design split leaves the inspector and a usable editor ahead of the canvas. */
export function studioDesignPreviewSize(available: number, right: number): number {
  const room = available - right - dividerWidth * 2 - editorMinimum
  return Math.max(StudioPaneMinimums.preview, Math.min(Math.round(available / 2), Math.round(room)))
}

/** One stroke weight on a 24-unit grid; the rail, toolbar, and tree all draw from this set. */
export const studioIconPaths = {
  ai: 'M3.5 19.5L8.5 4.5h1l5 15M5.5 14h7M18.5 10.5v9M18.5 3.5v4M16.5 5.5h4',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  chevronRight: 'M9 6l6 6-6 6',
  database:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  layers: 'M3 8l9-5 9 5-9 5zM3 13l9 5 9-5',
  more: 'M5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM12 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM19 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  pen: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  phone: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
  plus: 'M12 5v14M5 12h14',
  reload: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5 20 20',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8',
  x: 'M6 6l12 12M18 6 6 18',
} as const

export type StudioIconName = keyof typeof studioIconPaths

export function studioIcon(name: StudioIconName, size: 'default' | 'small' = 'default'): string {
  const sizeAttribute = size === 'small' ? ' data-size="small"' : ''
  return `<svg class="studio-icon"${sizeAttribute} viewBox="0 0 24 24" aria-hidden="true"><path d="${
    studioIconPaths[name]
  }"/></svg>`
}

export const studioShellRailPanels = [
  { icon: 'folder', label: 'Files', panel: 'files' },
  { icon: 'grid', label: 'Components', panel: 'components' },
  { icon: 'layers', label: 'Screens', panel: 'screens' },
  { icon: 'drop', label: 'Design tokens', panel: 'tokens' },
  { icon: 'database', label: 'Data', panel: 'data' },
] as const

/** Utilities sit below the project panels, separated by a rail divider. */
const studioShellRailUtilities = [
  { icon: 'ai', label: 'Agent', panel: 'agent' },
] as const

export const StudioPaneSizes = {
  load(storage: Pick<Storage, 'getItem'>): Record<PaneName, number> {
    try {
      const parsed = JSON.parse(storage.getItem(paneStorageKey) ?? '{}') as Partial<Record<PaneName, unknown>>
      return {
        bottom: validSize(parsed.bottom, paneDefaults.bottom),
        left: validSize(parsed.left, paneDefaults.left),
        preview: validSize(parsed.preview, paneDefaults.preview),
        right: validSize(parsed.right, paneDefaults.right),
      }
    } catch {
      return { ...paneDefaults }
    }
  },
  save(storage: Pick<Storage, 'setItem'>, sizes: Record<PaneName, number>): void {
    storage.setItem(paneStorageKey, JSON.stringify(sizes))
  },
} as const

export type StudioLayoutPreset = 'code' | 'design' | 'draw' | 'run'

export type StudioWorkbenchStorage = Pick<Storage, 'getItem' | 'setItem'>

const layoutPresetStorageKey = 'tao-studio:layout-preset:v1'
const railStorageKey = 'tao-studio:rail-panel:v1'
const drawerTabStorageKey = 'tao-studio:drawer-tab:v1'

export const StudioWorkbenchState = {
  loadLayoutPreset(storage?: Pick<Storage, 'getItem'>): StudioLayoutPreset {
    try {
      const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
      const val = store?.getItem(layoutPresetStorageKey)
      return val === 'code' || val === 'draw' || val === 'run' || val === 'design' ? val : 'run'
    } catch {
      return 'run'
    }
  },
  saveLayoutPreset(storage: Pick<Storage, 'setItem'> | undefined, preset: StudioLayoutPreset): void {
    try {
      const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
      store?.setItem(layoutPresetStorageKey, preset)
    } catch {}
  },
  loadRailPanel(storage?: Pick<Storage, 'getItem'>): string {
    try {
      const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
      const val = store?.getItem(railStorageKey)
      return typeof val === 'string' && val !== 'agent' && val !== 'search' && val !== '' ? val : 'files'
    } catch {
      return 'files'
    }
  },
  saveRailPanel(storage: Pick<Storage, 'setItem'> | undefined, panel: string): void {
    try {
      const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
      store?.setItem(railStorageKey, panel)
    } catch {}
  },
  loadDrawerTab(storage?: Pick<Storage, 'getItem'>): StudioDrawerTab {
    try {
      const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
      const val = store?.getItem(drawerTabStorageKey)
      return val === 'Compile' || val === 'Data' || val === 'Logs' || val === 'Problems' || val === 'Tests'
        ? val
        : 'Problems'
    } catch {
      return 'Problems'
    }
  },
  saveDrawerTab(storage: Pick<Storage, 'setItem'> | undefined, tab: StudioDrawerTab): void {
    try {
      const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
      store?.setItem(drawerTabStorageKey, tab)
    } catch {}
  },
} as const

export function studioShellMarkup(): string {
  return `
    <section class="studio-shell">
      <header class="studio-toolbar">
        <div class="studio-toolbar-context">
          <span class="studio-window-controls" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
          <span class="studio-wordmark" aria-hidden="true"><i>T</i><b>Tao</b></span>
          <span class="studio-toolbar-separator" aria-hidden="true">/</span>
          <select class="studio-project studio-picker" aria-label="Project" title="Project" disabled></select>
          <select class="studio-app-picker studio-picker" aria-label="App variant" title="App variant" disabled></select>
        </div>
        <div class="studio-toolbar-mode">
          <nav class="studio-layout-presets" aria-label="Layout presets">
            <button data-preset="design" type="button">Design</button>
            <button data-preset="code" type="button">Code</button>
            <button data-preset="run" type="button">Run</button>
            <button data-preset="draw" type="button">Draw</button>
          </nav>
          <button class="studio-command-palette" type="button" aria-keyshortcuts="Meta+K Control+K" title="Search files, scenarios, and commands">
            ${studioIcon('search', 'small')}<span>Search files, scenarios, commands</span><kbd>⌘K</kbd>
          </button>
        </div>
        <div class="studio-toolbar-actions">
          <span class="studio-status" role="status">Connecting…</span>
          <button class="studio-canvas-focus" type="button" hidden title="Show the selected element's view on its own and edit only that view">Focus view</button>
          <button class="studio-browser" type="button" title="Open app in browser">Browser</button>
          <button class="studio-device" type="button" aria-haspopup="dialog" aria-expanded="false" title="Physical device">${
    studioIcon('phone', 'small')
  }Device</button>
          <button class="studio-interaction-mode" type="button">Mode: Run</button>
          <button class="studio-reload" type="button" title="Reload preview" aria-label="Reload preview">${
    studioIcon('reload')
  }</button>
          <button class="studio-beta-ship" type="button">Beta ship</button>
        </div>
      </header>
      <section class="studio-device-popover" hidden role="dialog" aria-label="Physical device"></section>
      <section class="studio-body">
        <nav class="studio-rail" aria-label="Studio panels">
          <div class="studio-search-affordance">
            <button class="studio-rail-button studio-search-button" type="button" title="Search" aria-label="Search project" aria-pressed="false">${
    studioIcon('search')
  }</button>
          </div>
          ${studioShellRailPanels.map(item => railButton(item.panel, item.label, item.icon)).join('')}
          <span class="studio-rail-separator" role="separator" aria-orientation="horizontal"></span>
          ${studioShellRailUtilities.map(item => railButton(item.panel, item.label, item.icon)).join('')}
          <span class="studio-rail-spacer"></span>
        </nav>
        <aside class="studio-sidebar studio-pane-left">
          <div class="studio-search-field">
            <input class="studio-search-input" type="search" placeholder="Text or diagnostic" aria-label="Search project">
          </div>
          <header class="studio-pane-header"><strong>Files</strong><button class="studio-collapse-left" type="button" aria-label="Collapse left panel">‹</button></header>
          <section class="studio-left-panel" data-studio-panel="files"><nav class="studio-files" aria-label="Project files"></nav></section>
          <section class="studio-palette studio-left-panel" data-studio-panel="components" aria-label="Component palette" hidden>
            <div class="studio-components"></div>
            <div class="studio-project-views"></div>
          </section>
          <section class="studio-design-values studio-left-panel" data-studio-panel="tokens" hidden></section>
          <section class="studio-left-panel" data-studio-panel="screens" hidden><nav class="studio-screens" aria-label="Project screens"></nav></section>
          <section class="studio-left-panel" data-studio-panel="data" hidden><div class="studio-data"></div></section>
          <section class="studio-left-panel studio-search-panel" data-studio-panel="search" hidden>
            <div class="studio-search-results" role="listbox"></div>
          </section>
        </aside>
        <div class="studio-divider studio-divider-left" data-divider="left" role="separator" aria-orientation="vertical"></div>
        <section class="studio-center">
          <aside class="studio-inspector studio-pane-right" aria-label="Inspector">
            <section class="studio-inspector-pane studio-environment-pane" aria-label="Environment and scenario">
              <header class="studio-inspector-pane-header">
                <strong>Scenario</strong>
                <button class="studio-pane-collapse studio-collapse-right" type="button" aria-label="Collapse inspector" title="Collapse inspector">‹</button>
              </header>
              <div class="studio-scenario-inspector-content"></div>
              <div class="studio-inspector-tao-environment"></div>
            </section>
            <section class="studio-inspector-pane studio-visual-pane" aria-label="Layout, style, data, and actions">
              <header class="studio-inspector-pane-header"><strong>Selection</strong></header>
              <div class="studio-inspector-tao-context"></div>
              <div class="studio-inspector-content"></div>
            </section>
          </aside>
          <div class="studio-divider studio-divider-right" data-divider="right" role="separator" aria-orientation="vertical"></div>
          <section class="studio-workbench">
            <section class="studio-editor-pane">
              <nav class="studio-editor-tabs" aria-label="Open files"></nav>
              <nav class="studio-breadcrumbs" aria-label="Editor breadcrumbs"></nav>
              <section class="studio-editor" aria-label="Tao source editor"></section>
            </section>
            <div class="studio-divider studio-divider-preview" data-divider="preview" role="separator" aria-label="Resize code and preview" aria-orientation="vertical"></div>
            <section class="studio-preview" aria-label="Preview canvas"></section>
          </section>
          <div class="studio-divider studio-divider-bottom" data-divider="bottom" role="separator" aria-orientation="horizontal"></div>
          <section class="studio-drawer">
            <nav class="studio-drawer-tabs" aria-label="Bottom drawer">
              ${['Problems', 'Tests', 'Data', 'Debug', 'Logs', 'Compile'].map(drawerTab).join('')}
              <button class="studio-pane-collapse studio-collapse-bottom" type="button" aria-label="Collapse bottom drawer" title="Collapse bottom drawer">⌄</button>
            </nav>
            <div class="studio-drawer-content"></div>
          </section>
        </section>
      </section>
      <section class="studio-agent-host" data-studio-panel="agent" aria-label="Agent"></section>
      <section class="studio-command-overlay" hidden aria-label="Command palette">
        <label><span>Command</span><input type="search" placeholder="Files, views, scenarios, commands, insertions"></label>
        <div class="studio-command-results" role="listbox"></div>
      </section>
      <section class="studio-global-loading" hidden aria-live="assertive" aria-label="Studio is loading" role="status">
        <div class="studio-global-loading-panel">
          <span class="studio-global-loading-spinner" aria-hidden="true"></span>
          <span><strong>Loading…</strong><small>Please wait while Studio prepares the project.</small></span>
        </div>
      </section>
      <section class="studio-ship-overlay" hidden aria-live="assertive" aria-label="Beta shipping current app" role="status">
        <div class="studio-ship-progress">
          <progress aria-label="Beta ship progress"></progress>
          <strong>Beta shipping…</strong>
          <small>Building, uploading, and waiting for TestFlight. This can take several minutes.</small>
        </div>
      </section>
    </section>
  `
}

export function createStudioShell(
  root: HTMLElement,
  config: StudioClientConfig,
  storage?: StudioWorkbenchStorage,
): StudioClientView {
  root.innerHTML = studioShellMarkup()
  const preview = requiredElement(root, '.studio-preview')
  preview.innerHTML = config.previewUrl === undefined
    ? '<div class="studio-empty">Preview host is not connected.</div>'
    : '<div class="studio-empty">Connecting preview…</div>'
  const panes = configurePanes(root, storage)
  configurePresets(root, panes, storage)
  const rail = configureRail(root, panes.showLeft, storage)
  configureSearch(root, panes.showLeft, rail.selectRail)
  return {
    appPicker: requiredSelect(root, '.studio-app-picker'),
    breadcrumbs: requiredElement(root, '.studio-breadcrumbs'),
    commandButton: requiredButton(root, '.studio-command-palette'),
    commandInput: requiredInput(root, '.studio-command-overlay input'),
    commandOverlay: requiredElement(root, '.studio-command-overlay'),
    commandResults: requiredElement(root, '.studio-command-results'),
    canvasFocus: requiredButton(root, '.studio-canvas-focus'),
    browser: requiredButton(root, '.studio-browser'),
    device: requiredButton(root, '.studio-device'),
    devicePopover: requiredElement(root, '.studio-device-popover'),
    drawerContent: requiredElement(root, '.studio-drawer-content'),
    drawerTabs: requiredElement(root, '.studio-drawer-tabs'),
    editorTabs: requiredElement(root, '.studio-editor-tabs'),
    betaShip: requiredButton(root, '.studio-beta-ship'),
    globalLoading: requiredElement(root, '.studio-global-loading'),
    inspector: requiredElement(root, '.studio-inspector-content'),
    interactionMode: requiredButton(root, '.studio-interaction-mode'),
    preview,
    project: requiredSelect(root, '.studio-project'),
    rail: requiredElement(root, '.studio-rail'),
    reload: requiredButton(root, '.studio-reload'),
    scenarioInspector: requiredElement(root, '.studio-scenario-inspector-content'),
    searchInput: requiredInput(root, '.studio-search-input'),
    shipOverlay: requiredElement(root, '.studio-ship-overlay'),
    status: requiredElement(root, '.studio-status'),
    dispose: panes.dispose,
  }
}

export const StudioGlobalLoading = {
  hide(element: HTMLElement): void {
    element.hidden = true
    element.removeAttribute('aria-busy')
    element.closest('.studio-shell')?.removeAttribute('aria-busy')
  },
  show(element: HTMLElement, heading: string, detail: string): void {
    const headingElement = element.querySelector<HTMLElement>('strong')
    const detailElement = element.querySelector<HTMLElement>('small')
    if (headingElement !== null) {
      headingElement.textContent = heading
    }
    if (detailElement !== null) {
      detailElement.textContent = detail
    }
    element.hidden = false
    element.setAttribute('aria-busy', 'true')
    element.closest('.studio-shell')?.setAttribute('aria-busy', 'true')
  },
} as const

/** The breadcrumb is the file, then whatever trail the selection supplies; nothing is invented. */
export function showOpenFile(view: StudioClientView, path: string, trail: readonly string[] = []): void {
  const label = path.split('/').at(-1) ?? path
  view.breadcrumbs.replaceChildren(...[label, ...trail].flatMap((part, index) => {
    const item = document.createElement('span')
    item.textContent = part
    if (index === 0) {
      return [item]
    }
    const separator = document.createElement('span')
    separator.className = 'studio-breadcrumb-separator'
    separator.textContent = '›'
    return [separator, item]
  }))
}

function railButton(panel: string, label: string, icon: StudioIconName): string {
  return `<button class="studio-rail-button" data-panel="${panel}" type="button" title="${label}" aria-label="${label}">${
    studioIcon(icon)
  }</button>`
}

function drawerTab(label: string): string {
  return `<button data-drawer-tab="${label}" type="button">${label}</button>`
}

function configurePanes(root: HTMLElement, storage?: StudioWorkbenchStorage): StudioPaneControls {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  const sizes = store !== undefined ? StudioPaneSizes.load(store) : { ...paneDefaults }
  const lastExpanded = {
    bottom: sizes.bottom > 0 ? sizes.bottom : paneDefaults.bottom,
    left: sizes.left > 0 ? sizes.left : paneDefaults.left,
    preview: sizes.preview > 0 ? sizes.preview : paneDefaults.preview,
    right: sizes.right > 0 ? sizes.right : paneDefaults.right,
  }
  const shell = requiredElement(root, '.studio-body')
  const center = requiredElement(root, '.studio-center')
  const left = requiredElement(root, '.studio-pane-left')
  const right = requiredElement(root, '.studio-pane-right')
  const preview = requiredElement(root, '.studio-preview')
  const bottom = requiredElement(root, '.studio-drawer')
  const editorPane = requiredElement(root, '.studio-editor-pane')
  const environmentPane = requiredElement(root, '.studio-environment-pane')
  const visualPane = requiredElement(root, '.studio-visual-pane')
  /**
   * What the layout looked like before Design mode borrowed the width, so leaving can give it back.
   * `previewSized` records that the person moved the canvas divider themselves while in Design mode;
   * from then on their width stands instead of being re-derived from the host on every measurement.
   */
  const designLayout: { active: boolean; left?: number; preview?: number; previewSized: boolean } = {
    active: false,
    previewSized: false,
  }
  const apply = (): void => {
    // The side panes take their width first: Design derives the canvas from the centre column they leave.
    const sides = studioPaneVisibility(root.dataset['layoutPreset'], sizes)
    left.hidden = sides.left
    right.hidden = sides.right
    shell.style.setProperty('--studio-left-size', `${sizes.left}px`)
    shell.style.setProperty('--studio-right-size', `${sizes.right}px`)
    if (designLayout.active && !designLayout.previewSized) {
      sizes.preview = studioDesignPreviewSize(center.getBoundingClientRect().width, sizes.right)
    }
    const hidden = studioPaneVisibility(root.dataset['layoutPreset'], sizes)
    preview.hidden = hidden.preview
    bottom.hidden = hidden.bottom
    editorPane.hidden = hidden.editor
    environmentPane.hidden = hidden.environment
    visualPane.hidden = hidden.visual
    center.style.setProperty('--studio-preview-size', `${sizes.preview}px`)
    center.style.setProperty('--studio-bottom-size', `${sizes.bottom}px`)
    for (const divider of root.querySelectorAll<HTMLElement>('[data-divider]')) {
      const pane = divider.dataset['divider'] as PaneName
      divider.setAttribute('aria-valuemin', '0')
      divider.setAttribute('aria-valuenow', String(Math.round(sizes[pane])))
      divider.setAttribute('title', `Drag to resize ${pane} pane; double-click or press Enter to collapse or restore`)
      divider.tabIndex = 0
    }
  }
  const save = (): void => {
    if (store !== undefined) {
      StudioPaneSizes.save(
        store,
        designLayout.active
          ? {
            ...sizes,
            left: designLayout.left ?? sizes.left,
            preview: designLayout.preview ?? sizes.preview,
          }
          : sizes,
      )
    }
  }
  /** resize records one pane size the person asked for, rather than one the layout derived. */
  const resize = (pane: PaneName, value: number): void => {
    if (pane === 'preview') {
      designLayout.previewSized = true
    }
    sizes[pane] = value
    apply()
  }
  const setSize = (pane: PaneName, value: number): void => {
    if (value > 0) {
      lastExpanded[pane] = value
    }
    resize(pane, value)
    save()
  }
  const toggle = (pane: PaneName): void => setSize(pane, sizes[pane] === 0 ? lastExpanded[pane] : 0)
  const onResize = (): void => apply()
  window.addEventListener('resize', onResize)
  apply()
  requiredButton(root, '.studio-collapse-left').addEventListener('click', () => {
    toggle('left')
  })
  requiredButton(root, '.studio-collapse-right').addEventListener('click', () => toggle('right'))
  requiredButton(root, '.studio-collapse-bottom').addEventListener('click', () => toggle('bottom'))
  /**
   * Which way a horizontal divider grows its pane: +1 when dragging right grows it. The inspector sits
   * left of its divider and the preview right of its own, except in Draw's workbench frame, where the
   * inspector is on the right and the preview size is the code column on the left.
   */
  const horizontalSign = (pane: PaneName): number => {
    if (pane === 'left') {
      return 1
    }
    const mirrored = root.dataset['layoutPreset'] === 'draw'
    return (pane === 'preview') === mirrored ? 1 : -1
  }
  /** The widest a pane may be dragged: whatever leaves the middle column of its preset at its floor. */
  const paneMaximum = (pane: PaneName): number => {
    if (pane === 'left') {
      return shell.getBoundingClientRect().width - 48 - studioDefaultMiddleFloor
    }
    if (pane === 'bottom') {
      return center.getBoundingClientRect().height - 240
    }
    const floor = studioMiddleFloor[root.dataset['layoutPreset'] ?? ''] ?? studioDefaultMiddleFloor
    const other = pane === 'preview' ? sizes.right : sizes.preview
    return center.getBoundingClientRect().width - other - dividerWidth * 2 - floor
  }
  for (const divider of root.querySelectorAll<HTMLElement>('[data-divider]')) {
    const pane = divider.dataset['divider'] as PaneName
    divider.addEventListener('dblclick', () => toggle(pane))
    divider.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        toggle(pane)
        return
      }
      const direction = pane === 'bottom'
        ? event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
        : (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * horizontalSign(pane)
      if (direction === 0) {
        return
      }
      event.preventDefault()
      const minimum = StudioPaneMinimums[pane]
      const base = sizes[pane] === 0 ? minimum : sizes[pane]
      setSize(pane, Math.max(minimum, base + direction * (event.shiftKey ? 40 : 12)))
    })
    divider.addEventListener('pointerdown', event => {
      event.preventDefault()
      const start = pane === 'bottom' ? event.clientY : event.clientX
      const initial = sizes[pane]
      divider.setPointerCapture(event.pointerId)
      const move = (moveEvent: PointerEvent): void => {
        const delta = pane === 'bottom'
          ? start - moveEvent.clientY
          : (moveEvent.clientX - start) * horizontalSign(pane)
        resize(pane, studioDraggedPaneSize(initial + delta, StudioPaneMinimums[pane], paneMaximum(pane)))
      }
      const finish = (): void => {
        divider.removeEventListener('pointermove', move)
        if (sizes[pane] > 0) {
          lastExpanded[pane] = sizes[pane]
        }
        save()
      }
      divider.addEventListener('pointermove', move)
      divider.addEventListener('pointerup', finish, { once: true })
      divider.addEventListener('pointercancel', finish, { once: true })
    })
  }
  return {
    /**
     * Design mode makes the canvas the hero: the file tree folds into the rail, which can bring it
     * straight back, and the preview takes half the window. Leaving Design restores what was there.
     * Every preset change re-applies the collapse mapping, since Draw hides different elements.
     */
    presetLayout(preset: string | undefined): void {
      const active = preset === 'design'
      if (active !== designLayout.active) {
        designLayout.active = active
        if (active) {
          designLayout.left = sizes.left
          designLayout.preview = sizes.preview
          designLayout.previewSized = false
          sizes.left = 0
          // `apply` measures every time the host width or rail visibility changes.
        } else {
          sizes.left = designLayout.left ?? sizes.left
          sizes.preview = designLayout.preview ?? sizes.preview
        }
      }
      apply()
    },
    dispose() {
      window.removeEventListener('resize', onResize)
    },
    showLeft() {
      if (sizes.left === 0) {
        setSize('left', lastExpanded.left)
      }
    },
  }
}

function configurePresets(root: HTMLElement, panes: StudioPaneControls, storage?: StudioWorkbenchStorage): void {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  const initialPreset = StudioWorkbenchState.loadLayoutPreset(store)
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
    button.addEventListener('click', () => {
      root.querySelectorAll('[data-preset]').forEach(item => item.removeAttribute('aria-current'))
      button.setAttribute('aria-current', 'true')
      root.dataset['layoutPreset'] = button.dataset['preset']
      const preset = button.dataset['preset'] as StudioLayoutPreset
      panes.presetLayout(preset)
      root.dispatchEvent(new CustomEvent(studioLayoutPresetChangedEvent))
      if (preset === 'code' || preset === 'design' || preset === 'draw' || preset === 'run') {
        StudioWorkbenchState.saveLayoutPreset(store, preset)
      }
    })
  }
  const defaultButton = root.querySelector<HTMLButtonElement>(`[data-preset="${initialPreset}"]`)
    ?? root.querySelector<HTMLButtonElement>('[data-preset="design"]')
  defaultButton?.click()
}

function configureRail(
  root: HTMLElement,
  showLeft: () => void,
  storage?: StudioWorkbenchStorage,
): { selectRail: (panel: string) => void } {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  const selectRail = (panel: string): void => {
    const button = root.querySelector<HTMLButtonElement>(`.studio-rail-button[data-panel="${panel}"]`)
    if (button === null || panel === 'agent' || panel === 'search') {
      return
    }
    for (const item of root.querySelectorAll<HTMLButtonElement>('.studio-rail-button')) {
      if (item.dataset['panel'] !== 'agent') {
        item.removeAttribute('aria-current')
      }
    }
    button.setAttribute('aria-current', 'true')
    requiredElement(root, '.studio-pane-header strong').textContent = button.title
    for (const leftPanel of root.querySelectorAll<HTMLElement>('.studio-sidebar [data-studio-panel]')) {
      leftPanel.hidden = leftPanel.dataset['studioPanel'] !== panel
    }
  }

  for (const button of root.querySelectorAll<HTMLButtonElement>('.studio-rail-button')) {
    button.addEventListener('click', () => {
      const panel = button.dataset['panel']
      if (panel === 'agent') {
        const collapseBtn = root.querySelector<HTMLButtonElement>('.studio-agent-collapse')
        if (collapseBtn !== null) {
          collapseBtn.click()
        }
        return
      }
      showLeft()
      if (panel !== undefined) {
        selectRail(panel)
        StudioWorkbenchState.saveRailPanel(store, panel)
      }
    })
  }

  const initialPanel = StudioWorkbenchState.loadRailPanel(store)
  selectRail(initialPanel)
  root.querySelector<HTMLButtonElement>('.studio-rail-button[data-panel="agent"]')?.setAttribute('aria-current', 'true')
  return { selectRail }
}

export type StudioSearchBlurIntent = 'hand-off-rail' | 'keep' | 'restore'

/** Blur restores the rail pane unless the next target is a result or another left-rail button. */
export function studioSearchBlurIntent(input: {
  insideSearch: boolean
  railPanel: string | undefined
}): StudioSearchBlurIntent {
  if (input.insideSearch) {
    return 'keep'
  }
  if (input.railPanel !== undefined && input.railPanel !== 'agent') {
    return 'hand-off-rail'
  }
  return 'restore'
}

/** Project search sits above the rail; focus swaps the sidecar to results, blur restores the rail pane. */
function configureSearch(
  root: HTMLElement,
  showLeft: () => void,
  selectRail: (panel: string) => void,
): void {
  const input = requiredInput(root, '.studio-search-input')
  const searchButton = requiredButton(root, '.studio-search-button')
  const searchField = requiredElement(root, '.studio-search-field')
  const searchPanel = requiredElement(root, '.studio-sidebar [data-studio-panel="search"]')
  const paneHeader = requiredElement(root, '.studio-pane-header')
  const sidebar = requiredElement(root, '.studio-sidebar')

  const setSearchChrome = (open: boolean): void => {
    searchButton.setAttribute('aria-pressed', open ? 'true' : 'false')
    paneHeader.hidden = open
    sidebar.toggleAttribute('data-search-open', open)
  }

  const openSearch = (): void => {
    showLeft()
    for (const leftPanel of root.querySelectorAll<HTMLElement>('.studio-sidebar [data-studio-panel]')) {
      leftPanel.hidden = leftPanel.dataset['studioPanel'] !== 'search'
    }
    setSearchChrome(true)
  }

  const closeSearch = (): void => {
    if (searchButton.getAttribute('aria-pressed') !== 'true') {
      return
    }
    setSearchChrome(false)
    selectRail(selectedRailPanel(root))
  }

  searchButton.addEventListener('click', () => {
    showLeft()
    input.focus()
  })
  input.addEventListener('focus', () => {
    openSearch()
  })
  input.addEventListener('blur', event => {
    const next = event.relatedTarget
    const intent = studioSearchBlurIntent({
      insideSearch: next instanceof Node
        && (searchPanel.contains(next) || searchField.contains(next) || searchButton.contains(next)),
      railPanel: next instanceof Element
        ? next.closest<HTMLElement>('.studio-rail-button[data-panel]')?.dataset['panel']
        : undefined,
    })
    if (intent === 'keep') {
      return
    }
    if (intent === 'hand-off-rail') {
      setSearchChrome(false)
      return
    }
    closeSearch()
  })
  searchPanel.addEventListener('mousedown', event => {
    event.preventDefault()
  })
}

function selectedRailPanel(root: HTMLElement): string {
  for (const button of root.querySelectorAll<HTMLButtonElement>('.studio-rail-button[aria-current="true"]')) {
    const panel = button.dataset['panel']
    if (panel !== undefined && panel !== 'agent') {
      return panel
    }
  }
  return 'files'
}

function validSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function requiredElement(parent: ParentNode, selector: string): HTMLElement {
  const element = parent.querySelector<HTMLElement>(selector)
  Assert.defined(element, `the Tao Studio shell to render the element ${selector}`)
  return element
}

function requiredButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const button = parent.querySelector<HTMLButtonElement>(selector)
  Assert.defined(button, `the Tao Studio shell to render the button ${selector}`)
  return button
}

function requiredInput(parent: ParentNode, selector: string): HTMLInputElement {
  const input = parent.querySelector<HTMLInputElement>(selector)
  Assert.defined(input, `the Tao Studio shell to render the input ${selector}`)
  return input
}

function requiredSelect(parent: ParentNode, selector: string): HTMLSelectElement {
  const select = parent.querySelector<HTMLSelectElement>(selector)
  Assert.defined(select, `the Tao Studio shell to render the select ${selector}`)
  return select
}
