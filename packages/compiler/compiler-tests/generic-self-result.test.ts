import { ASTUtils } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { associatedOperatorWitnessKeys } from '../compiler-src/codegen/react-native/app/associated-witness-plan'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

Describe('compiler: generic Self result contracts', () => {
  Test('retains another bound after an authored generic operator returns a new Self', async () => {
    const parsed = await Parser.parseCode(
      `
      can Arithmetic { +(Right Self) fails never -> Self }
      can Display { ToText() fails never -> text }
      func SumText where type T is Arithmetic and Display (Left T, Right T) -> text {
        return (Left + Right).ToText()
      }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const fn = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    const effects = ASTUtils.createAssociatedEffects([parsed.entry.ast])
    const keys = associatedOperatorWitnessKeys([parsed.entry.ast])
    const arithmetic = parsed.entry.ast.statements.find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Arithmetic'
    )
    Expect.Is(arithmetic, AST.isTypeDeclaration)
    const operator = ASTUtils.capabilityRequirements(arithmetic)[0]!
    Expect.Is(operator, AST.isCapabilityMethodDeclaration)
    const operatorKey = keys.get(operator)!
    Expect(operatorKey).toBeDefined()
    const code = ASTUtils.withAssociatedEffects(
      effects,
      () => withAssociatedWitnessBindings(new Map(), () => Langium.toString(Compile.FunctionDeclaration(fn)), keys),
    )
    const { default: TR } = await import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))
    const scope: Record<string, any> = {}
    new Function('TR', '_Scope', new Bun.Transpiler({ loader: 'ts' }).transformSync(code))(TR, scope)
    let calls = 0
    const methods = {
      [operatorKey]: TR.Function((left: any, right: any) => {
        calls++
        return TR.Value(`${left.getJSValue()}:${right.getJSValue()}`)
      }),
      ToText: TR.Function((receiver: any) => TR.Value(receiver.getJSValue())),
    }
    const left = TR.Capability.attach(TR.Value('left'), methods)
    const right = TR.Capability.attach(TR.Value('right'), methods)
    Expect(TR.Call(scope['SumText'], left, right).getJSValue()).toBe('left:right')
    Expect(calls).toBe(1)
    Expect(TR.Call(TR.Capability.method(left, 'ToText')).getJSValue()).toBe('left')
  })

  Test('dispatches both bounds on a new Self result while retaining the original donor', async () => {
    const parsed = await Parser.parseCode(
      `
      can Cloneable { Clone() fails never -> type }
      can Display { ToText() fails never -> text }
      type Token is text with {
        func Clone() fails never -> Self { return Token "new" }
        func ToText() fails never -> text { return Token }
      }
      func CloneText where type T is Cloneable and Display (Value T) -> text {
        return Value.Clone().ToText()
      }
      func OriginalText where type T is Cloneable and Display (Value T) -> text {
        return Value.ToText()
      }
    `,
      { validation: false },
    )
    Expect(parsed.diagnostics).toEqual([])
    const owner = parsed.entry.ast.statements.find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Token'
    )
    Expect.Is(owner, AST.isTypeDeclaration)
    const effects = ASTUtils.createAssociatedEffects([parsed.entry.ast])
    const emitted = ASTUtils.withAssociatedEffects(
      effects,
      () =>
        withAssociatedWitnessBindings(new Map([[owner, '_Witness']]), () =>
          [
            Langium.toString(Compile.AssociatedMethodsDeclaration(owner)),
            ...parsed.entry.ast.statements.filter(AST.isFunctionDeclaration).map(fn =>
              Langium.toString(Compile.FunctionDeclaration(fn))
            ),
          ].join('\n')),
    )
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(emitted)
    const { default: TR } = await import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))
    const scope: Record<string, any> = {}
    const witness = new Function('TR', '_Scope', `${javascript}\nreturn _Witness`)(TR, scope)
    const original = TR.Value('original')
    let clones = 0
    const donor = TR.Capability.attach(original, {
      Clone: TR.Function((receiver: any) => {
        Expect(receiver === original).toBe(true)
        clones++
        return TR.Call(witness.Clone, receiver)
      }),
      ToText: witness.ToText,
    })
    Expect(TR.Call(scope['CloneText'], donor).getJSValue()).toBe('new')
    Expect(clones).toBe(1)
    Expect(TR.Call(scope['OriginalText'], donor).getJSValue()).toBe('original')
    Expect(original.getJSValue()).toBe('original')
  })
})
