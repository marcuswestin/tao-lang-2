import { FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  discoverStudioProjectRoots,
  resolveStudioProjectRoot,
} from '../studio-src/StudioProjectRoot'

Test('Studio project root selection keeps a folder that directly owns one project declaration', async () => {
  await withProjectFolders({
    'Project.tao': 'project { id "root" name "Root" }',
    'Sources/View.tao': 'view Main() { }',
  }, async root => {
    const resolution = await resolveStudioProjectRoot(root)

    Expect(resolution).toEqual({
      inputRoot: await FS.realPath(root),
      projectRoot: await FS.realPath(root),
      selectedDescendant: false,
    })
  })
})

Test('Studio project root selection resolves a family folder to its sole nested project', async () => {
  await withProjectFolders({
    '1 - Current/WordFlower.tao': 'project { id "word-flower" name "WordFlower" }',
    '1 - Current/@nav/Navigation.tao': 'type Navigation { }',
    '2 - Next/@nav/Navigation.tao-next': 'type Navigation { }',
    'README.md': 'Project family',
  }, async root => {
    const current = await FS.realPath(FS.resolvePath('1 - Current', root))
    const resolution = await resolveStudioProjectRoot(root)

    Expect(resolution).toEqual({
      inputRoot: await FS.realPath(root),
      projectRoot: current,
      selectedDescendant: true,
    })
    Expect(await discoverStudioProjectRoots(root)).toEqual([current])
  })
})

Test('Studio project root selection reports no candidate and asks for one project root', async () => {
  await withProjectFolders({
    'Notes.tao': 'view Notes() { }',
    'Nested/TwoProjects.tao': 'project { name "One" }\nproject { name "Two" }',
  }, async root => {
    await Expect(resolveStudioProjectRoot(root)).rejects.toThrow(
      `Candidates:\n  (none)\nPass one project root to ./dev studio.`,
    )
  })
})

Test('Studio project root selection lists multiple candidates and asks for one project root', async () => {
  await withProjectFolders({
    'Alpha/Project.tao': 'project { id "alpha" name "Alpha" }',
    'Beta/App.tao': 'project { id "beta" name "Beta" }',
  }, async root => {
    const alpha = await FS.realPath(FS.resolvePath('Alpha', root))
    const beta = await FS.realPath(FS.resolvePath('Beta', root))

    await Expect(resolveStudioProjectRoot(root)).rejects.toThrow(
      `Candidates:\n  ${alpha}\n  ${beta}\nPass one project root to ./dev studio.`,
    )
  })
})

async function withProjectFolders(
  files: Readonly<Record<string, string>>,
  testFunction: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkTestDir('tao-studio-project-root-')
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      await FS.writeText(FS.resolvePath(relativePath, root), source)
    }
    await testFunction(root)
  } finally {
    await FS.remove(root)
  }
}
