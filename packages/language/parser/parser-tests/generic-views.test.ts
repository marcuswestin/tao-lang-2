import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: generic views', () => {
  Test('uses the ordinary generic parameter node before value parameters and foreign item contracts', async () => {
    const parsed = await testParseSyntax(`
      can Keyed { Key() fails never -> text }
      can Displayed { Render() fails never -> rendered }
      view NativeRows where type T is Keyed and Displayed, type U is Keyed (Items list of T, Footer U)
        accepts slots @item(Value T, Ordinal number) from ./NativeRows.tsx
      view Wrapper where type T is Keyed (Items list of T) { render "wrapper" }
    `)
    const [native, wrapper] = parsed.entry.ast.statements.filter(AST.isViewDeclaration)
    Expect.Is(native, AST.isViewDeclaration)
    Expect.Is(wrapper, AST.isViewDeclaration)
    Expect(native.genericParameters.map(parameter => parameter.name)).toEqual(['T', 'U'])
    Expect(native.genericParameters.every(AST.isGenericTypeParameter)).toBe(true)
    Expect(native.genericParameters.every(parameter => parameter.$container === native)).toBe(true)
    Expect(native.genericParameters[0]!.bounds.map(bound => {
      Expect.Is(bound, AST.isNamedTypeReference)
      return bound.root
    })).toEqual(['Keyed', 'Displayed'])
    const items = AST.parametersOf(native)[0]!
    Expect.Is(items.inlineType, AST.isParameterTypeDeclaration)
    Expect.Is(items.inlineType.type, AST.isListTypeReference)
    Expect.Is(items.inlineType.type.elementType, AST.isNamedTypeReference)
    Expect(items.inlineType.type.elementType.root).toBe('T')
    const input = native.foreign!.slots[0]!.parameterList!.parameters[0]!
    Expect.Is(input.inlineType, AST.isParameterTypeDeclaration)
    Expect.Is(input.inlineType.type, AST.isNamedTypeReference)
    Expect(input.inlineType.type.root).toBe('T')
    Expect(wrapper.genericParameters.map(parameter => parameter.name)).toEqual(['T'])
    Expect.Is(wrapper.block, AST.isBlock)
  })
})
