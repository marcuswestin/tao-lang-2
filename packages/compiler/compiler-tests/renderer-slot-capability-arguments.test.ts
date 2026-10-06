import { ASTUtils } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Assert, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, fence, Test, tsFence } from '@shared/test'
import Validator from '@validator'
import { compileSlotPlacement } from '../compiler-src/codegen/react-native/app/renderer-slot-codegen'
import { TestCompiler as Compiler } from './test-compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: renderer slot capability arguments', () => {
  for (const mode of ['supplied', 'default'] as const) {
    Test(`transports a ${mode} slot placement argument through its actual capability input contract`, async () => {
      const validated = await Validator.validateCode(`
      can Display { ToText() fails never -> text }
      can Broad { ToText() fails never -> text, Key() fails never -> text }
      view Body(Value Display) { render Value.ToText() }
      view Frame() { render inject Content @@content ${tsFence} return Content ${fence} }
      view Owner(Provided Broad) {
        @item(Value Display ${mode === 'default' ? 'default Provided' : ''}): ${mode === 'default' ? 'empty' : 'Body'}
        render Frame { @item(${mode === 'supplied' ? 'Provided' : ''}) }
      }
    `)
      Expect(Diagnostics.errorMessages(validated.diagnostics)).toEqual([])
      const placement = AST.streamAllContents(validated.entry.ast).find(node =>
        AST.isRenderSlotUse(node) && !AST.isRenderSlotFill(node)
      )
      Assert(placement && AST.isRenderSlotUse(placement), 'the actual source has a typed slot placement')
      const effects = validated.associatedEffects
      Assert.defined(effects, 'source capability contracts are sealed before placement emission')
      const expression = ASTUtils.withAssociatedEffects(
        effects,
        () => Langium.toString(compileSlotPlacement(placement, {})),
      )
      Expect(expression).toContain('TR.Capability.reproject(')
      const { default: TR } = await runtimeModule
      type Capability = ReturnType<typeof TR.Capability.attach>
      const original = TR.Cell(TR.Value('before'))
      const carrier = TR.Capability.attach(original, {
        ToText: TR.Function((receiver: Parameters<typeof TR.Capability.attach>[0]) => {
          Expect(receiver === original).toBe(true)
          return TR.Value(original.evaluate().jsValue)
        }),
        Key: TR.Function(() => TR.Value('private-key')),
      })
      const renderer = TR.RenderSlots.create(() => null, {})
      const javascript = new Bun.Transpiler({ loader: 'tsx' }).transformSync(`return ${expression}`)
      const element = new Function('TR', 'React', '_Scope', '_ViewProps', '_TaoSlotDefaults', javascript)(
        TR,
        { createElement: (_component: unknown, props: unknown) => ({ props }) },
        { Provided: carrier },
        { __taoSlots: { '@item': renderer } },
        {},
      ) as { props: { args: { Value: Capability }; renderer: unknown } }
      Expect(element.props.renderer === renderer).toBe(true)
      const received = element.props.args.Value.evaluate() as Capability
      const held = TR.Capability.method(received, 'ToText')
      Expect(() => TR.Capability.method(received, 'Key')).toThrow()
      Expect(TR.Call(held).getJSValue()).toBe('before')
      original.set(TR.Value('after'))
      Expect(TR.Call(held).getJSValue()).toBe('after')
    })
  }

  Test('attaches actual authored provider witnesses when a concrete value enters a slot', async () => {
    const compiled = await Compiler.compileCode(`
      can Display { ToText() fails never -> text }
      type Title is text with { func Title.ToText() fails never -> text { return "converted" } }
      view Body(Value Display) { render Value.ToText() }
      view Frame() { render inject Content @@content ${tsFence} return Content ${fence} }
      view Owner() {
        @item(Value Display): Body
        state Provided = Title "before"
        render Frame { @item(Provided) }
      }
      app Slots { id "slot.capability.transport" version "1.0.0" name "Slots" view Owner }
    `)
    Expect(compiled.code).toContain('_TaoSlotSourceArgument0 = TR.Capability.attach(')
    Expect(compiled.code).toContain('["ToText"]: TR.Function(')
  })
})
