import { Workspace } from '@compiler/workspace'
import { Assert } from '@shared'
import { Describe, Expect, stubView, Test, withTaoFiles } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: associated action witness publication', () => {
  Test('publishes same-named row and collection factories in distinct declaration slots', async () => {
    const compiled = await Compiler.compileCode(`
      data Books / Book {
        Title text,
        action Book.Return() { },
        action Books.Return() { }
      }
      app Demo { id "com.tao.action.witness" version "1.0.0" name "Witness" view Main }
      ${stubView('Main')}
    `)
    Expect(compiled.code).toContain('"$actions": [')
    Expect(compiled.code.match(/_Scope.Book = _TaoAssociatedReceiver/g)).toHaveLength(1)
    Expect(compiled.code.match(/_Scope.Books = _TaoAssociatedReceiver/g)).toHaveLength(1)
    Expect(compiled.code).toContain('export { __tao_associated_witness_1__ }')
  })

  Test('captures selected action aliases eagerly and invokes their saved value', async () => {
    const compiled = await Compiler.compileCode(`
      data Books / Book {
        Title text,
        action Book.Return() { },
        action Books.Return() { }
      }
      action Caller(Row Book, Rows Books) {
        let Saved = Row.Return
        let Again = Saved
        do Again()
        do Rows.Return()
      }
      app Demo { id "com.tao.action.witness" version "1.0.0" name "Witness" view Main }
      ${stubView('Main')}
    `)
    Expect(compiled.code).toMatch(
      /_Scope.Saved = TR.Readonly\(TR.Alias\(\(\) => __tao_associated_witness_1__\["\$actions"\]\[0\]\(TR.CaptureActionReceiver/,
    )
    Expect(compiled.code).toContain('_Scope.Again = TR.Readonly(TR.Alias(() => _Scope.Saved.evaluate()).evaluate())')
    Expect(compiled.code).toMatch(
      /__tao_associated_witness_1__\["\$actions"\]\[1\]\(TR.CaptureActionReceiver\([^]*?"many"/,
    )
    Expect(compiled.code).toContain('TR.Do(_Scope.Again.evaluate()')
    Expect(compiled.code).not.toContain('owner: _TaoActionOwner,')
  })

  Test('selects nested and postfix receivers and supplies an owner from an actual view scope', async () => {
    const compiled = await Compiler.compileCode(`
      data Books / Book { Title text, action Book.Return() { } }
      type Revision is { Book }
      view Main() {
        action Inspect(Value Revision) {
          let Nested = Value.Book.Return
          let Postfix = (Value.Book).Return
        }
        render Empty()
      }
      ${stubView('Empty')}
      app Demo { id "com.tao.action.receiver" version "1.0.0" name "Receiver" view Main }
    `)
    Expect(compiled.code).toMatch(
      /_Scope.Nested = TR.Readonly\(TR.Alias\(\(\) => __tao_associated_witness_1__\["\$actions"\]\[0\]/,
    )
    Expect(compiled.code).toMatch(
      /_Scope.Postfix = TR.Readonly\(TR.Alias\(\(\) => __tao_associated_witness_1__\["\$actions"\]\[0\]/,
    )
    Expect(compiled.code.match(/\{ owner: _TaoActionOwner \}/g)).toHaveLength(2)
    Expect(compiled.code).toContain('["Book"]')
  })

  Test('imports the actual declaration owner through the existing collision-safe witness map', async () => {
    await withTaoFiles('tao-associated-action-publication-', {
      'Main.tao': `
        use Books, Book from ./Library
        let __tao_associated_import_1__ = "reserved"
        public action Caller(Row Book, Rows Books) {
          let Saved = Row.Return
          do Saved()
          do Rows.Return()
        }
        app Demo { id "com.tao.action.import" version "1.0.0" name "Import" view Main }
        view Main() from ./Native.tsx
      `,
      'Library.tao': `public data Books / Book { Title text, action Book.Return() { }, action Books.Return() { } }`,
      'Native.tsx': 'export function Main() { return null }',
    }, async (paths, root) => {
      const compiled = await (await Workspace.open(root)).compile(paths['Main.tao'])
      const consumer = compiled.files.find(file =>
        file.sourcePath === paths['Main.tao'] && file.relativePath.endsWith('.tsx')
      )
      const owner = compiled.files.find(file =>
        file.sourcePath === paths['Library.tao'] && file.relativePath.endsWith('.tsx')
      )
      Assert.defined(consumer, 'the actual associated action consumer is emitted')
      Assert.defined(owner, 'the actual associated action defining module is emitted')
      Expect(owner.code).toContain('"$actions": [')
      Expect(owner.code).toContain('export { __tao_associated_witness_1__ }')
      Expect(consumer.code).toContain('as __tao_associated_import_1__1')
      Expect(consumer.code).toContain('__tao_associated_import_1__1["$actions"][0]')
      Expect(consumer.code).toContain('__tao_associated_import_1__1["$actions"][1]')
    })
  })
})
