import { ASTUtils, Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import {
  associatedWitnessExports,
  referencedAssociatedWitnessOwners,
} from '../compiler-src/codegen/react-native/app/associated-witness-plan'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { compileArgumentForType } from '../compiler-src/codegen/react-native/app/capability-projection'
import { bridgeBindingName } from '../compiler-src/codegen/react-native/app/injection-plan'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

async function fixture() {
  const parsed = await Parser.parseCode(`
    let DisplayPrefix = "display"
    type Token is text with {
      func Format(Count number, Prefix text default "token", Tail text default "!") -> text {
        return "{Prefix}:{Count}:{Token}:{Tail}"
      }
    }
    type Child is Token
    can Supplied { Format(Count number, Prefix text default "supplied", Tail text default "!") -> text }
    can Display { Format(Prefix text default DisplayPrefix, Count number) -> text }
    func Source(Value Child) -> Child { return Value }
    func Projected(Value Supplied) -> Supplied { return Value }
    func Accept(Value Display) -> text { return Value.Format(Count: 2) }
    func Invoke(Value Child) -> text { return Accept(Value) }
    func ReturnDisplay(Value Child) -> Display { return Value }
    func DefaultAccept(Value Display default Child "Default") -> text { return Value.Format(Count: 2) }
    type NestedToken is text with { func Read() -> Child { return Child "nested" } }
    can Nested { Read() -> Display }
    type Consumer is text with { func Apply(Value Display) -> text { return Value.Format(Count: 2) } }
    can ApplyChild { Apply(Value Child) -> text }
    func NestedSource(Value NestedToken) -> NestedToken { return Value }
    func ConsumerSource(Value Consumer) -> Consumer { return Value }
    func ReturnNested(Value NestedToken) -> Nested { return Value }
    func ReturnConsumer(Value Consumer) -> ApplyChild { return Value }
    func NativeSink(Impossible number) -> number { return Impossible }
    func NativeBoundary(Value Child) -> text { return NativeSink(Accept(Value)) from ./Native.ts }
    func MissingNativeBoundary(Value Child) -> text { return NativeOnly(Accept(Value)) from ./Native.ts }
  `)
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  const file = parsed.entry.ast
  const owners = file.statements.filter(AST.isTypeDeclaration)
  const owner = (name: string) => {
    const declaration = owners.find(candidate => candidate.name === name)
    Assert.defined(declaration, 'Expected a named fixture owner.')
    return declaration
  }
  const functionNamed = (name: string) => {
    const fn = file.statements.filter(AST.isFunctionDeclaration).find(statement => statement.name === name)
    Assert.defined(fn, 'Expected a fixture function.')
    return fn
  }
  const expression = (name: string) => {
    const fn = functionNamed(name)
    const value = AST.returnStatementsOf(fn)[0]?.value
    Assert.defined(value, 'Expected a fixture return expression.')
    return value
  }
  const descriptors = new Map<
    AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
    ASTUtils.AssociatedCallableDescriptor
  >()
  for (const declaration of owners) {
    for (
      const method of [...ASTUtils.ownAssociatedMethods(declaration), ...ASTUtils.capabilityRequirements(declaration)]
    ) {
      const materialized = Type.associatedCallable(method, declaration)
      Assert(materialized.kind === 'ready', 'Expected a ready fixture descriptor.')
      descriptors.set(method, materialized.descriptor)
    }
  }
  // This isolates compiler transport over sealed proof inputs; production source discovery has its own vertical.
  const analyses = new Map(
    owners.flatMap(declaration => ASTUtils.ownAssociatedMethods(declaration)).map(method => [
      method,
      ASTUtils.analyzeCallableEffects(method, [{
        node: method,
        kind: 'complete',
        purity: { open: false, violations: [] },
        failures: { open: false, cases: [] },
        executes: [],
      }]),
    ]),
  )
  return { file, owner, expression, functionNamed, context: { descriptors, analyses } }
}

Describe('compiler: capability projection correspondence', () => {
  for (const mode of ['concrete', 'projection'] as const) {
    Test(`retains inherited live receiver, required defaults and implementation holes through ${mode}`, async () => {
      const { owner, expression, functionNamed, context } = await fixture()
      const code = ASTUtils.withAssociatedEffects(
        context,
        () =>
          withAssociatedWitnessBindings(
            new Map([
              [owner('Token'), '_TokenWitness'],
              [owner('Display'), '_DisplayDefaults'],
              [owner('Supplied'), '_SuppliedDefaults'],
            ]),
            () => {
              const declaration = ['Token', 'Display', 'Supplied'].map(name =>
                Langium.toString(Compile.AssociatedMethodsDeclaration(owner(name)))
              ).join('\n')
              const concrete = Langium.toString(compileArgumentForType(
                expression('Source'),
                Type.ofDefinition(owner(mode === 'concrete' ? 'Display' : 'Supplied')),
              ))
              const projected = mode === 'projection'
                ? Langium.toString(compileArgumentForType(expression('Projected'), Type.ofDefinition(owner('Display'))))
                : undefined
              const accept = functionNamed('Accept')
              const acceptDeclaration = Langium.toString(Compile.FunctionDeclaration(accept))
              const invocation = Langium.toString(Compile.Expression(expression('Invoke')))
              const returned = functionNamed('ReturnDisplay')
              const returnDeclaration = Langium.toString(Compile.FunctionDeclaration(returned))
              const defaultDeclaration = Langium.toString(Compile.FunctionDeclaration(functionNamed('DefaultAccept')))
              return {
                declaration,
                concrete,
                projected,
                acceptDeclaration,
                invocation,
                returnDeclaration,
                defaultDeclaration,
              }
            },
          ),
      )
      const { default: TR } = await runtimeModule
      const source = TR.Cell(TR.Value('Before'))
      const scope = { Value: source, DisplayPrefix: TR.Value('display') }
      const transpiler = new Bun.Transpiler({ loader: 'ts' })
      const module = new Function(
        'TR',
        '_Scope',
        transpiler.transformSync(
          `${code.declaration}\nreturn { carrier: ${code.concrete}, defaults: _DisplayDefaults }`,
        ),
      )(TR, scope)
      const value = code.projected
        ? new Function('TR', '_Scope', '_DisplayDefaults', transpiler.transformSync(`return ${code.projected}`))(
          TR,
          { Value: module.carrier, DisplayPrefix: TR.Value('caller shadow') },
          module.defaults,
        )
        : module.carrier
      const held = TR.Capability.method(value.evaluate(), 'Format')
      const invoke = new Function('TR', 'held', 'return TR.Call(held, undefined, TR.Value(2))')
      Expect(invoke(TR, held).getJSValue()).toBe('display:2:Before:!')
      source.set(TR.Value('After'))
      Expect(invoke(TR, held).getJSValue()).toBe('display:2:After:!')
      Expect(TR.Call(held, TR.Value('given'), TR.Value(3)).getJSValue()).toBe('given:3:After:!')
      Expect(scope.Value).toBe(source)
      const invoked = new Function(
        'TR',
        '_Scope',
        transpiler.transformSync(
          `${code.declaration}\n${code.acceptDeclaration}\nreturn ${code.invocation}`,
        ),
      )(TR, scope)
      Expect(invoked.getJSValue()).toBe('display:2:After:!')
      const returned = new Function(
        'TR',
        '_Scope',
        transpiler.transformSync(
          `${code.declaration}\n${code.returnDeclaration}\nreturn TR.Call(_Scope.ReturnDisplay, _Scope.Value)`,
        ),
      )(TR, scope)
      Expect(invoke(TR, TR.Capability.method(returned, 'Format')).getJSValue()).toBe('display:2:After:!')
      const defaulted = new Function(
        'TR',
        '_Scope',
        transpiler.transformSync(
          `${code.declaration}\n${code.defaultDeclaration}\nreturn TR.Call(_Scope.DefaultAccept)`,
        ),
      )(TR, scope)
      Expect(defaulted.getJSValue()).toBe('display:2:Default:!')
    })
  }

  Test('refuses to manufacture concrete witnesses without sealed effect proof', async () => {
    const { owner, expression, context } = await fixture()
    ASTUtils.withAssociatedEffects({ ...context, analyses: new Map() }, () => {
      Expect(() => compileArgumentForType(expression('Source'), Type.ofDefinition(owner('Display'))))
        .toThrow('Expected validated capability argument witnesses.')
    })
  })

  Test('projects nested result and contravariant input wrappers into their receiving contracts', async () => {
    const { owner, expression, context } = await fixture()
    const declarations = ['Token', 'Display', 'Supplied', 'NestedToken', 'Consumer']
    const code = ASTUtils.withAssociatedEffects(context, () =>
      withAssociatedWitnessBindings(
        new Map(declarations.map(name => [owner(name), `_${name}Witness`])),
        () => ({
          declarations: declarations.map(name => Langium.toString(Compile.AssociatedMethodsDeclaration(owner(name))))
            .join('\n'),
          nested: Langium.toString(
            compileArgumentForType(expression('NestedSource'), Type.ofDefinition(owner('Nested'))),
          ),
          consumer: Langium.toString(compileArgumentForType(
            expression('ConsumerSource'),
            Type.ofDefinition(owner('ApplyChild')),
          )),
        }),
      ))
    const { default: TR } = await runtimeModule
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const compile = (expression: string) =>
      new Function(
        'TR',
        '_Scope',
        transpiler.transformSync(
          `${code.declarations}\nreturn ${expression}`,
        ),
      )(TR, { Value: TR.Value('receiver'), DisplayPrefix: TR.Value('display') })
    const nested = compile(code.nested)
    const result = TR.Call(TR.Capability.method(nested, 'Read'))
    Expect(TR.Call(TR.Capability.method(result, 'Format'), undefined, TR.Value(2)).getJSValue())
      .toBe('display:2:nested:!')
    const consumer = compile(code.consumer)
    Expect(TR.Call(TR.Capability.method(consumer, 'Apply'), TR.Value('input')).getJSValue())
      .toBe('display:2:input:!')
  })

  Test('plans declaring-module default and nested witness dependencies from actual source boundaries', async () => {
    const { file, owner, context } = await fixture()
    ASTUtils.withAssociatedEffects(context, () => {
      const exports = associatedWitnessExports(file)
      Expect(exports.has(owner('Display'))).toBe(true)
      Expect(exports.has(owner('Supplied'))).toBe(true)
      const referenced = referencedAssociatedWitnessOwners(file.statements)
      for (const name of ['Token', 'Display', 'NestedToken', 'Consumer']) {
        Expect(referenced.has(owner(name))).toBe(true)
      }
    })
  })

  Test('skips native heads while retaining nested Tao capability transport and execution', async () => {
    const { owner, functionNamed, context } = await fixture()
    const boundaries = ['NativeBoundary', 'MissingNativeBoundary'].map(functionNamed)
    const bridges = boundaries.map(fn => {
      const bridge = AST.streamAllContents(fn).find(AST.isFromExpression)
      Expect.Is(bridge, AST.isFromExpression)
      return bridge
    })
    const [matched, unresolved] = bridges
    Assert.defined(matched, 'Expected the same-name native boundary.')
    Assert.defined(unresolved, 'Expected the unresolved native boundary.')
    Expect.Is(matched.expression, AST.isFunctionCallExpression)
    Expect(matched.expression.function.ref === functionNamed('NativeSink')).toBe(true)
    Expect.Is(unresolved.expression, AST.isFunctionCallExpression)
    Expect(unresolved.expression.function.ref).toBeUndefined()
    const code = ASTUtils.withAssociatedEffects(context, () => {
      const referenced = referencedAssociatedWitnessOwners(boundaries)
      Expect(referenced.has(owner('Token'))).toBe(true)
      Expect(referenced.has(owner('Display'))).toBe(true)
      return withAssociatedWitnessBindings(
        new Map(['Token', 'Display'].map(name => [owner(name), `_${name}Witness`])),
        () =>
          [
            ...['Token', 'Display'].map(name => Langium.toString(Compile.AssociatedMethodsDeclaration(owner(name)))),
            ...[functionNamed('Accept'), ...boundaries].map(fn => Langium.toString(Compile.FunctionDeclaration(fn))),
            'return [TR.Call(_Scope.NativeBoundary, TR.Value("native")), TR.Call(_Scope.MissingNativeBoundary, TR.Value("missing"))]',
          ].join('\n'),
      )
    })
    const { default: TR } = await runtimeModule
    const calls: string[] = []
    const native = (value: string) => {
      calls.push(value)
      return `native:${value}`
    }
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    const results = new Function('TR', '_Scope', ...bridges.map(bridgeBindingName), transpiler.transformSync(code))(
      TR,
      { DisplayPrefix: TR.Value('display') },
      native,
      native,
    ) as { getJSValue(): string }[]
    Expect(calls).toEqual(['display:2:native:!', 'display:2:missing:!'])
    Expect(results.map(result => result.getJSValue())).toEqual([
      'native:display:2:native:!',
      'native:display:2:missing:!',
    ])
  })

  Test('typechecks generated default-before-required signatures against the actual runtime', async () => {
    const { owner, expression, functionNamed, context } = await fixture()
    const declarations = ['Token', 'Display', 'Supplied']
    const code = ASTUtils.withAssociatedEffects(context, () =>
      withAssociatedWitnessBindings(
        new Map(declarations.map(name => [owner(name), `_${name}Witness`])),
        () =>
          [
            ...declarations.map(name => Langium.toString(Compile.AssociatedMethodsDeclaration(owner(name)))),
            Langium.toString(Compile.FunctionDeclaration(functionNamed('DefaultAccept'))),
            `export const Result = ${
              Langium.toString(compileArgumentForType(
                expression('Source'),
                Type.ofDefinition(owner('Display')),
              ))
            }`,
          ].join('\n'),
      ))
    await withTaoFiles('tao-capability-signatures-', {
      'Generated.ts': `
        import TR from ${JSON.stringify(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))}
        const _Scope: any = { Value: TR.Value('typed'), DisplayPrefix: TR.Value('display') }
        ${code}
      `,
    }, async paths => {
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([paths['Generated.ts']], {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['bun'],
        lib: ['lib.es2023.d.ts'],
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowSyntheticDefaultImports: true,
        allowImportingTsExtensions: true,
        jsx: ts.JsxEmit.React,
      }))
      Expect(diagnostics.map(diagnostic => ({
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      }))).toEqual([])
    })
  })
})
