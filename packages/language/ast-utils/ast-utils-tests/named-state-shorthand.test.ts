import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { Type } from '../ast-utils-src/Type'

Describe('Named yes/no state shorthand', () => {
  Test('retains the same-name nominal type and independent writable value binding', async () => {
    const parsed = await Parser.parseCode(
      `
      type GroupMode is yes/no
      scene Main {
        state GroupMode no
        let GroupMode2 = GroupMode yes
        let Current = GroupMode
      }
    `,
      { validation: false },
    )
    Expect(parsed.diagnostics).toEqual([])
    const file = parsed.entry.ast
    const declaration = file.statements.find(AST.isTypeDeclaration)
    Expect.Is(declaration, AST.isTypeDeclaration)
    const main = file.statements.find(AST.isViewDeclaration)
    Expect.Is(main, AST.isViewDeclaration)
    const state = main.block!.statements.find(AST.isStateDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    Expect.Is(state.value, AST.isBooleanLiteral)
    Expect(state.value.value).toBe('no')
    const type = Type.ofValueDeclaration(state)
    Expect(type.kind === 'primitive' && type.primitive === 'boolean' && type.nominal === declaration).toBe(true)
    const aliases = main.block!.statements.filter(AST.isAliasDeclaration)
    const constructor = aliases.find(alias => alias.name === 'GroupMode2')!.value
    Expect.Is(constructor, AST.isConfigurationConstructor)
    Expect(constructor.type.ref === declaration).toBe(true)
    const reference = aliases.find(alias => alias.name === 'Current')!.value
    Expect.Is(reference, AST.isValueReference)
    Expect(reference.target.ref === state).toBe(true)
  })
})
