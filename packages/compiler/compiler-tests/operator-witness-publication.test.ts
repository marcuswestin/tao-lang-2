import { ASTUtils } from '@ast-utils'
import { AST, Langium } from '@parser'
import { Assert, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  associatedOperatorWitnessKeys,
  associatedWitnessExports,
} from '../compiler-src/codegen/react-native/app/associated-witness-plan'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'
import Compiler from '../compiler-src/compiler'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: operator witness publication', () => {
  Test('keeps unary and binary contracts separate through real structural attachment and invocation', async () => {
    const compiled = await Compiler.compileCode(`
      can BothMinus {
        -() fails never -> number
        -(Right Self) fails never -> number
      }
      can UnaryMinus { -() fails never -> number }
      type Measure is number with {
        func -() fails never -> number { return 11 }
        func -(Right Measure) fails never -> number { return 7 }
      }
      func Negative(Value BothMinus) { return -Value }
      func Difference(Value BothMinus) { return Value - Value }
      func RunNegative(Value Measure) { return Negative(Value) }
      func RunDifference(Value Measure) { return Difference(Value) }
      func Project(Value BothMinus) -> UnaryMinus { return Value }
      func NegativeOnly(Value UnaryMinus) { return -Value }
      func RunProjected(Value Measure) { return NegativeOnly(Project(Value)) }
      view Main { render "Operators" }
      app Sample { id "com.tao.operator-witness" name "Operators" version "1.0.0" view Main }
    `)
    Expect(Diagnostics.errorMessages(compiled.validation.diagnostics)).toEqual([])
    const effects = compiled.validation.associatedEffects
    Assert.defined(effects, 'real source validation publishes the operator effect proofs')
    const file = compiled.validation.entry.ast
    const keys = associatedOperatorWitnessKeys([file])
    Expect(keys.size).toBe(5)
    Expect(new Set(keys.values()).size).toBe(5)
    const bindings = associatedWitnessExports(file)
    const source = ASTUtils.withAssociatedEffects(effects, () =>
      withAssociatedWitnessBindings(bindings, () =>
        [
          ...[...bindings.keys()].map(owner => Langium.toString(Compile.AssociatedMethodsDeclaration(owner))),
          ...file.statements.filter(AST.isFunctionDeclaration).map(fn =>
            Langium.toString(Compile.FunctionDeclaration(fn))
          ),
        ].join('\n'), keys))
    const { default: TR } = await runtimeModule
    const scope: Record<string, any> = {}
    new Function('TR', '_Scope', new Bun.Transpiler({ loader: 'ts' }).transformSync(source))(TR, scope)
    Expect(TR.Call(scope['RunNegative'], TR.Value(5)).getJSValue()).toBe(11)
    Expect(TR.Call(scope['RunDifference'], TR.Value(5)).getJSValue()).toBe(7)
    Expect(TR.Call(scope['RunProjected'], TR.Value(5)).getJSValue()).toBe(11)
  })
})
