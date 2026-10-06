import { Workspace } from '@compiler/workspace'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Type } from '../ast-utils-src/Type'

Describe('abstract type domains', () => {
  Test('reads only the own declaration flag without inheriting it', async () => {
    const parsed = await Parser.parseCode(
      `
      abstract type NumericFamily is number
      type ConcreteNumber is NumericFamily
      abstract type ItemFamily is {}
      type ConcreteItem is ItemFamily
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const declarations = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
    const abstract = (name: string) =>
      Type.isAbstractDomain(Type.ofDefinition(declarations.find(type => type.name === name)!))
    Expect(abstract('NumericFamily')).toBe(true)
    Expect(abstract('ConcreteNumber')).toBe(false)
    Expect(abstract('ItemFamily')).toBe(true)
    Expect(abstract('ConcreteItem')).toBe(false)
    Expect(Type.isAbstractDomain({ kind: 'primitive', primitive: 'number' })).toBe(false)
    Expect(Type.isAbstractDomain({ kind: 'unresolved' })).toBe(false)
  })

  Test('follows transparent package aliases to the actual declaration flag', async () => {
    await withTaoFiles('tao-abstract-domains-', {
      'Main.tao': `
        use package ./domains as domains
        type Alias = domains.NumericFamily
        type ConcreteAlias = domains.ConcreteNumber
      `,
      'domains.tao': `
        public abstract type NumericFamily is number
        public type ConcreteNumber is NumericFamily
      `,
    }, async paths => {
      const parsed = await Workspace.parse(paths['Main.tao']!)
      const file = parsed.files.find(file => file.path === paths['Main.tao'])!
      const declarations = file.ast.statements.filter(AST.isTypeDeclaration)
      Expect(Type.isAbstractDomain(Type.ofDefinition(declarations.find(type => type.name === 'Alias')!))).toBe(true)
      Expect(Type.isAbstractDomain(Type.ofDefinition(declarations.find(type => type.name === 'ConcreteAlias')!))).toBe(
        false,
      )
    })
  })
})
