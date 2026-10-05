import { Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { rejectsParser } from './test-parse'

Describe('parser: named import aliases', () => {
  Test('binds aliases in each namespace while keeping exported declaration identity', async () => {
    await withTaoFiles('tao-import-aliases-', {
      'Main.tao': `
        use Label as LocalLabel, Greet as LocalGreet, Card as LocalCard,
          Items as LocalItems, Item as LocalItem from ./library/Library
        let Display = LocalLabel "Ada"
        let Greeting = LocalGreet(LocalLabel)
        view Main(LocalItem) {
          query AllItems = LocalItems with { }
          action Add() { create LocalItem { Name: Greeting } }
          render LocalCard(Greeting)
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
      const library = result.files.find(file => file.path === paths['library/Library.tao'])
      Expect(library).toBeDefined()
      const declarations = library!.ast.statements.filter(AST.isDeclaration)
      const bindings = AST.resolvedImportedBindings(use)
      Expect(bindings.map(binding => [binding.sourceName, binding.localName, binding.namespace])).toEqual([
        ['Label', 'LocalLabel', 'type'],
        ['Label', 'LocalLabel', 'value'],
        ['Greet', 'LocalGreet', 'value'],
        ['Card', 'LocalCard', 'value'],
        ['Items', 'LocalItems', 'value'],
        ['Item', 'LocalItem', 'type'],
      ])
      Expect(AST.importSpecifierText(use.importedDeclarations[0]!)).toBe('Label as LocalLabel')
      Expect(bindings[0]!.specifier).toBe(use.importedDeclarations[0])
      Expect(bindings[1]!.specifier).toBe(use.importedDeclarations[0])
      const aliases = result.entry.ast.statements.filter(AST.isAliasDeclaration)
      const display = aliases.find(alias => alias.name === 'Display')
      Expect.Is(display, AST.isAliasDeclaration)
      Expect.Is(display.value, AST.isConfigurationConstructor)
      Expect(display.value.type.ref).toBe(declarations.find(AST.isTypeDeclaration))
      const greeting = aliases.find(alias => alias.name === 'Greeting')
      Expect.Is(greeting, AST.isAliasDeclaration)
      Expect.Is(greeting.value, AST.isFunctionCallExpression)
      Expect(greeting.value.function.ref).toBe(declarations.find(AST.isFunctionDeclaration))
      const value = AST.streamAllContents(greeting).find(AST.isValueReference)
      Expect.Is(value, AST.isValueReference)
      Expect(value.target.ref).toBe(declarations.find(AST.isAliasDeclaration))
      const render = AST.streamAllContents(result.entry.ast).find(AST.isRender)
      Expect.Is(render, AST.isRender)
      Expect(render.view?.ref).toBe(declarations.find(AST.isViewDeclaration))
      const create = AST.streamAllContents(result.entry.ast).find(AST.isCreateStatement)
      Expect.Is(create, AST.isCreateStatement)
      const entity = declarations.find(AST.isEntityDataDeclaration)
      Expect.Is(entity, AST.isEntityDataDeclaration)
      Expect(create.entity.ref).toBe(entity)
      const query = AST.streamAllContents(result.entry.ast).find(AST.isEntityQueryDeclaration)
      Expect.Is(query, AST.isEntityQueryDeclaration)
      Expect(Type.queryEntity(query)).toBe(entity)
      Expect(
        AST.visibleFileBindings(query, AST.isEntityDataDeclaration)
          .map(binding => [binding.sourceName, binding.localName]),
      ).toEqual([
        ['Items', 'LocalItems'],
        ['Item', 'LocalItem'],
      ])
      const imported = AST.resolvedImportedDeclarations(use)
      Expect(imported).toHaveLength(declarations.length)
      imported.forEach((declaration, index) => Expect(declaration).toBe(declarations[index]))
      Expect(declarations.map(declaration => declaration.name)).toEqual(['Label', 'Label', 'Greet', 'Card', 'Items'])
    })
  })

  Test('keeps original export spelling out of the receiving value scope', async () => {
    await withTaoFiles('tao-import-alias-spelling-', {
      'Main.tao': 'use Greeting as Welcome from ./library/Library\nlet Local = Welcome\nlet Missing = Greeting',
      'library/Library.tao': 'public let Greeting = "Hello"',
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      const references = AST.streamAllContents(result.entry.ast).filter(AST.isValueReference)
      const local = references.find(reference => reference.target.$refText === 'Welcome')
      const original = references.find(reference => reference.target.$refText === 'Greeting')
      Expect.Is(local, AST.isValueReference)
      Expect.Is(original, AST.isValueReference)
      Expect.Is(local.target.ref, AST.isAliasDeclaration)
      Expect(original.target.ref).toBeUndefined()
      Expect(
        AST.visibleValueBindings(local, (candidate): candidate is AST.ImportableValueDeclaration =>
          AST.isDeclaration(candidate) && AST.isImportableValueDeclaration(candidate)
        )
          .map(binding => binding.localName),
      ).toEqual(['Welcome', 'Local', 'Missing'])
    })
  })

  for (const source of ['use Label as', 'use Label as from ./Library']) {
    Test(`rejects an incomplete named alias: ${source}`, rejectsParser(source))
  }
})
