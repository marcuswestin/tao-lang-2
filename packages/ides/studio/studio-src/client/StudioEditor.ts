import { EditorState, type Extension } from '@codemirror/state'
import { basicSetup, EditorView } from 'codemirror'
import type { StudioDraftFile } from '../StudioDraftSync'
import type { StudioEditorSnippet } from '../StudioInspector'
import type { StudioSourceIdentity, StudioSourceRange } from '../StudioProtocol'
import type { StudioDiagnosticRange } from './StudioApiClient'

export type StudioOpenFileAttempt = {
  isCurrent: () => boolean
}

/** CodeMirror's standard keymap plus the Tao syntax data its commands require. */
export const StudioCodeEditor = {
  extension: [
    basicSetup,
    EditorState.languageData.of(() => [{ commentTokens: { line: '//' } }]),
  ] as Extension,
} as const

/** Identifies Studio's explicit save shortcut without consuming unrelated browser commands. */
export function isStudioSaveShortcut(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>): boolean {
  return !event.altKey && (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's'
}

/**
 * The letter a shortcut names, lowercased. `key` follows the person's keyboard layout, as the save
 * shortcut does; ⌥ turns it into a symbol on macOS (⌥G is "©"), so only then is the physical key read.
 * The preview runtime keeps a copy (`shortcutLetter` in TR-studio-preview); keep the two in step.
 */
export function studioShortcutLetter(event: Pick<KeyboardEvent, 'altKey' | 'code' | 'key'>): string | undefined {
  if (event.altKey) {
    return event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : undefined
  }
  return event.key.toLowerCase()
}

/** Invalidates async file opens as soon as a newer navigation begins. */
export class StudioOpenFileLifecycle {
  #revision = 0

  begin(): StudioOpenFileAttempt {
    const revision = ++this.#revision
    return { isCurrent: () => revision === this.#revision }
  }
}

export type StudioSourceEditor = {
  editor: EditorView
  file: StudioDraftFile
}

/**
 * Opens the exact Tao source observed by a preview, selects its range, and centers it in the editor.
 * `focus: false` follows the selection without taking the keyboard, for when the canvas owns input.
 */
export const StudioSourceNavigation = {
  async openAndSelect(options: {
    focus?: boolean
    identity: StudioSourceIdentity
    openFile: (path: string) => Promise<StudioSourceEditor | undefined>
    project: string
    range: StudioSourceRange
  }): Promise<StudioSourceEditor | undefined> {
    const path = projectSourcePath(options.project, options.identity.path)
    if (path === undefined || !validSourceRange(options.range)) {
      return undefined
    }
    const opened = await options.openFile(path)
    if (
      opened === undefined
      || opened.file.path !== path
      || opened.file.sourceVersion !== options.identity.sourceVersion
      || options.range.end > opened.editor.state.doc.length
    ) {
      return undefined
    }
    opened.editor.dispatch({
      effects: EditorView.scrollIntoView(options.range.start, { y: 'center' }),
      selection: { anchor: options.range.start, head: options.range.end },
    })
    if (options.focus !== false) {
      opened.editor.focus()
    }
    return opened
  },
} as const

/** Converts a zero-based compiler range into a bounded CodeMirror selection. */
export const StudioDiagnosticNavigation = {
  selection(
    document: { line(number: number): { from: number; to: number }; lines: number },
    range: StudioDiagnosticRange,
  ): { anchor: number; head: number } {
    const startLine = document.line(Math.min(document.lines, Math.max(1, range.start.line + 1)))
    const endLine = document.line(Math.min(document.lines, Math.max(1, range.end.line + 1)))
    const anchor = Math.min(startLine.to, startLine.from + Math.max(0, range.start.character))
    const head = Math.max(anchor, Math.min(endLine.to, endLine.from + Math.max(0, range.end.character)))
    return { anchor, head }
  },
} as const

/** Selects the complete source line containing a declaration's parser-owned start offset. */
export const StudioDefinitionNavigation = {
  selection(
    document: { length: number; lineAt(position: number): { from: number; to: number } },
    start: number,
  ): { anchor: number; head: number } {
    const line = document.lineAt(Math.min(document.length, Math.max(0, start)))
    return { anchor: line.from, head: line.to }
  },
} as const

/**
 * Replaces a document and names the caret in one transaction. A wholesale insert without an explicit
 * selection remaps a cursor to 0 and a range onto the whole new text — the host's echo of a cut.
 */
export function studioHostDocumentUpdate(
  documentLength: number,
  content: string,
  selection: Readonly<{ anchor: number; head: number }>,
): {
  changes: { from: number; insert: string; to: number }
  selection: { anchor: number; head: number }
} {
  const length = content.length
  return {
    changes: { from: 0, insert: content, to: documentLength },
    selection: {
      anchor: Math.max(0, Math.min(selection.anchor, length)),
      head: Math.max(0, Math.min(selection.head, length)),
    },
  }
}

/** StudioEditorInsertion preserves Tao snippet indentation and selects its first required placeholder. */
export const StudioEditorInsertion = {
  transaction(
    document: { lineAt(position: number): { from: number; text: string } },
    snippet: StudioEditorSnippet,
    position: number,
  ): { changes: { from: number; insert: string; to: number }; selection: { anchor: number; head: number } } {
    const line = document.lineAt(position)
    const indent = /^[ \t]*/.exec(line.text)?.[0] ?? ''
    const insert = snippet.text.replaceAll('\n', `\n${indent}`)
    const first = snippet.placeholders[0]
    const selection = first === undefined
      ? { anchor: position + insert.length, head: position + insert.length }
      : {
        anchor: position + expandedOffset(snippet.text, first.start, indent.length),
        head: position + expandedOffset(snippet.text, first.end, indent.length),
      }
    return { changes: { from: position, insert, to: position }, selection }
  },
} as const

function expandedOffset(text: string, offset: number, indentLength: number): number {
  return offset + (text.slice(0, offset).match(/\n/g)?.length ?? 0) * indentLength
}

export function fileUri(project: string, path?: string): string {
  const absolutePath = path === undefined ? project : absoluteSourcePath(project, path)
  return `file://${
    absolutePath.split('/').map((part, index) => index === 0 ? part : encodeURIComponent(part)).join('/')
  }`
}

export function absoluteSourcePath(project: string, path: string): string {
  return `${project.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

export function projectRelativePath(project: string, sourcePath: string): string | undefined {
  const prefix = `${project.replace(/\/$/, '')}/`
  return sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : undefined
}

/**
 * A Studio scenario or cell id is `<absolute source path>#scenario:<group>:<entry>`, optionally
 * followed by `#cell`, with both names URI-encoded by the preview manifest. People know the cell as
 * "group › entry"; anything that is not such an id is shown as it is.
 */
export function studioCellLabel(id: string): string {
  const marker = id.lastIndexOf('#scenario:')
  if (marker < 0) {
    return id
  }
  return id.slice(marker + '#scenario:'.length).replace(/#cell$/u, '').split(':').map(decodeName).join(' › ')
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** Accepts canonical absolute identities and project-relative identities without navigating outside the project. */
function projectSourcePath(project: string, sourcePath: string): string | undefined {
  const relative = projectRelativePath(project, sourcePath)
  if (relative !== undefined) {
    return validProjectRelativePath(relative) ? relative : undefined
  }
  return validProjectRelativePath(sourcePath) ? sourcePath : undefined
}

function validProjectRelativePath(path: string): boolean {
  return path !== ''
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function validSourceRange(range: StudioSourceRange): boolean {
  return Number.isInteger(range.start)
    && Number.isInteger(range.end)
    && range.start >= 0
    && range.end >= range.start
}

export function sanitizeLspHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  for (const unsafe of template.content.querySelectorAll('script, style, iframe, object, embed, link, meta, base')) {
    unsafe.remove()
  }
  for (const element of template.content.querySelectorAll<HTMLElement>('*')) {
    for (const attribute of [...element.attributes]) {
      const value = attribute.value.trim().toLowerCase()
      if (attribute.name.toLowerCase().startsWith('on') || value.startsWith('javascript:')) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return template.innerHTML
}
