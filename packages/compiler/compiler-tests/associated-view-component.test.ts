import { AST, Langium, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { gen } from '../compiler-src/codegen/react-native/codegen-util'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

Describe('compiler: associated view components', () => {
  Test('emits a stable component with receiver-first shared lifecycle and planned surfaces', async () => {
    const source = `
      type Token is text with {
        view Token.Badge(Value text) [pad 8] {
          let Label = "ready"
          render Label
        }
      }
    `
    const parsed = await Parser.parseCode(source, { validation: false })
    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const owner = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(owner, AST.isTypeDeclaration)
    Expect.Is(owner.type, AST.isDerivedTypeExpression)
    const declaration = owner.type.slots.views.find(AST.isAssociatedViewDeclaration)
    Expect.Is(declaration, AST.isAssociatedViewDeclaration)
    Expect(AST.associatedViewOwner(declaration)).toBe(owner)
    const code = Langium.toString(Compile.AssociatedViewDeclaration(declaration, {
      component: gen.Name({ name: '_TaoToken_Badge' }),
      propsType: gen`{
        __taoReceiver: TR.Cell<string>
        Value?: TR.Value<string>
        __tao?: TR.TaoProps
        __taoHost?: TR.HostReadChannel
        __taoSlots?: Readonly<Record<string, TR.SlotRenderer<any> | null>>
        children?: React.ReactNode
      }`,
      receiverBinding: gen`_Scope.Token = _ViewProps.__taoReceiver`,
      commandSurface: gen`TR.Interaction.UseCommandSurface("planned-command")`,
      hostSlots: gen`TR.Navigation.UseHostSlots(_ViewProps.__taoHost, { planned: true })`,
    }))

    Expect(code.startsWith('function _TaoToken_Badge(_ViewProps: {')).toBe(true)
    Expect(code).toContain('__taoReceiver: TR.Cell<string>')
    Expect(code).toContain('__tao?: TR.TaoProps')
    Expect(code).toContain('__taoHost?: TR.HostReadChannel')
    Expect(code).toContain('__taoSlots?: Readonly<Record<string, TR.SlotRenderer<any> | null>>')
    Expect(code).toContain('children?: React.ReactNode')
    Expect(code).toContain('TR.AssertViewDepth(_ViewProps.__tao, "Badge")')
    Expect(code).toContain('TR.Interaction.UseOccurrence(_ViewProps.__tao)')
    Expect(code).toContain('const _TaoActionOwner = TR.UseActionOwner()')
    Expect(code).toContain('const _TaoAuthScope = TR.Auth.UseOptionalContext()')
    Expect(code).toContain('TR.BlockScope(_Scope, _Scope => {')

    const receiver = code.indexOf('_Scope.Token = _ViewProps.__taoReceiver')
    const parameter = code.indexOf('_Scope.Value = _ViewProps.Value')
    const setup = code.indexOf('TR.Value("ready")')
    const render = code.indexOf('TR.RenderText(_Scope.Label')
    Expect(receiver).toBeGreaterThan(-1)
    Expect(parameter).toBeGreaterThan(-1)
    Expect(setup).toBeGreaterThan(-1)
    Expect(render).toBeGreaterThan(-1)
    Expect(receiver).toBeLessThan(parameter)
    Expect(parameter).toBeLessThan(setup)
    Expect(setup).toBeLessThan(render)
    Expect(code).toContain('TR.DeclarationTaoProps(_ViewProps.__tao,')
    Expect(code).toContain('TR.Interaction.UseCommandSurface("planned-command")')
    Expect(code).toContain('TR.Navigation.UseHostSlots(_ViewProps.__taoHost, { planned: true })')
  })
})
