import { Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { rejectsParser } from './test-parse'

Describe('parser: wildcard imports', () => {
  Test('makes an otherwise unused wildcard available to query inference', async () => {
    await withTaoFiles('tao-wildcard-query-', {
      'Main.tao': 'use all from ./Data\nview Main { query Available = Notes with { } }',
      'Data.tao': 'public data Notes / Note { Body text }',
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      Expect(result.diagnostics).toEqual([])
      const query = AST.streamAllContents(result.entry.ast).find(AST.isEntityQueryDeclaration)
      Expect.Is(query, AST.isEntityQueryDeclaration)
      const data = result.files.find(file => file.path === paths['Data.tao'])!
        .ast.statements.find(AST.isEntityDataDeclaration)
      Expect(Type.queryEntity(query)).toBe(data)
    })
  })

  Test('links public namespace peers, functions, views, and both entity names', async () => {
    await withTaoFiles('tao-wildcard-imports-', {
      'Main.tao': `
        use all from ./library/Library
        let Display = Label "Ada"
        let Greeting = Greet(Label)
        view Main(Item) {
          query AllItems = Items with { }
          action Add() { create Item { Name: Greeting } }
          render Card(Greeting)
        }
      `,
      'library/Library.tao': `
        public type Label is text
        public let Label = "Hello"
        public function Greet(Value text) returns text { return Value }
        public view Card(Value text) { }
        public data Items / Item { Name text }
      `,
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      Expect(result.diagnostics).toEqual([])
      const use = result.entry.ast.statements.find(AST.isUseStatement)
      Expect.Is(use, AST.isUseStatement)
      Expect(use.all).toBe(true)
      Expect(use.importPath).toBe('./library/Library')
      Expect(use.importedDeclarations).toEqual([])
      const library = result.files.find(file => file.path === paths['library/Library.tao'])
      Expect(library).toBeDefined()
      const declarations = library!.ast.statements.filter(AST.isDeclaration)
      const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)
      const display = aliases.find(alias => alias.name === 'Display')
      const greeting = aliases.find(alias => alias.name === 'Greeting')
      Expect.Is(display, AST.isAliasDeclaration)
      Expect.Is(greeting, AST.isAliasDeclaration)
      Expect.Is(display.value, AST.isConfigurationConstructor)
      Expect(display.value.type.ref).toBe(declarations.find(AST.isTypeDeclaration))
      Expect.Is(greeting.value, AST.isFunctionCallExpression)
      Expect(greeting.value.function.ref).toBe(declarations.find(AST.isFunctionDeclaration))
      const valueReference = AST.streamAllContents(greeting).find(AST.isValueReference)
      Expect.Is(valueReference, AST.isValueReference)
      Expect(valueReference.target.ref).toBe(declarations.find(AST.isAliasDeclaration))
      const render = AST.streamAllContents(result.entry.ast).find(AST.isRender)
      Expect.Is(render, AST.isRender)
      Expect(render.view?.ref).toBe(declarations.find(AST.isViewDeclaration))
      const create = AST.streamAllContents(result.entry.ast).find(AST.isCreateStatement)
      Expect.Is(create, AST.isCreateStatement)
      Expect(create.entity.ref).toBe(declarations.find(AST.isEntityDataDeclaration))
      const query = AST.streamAllContents(result.entry.ast).find(AST.isEntityQueryDeclaration)
      Expect.Is(query, AST.isEntityQueryDeclaration)
      const queryEntity = Type.queryEntity(query)
      Expect.Is(queryEntity, AST.isEntityDataDeclaration)
      Expect(queryEntity).toBe(declarations.find(AST.isEntityDataDeclaration))
      const imported = AST.resolvedImportedDeclarations(use)
      Expect(imported.map(declaration => declaration.name)).toEqual(['Label', 'Label', 'Greet', 'Card', 'Items'])
      imported.forEach((declaration, index) => Expect(declaration).toBe(declarations[index]))
    })
  })

  for (const source of ['use all', 'use all from', 'use all, Name from ./Library', 'use Name, all from ./Library']) {
    Test(`rejects incomplete or mixed wildcard syntax: ${source}`, rejectsParser(source))
  }
})
