import { ASTUtils } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: actual associated call lowering', () => {
  Test('uses inherited owner witnesses, type-bound order and omitted defaults', async () => {
    const source = await parse(`
      type Token is text with {
        func Format(Prefix text, Count number) -> text {
          return "{Token}:{Prefix}:{Count}"
        }
        func Defaults(Prefix text default "fallback", Count number default 1) -> text {
          return "{Token}:{Prefix}:{Count}"
        }
      }
      type Child is Token
      func Reordered(Value Child) -> text { return Value.Format(3, "prefix") }
      func Omitted(Value Child) -> text { return Value.Defaults(Count: 2) }
    `)
    const { default: TR } = await runtimeModule
    for (const fn of source.statements.filter(AST.isFunctionDeclaration)) {
      const call = AST.returnStatementsOf(fn)[0]?.value
      Expect.Is(call, AST.isMethodCallExpression)
      Expect(ASTUtils.resolveAssociatedMethodInvocation(call).diagnostics.map(diagnostic => diagnostic.kind)).toEqual(
        [],
      )
    }
    const scope = await emit(source, TR)
    const sourceValue = TR.Cell(TR.Value('before'))
    Expect(TR.Call(scope['Reordered'], sourceValue).getJSValue()).toBe('before:prefix:3')
    Expect(TR.Call(scope['Omitted'], sourceValue).getJSValue()).toBe('before:fallback:2')
    sourceValue.set(TR.Value('after'))
    Expect(TR.Call(scope['Reordered'], sourceValue).getJSValue()).toBe('after:prefix:3')
  })

  Test('lowers contextual receivers, nested members and returned-value chains', async () => {
    const source = await parse(`
      type Token is text with {
        func Again() -> Token { return Token }
        func ToText() -> text { return Token }
        func Echo() -> text { return Token.ToText() }
      }
      func Build() -> Token { return Token "built" }
      func Chain() -> text { return Build().Again().Echo() }
      func Nested(Value { Inner Token }) -> text { return Value.Inner.ToText() }
    `)
    const { default: TR } = await runtimeModule
    const scope = await emit(source, TR)
    Expect(TR.Call(scope['Chain']).getJSValue()).toBe('built')
    Expect(TR.Call(scope['Nested'], TR.Value({ Inner: 'nested' })).getJSValue()).toBe('nested')
  })

  Test('invokes a carried capability without injecting a second concrete receiver', async () => {
    const source = await parse(`
      can Display { ToText(Suffix text) -> text }
      func Relay(Value Display) -> Display { return Value }
      func Show(Value Display) -> text { return Relay(Value).ToText("!") }
    `)
    const { default: TR } = await runtimeModule
    const scope = await emit(source, TR)
    const cell = TR.Cell(TR.Value('before'))
    let invocations = 0
    const carrier = TR.Capability.attach(cell, {
      ToText: TR.Function((receiver: any, suffix: any) => {
        invocations++
        Expect(receiver === cell).toBe(true)
        return TR.Value(`${receiver.getJSValue()}${suffix.getJSValue()}`)
      }),
    })
    Expect(TR.Call(scope['Show'], carrier).getJSValue()).toBe('before!')
    cell.set(TR.Value('after'))
    Expect(TR.Call(scope['Show'], carrier).getJSValue()).toBe('after!')
    Expect(invocations).toBe(2)
  })

  Test('rejects invalid method correspondence before producing a call', async () => {
    const source = await parse(`
      type Token is text with { func Format(Count number) -> text { return Token } }
      func Bad(Value Token) -> text { return Value.Format("wrong") }
    `)
    const bad = source.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === 'Bad')
    Expect.Is(bad, AST.isFunctionDeclaration)
    const call = AST.returnStatementsOf(bad)[0]?.value
    Expect.Is(call, AST.isMethodCallExpression)
    Expect(() => Compile.Expression(call)).toThrow('validated associated call has no binding diagnostics')
  })
})

async function parse(code: string): Promise<AST.TaoFile> {
  // This suite isolates actual call transport; production effect publication has a separate owner.
  const parsed = await Parser.parseCode(code, { validation: false })
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}

async function emit(source: AST.TaoFile, runtime: unknown): Promise<Record<string, any>> {
  const bindings = new Map<AST.TypeDeclaration, string>()
  source.statements.filter(AST.isTypeDeclaration).forEach((owner, index) => {
    const methods = ASTUtils.ownAssociatedMethods(owner)
    if (methods.length) {
      bindings.set(owner, `_Witness${index}`)
    }
  })
  const code = ASTUtils.withAssociatedEffects(
    ASTUtils.createAssociatedEffects([source]),
    () =>
      withAssociatedWitnessBindings(bindings, () => {
        const owners = [...bindings.keys()].map(owner => Langium.toString(Compile.AssociatedMethodsDeclaration(owner)))
        const functions = source.statements.filter(AST.isFunctionDeclaration)
          .map(fn => Langium.toString(Compile.FunctionDeclaration(fn)))
        return [...owners, ...functions].join('\n')
      }),
  )
  const scope = {}
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(code)
  new Function('TR', '_Scope', javascript)(runtime, scope)
  return scope
}
