import { studioPaletteComponents, type StudioProjectViewPaletteItem } from '../StudioInspector'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import type { StudioDesignValue } from '../StudioProjectSession'
import type { StudioCanonicalSourceAction } from '../StudioProtocol'
import type { StudioTestFailure, StudioTestStatus } from '../StudioTestRunner'
import type { StudioCompileDiagnostic, StudioCompileState, StudioFile } from './StudioApiClient'
import type { StudioRuntimeDataTable, StudioRuntimeLog } from './StudioMatrixView'

export type StudioDrawerTab = 'Compile' | 'Data' | 'Logs' | 'Problems' | 'Tests'

export const StudioProductCapabilities = {
  logs: {
    available: true,
    reason: 'Logs stream from the active preview cell and retain its latest 500 console records.',
  },
  tests: {
    available: true,
    reason: 'Tests run through the project-owned Tao runtime and watch completed Studio compiles.',
  },
  tokenWrites: {
    available: true,
    reason: 'Raw inline colors can be promoted to current-grammar color tokens from the selected render.',
  },
} as const

export type StudioCommandTarget =
  | { kind: 'command'; command: 'compile' | 'data' | 'problems' | 'reload' | 'toggle-mode' }
  | { kind: 'file'; path: string }
  | { kind: 'insert-component'; component: (typeof studioPaletteComponents)[number] }
  | { kind: 'insert-view'; view: StudioProjectViewPaletteItem }
  | { kind: 'scenario'; scenarioId: string }
  | { kind: 'view'; path: string }

export type StudioCommandItem = {
  category: 'Command' | 'File' | 'Insertion' | 'Scenario' | 'View'
  detail: string
  id: string
  label: string
  search: string
  target: StudioCommandTarget
}

export const StudioCommandPalette = {
  filter(items: readonly StudioCommandItem[], query: string): readonly StudioCommandItem[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return terms.length === 0
      ? items
      : items.filter(item => terms.every(term => item.search.includes(term)))
  },
  items(input: {
    files: readonly StudioFile[]
    manifest?: StudioPreviewManifestV2
    projectViews: readonly StudioProjectViewPaletteItem[]
  }): readonly StudioCommandItem[] {
    const commands: StudioCommandItem[] = [
      command('problems', 'Show Problems', 'Open project-wide compile diagnostics'),
      command('data', 'Show Data', 'Open live StudioServer entity tables'),
      command('compile', 'Show Compile', 'Open compiler status and details'),
      command('reload', 'Reload previews', 'Reload every connected preview cell'),
      command('toggle-mode', 'Toggle Edit / Run', 'Switch preview interaction mode'),
    ]
    const files = input.files.map(file =>
      item(
        `file:${file.path}`,
        'File',
        file.path,
        'Open source file',
        { kind: 'file', path: file.path },
      )
    )
    const root = input.manifest?.project.root.replace(/\/$/, '')
    const views = (input.manifest?.subjects ?? []).flatMap(subject =>
      subject.kind !== 'view' || root === undefined || !subject.source.path.startsWith(`${root}/`)
        ? []
        : [item(
          `view:${subject.subjectId}`,
          'View',
          subject.viewName,
          subject.source.path,
          { kind: 'view', path: subject.source.path },
        )]
    )
    const scenarios = (input.manifest?.scenarios ?? []).map(scenario =>
      item(
        `scenario:${scenario.scenarioId}`,
        'Scenario',
        scenario.label,
        scenario.group,
        { kind: 'scenario', scenarioId: scenario.scenarioId },
      )
    )
    const components = studioPaletteComponents.map(component =>
      item(
        `insert-component:${component.component}`,
        'Insertion',
        `Insert ${component.label}`,
        component.category,
        { component, kind: 'insert-component' },
      )
    )
    const projectViews = input.projectViews.map(view =>
      item(
        `insert-view:${view.sourcePath}:${view.viewName}`,
        'Insertion',
        `Insert ${view.label}`,
        view.snippet.text,
        { kind: 'insert-view', view },
      )
    )
    return [...commands, ...files, ...views, ...scenarios, ...components, ...projectViews]
  },
} as const

