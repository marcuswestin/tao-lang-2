import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { StudioFeedLoopSource } from '../studio-src/StudioFeedLoopSource'

const files = {
  'Main.tao': 'use Workspace from ./Data\nview Main(Workspace) {}',
  'Data.tao': `public data Workspaces / Workspace { Name text, Tasks (owned) }
public data Tasks / Task { Title text, Workspace }`,
  'Rows.tao':
    'use Task from ./Data\nuse Placeholder from @tao/ui\npublic view TaskCard(Task) { render Placeholder(Task.Title) }',
  '@/studio/View1.tao': `use Workspace from ../../Data
use Placeholder from @tao/ui
public view View1(Workspace) {
  #studio_rect_0072
  render Placeholder("Existing") [width 80, height 40]
}
scenarios View1 "sketch" { scenario "draft" { render () } }`,
}

Describe('Studio Feed loop proposals', () => {
  Test('proposes a typed collection loop with a private row view and preserves disk source', async () => {
    await withTaoFiles('tao-feed-loop-', files, async (paths, root) => {
      const result = await StudioFeedLoopSource.prepare({
        entryPath: paths['Main.tao'],
        fieldPath: ['Tasks'],
        parameterName: 'Workspace',
        projectRoot: root,
        rectId: 'r',
        sourceOverrides: {},
        viewName: 'View1',
      })
      const source = result.sources[paths['@/studio/View1.tao']]!
      Expect(source).toContain('loop Workspace.Tasks / TaskItem')
      Expect(source).toContain('TaskRow(Task: TaskItem)')
      Expect(source).toContain('view TaskRow(Task)')
      Expect(source).toContain('#studio_rect_0072')
      Expect(source).toContain('Col() [width 80, height 40]')
      Expect(source).not.toContain('Placeholder("Existing")')
      Expect(result.proposal).toEqual({
        collectionPath: 'Workspace.Tasks',
        entity: 'Task',
        generatedRowView: true,
        rowParameter: 'Task',
        rowView: 'TaskRow',
      })
      Expect(await FS.readText(paths['@/studio/View1.tao'])).toBe(files['@/studio/View1.tao'])
      const workspace = await Workspace.open(root, { sourceOverrides: result.sources })
      const parsed = await workspace.parseFiles([paths['Main.tao'], paths['@/studio/View1.tao']])
      const document = AST.getDocument(
        parsed.flatMap(result => result.files).find(file =>
          AST.getDocument(file.ast).uri.fsPath === paths['@/studio/View1.tao']
        )!.ast,
      )
      const rowView = document.parseResult.value.statements.filter(AST.isViewDeclaration).find(view =>
        view.name === 'TaskRow'
      )!
      const rowRender = AST.streamAllContents(document.parseResult.value).filter(AST.isRender).find(render =>
        render.view?.$refText === 'TaskRow'
      )!
      Expect(rowView.name).toBe('TaskRow')
      Expect(rowRender.view?.ref).toBe(rowView)
    })
  })

  Test('compiles package collection imports for generated and existing row views without writing sources', async () => {
    const packageView = files['@/studio/View1.tao'].replace('from ../../Data', 'from @model')
      .replace('scenarios View1 "sketch" { scenario "draft" { render () } }', '').trim()
    await withTaoFiles('tao-feed-loop-package-', {
      'Main.tao': 'app Feed { view Main } view Main() { render inject ```ts return null ``` }',
      '@model/Data.tao': files['Data.tao'],
      '@cards/Rows.tao': files['Rows.tao'].replace('from ./Data', 'from @model'),
      '@/studio/View1.tao': packageView,
    }, async (paths, root) => {
      for (const rowView of [undefined, { name: 'TaskCard', path: paths['@cards/Rows.tao'] }]) {
        const result = await StudioFeedLoopSource.prepare({
          entryPath: paths['Main.tao'],
          fieldPath: ['Tasks'],
          parameterName: 'Workspace',
          projectRoot: root,
          rectId: 'r',
          sourceOverrides: {},
          viewName: 'View1',
          ...(rowView === undefined ? {} : { rowView }),
        })
        const source = result.sources[paths['@/studio/View1.tao']]!
        Expect(source).toContain(rowView === undefined ? 'use Task from @model' : 'use TaskCard from @cards')
        const compiled = await (await Workspace.open(root, { sourceOverrides: result.sources }))
          .compileFiles([paths['Main.tao'], paths['@/studio/View1.tao']], { studio: true })
        Expect(compiled.studioManifest?.views.find(view => view.name === 'View1')?.parameters)
          .toContainEqual({
            name: 'Workspace',
            kind: 'entity',
            entity: 'Workspace',
            required: true,
            typeName: 'Workspace',
          })
        Expect(await FS.readText(paths['@/studio/View1.tao'])).toBe(packageView)
      }
    })
  })

  Test('uses a compatible public row view from another source and preserves root content when appended', async () => {
    await withTaoFiles('tao-feed-loop-existing-', files, async (paths, root) => {
      const result = await StudioFeedLoopSource.prepare({
        entryPath: paths['Main.tao'],
        fieldPath: ['Tasks'],
        parameterName: 'Workspace',
        projectRoot: root,
        rowView: { name: 'TaskCard', path: paths['Rows.tao'] },
        sourceOverrides: {},
        viewName: 'View1',
      })
      const source = result.sources[paths['@/studio/View1.tao']]!
      Expect(source).toContain('use TaskCard from ../../Rows.tao')
      Expect(source).toContain('TaskCard(Task: TaskItem)')
      Expect(source).toContain('Placeholder("Existing")')
      Expect(source).not.toContain('view TaskRow')
      Expect(result.proposal.generatedRowView).toBe(false)
    })
  })

  Test('rejects scalar collections and incompatible row views without a source proposal', async () => {
    await withTaoFiles('tao-feed-loop-rejected-', files, async (paths, root) => {
      const input = {
        entryPath: paths['Main.tao'],
        fieldPath: ['Name'],
        parameterName: 'Workspace',
        projectRoot: root,
        sourceOverrides: {},
        viewName: 'View1',
      }
      await Expect(StudioFeedLoopSource.prepare(input)).rejects.toThrow('entity collection')
      await Expect(
        StudioFeedLoopSource.prepare({
          ...input,
          fieldPath: ['Tasks'],
          rowView: { name: 'Main', path: paths['Main.tao'] },
        }),
      ).rejects.toThrow('different public project view')
    })
  })
})
