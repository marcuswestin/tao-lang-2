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
  components: HTMLElement
  designValues: HTMLElement
  drawerContent: HTMLElement
  drawerTabs: HTMLElement
  editor: HTMLElement
  editorTabs: HTMLElement
  files: HTMLElement
  inspector: HTMLElement
  inspectorTabs: HTMLElement
  interactionMode: HTMLButtonElement
  preview: HTMLElement
  project: HTMLButtonElement
  projectViews: HTMLElement
  rail: HTMLElement
  reload: HTMLButtonElement
  screens: HTMLElement
  searchInput: HTMLInputElement
  searchResults: HTMLElement
  status: HTMLElement
}

type PaneName = 'bottom' | 'left' | 'right'

const paneDefaults: Record<PaneName, number> = { bottom: 180, left: 260, right: 280 }
const paneStorageKey = 'tao-studio:pane-sizes:v2'

export const StudioPaneSizes = {
  load(storage: Pick<Storage, 'getItem'>): Record<PaneName, number> {
    try {
      const parsed = JSON.parse(storage.getItem(paneStorageKey) ?? '{}') as Partial<Record<PaneName, unknown>>
      return {
        bottom: validSize(parsed.bottom, paneDefaults.bottom),
        left: validSize(parsed.left, paneDefaults.left),
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

export function createStudioShell(root: HTMLElement, config: StudioClientConfig): StudioClientView {
  root.innerHTML = `
    <section class="studio-shell">
      <header class="studio-toolbar">
        <span class="studio-wordmark">Tao Studio</span>
        <button class="studio-project studio-picker" type="button" title="Project picker"></button>
        <select class="studio-app-picker studio-picker" aria-label="App variant" title="App variant" disabled></select>
        <nav class="studio-layout-presets" aria-label="Layout presets">
          <button data-preset="design" type="button">Design</button>
          <button data-preset="code" type="button">Code</button>
          <button data-preset="run" type="button">Run</button>
        </nav>
        <button class="studio-command-palette" type="button" aria-keyshortcuts="Meta+K">⌘K</button>
        <button class="studio-interaction-mode" type="button">Mode: Edit</button>
        <button class="studio-reload" type="button">Reload preview</button>
        <span class="studio-status" role="status">Connecting…</span>
      </header>
      <section class="studio-body">
        <nav class="studio-rail" aria-label="Studio panels">
          ${railButton('files', 'Files', 'F')}
          ${railButton('components', 'Components', 'C')}
          ${railButton('screens', 'Screens', 'S')}
          ${railButton('tokens', 'Design tokens', 'T')}
          ${railButton('data', 'Data', 'D')}
          ${railButton('search', 'Search', '⌕')}
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
          <section class="studio-workbench">
            <section class="studio-editor-pane">
              <nav class="studio-editor-tabs" aria-label="Open files"></nav>
              <nav class="studio-breadcrumbs" aria-label="Editor breadcrumbs"></nav>
              <section class="studio-editor" aria-label="Tao source editor"></section>
            </section>
            <section class="studio-preview" aria-label="Preview canvas"></section>
          </section>
          <div class="studio-divider studio-divider-bottom" data-divider="bottom" role="separator" aria-orientation="horizontal"></div>
          <section class="studio-drawer">
            <nav class="studio-drawer-tabs" aria-label="Bottom drawer">
              ${['Problems', 'Tests', 'Data', 'Logs', 'Compile'].map(drawerTab).join('')}
            </nav>
            <div class="studio-drawer-content"></div>
          </section>
        </section>
        <div class="studio-divider studio-divider-right" data-divider="right" role="separator" aria-orientation="vertical"></div>
        <aside class="studio-inspector studio-pane-right" aria-label="Inspector">
          <nav class="studio-inspector-tabs" aria-label="Inspector contexts">
            ${drawerTab('Layout')}${drawerTab('Style')}${drawerTab('Data')}${drawerTab('Actions')}
          </nav>
          <div class="studio-inspector-content"></div>
        </aside>
      </section>
      <section class="studio-command-overlay" hidden aria-label="Command palette">
        <label><span>Command</span><input type="search" placeholder="Files, views, scenarios, commands, insertions"></label>
        <div class="studio-command-results" role="listbox"></div>
      </section>
    </section>
  `
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
    components: requiredElement(root, '.studio-components'),
    designValues: requiredElement(root, '.studio-design-values'),
    drawerContent: requiredElement(root, '.studio-drawer-content'),
    drawerTabs: requiredElement(root, '.studio-drawer-tabs'),
    editor: requiredElement(root, '.studio-editor'),
    editorTabs: requiredElement(root, '.studio-editor-tabs'),
    files: requiredElement(root, '.studio-files'),
    inspector: requiredElement(root, '.studio-inspector-content'),
    inspectorTabs: requiredElement(root, '.studio-inspector-tabs'),
    interactionMode: requiredButton(root, '.studio-interaction-mode'),
    preview,
    project: requiredButton(root, '.studio-project'),
    projectViews: requiredElement(root, '.studio-project-views'),
    rail: requiredElement(root, '.studio-rail'),
    reload: requiredButton(root, '.studio-reload'),
    screens: requiredElement(root, '.studio-screens'),
    searchInput: requiredInput(root, '.studio-search-input'),
    searchResults: requiredElement(root, '.studio-search-results'),
    status: requiredElement(root, '.studio-status'),
  }
}

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
  return `<button type="button">${label}</button>`
}

function configurePanes(root: HTMLElement): { showLeft: () => void } {
  const sizes = StudioPaneSizes.load(window.localStorage)
  const shell = requiredElement(root, '.studio-body')
  const center = requiredElement(root, '.studio-center')
  const left = requiredElement(root, '.studio-pane-left')
  const apply = (): void => {
    shell.style.setProperty('--studio-left-size', `${left.hidden ? 0 : sizes.left}px`)
    shell.style.setProperty('--studio-right-size', `${sizes.right}px`)
    center.style.setProperty('--studio-bottom-size', `${sizes.bottom}px`)
  }
  apply()
  requiredButton(root, '.studio-collapse-left').addEventListener('click', () => {
    left.hidden = !left.hidden
    apply()
  })
  for (const divider of root.querySelectorAll<HTMLElement>('[data-divider]')) {
    const pane = divider.dataset['divider'] as PaneName
    divider.addEventListener('pointerdown', event => {
      event.preventDefault()
      const start = pane === 'bottom' ? event.clientY : event.clientX
      const initial = sizes[pane]
      divider.setPointerCapture(event.pointerId)
      const move = (moveEvent: PointerEvent): void => {
        const delta = pane === 'bottom'
          ? start - moveEvent.clientY
          : pane === 'right'
          ? start - moveEvent.clientX
          : moveEvent.clientX - start
        sizes[pane] = Math.max(pane === 'bottom' ? 96 : 180, initial + delta)
        apply()
      }
      const finish = (): void => {
        divider.removeEventListener('pointermove', move)
        StudioPaneSizes.save(window.localStorage, sizes)
      }
      divider.addEventListener('pointermove', move)
      divider.addEventListener('pointerup', finish, { once: true })
      divider.addEventListener('pointercancel', finish, { once: true })
    })
  }
  return {
    showLeft() {
      left.hidden = false
      apply()
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
  if (element === null) {
    throw new Error(`Tao Studio element is missing: ${selector}`)
  }
  return element
}

function requiredButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const button = parent.querySelector<HTMLButtonElement>(selector)
  if (button === null) {
    throw new Error(`Tao Studio button is missing: ${selector}`)
  }
  return button
}

function requiredInput(parent: ParentNode, selector: string): HTMLInputElement {
  const input = parent.querySelector<HTMLInputElement>(selector)
  if (input === null) {
    throw new Error(`Tao Studio input is missing: ${selector}`)
  }
  return input
}

function requiredSelect(parent: ParentNode, selector: string): HTMLSelectElement {
  const select = parent.querySelector<HTMLSelectElement>(selector)
  if (select === null) {
    throw new Error(`Tao Studio select is missing: ${selector}`)
  }
  return select
}