export function renderCommandResults(
  parent: HTMLElement,
  items: readonly StudioCommandItem[],
  select: (item: StudioCommandItem) => void,
): void {
  if (items.length === 0) {
    parent.replaceChildren(note('No matching Studio commands.'))
    return
  }
  parent.replaceChildren(
    ...items.slice(0, 60).map(commandItem => {
      const button = document.createElement('button')
      button.className = 'studio-command-result'
      button.type = 'button'
      const label = document.createElement('strong')
      label.textContent = commandItem.label
      const detail = document.createElement('span')
      detail.textContent = `${commandItem.category} · ${commandItem.detail}`
      button.append(label, detail)
      button.addEventListener('click', () => select(commandItem))
      return button
    }),
  )
}

export function renderDrawerContent(parent: HTMLElement, tab: StudioDrawerTab, options: {
  compile: StudioCompileState
  data: readonly StudioRuntimeDataTable[]
  dataError?: string
  dataLoading: boolean
  logs: readonly StudioRuntimeLog[]
  onCaptureFixture: () => void
  onClearLogs: () => void
  onDiagnostic: (diagnostic: StudioCompileDiagnostic) => void
  onRefreshData: () => void
  onRunTests: () => void
  onTestFailure: (failure: StudioTestFailure) => void
  onTestWatch: (watch: boolean) => void
  testError?: string
  testStatus?: StudioTestStatus
  testWatch: boolean
}): void {
  if (tab === 'Problems') {
    renderProblems(parent, options.compile.diagnostics ?? [], options.onDiagnostic)
  } else if (tab === 'Compile') {
    renderCompile(parent, options.compile)
  } else if (tab === 'Data') {
    renderData(parent, options)
  } else if (tab === 'Tests') {
    renderTests(parent, options)
  } else {
    renderLogs(parent, options.logs, options.onClearLogs)
  }
}

export function renderDesignValues(parent: HTMLElement, options: {
  busy: boolean
  currentSourceVersion?: string
  design: readonly StudioDesignValue[]
  onAction: (action: StudioCanonicalSourceAction) => void
  renderId?: string
  selectedSourceVersion?: string
}): void {
  const heading = document.createElement('h2')
  heading.textContent = 'Design tokens'
  const bundles = options.design.filter((value): value is Extract<StudioDesignValue, { kind: 'bundle' }> =>
    value.kind === 'bundle'
  )
  const tokens = options.design.filter((value): value is Extract<StudioDesignValue, { kind: 'token' }> =>
    value.kind === 'token'
  )
  const content: HTMLElement[] = [heading]
  if (tokens.length > 0) {
    const tokenHeading = document.createElement('h3')
    tokenHeading.textContent = 'Color tokens'
    content.push(tokenHeading)
    for (const token of tokens) {
      const row = document.createElement('div')
      row.className = 'studio-design-value'
      const swatch = document.createElement('span')
      swatch.className = 'studio-design-swatch'
      swatch.style.background = token.value
      const value = document.createElement('code')
      value.textContent = `${token.name} ${token.value}`
      row.append(swatch, value)
      content.push(row)
    }
    content.push(note(StudioProductCapabilities.tokenWrites.reason))
  }
  if (bundles.length > 0) {
    const bundleHeading = document.createElement('h3')
    bundleHeading.textContent = 'Local bundles'
    content.push(bundleHeading)
    for (const bundle of bundles) {
      content.push(bundleEditor(bundle, options))
    }
  }
  if (tokens.length === 0 && bundles.length === 0) {
    content.push(note('No design tokens or local bundles are declared in the active file.'))
  }
  if (options.renderId === undefined) {
    content.push(note('Select a rendered element before applying a local bundle edit.'))
  }
  parent.replaceChildren(...content)
}

function renderProblems(
  parent: HTMLElement,
  diagnostics: readonly StudioCompileDiagnostic[],
  open: (diagnostic: StudioCompileDiagnostic) => void,
): void {
  if (diagnostics.length === 0) {
    parent.replaceChildren(note('No project diagnostics.'))
    return
  }
  parent.replaceChildren(...diagnostics.map(diagnostic => {
    const button = document.createElement('button')
    button.className = 'studio-drawer-row'
    button.disabled = diagnostic.filePath === undefined
    button.type = 'button'
    const location = diagnostic.range === undefined ? '' : `:${diagnostic.range.start.line + 1}`
    button.textContent = `${diagnostic.filePath ?? 'Project'}${location} — ${diagnostic.message}`
    button.addEventListener('click', () => open(diagnostic))
    return button
  }))
}

