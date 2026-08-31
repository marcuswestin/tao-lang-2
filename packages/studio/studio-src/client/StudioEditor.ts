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

/** Opens the exact Tao source observed by a preview, selects its range, and centers it in the editor. */
export const StudioSourceNavigation = {
  async openAndSelect(options: {
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
    opened.editor.focus()
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
