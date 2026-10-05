import { ASTUtils } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Assert, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { associatedWitnessExports } from '../compiler-src/codegen/react-native/app/associated-witness-plan'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import Compiler from '../compiler-src/compiler'

Describe('compiler: item capability publication', () => {
  Test('stores selected behavior in an authored item and preserves its original live receiver', async () => {
    const compiled = await Compiler.compileCode(`
      type Title is text with { func ToText() fails never -> text { return "Title:{Title}" } }
      can Display { ToText() fails never -> text }
      type Row is { Content Display } with {
        func Read() fails never -> text { return Row.Content.ToText() }
      }
      func Read(Row) -> text { return Row.Read() }
      view Main { let Value = Title "before" let Entry = Row { Value } render "Items" }
      app Sample { id "item.capability" name "Items" version "1.0.0" view Main }
    `)
    Expect(Diagnostics.errorMessages(compiled.validation.diagnostics)).toEqual([])
    const effects = compiled.validation.associatedEffects
    Assert.defined(effects, 'source validation publishes actual item field capability proofs')
    const file = compiled.validation.entry.ast
    const bindings = associatedWitnessExports(file)
    const main = file.statements.filter(AST.isViewDeclaration).find(view => view.name === 'Main')
    Assert.defined(main, 'the item fixture has its source view')
    const entry = main.block?.statements.filter(AST.isAliasDeclaration).find(alias => alias.name === 'Entry')
    Assert.defined(entry, 'the item fixture constructs its authored row')
    const source = ASTUtils.withAssociatedEffects(effects, () =>
      withAssociatedWitnessBindings(bindings, () =>
        [
          ...[...bindings.keys()].map(owner => Langium.toString(Compile.AssociatedMethodsDeclaration(owner))),
          Langium.toString(Compile.AliasDeclaration(entry)),
          ...file.statements.filter(AST.isFunctionDeclaration).map(fn =>
            Langium.toString(Compile.FunctionDeclaration(fn))
          ),
        ].join('\n')))
    const { default: TR } = await import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))
    const scope: Record<string, any> = { Value: TR.Cell(TR.Value('before')) }
    new Function('TR', '_Scope', new Bun.Transpiler({ loader: 'ts' }).transformSync(source))(TR, scope)
    Expect(TR.Call(scope['Read'], scope['Entry']).getJSValue()).toBe('Title:before')
    scope['Value'].set(TR.Value('after'))
    Expect(TR.Call(scope['Read'], scope['Entry']).getJSValue()).toBe('Title:after')
  })
})