function renderCompile(parent: HTMLElement, compile: StudioCompileState): void {
  const summary = document.createElement('dl')
  append(summary, 'Status', compile.status)
  append(summary, 'Compile revision', String(compile.compileRevision))
  append(summary, 'Applied revision', String(compile.appliedRevision))
  append(summary, 'Message', compile.message)
  append(summary, 'Diagnostics', String(compile.diagnostics?.length ?? 0))
  parent.replaceChildren(summary)
}

function renderData(
  parent: HTMLElement,
  options: Parameters<typeof renderDrawerContent>[2],
): void {
  const toolbar = document.createElement('div')
  toolbar.className = 'studio-drawer-toolbar'
  const refresh = document.createElement('button')
  refresh.textContent = 'Refresh'
  refresh.type = 'button'
  refresh.addEventListener('click', options.onRefreshData)
  const capture = document.createElement('button')
  capture.textContent = 'Capture fixture from active cell'
  capture.type = 'button'
  capture.addEventListener('click', options.onCaptureFixture)
  toolbar.append(refresh, capture)
  if (options.dataLoading) {
    parent.replaceChildren(toolbar, note('Capturing live app data from the active preview…'))
    return
  }
  if (options.dataError !== undefined) {
    parent.replaceChildren(toolbar, unavailable('Data', options.dataError))
    return
  }
  const tables = options.data.flatMap(table => {
    const heading = document.createElement('h3')
    heading.textContent = `${table.datasource} · ${table.entity}`
    return [heading, dataTable(table.rows)]
  })
  parent.replaceChildren(toolbar, ...(tables.length === 0 ? [note('No live datasource rows.')] : tables))
}

function dataTable(rows: readonly Readonly<Record<string, unknown>>[]): HTMLElement {
  if (rows.length === 0) {
    return note('No rows.')
  }
  const table = document.createElement('table')
  table.className = 'studio-data-table'
  const keys = [...new Set(rows.flatMap(row => Object.keys(row)))].toSorted()
  const header = document.createElement('tr')
  header.append(...keys.map(key => {
    const th = document.createElement('th')
    th.textContent = key
    return th
  }))
  const head = document.createElement('thead')
  head.append(header)
  const body = document.createElement('tbody')
  body.append(...rows.map(row => {
    const tr = document.createElement('tr')
    tr.append(...keys.map(key => {
      const td = document.createElement('td')
      const value = (row as unknown as Record<string, unknown>)[key]
      td.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
      return td
    }))
    return tr
  }))
  table.append(head, body)
  return table
}

function renderLogs(parent: HTMLElement, logs: readonly StudioRuntimeLog[], clear: () => void): void {
  const toolbar = document.createElement('div')
  toolbar.className = 'studio-drawer-toolbar'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Clear'
  button.disabled = logs.length === 0
  button.addEventListener('click', clear)
  toolbar.append(button)
  const rows = logs.map(log => {
    const row = document.createElement('div')
    row.className = 'studio-drawer-row'
    row.textContent = `${new Date(log.timestamp).toLocaleTimeString()} ${log.level.toUpperCase()} ${
      log.arguments.map(formatValue).join(' ')
    }`
    return row
  })
  parent.replaceChildren(
    toolbar,
    ...(rows.length === 0 ? [note('No console messages from the active preview.')] : rows),
  )
}

