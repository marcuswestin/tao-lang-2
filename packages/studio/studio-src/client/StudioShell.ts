import { Assert } from '@shared/core'

export type StudioClientConfig = {
  previewUrl?: string
}

export type StudioClientView = {
  appPicker: HTMLSelectElement
  breadcrumbs: HTMLElement
  commandButton: HTMLButtonElement
  commandInput: HTMLInputElement
  commandOverlay: HTMLElement
  commandResults: HTMLElement
  drawerContent: HTMLElement
  drawerTabs: HTMLElement
  editorTabs: HTMLElement
  betaShip: HTMLButtonElement
  globalLoading: HTMLElement
  inspector: HTMLElement
  interactionMode: HTMLButtonElement
  preview: HTMLElement
  project: HTMLSelectElement
  rail: HTMLElement
  reload: HTMLButtonElement
  scenarioInspector: HTMLElement
  searchInput: HTMLInputElement
  shipOverlay: HTMLElement
  status: HTMLElement
}

type PaneName = 'bottom' | 'left' | 'preview' | 'right'

const paneDefaults: Record<PaneName, number> = { bottom: 180, left: 360, preview: 440, right: 440 }
const paneStorageKey = 'tao-studio:pane-sizes:v4'

export const StudioPaneMinimums: Record<PaneName, number> = { bottom: 96, left: 180, preview: 280, right: 320 }

