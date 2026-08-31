import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import type { StudioCompileDiagnostic } from './StudioApiClient'

export type StudioScreenItem = Readonly<{
  id: string
  kind: 'app' | 'view'
  label: string
  path: string
  start: number
}>

export type StudioSearchDocument = Readonly<{ content: string; path: string; sourceVersion?: string }>

export type StudioSearchResult = Readonly<{
  detail: string
  end?: number
  kind: 'diagnostic' | 'text'
  label: string
  path: string
  range?: StudioCompileDiagnostic['range']
  sourceVersion?: string
  start?: number
}>

/** Pure rail-panel models keep screen and search behavior independently testable. */
export const StudioRailPanels = {
  screens(manifest: StudioPreviewManifestV2 | undefined): readonly StudioScreenItem[] {
    return (manifest?.subjects ?? []).map(subject => ({
      id: subject.subjectId,
      kind: subject.kind,
      label: subject.kind === 'app' ? subject.appName : subject.viewName,
      path: subject.source.path,
      start: subject.source.range.start,
    }))
  },

  search(
    documents: readonly StudioSearchDocument[],
    diagnostics: readonly StudioCompileDiagnostic[],
    query: string,
    sourceVersions: Readonly<Record<string, string>> = {},
  ): readonly StudioSearchResult[] {
    const needle = query.trim().toLocaleLowerCase()
    if (needle === '') {
      return []
    }
    const results: StudioSearchResult[] = []
    for (const diagnostic of diagnostics) {
      if (diagnostic.filePath !== undefined && diagnostic.message.toLocaleLowerCase().includes(needle)) {
        results.push({
          detail: diagnostic.message,
          kind: 'diagnostic',
          label: `Problem · ${fileLabel(diagnostic.filePath)}`,
          path: diagnostic.filePath,
          ...(diagnostic.range === undefined ? {} : { range: diagnostic.range }),
          ...(sourceVersions[diagnostic.filePath] === undefined
            ? {}
            : { sourceVersion: sourceVersions[diagnostic.filePath] }),
        })
      }
    }
    for (const document of documents) {
      const lower = document.content.toLocaleLowerCase()
      let start = lower.indexOf(needle)
      while (start !== -1 && results.length < 100) {
        const lineStart = document.content.lastIndexOf('\n', start - 1) + 1
        const lineEnd = document.content.indexOf('\n', start)
        results.push({
          detail: document.content.slice(lineStart, lineEnd === -1 ? document.content.length : lineEnd).trim(),
          end: start + query.trim().length,
          kind: 'text',
          label: `${fileLabel(document.path)}:${lineNumber(document.content, start)}`,
          path: document.path,
          ...(document.sourceVersion === undefined ? {} : { sourceVersion: document.sourceVersion }),
          start,
        })
        start = lower.indexOf(needle, start + Math.max(1, needle.length))
      }
      if (results.length >= 100) {
        break
      }
    }
    return results.slice(0, 100)
  },
} as const

export function renderScreens(
  parent: HTMLElement,
  manifest: StudioPreviewManifestV2 | undefined,
  open: (item: StudioScreenItem) => void,
): void {
  const heading = document.createElement('h2')
  heading.textContent = 'Screens'
  const items = StudioRailPanels.screens(manifest)
  const content = items.map(item => {
    const button = document.createElement('button')
    button.className = 'studio-screen-item'
    button.type = 'button'
    button.dataset['studioScreen'] = item.id
    button.textContent = item.label
    button.title = `${item.kind} · ${item.path}`
    button.addEventListener('click', () => open(item))
    return button
  })
  if (content.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'studio-palette-empty'
    empty.textContent = 'No manifest screens are available yet.'
    parent.replaceChildren(heading, empty)
  } else {
    parent.replaceChildren(heading, ...content)
  }
}

export function renderSearchResults(
  parent: HTMLElement,
  results: readonly StudioSearchResult[],
  open: (result: StudioSearchResult) => void,
): void {
  if (results.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'studio-palette-empty'
    empty.textContent = 'No project text or diagnostics match.'
    parent.replaceChildren(empty)
    return
  }
  parent.replaceChildren(...results.map(result => {
    const button = document.createElement('button')
    button.className = 'studio-search-result'
    button.type = 'button'
    button.setAttribute('role', 'option')
    const label = document.createElement('strong')
    label.textContent = result.label
    const detail = document.createElement('span')
    detail.textContent = result.detail
    button.append(label, detail)
    button.addEventListener('click', () => open(result))
    return button
  }))
}

function fileLabel(path: string): string {
  return path.split('/').at(-1) ?? path
}

function lineNumber(content: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (content[index] === '\n') {
      line += 1
    }
  }
  return line
}
