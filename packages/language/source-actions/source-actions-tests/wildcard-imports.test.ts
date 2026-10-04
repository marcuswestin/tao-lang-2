import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Assert, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions from '../source-actions-src/source-actions'
import { ensureNamedImport } from '../source-actions-src/studio/studio-use-imports'

const emptyRender = 'render inject ```ts return null ```'

Describe('wildcard import source actions', () => {
  Test('organizes a named public binding supplied by a same-source wildcard in either order', async () => {
    for (
      const imports of ['use all from ./Cards\nuse Card from ./Cards', 'use Card from ./Cards\nuse all from ./Cards']
    ) {
      await withTaoFiles('tao-wildcard-redundant-', {
        'Cards.tao': `public view Card() { ${emptyRender} }`,
        'Main.tao': `${imports}\nview Main() { render Card() }`,
      }, async paths => {
        const parsed = await Workspace.validate(paths['Main.tao'])
        Expect(
          parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code),
        )
          .toEqual(['tao-repeated-import'])
        const organized = await SourceActions.organizeSource(parsed.entry.document)
        Expect(organized).toBe('use all from ./Cards\n\nview Main() {\n   render Card()\n}\n')
        await FS.writeText(paths['Main.tao'], organized!)
        const updated = await validatedDocument(paths['Main.tao'])
        Expect(await SourceActions.organizeSource(updated)).toBeUndefined()
        const render = AST.streamAllContents(updated.parseResult.value).filter(AST.isRender)[0]
        Assert.defined(render?.view?.ref, 'organized Card render resolves')
        Expect(AST.getDocument(render.view.ref).uri.fsPath).toBe(paths['Cards.tao'])
      })
    }
  })

  Test('organize keeps a named binding that adds a project type peer to a public wildcard value', async () => {
    await withTaoFiles('tao-wildcard-namespace-peer-', {
      'Cards.tao': `public view Card() { ${emptyRender} }\nproject type Card is text`,
      'Main.tao': `
        use all from ./Cards
        use Card from ./Cards
        let Label = Card "Ada"
        view Main() { render Card() }
      `,
    }, async paths => {
      const parsed = await Workspace.validate(paths['Main.tao'])
      Expect(
        parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code),
      )
        .toEqual(['tao-repeated-import'])
      const organized = await SourceActions.organizeSource(parsed.entry.document)
      Expect(organized).toBe(
        'use all from ./Cards\nuse Card from ./Cards\n\nlet Label = Card "Ada"\n\n'
          + 'view Main() {\n   render Card()\n}\n',
      )
      await FS.writeText(paths['Main.tao'], organized!)
      const updated = await Workspace.validate(paths['Main.tao'])
      Expect(
        updated.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code),
      )
        .toEqual(['tao-repeated-import'])
      const uses = updated.entry.ast.statements.filter(AST.isUseStatement)
      Expect(AST.resolvedImportedDeclarations(uses[0]!).map(AST.declarationNamespace)).toEqual(['value'])
      Expect(AST.resolvedImportedDeclarations(uses[1]!).map(AST.declarationNamespace).toSorted()).toEqual([
        'type',
        'value',
      ])
      Expect(await SourceActions.organizeSource(updated.entry.document)).toBeUndefined()
    })
  })

  Test('organizes unused wildcard imports with comments and keeps a project-visible named import', async () => {
    await withTaoFiles('tao-wildcard-organize-', {
      'Cards.tao': `public view Card() { ${emptyRender} }\nproject view Internal() { ${emptyRender} }`,
      'Main.tao': `
        view Main() { render Internal() }
        // public cards
        use all from ./Cards
        // internal card
        use Internal from ./Cards
        // repeated public cards
        use all from ./Cards
      `,
    }, async paths => {
      const parsed = await Workspace.validate(paths['Main.tao'])
      Expect(
        parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code),
      )
        .toEqual(['tao-repeated-import'])
      const document = parsed.entry.document
      const organized = await SourceActions.organizeSource(document)
      Expect(organized).toBe(
        '// public cards\n// internal card\n// repeated public cards\nuse all from ./Cards\n'
          + 'use Internal from ./Cards\n\nview Main() {\n   render Internal()\n}\n',
      )
      await FS.writeText(paths['Main.tao'], organized!)
      const updated = await validatedDocument(paths['Main.tao'])
      Expect(await SourceActions.organizeSource(updated)).toBeUndefined()
      Expect(await SourceActions.removeUnusedImports(updated)).toBeUndefined()
      const uses = updated.parseResult.value.statements.filter(AST.isUseStatement)
      Expect(uses.map(use => use.all)).toEqual([true, false])
      Expect(AST.resolvedImportedDeclarations(uses[0]!).map(declaration => declaration.name)).toEqual(['Card'])
      Expect(AST.resolvedImportedDeclarations(uses[1]!).map(declaration => declaration.name)).toEqual(['Internal'])
    })
  })

  Test('removes unused named imports while preserving an unused wildcard and its comment', async () => {
    await withTaoFiles('tao-wildcard-unused-', {
      'Cards.tao': `public view Card() { ${emptyRender} }`,
      'Main.tao': `
        // keep the public surface
        use all from ./Cards
        use Text from @tao/ui
        view Main() { ${emptyRender} }
      `,
    }, async paths => {
      const removed = await SourceActions.removeUnusedImports(await validatedDocument(paths['Main.tao']))
      Expect(removed).toBe(
        '// keep the public surface\nuse all from ./Cards\n\nview Main() {\n'
          + '   render inject ```ts return null ```\n}\n',
      )
      await FS.writeText(paths['Main.tao'], removed!)
      Expect(await SourceActions.removeUnusedImports(await validatedDocument(paths['Main.tao']))).toBeUndefined()
    })
  })

  Test('adds a separate named import when a publicless wildcard cannot supply a project declaration', async () => {
    await withTaoFiles('tao-wildcard-named-', {
      'Cards.tao': `project view Internal() { ${emptyRender} }`,
      'Main.tao': `use all from ./Cards\nview Main() { ${emptyRender} }`,
    }, async paths => {
      const document = await validatedDocument(paths['Main.tao'])
      const source = ensureNamedImport(
        document.textDocument.getText(),
        document.parseResult.value,
        'Internal',
        './Cards',
      )
      Expect(source).toContain('use all from ./Cards\nuse Internal from ./Cards')
      await FS.writeText(paths['Main.tao'], source.replace(emptyRender, 'render Internal()'))
      const updated = await validatedDocument(paths['Main.tao'])
      Expect(ensureNamedImport(updated.textDocument.getText(), updated.parseResult.value, 'Internal', './Cards'))
        .toBe(updated.textDocument.getText())
    })
  })

  Test('inserts a palette component already supplied by the UI wildcard without adding a named import', async () => {
    await withTaoFiles('tao-wildcard-palette-', {
      'Main.tao': 'use all from @tao/ui\nview Main() { render Col() { Text("First") } }',
    }, async paths => {
      const patch = await SourceActions.applyStudioPatch(await validatedDocument(paths['Main.tao']), {
        component: 'Button',
        kind: 'insert-component',
      })
      Expect(patch.content).toContain('Button("New button")')
      await FS.writeText(paths['Main.tao'], patch.content)
      const updated = await validatedDocument(paths['Main.tao'])
      Expect(updated.parseResult.value.statements.filter(AST.isUseStatement).map(use => use.$cstNode?.text))
        .toEqual(['use all from @tao/ui'])
    })
  })

  Test('refuses a palette name occupied by a foreign wildcard value while allowing a type peer', async () => {
    for (
      const declaration of [
        'public view Button() { render inject ```ts return null ``` }',
        'public type Button is text',
      ]
    ) {
      await withTaoFiles('tao-wildcard-palette-conflict-', {
        'Cards.tao': declaration,
        'Main.tao': 'use all from ./Cards\nuse Col from @tao/ui\nview Main() { render Col() {} }',
      }, async paths => {
        const document = await validatedDocument(paths['Main.tao'])
        const patch = SourceActions.applyStudioPatch(document, { component: 'Button', kind: 'insert-component' })
        if (declaration.startsWith('public view')) {
          await Expect(patch).rejects.toThrow("cannot import 'Button' from @tao/ui")
        } else {
          const content = (await patch).content
          Expect(content).toContain('use all from ./Cards')
          Expect(content).toContain('use Button, Col from @tao/ui')
          await FS.writeText(paths['Main.tao'], content)
          await validatedDocument(paths['Main.tao'])
        }
      })
    }
  })

  Test('inserts an imported project view by its wildcard declaration identity', async () => {
    await withTaoFiles('tao-wildcard-project-view-', {
      'Cards.tao': `public view Card() { ${emptyRender} }`,
      'Main.tao': 'use all from ./Cards\nuse Col from @tao/ui\nview Main() { render Col() {} }',
    }, async paths => {
      const patch = await SourceActions.applyStudioPatch(await validatedDocument(paths['Main.tao']), {
        kind: 'insert-project-view',
        viewName: 'Card',
      })
      Expect(patch.content).toContain('Card()')
      await FS.writeText(paths['Main.tao'], patch.content)
      const updated = await validatedDocument(paths['Main.tao'])
      Expect(updated.parseResult.value.statements.filter(AST.isUseStatement).map(use => use.$cstNode?.text))
        .toEqual(['use all from ./Cards', 'use Col from @tao/ui'])
      const invocation = AST.streamAllContents(updated.parseResult.value).filter(AST.isRender)
        .find(render => render.view?.$refText === 'Card')
      Assert.defined(invocation?.view?.ref, 'inserted Card render resolves')
      Expect(AST.getDocument(invocation.view.ref).uri.fsPath).toBe(paths['Cards.tao'])
    })
  })

  Test('keeps the UI wildcard when the first snap replaces a Placeholder', async () => {
    await withTaoFiles('tao-wildcard-snap-', {
      'Main.tao': `
        use all from @tao/ui
        public view View1() { render Placeholder("View1") }
        scenarios View1 "sketch" { device phone scenario "draft" { render () } }
      `,
    }, async paths => {
      const patch = await SourceActions.applyStudioPatch(await validatedDocument(paths['Main.tao']), {
        expectedCatalogRevision: 1,
        kind: 'snap-sketch-to-flow',
        mergeDirection: 'Row',
        mergePosition: 'after',
        rectIds: ['title'],
        sketchId: 'card',
        tree: { arguments: ['Snapped'], component: 'Text', layout: [], rectId: 'title', type: 'element' },
        viewName: 'View1',
      })
      Expect(patch.content).toContain('Text("Snapped")')
      Expect(patch.content).not.toContain('Placeholder(')
      await FS.writeText(paths['Main.tao'], patch.content)
      const updated = await validatedDocument(paths['Main.tao'])
      Expect(updated.parseResult.value.statements.filter(AST.isUseStatement).map(use => use.$cstNode?.text))
        .toEqual(['use all from @tao/ui'])
      Expect(await SourceActions.organizeSource(updated)).toBeUndefined()
    })
  })

  Test('extracts after wildcard value names and refuses an imported singular entity name', async () => {
    await withTaoFiles('tao-wildcard-extract-', {
      'Cards.tao': `public view View1() { ${emptyRender} }\npublic data Notes / Note { Title text }`,
      'Main.tao': 'use all from ./Cards\nuse Col, Text from @tao/ui\nview Main() { render Col() { Text("Loose") } }',
    }, async paths => {
      const document = await validatedDocument(paths['Main.tao'])
      const render = AST.streamAllContents(document.parseResult.value).filter(AST.isRender)
        .find(candidate => candidate.$cstNode?.text === 'Text("Loose")')
      Assert.defined(render?.$cstNode, 'selected Loose render has a source range')
      const renderIds = [`${document.uri.fsPath}:${render.$cstNode.offset}:${render.$cstNode.end}`]
      await Expect(SourceActions.applyStudioPatch(document, { kind: 'extract-view', name: 'Note', renderIds }))
        .rejects.toThrow('A declaration named Note is already visible here')
      const patch = await SourceActions.applyStudioPatch(document, { kind: 'extract-view', renderIds })
      Expect(patch.content).toContain('view View2()')
      Expect(patch.content).toContain('use all from ./Cards')
      await FS.writeText(paths['Main.tao'], patch.content)
      await validatedDocument(paths['Main.tao'])
    })
  })

  Test('retargets a wildcard scenario and separately imports a project-only view when needed', async () => {
    for (const visibility of ['public', 'project']) {
      await withTaoFiles('tao-wildcard-retarget-', {
        'Cards.tao': `public view Card() { ${emptyRender} }\n${visibility} view OtherCard() { ${emptyRender} }`,
        'Main.tao': 'use all from ./Cards\nscenarios Card "states" { device phone scenario "lead" { render () } }',
      }, async paths => {
        const patch = await SourceActions.applyStudioPatch(await validatedDocument(paths['Main.tao']), {
          kind: 'retarget-scenario-render',
          scenarioGroupName: 'states',
          scenarioName: 'lead',
          view: 'OtherCard',
        })
        Expect(patch.content).toContain('render OtherCard()')
        await FS.writeText(paths['Main.tao'], patch.content)
        const updated = await validatedDocument(paths['Main.tao'])
        Expect(updated.parseResult.value.statements.filter(AST.isUseStatement).map(use => use.$cstNode?.text))
          .toEqual(
            visibility === 'public'
              ? ['use all from ./Cards']
              : ['use all from ./Cards', 'use OtherCard from ./Cards'],
          )
      })
    }
  })

  Test('captures an imported singular entity through all without rewriting its import', async () => {
    await withTaoFiles('tao-wildcard-captured-', {
      'Data.tao': 'public data Notes / Note { Title text }',
      'Main.tao': `use all from ./Data\nview Main() { ${emptyRender} }`,
    }, async paths => {
      const document = await validatedDocument(paths['Main.tao'])
      const use = document.parseResult.value.statements.filter(AST.isUseStatement)[0]!
      Expect(AST.resolvedImportedDeclarations(use).map(declaration => declaration.name)).toEqual(['Notes'])
      const patch = await SourceActions.applyStudioPatch(document, {
        fixtureName: 'Captured',
        kind: 'insert-captured-fixture',
        plan: { accounts: [], creates: [{ entity: 'Note', fields: { Title: 'Saved' }, name: 'Note1' }] },
      })
      await FS.writeText(paths['Main.tao'], patch.content)
      const updated = await validatedDocument(paths['Main.tao'])
      Expect(updated.parseResult.value.statements.filter(AST.isUseStatement).map(use => use.$cstNode?.text))
        .toEqual(['use all from ./Data'])
      const row = AST.streamAllContents(updated.parseResult.value).filter(AST.isFixtureCreateBinding)[0]
      Assert.defined(row?.entity.ref, 'captured Note resolves')
      Expect(AST.getDocument(row.entity.ref).uri.fsPath).toBe(paths['Data.tao'])
    })
  })
})

async function validatedDocument(path: string): Promise<AST.Document> {
  const parsed = await Workspace.validate(path)
  Expect(parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
  return parsed.entry.document
}
