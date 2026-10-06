import { ASTUtils } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Assert, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, fence, Test, tsFence } from '@shared/test'
import Validator from '@validator'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import { TestCompiler as Compiler } from './test-compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: generic view arguments', () => {
  for (const supplied of ['Display', 'Full'] as const) {
    Test(`transports the actual ${supplied} role payload through its specialized capability domain`, async () => {
      const validated = await Validator.validateCode(`
      can Display { ToText() fails never -> text }
      can Full { ToText() fails never -> text, ToDebug() fails never -> text }
      view Native where type T is Display (Value T) {
        render inject Value ${tsFence} return null ${fence}
      }
      view Main(Provided ${supplied}) { render Native(.Value Provided) }
    `)
      Expect(Diagnostics.errorMessages(validated.diagnostics)).toEqual([])
      const effects = validated.associatedEffects
      Assert.defined(effects, 'real generic source contracts are sealed before argument emission')
      const main = validated.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Main')
      Assert.defined(main, 'the caller view exists')
      Assert(AST.isViewDeclaration(main), 'the caller is a view declaration')
      Assert.defined(main.block, 'the caller view has a body')
      const render = main.block.statements.find(AST.isRenderStatement)!
      const prop = ASTUtils.withAssociatedEffects(
        effects,
        () => Langium.toString(Compile.RenderArguments(ASTUtils.resolveRenderInvocation(render))).trim(),
      )
      if (supplied === 'Full') {
        Expect(prop).toContain('TR.Capability.reproject(')
      } else {
        Expect(prop).toBe('Value={TR.Alias(() => _Scope.Provided.evaluate())}')
      }
      Assert(prop.startsWith('Value={') && prop.endsWith('}'), 'the render has one transported Value prop')
      const expression = prop.slice('Value={'.length, -1)
      const { default: TR } = await runtimeModule
      const original = TR.Cell(TR.Value('before'))
      const carrier = TR.Capability.attach(original, {
        ToText: TR.Function((receiver: any) => {
          Expect(receiver === original).toBe(true)
          return TR.Value(receiver.getJSValue())
        }),
        ToDebug: TR.Function(() => TR.Value('original witness')),
      })
      const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(`return ${expression}`)
      const received = new Function('TR', '_Scope', javascript)(TR, { Provided: carrier })
      const call = () => TR.Call(TR.Capability.method(received.evaluate(), 'ToText')).getJSValue()
      Expect(call()).toBe('before')
      original.set(TR.Value('after'))
      Expect(call()).toBe('after')
    })
  }

  Test('preserves a nominal field lens through native view binding and required validation', async () => {
    const compiled = await Compiler.compileCode(`
      use Col, TextField from @tao/ui
      type TitleType is text
      data Books / Book { Title TitleType (required "Enter a title"), Note text }
      type NewBook is Book { Title }
      app Form { id "typed.text.field.direct" version "1.0.0" name "Typed form" view Main }
      view Main {
        state Draft = NewBook { Title: TitleType "" }
        render Col { #title TextField(Draft.Title) "{Draft.Incomplete}" }
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('<_Scope.TextField Value={(TR.Member(_Scope.Draft, ["Title"]) as TR.Writable<any>)}')
    Expect(code).toContain('TR.Incomplete(_Scope.Draft.evaluate(), [["Title", "Enter a title"]])')
    const field = compiled.files.find(file => file.code.includes('function TextField'))
    Expect(field).toBeDefined()
    Expect(field!.code).toContain('_TaoNative_Value.set(TR.Value(next))')
    Expect(compiled.files.some(file =>
      file.relativePath.endsWith('TextField.tao.injection-1.tsx')
      && file.code.includes('TR.Views.TextInput(')
    )).toBe(true)
  })
})
