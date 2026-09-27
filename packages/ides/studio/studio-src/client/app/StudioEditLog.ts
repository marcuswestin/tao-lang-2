import type { StudioCanonicalSourceAction } from '../../StudioProtocol'
import { sourceActionLabel } from '../StudioVisualEditing'

/** One committed visual edit, newest first in the log; only the newest in the open file can be walked back. */
export type StudioEditLogEntry = Readonly<{
  at: number
  id: string
  label: string
  path: string
  undoable: boolean
}>

export type StudioEditLogDeps = Readonly<{
  edits: () => readonly StudioEditLogEntry[]
  host: HTMLElement
  now?: () => number
  undo: () => void
}>

/** How much of the log stays on screen; older edits are still walked back one ⌘Z at a time. */
const visibleEdits = 8

/**
 * Names an edit the way the person made it: "Gap 16", "Wrap in Row", "Make view Card". Kinds without
 * a phrase here fall back to their spelled-out kind.
 */
export function studioEditLabel(action: StudioCanonicalSourceAction): string {
  return Object.hasOwn(editPhrases, action.kind)
    ? editPhrases[action.kind]!(action)
    : capitalized(sourceActionLabel(action))
}

const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined

const entryPhrase = (action: StudioCanonicalSourceAction): string =>
  Array.isArray(action['entry']) ? capitalized(action['entry'].join(' ')) : capitalized(sourceActionLabel(action))

const editPhrases: Readonly<Record<string, (action: StudioCanonicalSourceAction) => string>> = {
  'extract-view': action => ['Make view', text(action['name'])].filter(part => part !== undefined).join(' '),
  'group-renders': action => `Group in ${text(action['wrapper']) ?? 'container'}`,
  'insert-component': action => `Insert ${text(action['component']) ?? 'component'}`,
  'insert-project-view': action => `Insert ${text(action['viewName']) ?? 'view'}`,
  'move-render': () => 'Move element',
  'remove-render': () => 'Remove element',
  'set-design-entry': entryPhrase,
  'set-layout-entry': entryPhrase,
  'set-style-entry': entryPhrase,
  'set-text-content': action => `Text “${text(action['content']) ?? ''}”`,
  'wrap-render': action => `Wrap in ${text(action['wrapper']) ?? 'container'}`,
}

/** ⌘Z without Shift; ⇧⌘Z stays redo wherever redo exists. */
export function isStudioVisualUndoShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'code' | 'ctrlKey' | 'isComposing' | 'metaKey' | 'shiftKey'>,
): boolean {
  return !event.isComposing && !event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey)
    && event.code === 'KeyZ'
}

/** A short age: "now", then minutes, hours, and days. */
export function studioEditAge(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) {
    return 'now'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

/**
 * The edit log floats over the canvas corner in Design and Draw: every visual edit this session, newest
 * first, each with its age. ⌘Z or the newest row's Undo walks it back; an empty log hides itself.
 */
export function mountStudioEditLog(deps: StudioEditLogDeps): Readonly<{ dispose: () => void; render: () => void }> {
  const now = deps.now ?? Date.now
  const root = document.createElement('section')
  root.className = 'studio-edit-log'
  root.dataset['taoStudioEditLog'] = ''
  root.setAttribute('aria-label', 'Edits')
  root.hidden = true
  deps.host.append(root)

  const render = (): void => {
    // Mounting the preview matrix replaces the host's children, so the log re-attaches when it renders.
    if (root.parentElement !== deps.host) {
      deps.host.append(root)
    }
    const edits = deps.edits()
    root.hidden = edits.length === 0
    const header = document.createElement('header')
    const title = document.createElement('strong')
    title.textContent = 'Edits'
    const hint = document.createElement('span')
    hint.textContent = '⌘Z walks back'
    header.append(title, hint)
    const list = document.createElement('ol')
    const moment = now()
    for (const edit of edits.slice(0, visibleEdits)) {
      const item = document.createElement('li')
      item.dataset['taoStudioEdit'] = edit.id
      const label = document.createElement('span')
      label.className = 'studio-edit-log-label'
      label.textContent = edit.label
      label.title = edit.path
      const age = document.createElement('time')
      age.dateTime = new Date(edit.at).toISOString()
      age.textContent = studioEditAge(edit.at, moment)
      item.append(label, age)
      if (edit.undoable) {
        const undo = document.createElement('button')
        undo.type = 'button'
        undo.textContent = 'Undo'
        undo.addEventListener('click', () => deps.undo())
        item.append(undo)
      }
      list.append(item)
    }
    root.replaceChildren(header, list)
  }
  // Ages move on without any edit, so the log refreshes itself while it is showing.
  const timer = setInterval(() => {
    if (!root.hidden) {
      render()
    }
  }, 30_000)
  render()
  return {
    dispose() {
      clearInterval(timer)
      root.remove()
    },
    render,
  }
}

function capitalized(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`
}