function renderTests(parent: HTMLElement, options: Parameters<typeof renderDrawerContent>[2]): void {
  const toolbar = document.createElement('div')
  toolbar.className = 'studio-drawer-toolbar'
  const run = document.createElement('button')
  run.type = 'button'
  run.textContent = options.testStatus?.running === true ? 'Running…' : 'Run tests'
  run.disabled = options.testStatus?.available !== true || options.testStatus.running
  run.addEventListener('click', options.onRunTests)
  const watchLabel = document.createElement('label')
  const watch = document.createElement('input')
  watch.type = 'checkbox'
  watch.checked = options.testWatch
  watch.disabled = options.testStatus?.available !== true
  watch.addEventListener('change', () => options.onTestWatch(watch.checked))
  watchLabel.append(watch, ' Watch')
  toolbar.append(run, watchLabel)
  if (options.testStatus?.available === false) {
    parent.replaceChildren(
      toolbar,
      unavailable('Tests', options.testStatus.reason ?? 'The test runtime is unavailable.'),
    )
    return
  }
  if (options.testError !== undefined) {
    parent.replaceChildren(toolbar, unavailable('Tests', options.testError))
    return
  }
  const result = options.testStatus?.lastRun
  if (result === undefined) {
    parent.replaceChildren(toolbar, note('Run the project Tao tests, or enable Watch to rerun after compiles.'))
    return
  }
  const summary = document.createElement('strong')
  summary.textContent = result.status === 'no-tests'
    ? 'No Tao tests found.'
    : `${result.passed} passed · ${result.failed} failed · ${result.durationMs}ms`
  const failures = result.failures.map(failure => {
    const button = document.createElement('button')
    button.className = 'studio-drawer-row'
    button.type = 'button'
    button.textContent = `${failure.name} — ${failure.filePath}${failure.line === undefined ? '' : `:${failure.line}`}`
    button.addEventListener('click', () => options.onTestFailure(failure))
    return button
  })
  const output = document.createElement('pre')
  output.className = 'studio-test-output'
  output.textContent = result.output
  parent.replaceChildren(toolbar, summary, ...failures, output)
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
}

function bundleEditor(
  bundle: Extract<StudioDesignValue, { kind: 'bundle' }>,
  options: Parameters<typeof renderDesignValues>[1],
): HTMLElement {
  const form = document.createElement('section')
  form.className = 'studio-design-bundle'
  const heading = document.createElement('strong')
  heading.textContent = bundle.name
  const entry = document.createElement('select')
  for (const authored of bundle.entries) {
    const option = document.createElement('option')
    option.textContent = authored
    option.value = authored
    entry.append(option)
  }
  const property = document.createElement('input')
  const value = document.createElement('input')
  const load = (): void => {
    const [head = '', ...terms] = entry.value.trim().split(/\s+/)
    property.value = head
    value.value = terms.join(' ')
  }
  entry.addEventListener('change', load)
  load()
  const apply = document.createElement('button')
  apply.disabled = options.busy
    || options.renderId === undefined
    || options.selectedSourceVersion !== options.currentSourceVersion
  apply.textContent = 'Apply bundle entry'
  apply.type = 'button'
  apply.addEventListener('click', () => {
    if (options.renderId === undefined || property.value.trim() === '') {
      return
    }
    options.onAction({
      entry: [property.value.trim(), ...terms(value.value)],
      kind: 'set-style-entry',
      landing: { bundleName: bundle.name, kind: 'style-bundle', mode: 'edit' },
      renderId: options.renderId,
    })
  })
  form.append(heading, entry, property, value, apply)
  return form
}

function command(
  commandName: Extract<StudioCommandTarget, { kind: 'command' }>['command'],
  label: string,
  detail: string,
): StudioCommandItem {
  return item(`command:${commandName}`, 'Command', label, detail, { command: commandName, kind: 'command' })
}

function item(
  id: string,
  category: StudioCommandItem['category'],
  label: string,
  detail: string,
  target: StudioCommandTarget,
): StudioCommandItem {
  return { category, detail, id, label, search: `${category} ${label} ${detail}`.toLocaleLowerCase(), target }
}

function terms(value: string): readonly (number | string)[] {
  return value.trim().split(/\s+/).filter(Boolean).map(term => {
    const number = Number(term)
    return Number.isFinite(number) ? number : term
  })
}

function unavailable(title: string, reason: string): HTMLElement {
  const section = document.createElement('section')
  section.className = 'studio-unavailable'
  const heading = document.createElement('strong')
  heading.textContent = `${title} unavailable`
  section.append(heading, note(reason))
  return section
}

function note(text: string): HTMLElement {
  const element = document.createElement('p')
  element.className = 'studio-panel-note'
  element.textContent = text
  return element
}

function append(parent: HTMLDListElement, label: string, value: string): void {
  const dt = document.createElement('dt')
  const dd = document.createElement('dd')
  dt.textContent = label
  dd.textContent = value
  parent.append(dt, dd)
}
