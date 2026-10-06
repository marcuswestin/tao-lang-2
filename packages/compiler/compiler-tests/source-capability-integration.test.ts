import { ASTUtils } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Assert, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Validator from '@validator'
import { associatedWitnessExports } from '../compiler-src/codegen/react-native/app/associated-witness-plan'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import Compiler from '../compiler-src/compiler'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: source capability admission', () => {
  Test(
    'infers genuine source purity and transports an inherited live value through its admitted capability',
    async () => {
      const compiled = await Compiler.compileCode(`
      type Title is text with { func ToText() fails never { return "{Title}" } }
      type Child is Title
      can Display { ToText() fails never -> text }
      func TextOf(Value Display) fails never -> text { return Value.ToText() }
      func Show(Value Child) fails never -> text { return TextOf(Value) }
      view Main { render "{Show(Child \"Compiled\")}" }
      app Sample { id "com.tao.capability" name "Capability" version "1.0.0" view Main }
    `)
      const validation = compiled.validation
      Expect(Diagnostics.errorMessages(validation.diagnostics)).toEqual([])
      Expect(compiled.code.length).toBeGreaterThan(0)
      const effects = validation.associatedEffects
      Assert.defined(effects, 'Expected source-derived associated effect context.')
      const file = validation.entry.ast
      const title = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Title')
      Expect.Is(title, AST.isTypeDeclaration)
      const method = ASTUtils.ownAssociatedMethods(title)[0]
      Assert.defined(method, 'Expected the real source method.')
      const analysis = effects.analyses.get(method)
      Assert.defined(analysis, 'Expected analysis of the source method body.')
      Expect(analysis.effects).toEqual({
        purity: { open: false, violations: [] },
        failures: { open: false, cases: [] },
      })
      const code = ASTUtils.withAssociatedEffects(
        effects,
        () =>
          withAssociatedWitnessBindings(associatedWitnessExports(file), () =>
            [
              ...[...associatedWitnessExports(file).keys()].map(owner =>
                Langium.toString(Compile.AssociatedMethodsDeclaration(owner))
              ),
              ...file.statements.filter(AST.isFunctionDeclaration).map(fn =>
                Langium.toString(Compile.FunctionDeclaration(fn))
              ),
            ].join('\n')),
      )
      const { default: TR } = await runtimeModule
      const scope: Record<string, any> = {}
      new Function('TR', '_Scope', new Bun.Transpiler({ loader: 'ts' }).transformSync(code))(TR, scope)
      const value = TR.Cell(TR.Value('Before'))
      Expect(TR.Call(scope['Show'], value).getJSValue()).toBe('Before')
      value.set(TR.Value('After'))
      Expect(TR.Call(scope['Show'], value).getJSValue()).toBe('After')
    },
  )

  Test('rejects unclassified native implementations rather than trusting fails never', async () => {
    const validation = await Validator.validateCode(`
      type Title is text with {
        func ToText() fails never -> text { return NativeTitle from ./Native.ts }
      }
      can Display { ToText() fails never -> text }
      func TextOf(Value Display) -> text { return Value.ToText() }
      func Show(Value Title) -> text { return TextOf(Value) }
    `)
    Expect(Diagnostics.hasError(validation.diagnostics)).toBe(true)
    const title = validation.entry.ast.statements.find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Title'
    )
    Expect.Is(title, AST.isTypeDeclaration)
    const method = ASTUtils.ownAssociatedMethods(title)[0]
    Assert.defined(method, 'Expected the real native-calling source method.')
    const analysis = validation.associatedEffects?.analyses.get(method)
    Assert.defined(analysis, 'Expected source-derived native uncertainty.')
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
  })
})
