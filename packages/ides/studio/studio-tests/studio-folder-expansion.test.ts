import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  StudioFolderIsExpanded,
  StudioToggleFolder,
} from '../studio-src/StudioFolderExpansion'

Describe('Tao Studio persisted folder expansion', () => {
  Test('owns recursive folder expansion in persisted app state with an explicit root binding', async () => {
    const source = (await Promise.all([
      'TaoStudioClient.tao',
      '@ui/Explorer.tao',
    ].map(path => FS.readText(Repo.resolvePath(`Apps/Tao Studio/${path}`))))).join('\n')

    Expect(source).toContain('state CollapsedFolders is list of text = [] (persist)')
    Expect(source).toContain('action ToggleFolder(FolderPath text)')
    Expect(source).toContain(
      'Initial StudioRoot(CollapsedFolders: CollapsedFolders, ToggleFolder: ToggleFolder)',
    )
    Expect(source).toContain('do ToggleFolder(FolderPath)')
    Expect(source).not.toContain('state Expanded = true')
  })

  Test('keeps folders expanded by default and toggles stable paths independently', () => {
    Expect(StudioFolderIsExpanded([], 'Features')).toBe(true)

    const oneCollapsed = StudioToggleFolder([], 'Features')
    Expect(oneCollapsed).toEqual(['Features'])
    Expect(StudioFolderIsExpanded(oneCollapsed, 'Features')).toBe(false)
    Expect(StudioFolderIsExpanded(oneCollapsed, 'Other')).toBe(true)

    const twoCollapsed = StudioToggleFolder(oneCollapsed, 'Other')
    Expect(twoCollapsed).toEqual(['Features', 'Other'])
    Expect(StudioToggleFolder(twoCollapsed, 'Features')).toEqual(['Other'])
  })

  Test('canonicalizes duplicate persisted paths while toggling', () => {
    Expect(StudioToggleFolder(['Other', 'Features', 'Other'], 'Nested')).toEqual([
      'Features',
      'Nested',
      'Other',
    ])
  })
})
