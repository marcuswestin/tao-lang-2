import { Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  compileAssociatedWitness,
  withAssociatedWitnessBindings,
} from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import {
  compileNativeParameter,
  compileReactiveArgument,
} from '../compiler-src/codegen/react-native/app/reactive-parameters'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: associated method witness declarations', () => {
  Test('rejects a capability before generating a mutable native payload adapter', async () => {
    const parsed = await Parser.parseCode(`
      can Display { ToText() -> text }
      func Relay(Value Display) -> Display { return Value }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const relay = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(relay, AST.isFunctionDeclaration)
    const parameter = AST.parametersOf(relay)[0]!
    Expect(() => compileNativeParameter(parameter)).toThrow('Mutable native capability parameters are unsupported.')
  })

  Test('passes a capability argument with its selected witness and live receiver intact', async () => {
    const parsed = await Parser.parseCode(`
      can Display { ToText() -> text }
      func Relay(Value Display) -> Display { return Value }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const relay = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(relay, AST.isFunctionDeclaration)
    const expression = AST.returnStatementsOf(relay)[0]?.value
    Expect.Is(expression, AST.isValueReference)
    const code = Langium.toString(compileReactiveArgument(expression))
    const { default: TR } = await runtimeModule
    const source = TR.Cell(TR.Value('Before'))
    const carrier = TR.Capability.attach(source, {
      ToText: TR.Function((receiver: any) => {
        Expect(receiver === source).toBe(true)
        return TR.Value(`Token:${receiver.getJSValue()}`)
      }),
    })
    const argument = new Function('TR', '_Scope', `return ${code}`)(TR, { Value: carrier })
    Expect(argument.evaluate() === carrier).toBe(true)
    const held = TR.Capability.method(argument.evaluate(), 'ToText')
    Expect(TR.Call(held).getJSValue()).toBe('Token:Before')
    source.set(TR.Value('After'))
    Expect(argument.evaluate() === carrier).toBe(true)
    Expect(TR.Call(held).getJSValue()).toBe('Token:After')
  })

  Test('binds the exact receiver in a fresh scope and preserves ordinary callee defaults', async () => {
    const parsed = await Parser.parseCode(`
      type Token is text with {
        func Prefix(Value text default "fallback") -> text { return Value }
      }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const owner = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(owner, AST.isTypeDeclaration)
    const declaration = withAssociatedWitnessBindings(
      new Map([[owner, '_TaoTokenWitness']]),
      () => Langium.toString(Compile.AssociatedMethodsDeclaration(owner)),
    )
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(declaration)
    const { default: TR } = await runtimeModule
    const localScopes: Record<string, unknown>[] = []
    const runtime = {
      Function: TR.Function,
      Value: TR.Value,
      BlockScope: (scope: Record<string, unknown>, body: (scope: Record<string, unknown>) => unknown) =>
        TR.BlockScope(scope, (local: Record<string, unknown>) => {
          const result = body(local)
          localScopes.push(local)
          return result
        }),
    }
    const shadow = TR.Value('ordinary module value')
    const scope: Record<string, any> = { Token: shadow }
    const witness = new Function('TR', '_Scope', `${javascript}\nreturn _TaoTokenWitness`)(runtime, scope)
    const method = witness.Prefix
    const receiver = TR.Value('unchanged receiver')
    const supplied = TR.Value('supplied argument')
    const defaultResult = TR.Call(method, receiver)
    const suppliedResult = TR.Call(method, receiver, supplied)
    Expect(defaultResult.evaluate().jsValue).toBe('fallback')
    Expect(suppliedResult.evaluate() === supplied).toBe(true)
    Expect(localScopes).toHaveLength(2)
    Expect(localScopes.every(local => local['Token'] === receiver)).toBe(true)
    Expect(localScopes[0] === localScopes[1]).toBe(false)
    Expect(scope['Token'] === shadow).toBe(true)
    Expect(witness.Prefix === method).toBe(true)
  })

  Test('selects inherited witnesses through a supplied private import binding under lexical shadowing', async () => {
    const parsed = await Parser.parseCode(`
      type Token is text with {
        func ToText() -> text { return "token" }
      }
      type Child is Token
      func Shadow(Token text) -> text { return Token }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const child = parsed.entry.ast.statements.find(statement =>
      AST.isTypeDeclaration(statement) && statement.name === 'Child'
    )
    Expect.Is(child, AST.isTypeDeclaration)
    const selection = Type.associatedMethods(Type.ofDefinition(child))[0]!
    Expect(selection.descriptor.owner.name).toBe('Token')
    const code = withAssociatedWitnessBindings(
      new Map([[selection.descriptor.owner, '_ImportedOwnerWitness']]),
      () => Langium.toString(compileAssociatedWitness(selection.descriptor)),
    )
    const fn = () => 'actual witness'
    const selected = new Function('_ImportedOwnerWitness', '_Scope', `return ${code}`)(
      { ToText: fn },
      { Token: 'shadowing local parameter' },
    )
    Expect(selected === fn).toBe(true)
  })
})
