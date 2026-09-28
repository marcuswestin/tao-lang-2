import { Langium, Parser, URI } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('language server workspace indexing', () => {
  Test('indexes project Tao files and skips generated and hidden directories', () => {
    const manager = Parser.createLspContext().services.shared.workspace.WorkspaceManager
    manager.initialize({
      processId: null,
      rootUri: null,
      capabilities: {},
      workspaceFolders: [{ name: 'Demo', uri: URI.file('/projects/Demo').toString() }],
    })

    Expect(included(manager, '/projects/Demo/Main.tao')).toBe(true)
    Expect(included(manager, '/projects/Demo/.artifacts/scratch/Ghost.tao')).toBe(false)
    Expect(included(manager, '/projects/Demo/node_modules/pkg/File.tao')).toBe(false)
    Expect(included(manager, '/projects/Demo/ios/Generated.tao')).toBe(false)
  })

  Test('drops a Tao file that disappears before the language server reads it', async () => {
    await withTaoFiles(
      'tao-language-server-missing-',
      { 'Main.tao': 'view Main() { }' },
      async paths => {
        const { services } = Parser.createContext()
        const documents = services.shared.workspace.LangiumDocuments
        const uri = URI.file(paths['Main.tao'])
        documents.addDocument(await services.shared.workspace.LangiumDocumentFactory.fromUri(uri))
        await FS.remove(paths['Main.tao'])

        await services.shared.workspace.DocumentBuilder.update([uri], [])

        Expect(documents.hasDocument(uri)).toBe(false)
      },
    )
  })

  Test('indexes a new project file from the watcher and ignores a hidden one', async () => {
    await withTaoFiles(
      'tao-language-server-watch-',
      { 'Main.tao': 'view Main() { }' },
      async (_paths, rootDir) => {
        const { services } = Parser.createLspContext()
        const manager = services.shared.workspace.WorkspaceManager
        manager.initialize({
          processId: null,
          rootUri: null,
          capabilities: {},
          workspaceFolders: [{ name: 'Demo', uri: URI.file(rootDir).toString() }],
        })
        await manager.initialized({})

        const extraPath = FS.resolvePath('Extra.tao', rootDir)
        const ghostPath = FS.resolvePath('.artifacts/scratch/Ghost.tao', rootDir)
        await FS.writeFile(extraPath, 'view Extra() { }\n')
        await FS.writeFile(ghostPath, 'view Ghost() { }\n')
        const extraUri = URI.file(extraPath)
        const ghostUri = URI.file(ghostPath)
        services.shared.lsp.DocumentUpdateHandler.didChangeWatchedFiles?.({
          changes: [
            { uri: extraUri.toString(), type: Langium.FileChangeType.Created },
            { uri: ghostUri.toString(), type: Langium.FileChangeType.Created },
          ],
        })
        await Promise.resolve()
        await services.shared.workspace.WorkspaceLock.write(() => undefined)

        const documents = services.shared.workspace.LangiumDocuments
        Expect(documents.hasDocument(extraUri)).toBe(true)
        Expect(documents.hasDocument(ghostUri)).toBe(false)
      },
    )
  })
})

function included(
  manager: { shouldIncludeEntry(entry: { isFile: boolean; isDirectory: boolean; uri: URI }): boolean },
  path: string,
): boolean {
  return manager.shouldIncludeEntry({ isFile: true, isDirectory: false, uri: URI.file(path) })
}
