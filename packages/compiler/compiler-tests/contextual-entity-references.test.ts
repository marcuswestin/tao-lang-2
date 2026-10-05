import { AST, Langium } from '@parser'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { compileReactiveArgument } from '../compiler-src/codegen/react-native/app/reactive-parameters'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: contextual entity references', () => {
  Test('passes the singular renderer receiver without selecting its collection binding', async () => {
    const compiled = await Compiler.compileCode(`
      data Books / Book {
        Title text,
        view Book.Render() { render Label(Book) },
        action Books.Remember() { let Snapshot = Books }
      }
      view Label(Book) { render "{Book.Title}" }
      view Main { render "Main" }
      app Sample { id "contextual.receiver" name "Receiver" version "1.0.0" view Main }
    `)
    const entity = compiled.validation.entry.ast.statements.find(AST.isEntityDataDeclaration)
    Assert.defined(entity, 'the source declares the Book entity')
    const receiver = [...AST.streamAllContents(entity)].find(node =>
      AST.isValueReference(node) && AST.associatedReceiverOwner(node) === entity && node.target.$refText === 'Book'
    )
    Assert(receiver && AST.isValueReference(receiver), 'the renderer passes its actual contextual receiver')
    const TR = (await import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))).default
    const schema = TR.Data.Schema({
      name: 'ContextualReceiver',
      schemaVersion: 1,
      entities: { Book: { collection: 'Books', fields: { Title: { kind: 'text' } } } },
    }, { load: () => undefined, save: () => {} })
    await schema.settle()
    TR.Data.Create(schema, 'Book', { Title: TR.Value('Original') })
    const books = schema.query({ entity: 'Book', filters: [] })
    const original = books[0]!
    const collection = [...AST.streamAllContents(entity)].find(node =>
      AST.isValueReference(node) && AST.associatedReceiverOwner(node) === entity && node.target.$refText === 'Books'
    )
    Assert(collection && AST.isValueReference(collection), 'the collection action references its actual receiver')
    const scope = { Book: TR.Value(original), Books: TR.Value(books) }
    for (const emit of [Compile.Expression, compileReactiveArgument]) {
      const evaluate = (reference: AST.ValueReference) => {
        const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(`return ${Langium.toString(emit(reference))}`)
        return new Function('TR', '_Scope', source)(TR, scope).getJSValue()
      }
      Expect(evaluate(receiver)).toBe(original)
      Expect(TR.Data.NativeEntityContext(evaluate(receiver)).id).toBe(TR.Data.NativeEntityContext(original).id)
      Expect(evaluate(collection)).toBe(books)
    }
  })
})
