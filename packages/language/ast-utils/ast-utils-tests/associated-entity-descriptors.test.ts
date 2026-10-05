import { Workspace } from '@compiler/workspace'
import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { resolveAssociatedMethodInvocation } from '../ast-utils-src/associated-invocations'
import { ownAssociatedMethods, ownAssociatedViews } from '../ast-utils-src/associated-methods'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { Type } from '../ast-utils-src/Type'

Describe('Associated entity descriptors', () => {
  Test('retains the real single entity receiver in methods, fields and mounted descriptors', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        func Book.Key() -> text { return Book.Title },
        view Book.Render() { }
      }
      func Key(Value Book) -> text { return Value.Key() }
      func Show(Value Book) -> rendered { return Value.Render() }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const method = ownAssociatedMethods(entity)[0]
    const view = ownAssociatedViews(entity)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    Expect(AST.associatedFunctionOwner(method)).toBe(entity)
    Expect(AST.associatedViewOwner(view)).toBe(entity)
    const receiver = Type.ofAssociatedOwner(entity)
    Expect(receiver.kind).toBe('entity')
    Expect(receiver.kind === 'entity' && receiver.entity).toBe(entity)
    const fieldPath = AST.returnStatementsOf(method)[0]?.value
    Expect.Is(fieldPath, AST.isMemberAccessExpression)
    Expect(fieldPath.target.ref).toBe(entity)
    Expect(AST.associatedReceiverOwner(fieldPath)).toBe(entity)
    const root = Type.ofReferenceRoot(fieldPath)
    Expect(root.kind).toBe('entity')
    Expect(root.kind === 'entity' && root.entity).toBe(entity)
    Expect(Type.ofExpression(fieldPath)).toEqual({ kind: 'primitive', primitive: 'text' })
    const keyCall = returnedCall(file, 'Key')
    const renderCall = returnedCall(file, 'Show')
    const key = resolveAssociatedMethodInvocation(keyCall)
    const render = resolveAssociatedMethodInvocation(renderCall)
    Expect(key.problem).toBeUndefined()
    Expect(key.descriptor?.declaration).toBe(method)
    Expect(key.descriptor?.owner).toBe(entity)
    Expect(key.descriptor?.receiver.kind).toBe('entity')
    Expect(key.descriptor?.receiver.kind === 'entity' && key.descriptor.receiver.entity).toBe(entity)
    Expect(key.descriptor?.result).toEqual({ kind: 'primitive', primitive: 'text' })
    Expect(render.problem).toBeUndefined()
    Expect(render.descriptor?.declaration).toBe(view)
    Expect(render.descriptor?.owner).toBe(entity)
    Expect(render.descriptor?.result).toEqual({ kind: 'primitive', primitive: 'rendered' })
    Expect(Type.ofExpression(keyCall)).toEqual({ kind: 'primitive', primitive: 'text' })
    Expect(Type.ofExpression(renderCall)).toEqual({ kind: 'primitive', primitive: 'rendered' })
    Expect(Type.associatedMethodDeclaration(receiver, 'Render', undefined, 'static')).toBeUndefined()
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const declaration of [method, view]) {
      const materialized = snapshot.associatedDescriptors.get(declaration)
      Assert(materialized?.kind === 'ready', 'the actual entity descriptor materializes')
      const descriptor = snapshot.descriptors.get(declaration)
      Expect(materialized.descriptor.owner).toBe(entity)
      Expect(materialized.descriptor.declaration).toBe(declaration)
      Expect(descriptor?.owner).toBe(entity)
      Expect(descriptor?.body).toBe(declaration.block)
      Expect(Object.isFrozen(descriptor)).toBe(true)
    }
    Expect(snapshot.calls.get(keyCall)?.target).toBe(method)
    Expect(snapshot.calls.get(renderCall)?.target).toBe(view)
    Expect(snapshot.descriptors.get(view)?.convention).toBe('mounted')
    Expect(snapshot.descriptors.get(view)?.contract).toBeUndefined()
  })

  Test('keeps unbound qualifiers pending and permits a parameter to shadow the singular receiver', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        func Books.Wrong() -> text { return "wrong" },
        func Book.Shadow(Book text) -> text { return Book },
        view Books.Invalid() { }
      }
      func Bad(Value Book) -> text { return Value.Wrong() }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [wrong, shadow] = ownAssociatedMethods(entity)
    const view = ownAssociatedViews(entity)[0]
    Expect.Is(wrong, AST.isAssociatedFunctionDeclaration)
    Expect.Is(shadow, AST.isAssociatedFunctionDeclaration)
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    Expect(AST.associatedFunctionOwner(wrong)).toBe(entity)
    Expect(AST.associatedViewOwner(view)).toBe(entity)
    Expect(AST.associatedEntityReceiverOwner(wrong)).toBeUndefined()
    Expect(AST.associatedEntityReceiverOwner(view)).toBeUndefined()
    Expect(Type.associatedCallable(wrong, entity).kind).toBe('pending')
    Expect(Type.associatedCallable(view, entity).kind).toBe('pending')
    Expect(resolveAssociatedMethodInvocation(returnedCall(file, 'Bad')).problem).toBe('unknown-method')
    const value = AST.returnStatementsOf(shadow)[0]?.value
    Expect.Is(value, AST.isValueReference)
    Expect(value.target.ref).toBe(AST.parametersOf(shadow)[0])
    Expect(AST.associatedReceiverOwner(value)).toBeUndefined()
    const type = Type.ofExpression(value)
    Expect(type.kind).toBe('primitive')
    Expect(type.kind === 'primitive' && type.primitive).toBe('text')
  })

  Test('resolves singular shorthand fields and written collection returns against one actual entity', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      type Revision is { Book, RevisionID text, Unseen yes/no }
      func Rows(Value Books) -> Books { return Value }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const revision = file.statements.find(AST.isTypeDeclaration)
    Expect.Is(revision, AST.isTypeDeclaration)
    Expect.Is(revision.type, AST.isItemTypeExpression)
    const property = revision.type.properties[0]
    Expect.Is(property, AST.isTypeProperty)
    Expect(property.name).toBe('Book')
    const single = Type.ofProperty(property)
    Expect(single.kind).toBe('entity')
    Expect(single.kind === 'entity' && single.entity).toBe(entity)
    const unseen = revision.type.properties.find(property => property.name === 'Unseen')
    Expect.Is(unseen, AST.isTypeProperty)
    Expect.Is(unseen.type, AST.isYesNoTypeExpression)
    const boolean = Type.ofProperty(unseen)
    Assert(boolean.kind === 'primitive', 'the yes/no property has a primitive domain')
    Expect(boolean.primitive).toBe('boolean')
    const fn = file.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    const collection = Type.ofFunctionReturn(fn)
    Expect(collection.kind).toBe('list')
    Assert(collection.kind === 'list' && collection.element?.kind === 'entity', 'the written collection has rows')
    Expect(collection.element.entity).toBe(entity)
    const parameter = Type.ofParameter(AST.parametersOf(fn)[0]!)
    Expect(parameter.kind).toBe('list')
    Assert(parameter.kind === 'list' && parameter.element?.kind === 'entity', 'the collection parameter has rows')
    Expect(parameter.element.entity).toBe(entity)
    Expect(Type.associatedMethods(parameter)).toEqual([])
  })

  Test('preserves selected singular and collection imports across the actual public data declaration', async () => {
    await withTaoFiles('tao-entity-descriptor-imports-', {
      'Library.tao': `
        public data Books / Book { Title text }
        public data People / Person { Name text }
      `,
      'BookIO.tao': `
        use Book, Books, People from ./Library
        type BookWindow is list of Book
        type Revision is { Book, RevisionID text, Unseen yes/no }
        type PersonRows is People
        public func LoadedItems(Window BookWindow) -> Books { return Window }
      `,
    }, async paths => {
      const validated = await Workspace.validate(paths['BookIO.tao'])
      Expect(validated.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
      const library = validated.files.find(file => file.path === paths['Library.tao'])
      Assert.defined(library, 'the actual public data module is parsed')
      const [books, people] = library.ast.statements.filter(AST.isEntityDataDeclaration)
      Expect.Is(books, AST.isEntityDataDeclaration)
      Expect.Is(people, AST.isEntityDataDeclaration)
      const entry = validated.entry.ast
      const imports = entry.statements.find(AST.isUseStatement)
      Expect.Is(imports, AST.isUseStatement)
      Expect(imports.importedDeclarations.map(AST.importSourceName)).toEqual(['Book', 'Books', 'People'])
      Expect(imports.importedDeclarations[0]?.target.ref).toBe(books)
      Expect(imports.importedDeclarations[1]?.target.ref).toBe(books)
      Expect(imports.importedDeclarations[2]?.target.ref).toBe(people)
      const revision = entry.statements.find(statement =>
        AST.isTypeDeclaration(statement) && statement.name === 'Revision'
      )
      Expect.Is(revision, AST.isTypeDeclaration)
      Expect.Is(revision.type, AST.isItemTypeExpression)
      const bookField = revision.type.properties[0]
      Expect.Is(bookField, AST.isTypeProperty)
      const book = Type.ofProperty(bookField)
      Assert(book.kind === 'entity', 'the imported singular shorthand is a single entity')
      Expect(book.entity).toBe(books)
      const unseen = revision.type.properties.find(property => property.name === 'Unseen')
      Expect.Is(unseen, AST.isTypeProperty)
      Expect.Is(unseen.type, AST.isYesNoTypeExpression)
      const boolean = Type.ofProperty(unseen)
      Assert(boolean.kind === 'primitive', 'the actual yes/no annotation has a primitive domain')
      Expect(boolean.primitive).toBe('boolean')
      const loaded = entry.statements.find(AST.isFunctionDeclaration)
      Expect.Is(loaded, AST.isFunctionDeclaration)
      const loadedType = Type.ofFunctionReturn(loaded)
      Assert(loadedType.kind === 'list' && loadedType.element?.kind === 'entity', 'the imported return has entity rows')
      Expect(loadedType.element.entity).toBe(books)
      const peopleRows = entry.statements.find(statement =>
        AST.isTypeDeclaration(statement) && statement.name === 'PersonRows'
      )
      Expect.Is(peopleRows, AST.isTypeDeclaration)
      const peopleType = Type.ofDefinition(peopleRows)
      Assert(
        peopleType.kind === 'list' && peopleType.element?.kind === 'entity',
        'the imported collection has entity rows',
      )
      Expect(peopleType.element.entity).toBe(people)
    }, { location: 'worktree' })
  })

  Test('does not leak the unselected singular or collection import form', async () => {
    await withTaoFiles('tao-entity-descriptor-import-visibility-', {
      'Library.tao': 'public data Books / Book { Title text }',
      'BookOnly.tao': `
        use Book from ./Library
        type Single is Book
        type HiddenCollection is Books
      `,
      'BooksOnly.tao': `
        use Books from ./Library
        type Rows is Books
        type HiddenSingle is Book
        type HiddenField is { Book }
      `,
    }, async paths => {
      const singularOnly = await Workspace.parse(paths['BookOnly.tao'])
      const singularTypes = singularOnly.entry.ast.statements.filter(AST.isTypeDeclaration)
      Expect(Type.ofDefinition(singularTypes[0]!).kind).toBe('entity')
      Expect(Type.ofDefinition(singularTypes[1]!).kind).toBe('unresolved')
      const collectionOnly = await Workspace.parse(paths['BooksOnly.tao'])
      const collectionTypes = collectionOnly.entry.ast.statements.filter(AST.isTypeDeclaration)
      Expect(Type.ofDefinition(collectionTypes[0]!).kind).toBe('list')
      Expect(Type.ofDefinition(collectionTypes[1]!).kind).toBe('unresolved')
      Expect.Is(collectionTypes[2]?.type, AST.isItemTypeExpression)
      const hiddenField = collectionTypes[2].type.properties[0]
      Expect.Is(hiddenField, AST.isTypeProperty)
      Expect(Type.ofProperty(hiddenField).kind).toBe('unresolved')
    }, { location: 'worktree' })
  })
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}

function returnedCall(file: AST.TaoFile, name: string): AST.MethodCallExpression {
  const declaration = file.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  const expression = AST.returnStatementsOf(declaration)[0]?.value
  Expect.Is(expression, AST.isMethodCallExpression)
  return expression
}