export const studioShellRailPanels = [
  { icon: '🗂️', label: 'Files', panel: 'files' },
  { icon: '▦', label: 'Components', panel: 'components' },
  { icon: '🧭', label: 'Screens', panel: 'screens' },
  { icon: '🎨', label: 'Design tokens', panel: 'tokens' },
  { icon: '🗄️', label: 'Data', panel: 'data' },
  { icon: '🔍', label: 'Search', panel: 'search' },
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

export function studioShellMarkup(): string {
  return `
    <section class="studio-shell">
      <header class="studio-toolbar">
        <div class="studio-toolbar-context">
          <span class="studio-window-controls" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
          <select class="studio-project studio-picker" aria-label="Project" title="Project" disabled></select>
          <select class="studio-app-picker studio-picker" aria-label="App variant" title="App variant" disabled></select>
        </div>
        <div class="studio-toolbar-mode">
          <nav class="studio-layout-presets" aria-label="Layout presets">
            <button data-preset="design" type="button">Design</button>
            <button data-preset="code" type="button">Code</button>
            <button data-preset="run" type="button">Run</button>
          </nav>
          <button class="studio-command-palette" type="button" aria-keyshortcuts="Meta+K Control+K">⌘K</button>
        </div>
        <div class="studio-toolbar-actions">
          <button class="studio-beta-ship" type="button">Beta ship</button>
          <button class="studio-interaction-mode" type="button">Mode: Edit</button>
          <button class="studio-reload" type="button">Reload preview</button>
          <span class="studio-status" role="status">Connecting…</span>
        </div>
      </header>
      <section class="studio-body">
        <nav class="studio-rail" aria-label="Studio panels">
          ${studioShellRailPanels.map(item => railButton(item.panel, item.label, item.icon)).join('')}
        </nav>
        <aside class="studio-sidebar studio-pane-left">
          <header class="studio-pane-header"><strong>Files</strong><button class="studio-collapse-left" type="button" aria-label="Collapse left panel">‹</button></header>
          <section class="studio-left-panel" data-studio-panel="files"><nav class="studio-files" aria-label="Project files"></nav></section>
          <section class="studio-palette studio-left-panel" data-studio-panel="components" aria-label="Component palette" hidden>
            <h2>Components</h2><div class="studio-components"></div>
            <h2>Project views</h2><div class="studio-project-views"></div>
          </section>
          <section class="studio-design-values studio-left-panel" data-studio-panel="tokens" hidden></section>
          <section class="studio-left-panel" data-studio-panel="screens" hidden><nav class="studio-screens" aria-label="Project screens"></nav></section>
          <section class="studio-left-panel studio-panel-note" data-studio-panel="data" hidden>Live entity tables and refresh controls are in the Data drawer.</section>
          <section class="studio-left-panel studio-search-panel" data-studio-panel="search" hidden>
            <label><span>Search project</span><input class="studio-search-input" type="search" placeholder="Text or diagnostic"></label>
            <div class="studio-search-results" role="listbox"></div>
          </section>
        </aside>
        <div class="studio-divider studio-divider-left" data-divider="left" role="separator" aria-orientation="vertical"></div>
        <section class="studio-center">
          <aside class="studio-inspector studio-pane-right" aria-label="Inspector">
            <section class="studio-inspector-pane studio-environment-pane" aria-label="Environment and scenario">
              <header class="studio-inspector-pane-header"><strong>Environment &amp; scenario</strong></header>
              <div class="studio-scenario-inspector-content"></div>
            </section>
            <section class="studio-inspector-pane studio-visual-pane" aria-label="Layout, style, data, and actions">
              <header class="studio-inspector-pane-header">
                <strong>Selection</strong>
                <button class="studio-pane-collapse studio-collapse-right" type="button" aria-label="Collapse inspector" title="Collapse inspector">‹</button>
              </header>
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
              ${['Problems', 'Tests', 'Data', 'Logs', 'Compile'].map(drawerTab).join('')}
              <button class="studio-pane-collapse studio-collapse-bottom" type="button" aria-label="Collapse bottom drawer" title="Collapse bottom drawer">⌄</button>
            </nav>
            <div class="studio-drawer-content"></div>
          </section>
        </section>
      </section>
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

export function createStudioShell(root: HTMLElement, config: StudioClientConfig): StudioClientView {
  root.innerHTML = studioShellMarkup()
  const preview = requiredElement(root, '.studio-preview')
  preview.innerHTML = config.previewUrl === undefined
    ? '<div class="studio-empty">Preview host is not connected.</div>'
    : '<div class="studio-empty">Connecting preview…</div>'
  const panes = configurePanes(root)
  configurePresets(root)
  configureRail(root, panes.showLeft)
  return {
    appPicker: requiredSelect(root, '.studio-app-picker'),
    breadcrumbs: requiredElement(root, '.studio-breadcrumbs'),
    commandButton: requiredButton(root, '.studio-command-palette'),
    commandInput: requiredInput(root, '.studio-command-overlay input'),
    commandOverlay: requiredElement(root, '.studio-command-overlay'),
    commandResults: requiredElement(root, '.studio-command-results'),
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

export function showOpenFile(view: StudioClientView, path: string): void {
  const label = path.split('/').at(-1) ?? path
  view.breadcrumbs.replaceChildren(...[label, 'view', 'render'].flatMap((part, index) => {
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

function railButton(panel: string, label: string, icon: string): string {
  return `<button class="studio-rail-button" data-panel="${panel}" type="button" title="${label}" aria-label="${label}">${icon}</button>`
}

function drawerTab(label: string): string {
  return `<button data-drawer-tab="${label}" type="button">${label}</button>`
}

function configurePanes(root: HTMLElement): { showLeft: () => void } {
  const sizes = StudioPaneSizes.load(window.localStorage)
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
  const apply = (): void => {
    left.hidden = sizes.left === 0
    right.hidden = sizes.right === 0
    preview.hidden = sizes.preview === 0
    bottom.hidden = sizes.bottom === 0
    shell.style.setProperty('--studio-left-size', `${sizes.left}px`)
    shell.style.setProperty('--studio-right-size', `${sizes.right}px`)
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
  const save = (): void => StudioPaneSizes.save(window.localStorage, sizes)
  const setSize = (pane: PaneName, value: number): void => {
    if (value > 0) {
      lastExpanded[pane] = value
    }
    sizes[pane] = value
    apply()
    save()
  }
  const toggle = (pane: PaneName): void => setSize(pane, sizes[pane] === 0 ? lastExpanded[pane] : 0)
  apply()
  requiredButton(root, '.studio-collapse-left').addEventListener('click', () => {
    toggle('left')
  })
  requiredButton(root, '.studio-collapse-right').addEventListener('click', () => toggle('right'))
  requiredButton(root, '.studio-collapse-bottom').addEventListener('click', () => toggle('bottom'))
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
        : pane === 'preview'
        ? event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0
        : event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
        ? -1
        : 0
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
          : pane === 'preview'
          ? start - moveEvent.clientX
          : moveEvent.clientX - start
        const minimum = StudioPaneMinimums[pane]
        sizes[pane] = Math.max(minimum, initial + delta)
        apply()
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
    showLeft() {
      if (sizes.left === 0) {
        setSize('left', lastExpanded.left)
      }
    },
  }
}

function configurePresets(root: HTMLElement): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
    button.addEventListener('click', () => {
      root.querySelectorAll('[data-preset]').forEach(item => item.removeAttribute('aria-current'))
      button.setAttribute('aria-current', 'true')
      root.dataset['layoutPreset'] = button.dataset['preset']
    })
  }
  root.querySelector<HTMLButtonElement>('[data-preset="design"]')?.click()
}

function configureRail(root: HTMLElement, showLeft: () => void): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('.studio-rail-button')) {
    button.addEventListener('click', () => {
      showLeft()
      root.querySelectorAll('.studio-rail-button').forEach(item => item.removeAttribute('aria-current'))
      button.setAttribute('aria-current', 'true')
      requiredElement(root, '.studio-pane-header strong').textContent = button.title
      for (const panel of root.querySelectorAll<HTMLElement>('[data-studio-panel]')) {
        panel.hidden = panel.dataset['studioPanel'] !== button.dataset['panel']
      }
    })
  }
  root.querySelector<HTMLButtonElement>('.studio-rail-button')?.setAttribute('aria-current', 'true')
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
