import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { ASTUtils } from '../ast-utils-src/ast-utils'
import { Type } from '../ast-utils-src/Type'

Describe('import alias semantics', () => {
  Test('selects the original static factory through an alias without a lexical-callee exception', async () => {
    await withTaoFiles('tao-static-import-alias-', {
      'Main.tao': `
        use Title as TitleType from ./library/Library
        let Title = TitleType.Default()
      `,
      'library/Library.tao': `
        public type Title is text with {
          static func Default() -> Title { return Title "Untitled" }
        }
      `,
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      Expect(result.diagnostics).toEqual([])
      const use = result.entry.ast.statements.find(AST.isUseStatement)
      Expect.Is(use, AST.isUseStatement)
      const owner = AST.resolvedImportedDeclarations(use).find(AST.isTypeDeclaration)
      Expect.Is(owner, AST.isTypeDeclaration)
      const call = AST.streamAllContents(result.entry.ast).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      Expect.Is(call.callee, AST.isMemberAccessExpression)
      Expect(call.callee.target.ref).toBe(owner)
      const resolved = ASTUtils.resolveAssociatedMethodInvocation(call)
      Expect(resolved.problem).toBeUndefined()
      Expect(resolved.descriptor?.owner).toBe(owner)
      Expect(resolved.declaration).toBe(ASTUtils.ownAssociatedMethods(owner)[0])
    })
  })

  Test('retains entity source cardinality under renamed singular and collection forms', async () => {
    await withTaoFiles('tao-entity-import-alias-', {
      'Main.tao': `
        use Books as LibraryBooks, Book as LibraryBook from ./library/Library
        func Rows(Value LibraryBooks) { return Value }
        func Row(Value LibraryBook) { return Value }
        data Shelves / Shelf { Collection LibraryBooks, Selected LibraryBook }
      `,
      'library/Library.tao': 'public data Books / Book { Name text }',
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      Expect(result.diagnostics).toEqual([])
      const use = result.entry.ast.statements.find(AST.isUseStatement)
      Expect.Is(use, AST.isUseStatement)
      const entity = AST.resolvedImportedDeclarations(use).find(AST.isEntityDataDeclaration)
      Expect.Is(entity, AST.isEntityDataDeclaration)
      const functions = result.entry.ast.statements.filter(AST.isFunctionDeclaration)
      const rows = Type.ofParameter(AST.parametersOf(functions[0]!)[0]!)
      const row = Type.ofParameter(AST.parametersOf(functions[1]!)[0]!)
      Expect(rows.kind).toBe('list')
      Expect(rows.kind === 'list' && rows.element?.kind === 'entity' && rows.element.entity === entity).toBe(true)
      Expect(row.kind === 'entity' && row.entity === entity).toBe(true)
      const shelf = result.entry.ast.statements.find(AST.isEntityDataDeclaration)
      Expect.Is(shelf, AST.isEntityDataDeclaration)
      const [collection, selected] = Type.dataFields(shelf)
      Expect(Type.dataFieldRelationEntity(collection!) === entity).toBe(true)
      Expect(Type.dataFieldIsInverseRelation(collection!)).toBe(true)
      Expect(Type.dataFieldRelationEntity(selected!) === entity).toBe(true)
      Expect(Type.dataFieldIsInverseRelation(selected!)).toBe(false)
    })
  })
})
