import { ASTUtils } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Assert, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { associatedWitnessExports } from '../compiler-src/codegen/react-native/app/associated-witness-plan'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import Compiler from '../compiler-src/compiler'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: live list capability publication', () => {
  Test(
    'adapts and reprojects actual lists recursively while retaining current reads and raw nested storage',
    async () => {
      const compiled = await Compiler.compileCode(`
      type Title is text with { func ToText() fails never { return "{Title}" } }
      can Display { ToText() fails never -> text }
      can Caption { ToText() fails never -> text }
      func Project(Items list of Title) -> list of Display { return Items }
      func Reproject(Items list of Display) -> list of Caption { return Items }
      func Nested(Items list of list of Title) -> list of list of Display { return Items }
      view Main { render "Lists" }
      app Sample { id "com.tao.list-witness" name "Lists" version "1.0.0" view Main }
    `)
      Expect(Diagnostics.errorMessages(compiled.validation.diagnostics)).toEqual([])
      const effects = compiled.validation.associatedEffects
      Assert.defined(effects, 'source validation publishes real list element capability proofs')
      const file = compiled.validation.entry.ast
      const bindings = associatedWitnessExports(file)
      const source = ASTUtils.withAssociatedEffects(effects, () =>
        withAssociatedWitnessBindings(bindings, () =>
          [
            ...[...bindings.keys()].map(owner => Langium.toString(Compile.AssociatedMethodsDeclaration(owner))),
            ...file.statements.filter(AST.isFunctionDeclaration).map(fn =>
              Langium.toString(Compile.FunctionDeclaration(fn))
            ),
          ].join('\n')))
      const { default: TR } = await runtimeModule
      const scope: Record<string, any> = {}
      new Function('TR', '_Scope', new Bun.Transpiler({ loader: 'ts' }).transformSync(source))(TR, scope)
      const input = TR.Cell(TR.Value(['before']))
      const projected = TR.Call(scope['Project'], input)
      const captioned = TR.Call(scope['Reproject'], projected)
      const read = (value: any) => TR.Call(TR.Capability.method(value, 'ToText')).getJSValue()
      Expect(read(captioned.getJSValue()[0])).toBe('before')
      input.set(TR.Value(['after', 'added']))
      Expect(captioned.getJSValue().map(read)).toEqual(['after', 'added'])
      const nested = TR.Call(scope['Nested'], TR.Value([['one'], ['two']])).getJSValue()
      Expect(Array.isArray(nested[0])).toBe(true)
      Expect(nested.map((row: any[]) => row.map(read))).toEqual([['one'], ['two']])
    },
  )
})
