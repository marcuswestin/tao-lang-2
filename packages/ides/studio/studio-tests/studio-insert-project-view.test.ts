import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { FS } from '@shared'
import { Expect, Test, withTaoFiles } from '@shared/test'
import { StudioProjectSession } from '../studio-src/StudioProjectSession'
import {
  studioProtocolChannel,
  studioProtocolVersion,
  studioSourceActionVersion,
} from '../studio-src/StudioProtocol'

Test(
  'Studio session imports a generated view with the loop row and refuses an outside-project declaration',
  async () => {
    await withTaoFiles('tao-studio-outside-view-', {
      'View1.tao': 'public view View1() { }',
    }, async outside => {
      await withTaoFiles('tao-studio-insert-generated-view-', {
        'Data.tao': 'public data Playlists / Playlist { Title text }',
        '@/studio/View1.tao': `
        use Playlist from ../../Data
        use Text from @tao/ui
        public view View1(Playlist) { render Text(Playlist.Title) }
      `,
        'Main.tao': `
        use Playlists, Playlist from ./Data
        use Col, Text from @tao/ui
        app Demo { view Main }
        view Main() {
          query Playlists = Playlists
          render Col() {
            loop Playlists / Playlist { Text(Playlist.Title) }
          }
        }
      `,
      }, async (paths, root) => {
        let compileCount = 0
        const session = await StudioProjectSession.open({
          async compile() {
            compileCount += 1
          },
          entryPath: paths['Main.tao'],
          projectRoot: root,
        })
        session.registerPreview({ previewInstanceId: 'insert-generated-view' })
        const original = await session.readFile('Main.tao')
        const generatedSource = await FS.readText(paths['@/studio/View1.tao'])
        const workspace = await Workspace.open(root)
        const before = await workspace.validate(paths['Main.tao'])
        Expect(before.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
        const target = AST.streamAllContents(before.entry.ast).filter(AST.isRender)
          .find(render => render.$cstNode?.text === 'Text(Playlist.Title)')
        Expect(target?.$cstNode).toBeDefined()
        const node = target!.$cstNode!
        const envelope = {
          action: {
            beforeId: `${paths['Main.tao']}:${node.offset}:${node.end}`,
            kind: 'insert-project-view',
            viewName: 'View1',
            viewSourcePath: paths['@/studio/View1.tao'],
          },
          channel: studioProtocolChannel,
          checkpoint: { id: 'insert-generated-view', phase: 'single' },
          identity: {
            ...session.identity(),
            occurrence: { nodeKind: 'render', renderOwner: 'Main' },
            path: original.path,
            previewInstanceId: 'insert-generated-view',
            sourceVersion: original.sourceVersion,
          },
          protocolVersion: studioProtocolVersion,
          requestId: 'insert-generated-view',
          sourceActionVersion: studioSourceActionVersion,
          type: 'source-action',
        } as const

        await Expect(session.applySourceAction({
          ...envelope,
          action: { ...envelope.action, viewSourcePath: outside['View1.tao'] },
          requestId: 'outside-project-view',
        })).rejects.toThrow('not a Tao file in the project')
        Expect(await FS.readText(paths['Main.tao'])).toBe(original.content)
        Expect(compileCount).toBe(0)

        const applied = await session.applySourceAction(envelope)
        Expect(applied.path).toBe('Main.tao')
        Expect(applied.checkpoint).toEqual({ id: 'insert-generated-view', status: 'committed' })
        Expect(applied.sourceVersion).not.toBe(original.sourceVersion)
        Expect(applied.content).toContain('use View1 from @/studio')
        Expect(applied.content).toContain('View1(Playlist: Playlist)\n         Text(Playlist.Title)')
        Expect(await FS.readText(paths['Main.tao'])).toBe(applied.content)
        Expect(await FS.readText(paths['@/studio/View1.tao'])).toBe(generatedSource)
        Expect(compileCount).toBe(1)
        const after = await (await Workspace.open(root)).validate(paths['Main.tao'])
        Expect(after.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
        const imported = after.entry.ast.statements.filter(AST.isUseStatement)
          .flatMap(AST.resolvedImportedDeclarations).find(declaration => declaration.name === 'View1')
        Expect.Is(imported, AST.isViewDeclaration)
        Expect(AST.getDocument(imported).uri.fsPath).toBe(paths['@/studio/View1.tao'])
      })
    })
  },
)
