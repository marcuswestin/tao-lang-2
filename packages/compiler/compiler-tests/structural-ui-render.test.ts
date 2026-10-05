import { ASTUtils } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Assert, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Validator from '@validator'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: structural ui renders', () => {
  Test('uses selected capability transport and opaque rendered results with occurrence metadata', async () => {
    const validated = await Validator.validateCode(`
      can Display { Render() fails never -> rendered }
      view Bare(Value Display) { #bare accessible label "Visual" render Value [pad 8] }
      view Description(Value Display) { render Value.Render() }
    `)
    Expect(Diagnostics.errorMessages(validated.diagnostics)).toEqual([])
    const effects = validated.associatedEffects
    Assert.defined(effects, 'the real source contracts are sealed before view emission')
    const code = ASTUtils.withAssociatedEffects(
      effects,
      () =>
        validated.entry.ast.statements.filter(AST.isViewDeclaration).map(view =>
          Langium.toString(Compile.ViewDeclaration(view))
        ).join('\n'),
    ).replace(/\s+/g, ' ')
    Expect(code).toContain('TR.Capability.reproject(')
    Expect(code).toContain('TR.Capability.method(_TaoUiReceiver, "Render")')
    Expect(code).toContain('TR.Call<TR.Rendered>(')
    Expect(code).toContain('TR.MountRendered(TR.Call<TR.Rendered>(')
    Expect(code.match(/TR.MountRendered\(/g)).toHaveLength(2)
    Expect(code).toContain('testTag: "bare"')
    Expect(code).toContain('accessibilityLabel: TR.Value("Visual").evaluate().jsValue')
    Expect(code).toContain('TR.Design.Spec([["pad",8]])')
    Expect(code).not.toContain('TR.RenderText(')
  })

  Test('invokes the bound witness once with its original live receiver and no extra arguments', async () => {
    const validated = await Validator.validateCode(`
      can Display { Render() fails never -> rendered }
      view Bare(Value Display) { #current render Value }
    `)
    Expect(Diagnostics.errorMessages(validated.diagnostics)).toEqual([])
    const effects = validated.associatedEffects
    Assert.defined(effects, 'the real source contracts are sealed before render emission')
    const view = validated.entry.ast.statements.find(AST.isViewDeclaration)!
    const render = view.block!.statements.find(AST.isRenderStatement)!
    const fragment = ASTUtils.withAssociatedEffects(effects, () => Langium.toString(Compile.Render(render))).trim()
    // Run the emitted expression inside the JSX fragment; the real runtime still creates the element.
    Assert(fragment.startsWith('<>{') && fragment.endsWith('}</>'), 'the render has one JSX fragment wrapper')
    const expression = fragment.slice('<>{'.length, -'}</>'.length)
    const { default: TR } = await runtimeModule
    const original = TR.Cell(TR.Value('before'))
    let calls = 0
    let mounted = 0
    function Body(_props: { receiver: typeof original }) {
      mounted += 1
      return null
    }
    const carrier = TR.Capability.attach(original, {
      Render: TR.Function((receiver, ...args) => {
        calls += 1
        Expect(receiver === original).toBe(true)
        Expect(args).toEqual([])
        return TR.RenderView(Body, { receiver })
      }),
    })
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`return ${expression}`)
    const element = new Function('TR', '_Scope', '_ViewProps', javascript)(TR, { Value: carrier }, {})
    Expect(calls).toBe(1)
    Expect(mounted).toBe(0)
    Expect(element.type === Body).toBe(true)
    Expect(element.props.__tao.testTag).toBe('current')
    Expect(element.props.receiver === original).toBe(true)
    original.set(TR.Value('after'))
    Expect(element.props.receiver.evaluate().jsValue).toBe('after')
  })
})
