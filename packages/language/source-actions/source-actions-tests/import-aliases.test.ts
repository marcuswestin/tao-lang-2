import { Workspace } from '@compiler/workspace'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import SourceActions from '../source-actions-src/source-actions'
import { ensureNamedImport } from '../source-actions-src/studio/studio-use-imports'

const emptyRender = 'render inject ```ts return null ```'

Describe('named import aliases in source actions', () => {
  Test('keeps a used local alias and removes an unused aliased import', async () => {
    await withTaoFiles('tao-import-alias-prune-', {
      'Library.tao': `public view Card() { ${emptyRender} }\npublic view Unused() { ${emptyRender} }`,
      'Main.tao': `use Card as Button, Unused as Spare from ./Library\nview Main() { render Button() }`,
    }, async paths => {
      const parsed = await Workspace.validate(paths['Main.tao'])
      Expect(parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const organized = await SourceActions.removeUnusedImports(parsed.entry.document)
      Expect(organized).toBe('use Card as Button from ./Library\n\nview Main() {\n   render Button()\n}\n')
    })
  })

  Test('adds a local import without flattening an existing aliased specifier', async () => {
    await withTaoFiles('tao-import-alias-add-', {
      'Library.tao': `public view Card() { ${emptyRender} }\npublic view Other() { ${emptyRender} }`,
      'Main.tao': `use Card as Button from ./Library\nview Main() { render Button() }`,
    }, async paths => {
      const parsed = await Workspace.validate(paths['Main.tao'])
      Expect(parsed.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const source = ensureNamedImport(
        parsed.entry.document.textDocument.getText(),
        parsed.entry.document.parseResult.value,
        'Other',
        './Library',
      )
      Expect(source).toContain('use Card as Button, Other from ./Library')
    })
  })

  Test('keeps a used alias beside its wildcard source instead of collapsing it', async () => {
    await withTaoFiles('tao-import-alias-wildcard-', {
      'Library.tao': `public view Card() { ${emptyRender} }`,
      'Main.tao': `use all from ./Library\nuse Card as Alias from ./Library\nview Main() { render Alias() }`,
    }, async paths => {
      const parsed = await Workspace.validate(paths['Main.tao'])
      const organized = await SourceActions.organizeSource(parsed.entry.document)
      Expect(organized).toContain('use all from ./Library\nuse Card as Alias from ./Library')
      Expect(organized).toContain('render Alias()')
    })
  })

  Test('preserves unresolved recovery aliases during unused import removal', async () => {
    await withTaoFiles('tao-import-alias-recovery-', {
      'Library.tao': `public view Card() { ${emptyRender} }`,
      'Main.tao': `use Missing as Recovery from ./Library\nview Main() { ${emptyRender} }`,
    }, async paths => {
      const parsed = await Workspace.validate(paths['Main.tao'])
      const organized = await SourceActions.removeUnusedImports(parsed.entry.document)
      Expect(organized).toContain('use Missing as Recovery from ./Library')
    })
  })
})
