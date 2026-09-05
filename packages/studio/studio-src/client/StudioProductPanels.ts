import { studioPaletteComponents, type StudioProjectViewPaletteItem } from '../StudioInspector'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import type { StudioFile } from './StudioApiClient'

export {
  type StudioDrawerTab,
  StudioPanelBounds,
  StudioPanelModels,
} from './StudioPanelProjection'

type StudioCommandTarget =
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
    if (terms.length === 0) {
      return items
    }
    const matched = items.filter(item => terms.every(term => item.search.includes(term)))
    // A command named for what you typed outranks one that merely mentions those words in its
    // description. `search` folds label and detail together, so without this "show compile" ranks
    // "Show Problems" first on its "compile diagnostics" detail and buries "Show Compile".
    const named = (item: StudioCommandItem): boolean =>
      terms.every(term => item.label.toLocaleLowerCase().includes(term))
    return [...matched.filter(named), ...matched.filter(item => !named(item))]
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

function note(text: string): HTMLElement {
  const element = document.createElement('p')
  element.className = 'studio-panel-note'
  element.textContent = text
  return element
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
