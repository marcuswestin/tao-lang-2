import type TR from '@runtime/TR'
import { FS } from '@shared'
import { Expect, Test } from '@shared/test'
import React from 'react'
import {
  FileCreateBar,
  FilesPanelSurface,
  productHostStyle,
  TreeFileRow,
  type TreeFileRowProps,
  TreeFolder,
} from '../studio-src/TaoStudioProductHost'

Test('Tao Studio product host retains viewport ownership over generated Tao layout', () => {
  Expect(productHostStyle({ height: 36, position: 'relative', width: 120 })).toMatchObject({
    bottom: 0,
    height: 'auto',
    left: 0,
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    position: 'fixed',
    right: 0,
    top: 0,
    width: 'auto',
  })
})

Test('Tao Studio uses a content-only navigator and keeps recursive file CRUD in Tao', async () => {
  const source = await FS.readText(FS.resolvePath('../studio-src/TaoStudioClient.tao', import.meta.dir))

  Expect(source).toContain('Navigator SlotNav')
  Expect(source).not.toContain('StackNav')
  Expect(source).not.toContain('Title "Tao Studio"')
  Expect(source).not.toContain('FormButton')
  Expect(source).not.toContain('TextInput')
  Expect(source).toContain('ServerOrigin text is ""')
  Expect(source).toContain('action SyncDraft(Path text, SourceVersion text, Content text) runs latest')
  Expect(source).toContain('@editor StudioEditorSurface()')
  Expect(source).toContain('@inspector StudioContextPanel(')
  Expect(source).toContain('view StudioContextPanel(Revision number, ProjectRoot text, ActiveFilePath text')
  Expect(source).toContain('FilePath: ActiveFilePath')
  Expect(source).toContain('accepts content slots @files, @editor, @inspector')
  Expect(source).toContain('query Files as Children')
  Expect(source).toContain('FileTree(File.Path)')
  Expect(source).toContain('do CreateFile(NewPath)')
  Expect(source).toContain('do RenameFile(Path: File.Path, SourceVersion: File.Version, TargetPath: RenamePath)')
  Expect(source).toContain('do DeleteFile(Path: File.Path, SourceVersion: File.Version)')
})

Test('Tao Studio foreign file views render compact tree rows with contextual editing controls', () => {
  const action = noArgAction()
  const textAction = textArgAction()
  const surface = FilesPanelSurface({ children: React.createElement('span', null, 'Project tree') })
  const create = FileCreateBar({
    Change: textAction,
    Create: action,
    Path: 'Folder/New.tao',
  })
  const folder = TreeFolder({
    Expanded: true,
    Label: 'Folder',
    Toggle: action,
    children: React.createElement('span', null, 'Nested file'),
  })
  const compact = TreeFileRow(fileRowProps({}))
  const renaming = TreeFileRow(fileRowProps({ Renaming: true }))
  const deleting = TreeFileRow(fileRowProps({ ConfirmDelete: true }))

  Expect(property(surface, 'data-studio-files-surface')).toBe('compact')
  Expect(textContent(surface)).toBe('Project tree')
  Expect(property(create, 'data-studio-file-create')).toBe('compact')
  Expect(property(elementWith(create, 'aria-label', 'New Tao file path'), 'style')).toMatchObject({ height: 24 })
  Expect(property(elementWith(folder, 'aria-expanded', true), 'aria-expanded')).toBe(true)
  Expect(textContent(folder)).toContain('Nested file')
  Expect(property(compact, 'data-studio-tree-file')).toBe('Folder/Roadmap.tao')
  Expect(elementWith(compact, 'aria-label', 'Unsaved draft')).toBeDefined()
  Expect(elementWith(compact, 'aria-label', '2 problems')).toBeDefined()
  Expect(elements(compact).some(element => property(element, 'aria-label') === 'Save rename')).toBe(false)
  Expect(elements(compact).some(element => property(element, 'role') === 'alert')).toBe(false)
  Expect(elementWith(renaming, 'aria-label', 'Save rename')).toBeDefined()
  Expect(property(elementWith(renaming, 'aria-label', 'New path for Roadmap.tao'), 'value'))
    .toBe('Folder/Roadmap.tao')
  Expect(elementWith(deleting, 'role', 'alert')).toBeDefined()
  Expect(textContent(deleting)).toContain('Delete Roadmap.tao?')
})

function fileRowProps(overrides: Partial<TreeFileRowProps>): TreeFileRowProps {
  const action = noArgAction()
  return {
    BeginDelete: action,
    BeginRename: action,
    CancelDelete: action,
    CancelRename: action,
    ChangeRenamePath: textArgAction(),
    ConfirmDelete: false,
    Delete: action,
    DiagnosticCount: 2,
    Dirty: true,
    Name: 'Roadmap.tao',
    Open: action,
    Path: 'Folder/Roadmap.tao',
    Rename: action,
    RenamePath: 'Folder/Roadmap.tao',
    Renaming: false,
    ...overrides,
  }
}

function noArgAction(): TR.ActionValue<[]> {
  return { invoke() {} } as unknown as TR.ActionValue<[]>
}

function textArgAction(): TR.ActionValue<[TR.Value<string>]> {
  return { invoke() {} } as unknown as TR.ActionValue<[TR.Value<string>]>
}

type HostElement = React.ReactElement<Record<string, unknown>>

function elements(node: React.ReactNode): HostElement[] {
  if (Array.isArray(node)) {
    return node.flatMap(elements)
  }
  if (!React.isValidElement<Record<string, unknown>>(node)) {
    return []
  }
  return [node, ...elements(node.props['children'] as React.ReactNode)]
}

function elementWith(root: React.ReactElement, name: string, value: unknown): HostElement {
  const found = elements(root).find(element => property(element, name) === value)
  if (found === undefined) {
    throw new Error(`Expected Studio product-host element with ${name}=${String(value)}.`)
  }
  return found
}

function property(element: React.ReactElement, name: string): unknown {
  return (element.props as Record<string, unknown>)[name]
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(textContent).join('')
  }
  return React.isValidElement<Record<string, unknown>>(node)
    ? textContent(node.props['children'] as React.ReactNode)
    : ''
}
