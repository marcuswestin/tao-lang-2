import { ASTUtils, Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { associatedWitnessExports } from '../compiler-src/codegen/react-native/app/associated-witness-plan'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: bounded generic function calls', () => {
  Test('erases type parameters while executing the actual identity function and preserving the wrapper', async () => {
    const parsed = await Parser.parseCode(
      `
      type Score is number
      func Identity where type T is number (Value T) -> T { return Value }
      let Input = Score 4
      let Result = Identity(Input)
    `,
      { validation: false },
    )
    Expect(parsed.diagnostics).toEqual([])
    const fn = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    const result = parsed.entry.ast.statements.find(node => AST.isAliasDeclaration(node) && node.name === 'Result')
    const score = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    Expect.Is(result, AST.isAliasDeclaration)
    Expect.Is(score, AST.isTypeDeclaration)
    Expect.Is(result.value, AST.isFunctionCallExpression)
    const resolved = ASTUtils.resolveFunctionInvocation(result.value)
    Expect(resolved.diagnostics).toEqual([])
    Expect(resolved.genericDiagnostics).toEqual([])
    const type = Type.ofExpression(result.value)
    Expect(type.kind === 'primitive' && type.nominal === score).toBe(true)
    const declaration = Langium.toString(Compile.FunctionDeclaration(fn))
    const call = Langium.toString(Compile.Expression(result.value))
    Expect(declaration).not.toContain('_Scope.T')
    Expect(call).toBe('TR.Call(_Scope.Identity, _Scope.Input.evaluate())')
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(declaration)
    const { default: TR } = await runtimeModule
    const input = TR.Value(4)
    const scope = { Input: input }
    const output = new Function('TR', '_Scope', `${javascript}\nreturn ${call}`)(TR, scope)
    Expect(output.evaluate() === input).toBe(true)
  })

  Test('executes reordered generic capability calls and retains both witnesses through forwarding', async () => {
    const parsed = await Parser.parseCode(
      `
      can Ordered { Compare(Other type) fails never -> number }
      can Display { ToText() fails never -> text }
      type Token is text with {
        func Compare(Other Self) fails never -> number { return 0 }
        func ToText() fails never -> text { return Token }
      }
      type Parent is Token
      type Child is Parent with {
        func Compare(Other Self) fails never -> number { return 1 }
      }
      type Score is number with {
        func ToText() fails never -> text { return "score:{Score}" }
      }
      func EarlierLabel where type T is Ordered and Display (Left T, Right T) -> text {
        if Left.Compare(Right) <= 0 { return Left.ToText() }
        return Right.ToText()
      }
      func Relay where type U is Ordered and Display (Left U, Right U) -> text {
        return EarlierLabel(Right: Right, Left: Left)
      }
      func ScalarLabel where type S is number and Display (Value S) -> text {
        return Value.ToText()
      }
      func ScalarPair where type P is number and Display (Anchor P, Value P) -> text {
        return Value.ToText()
      }
      func DirectCall(Left Parent, Right Child) -> text {
        return EarlierLabel(Right: Right, Left: Left)
      }
      func ForwardedCall(Left Parent, Right Child) -> text {
        return Relay(Right: Right, Left: Left)
      }
      func RoleCall(ParentValue Parent, ChildValue Child) -> text {
        return EarlierLabel(.Right ChildValue, .Left ParentValue)
      }
      func ForwardedRoleCall(ParentValue Parent, ChildValue Child) -> text {
        return Relay(.Right ChildValue, .Left ParentValue)
      }
      func ReversedRoleCall(ParentValue Parent, ChildValue Child) -> text {
        return EarlierLabel(.Left ChildValue, .Right ParentValue)
      }
      func ForwardedReversedRoleCall(ParentValue Parent, ChildValue Child) -> text {
        return Relay(.Left ChildValue, .Right ParentValue)
      }
      func ScalarCall(Value Score) -> text { return ScalarLabel(Value) }
      func ScalarRoleCall(Value Score) -> text { return ScalarPair(.Anchor Value, .Value 7) }
    `,
      { validation: false },
    )
    Expect(parsed.diagnostics).toEqual([])

    const file = parsed.entry.ast
    const functions = file.statements.filter(AST.isFunctionDeclaration)
    const functionNamed = (name: string) => {
      const fn = functions.find(candidate => candidate.name === name)
      Expect.Is(fn, AST.isFunctionDeclaration)
      return fn
    }
    const token = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Token')
    Expect.Is(token, AST.isTypeDeclaration)
    const witnessBindings = associatedWitnessExports(file)
    const tokenWitness = witnessBindings.get(token)
    Assert.defined(tokenWitness, 'Expected the emitted Token witness binding.')

    const childType = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Child')
    const score = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Score')
    Expect.Is(childType, AST.isTypeDeclaration)
    Expect.Is(score, AST.isTypeDeclaration)
    const childWitness = witnessBindings.get(childType)
    Assert.defined(childWitness, 'Expected the emitted Child override witness binding.')
    const scoreWitness = witnessBindings.get(score)
    Assert.defined(scoreWitness, 'Expected the emitted Score witness binding.')

    const calls = [
      'DirectCall',
      'ForwardedCall',
      'RoleCall',
      'ForwardedRoleCall',
      'ReversedRoleCall',
      'ForwardedReversedRoleCall',
      'ScalarCall',
      'ScalarRoleCall',
    ].map(name => {
      const call = AST.returnStatementsOf(functionNamed(name))[0]?.value
      Expect.Is(call, AST.isFunctionCallExpression)
      return call
    })

    const effects = ASTUtils.createAssociatedEffects([file])
    const { emitted, expressions } = ASTUtils.withAssociatedEffects(
      effects,
      () =>
        withAssociatedWitnessBindings(witnessBindings, () => {
          calls.forEach(call => {
            const invocation = ASTUtils.resolveFunctionInvocation(call)
            Expect(invocation.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
            Expect(invocation.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
          })
          const emitted = [
            ...[...witnessBindings.keys()].map(owner => Langium.toString(Compile.AssociatedMethodsDeclaration(owner))),
            ...['EarlierLabel', 'Relay', 'ScalarLabel'].map(name =>
              Langium.toString(Compile.FunctionDeclaration(functionNamed(name)))
            ),
            Langium.toString(Compile.FunctionDeclaration(functionNamed('ScalarPair'))),
          ].join('\n')
          const expressions = calls.map(call => Langium.toString(Compile.Expression(call)))
          return { emitted, expressions }
        }),
    )
    const { default: TR } = await runtimeModule
    const compareCalls: unknown[][] = []
    const childCompareCalls: unknown[][] = []
    const displayCalls: unknown[][] = []
    let tokenMethods: { Compare: unknown; ToText: unknown } | undefined
    let childMethods: { Compare: unknown } | undefined
    let scoreMethods: { ToText: unknown } | undefined
    const runtime = new Proxy(TR, {
      get(target, property) {
        if (property === 'Call') {
          return (callable: unknown, ...args: unknown[]) => {
            if (tokenMethods && callable === tokenMethods.Compare) {
              compareCalls.push(args)
            }
            if (childMethods && callable === childMethods.Compare) {
              childCompareCalls.push(args)
            }
            if (tokenMethods && callable === tokenMethods.ToText) {
              displayCalls.push(args)
            }
            if (scoreMethods && callable === scoreMethods.ToText) {
              displayCalls.push(args)
            }
            return target.Call(callable as never, ...(args as never[]))
          }
        }
        return Reflect.get(target, property, target)
      },
    })
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const scope: Record<string, unknown> = {}
    const module = new Function(
      'TR',
      '_Scope',
      transpiler.transformSync(`${emitted}\nreturn {
        tokenMethods: ${tokenWitness},
        childMethods: ${childWitness},
        scoreMethods: ${scoreWitness},
        direct: () => ${expressions[0]},
        forwarded: () => ${expressions[1]},
        role: () => ${expressions[2]},
        forwardedRole: () => ${expressions[3]},
        reversedRole: () => ${expressions[4]},
        forwardedReversedRole: () => ${expressions[5]},
        scalar: () => ${expressions[6]},
        scalarRole: () => ${expressions[7]},
      }`),
    )(runtime, scope) as {
      tokenMethods: { Compare: unknown; ToText: unknown }
      childMethods: { Compare: unknown }
      scoreMethods: { ToText: unknown }
      direct: () => { getJSValue(): unknown }
      forwarded: () => { getJSValue(): unknown }
      role: () => { getJSValue(): unknown }
      forwardedRole: () => { getJSValue(): unknown }
      reversedRole: () => { getJSValue(): unknown }
      forwardedReversedRole: () => { getJSValue(): unknown }
      scalar: () => { getJSValue(): unknown }
      scalarRole: () => { getJSValue(): unknown }
    }
    tokenMethods = module.tokenMethods
    childMethods = module.childMethods
    scoreMethods = module.scoreMethods

    const left = TR.Value('left')
    const right = TR.Value('right')
    const parent = TR.Value('parent')
    const child = TR.Value('child')
    const expectSingleCall = (calls: readonly unknown[][], expected: readonly unknown[]) => {
      Expect(calls).toHaveLength(1)
      Expect(calls[0]).toHaveLength(expected.length)
      expected.forEach((argument, index) => {
        const actualValue = (calls[0]?.[index] as { getJSValue(): unknown }).getJSValue()
        const expectedValue = (argument as { getJSValue(): unknown }).getJSValue()
        Expect(actualValue).toBe(expectedValue)
      })
    }
    scope.Left = left
    scope.Right = right
    scope.ParentValue = parent
    scope.ChildValue = child
    scope.Value = TR.Value(12)
    Expect(module.direct().getJSValue()).toBe('left')
    expectSingleCall(compareCalls, [left, right])
    expectSingleCall(displayCalls, [left])

    compareCalls.length = 0
    displayCalls.length = 0
    Expect(module.role().getJSValue()).toBe('parent')
    expectSingleCall(compareCalls, [parent, child])
    expectSingleCall(displayCalls, [parent])

    compareCalls.length = 0
    childCompareCalls.length = 0
    displayCalls.length = 0
    Expect(module.reversedRole().getJSValue()).toBe('child')
    expectSingleCall(compareCalls, [child, parent])
    Expect(childCompareCalls).toHaveLength(0)
    expectSingleCall(displayCalls, [child])

    compareCalls.length = 0
    displayCalls.length = 0
    Expect(module.forwarded().getJSValue()).toBe('left')
    expectSingleCall(compareCalls, [left, right])
    expectSingleCall(displayCalls, [left])

    compareCalls.length = 0
    displayCalls.length = 0
    Expect(module.forwardedRole().getJSValue()).toBe('parent')
    expectSingleCall(compareCalls, [parent, child])
    expectSingleCall(displayCalls, [parent])

    compareCalls.length = 0
    childCompareCalls.length = 0
    displayCalls.length = 0
    Expect(module.forwardedReversedRole().getJSValue()).toBe('child')
    expectSingleCall(compareCalls, [child, parent])
    Expect(childCompareCalls).toHaveLength(0)
    expectSingleCall(displayCalls, [child])

    displayCalls.length = 0
    Expect(module.scalar().getJSValue()).toBe('score:12')
    Expect(displayCalls).toHaveLength(1)

    displayCalls.length = 0
    Expect(module.scalarRole().getJSValue()).toBe('score:7')
    Expect(displayCalls).toHaveLength(1)
  })
})
