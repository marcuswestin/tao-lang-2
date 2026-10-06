import { Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  hasAssociatedWitnessPublication,
  withAssociatedWitnessBindings,
} from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { bridgeBindingName } from '../compiler-src/codegen/react-native/app/injection-plan'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))

Describe('compiler: explicit associated conversions', () => {
  Test('publishes a converter-only owner, binds the actual source and evaluates that source once', async () => {
    const parsed = await Parser.parseCode(
      `
      type Source is text
      type Target is text with {
        Source as Target fails Invalid { return Target Source }
      }
      func Next() -> Source { return Next() from ./Host.ts }
      func Convert() -> Target { return Next() as Target }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const file = parsed.entry.ast
    const target = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Target')
    Expect.Is(target, AST.isTypeDeclaration)
    Expect(hasAssociatedWitnessPublication(target)).toBe(true)
    const converter = Type.ownAssociatedConverters(target)[0]!
    const descriptor = Type.associatedConverterDescriptor(converter)!
    Expect(descriptor.owner === target).toBe(true)
    Expect(Type.displayName(descriptor.receiver)).toBe('Source')
    Expect(Type.displayName(descriptor.result)).toBe('Target')
    Expect(descriptor.signature.failures).toEqual({ cases: ['Invalid'], open: false })
    const expression = AST.streamAllContents(file).find(AST.isConversionExpression)
    Expect.Is(expression, AST.isConversionExpression)
    Expect(Type.associatedConversion(expression).descriptor?.declaration === converter).toBe(true)
    const code = withAssociatedWitnessBindings(new Map([[target, '_TargetWitness']]), () =>
      [
        Langium.toString(Compile.AssociatedMethodsDeclaration(target)),
        ...file.statements.filter(AST.isFunctionDeclaration).map(fn =>
          Langium.toString(Compile.FunctionDeclaration(fn))
        ),
      ].join('\n'))
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(code)
    const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
    Expect.Is(bridge, AST.isFromExpression)
    const { default: TR } = await runtimeModule
    let reads = 0
    const scope: Record<string, any> = { Source: TR.Value('outer shadow') }
    new Function('TR', '_Scope', bridgeBindingName(bridge), javascript)(TR, scope, () => `sample${++reads}`)
    Expect(TR.Call(scope['Convert']).getJSValue()).toBe('sample1')
    Expect(reads).toBe(1)
    Expect(TR.Call(scope['Convert']).getJSValue()).toBe('sample2')
    Expect(reads).toBe(2)
    Expect(scope['Source'].getJSValue()).toBe('outer shadow')
  })

  Test('passes a modeled runtime failure through the authored converter body without replacing it', async () => {
    const parsed = await Parser.parseCode(
      `
      type Source is text with {
        Source as Target fails Invalid { return Reject(Source) from ./Host.ts }
      }
      type Target is text
      func Reject(Value Source) -> Target { return Target "unused" }
      func Convert(Value Source) -> Target { return Value as Target }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const file = parsed.entry.ast
    const owner = file.statements.find(AST.isTypeDeclaration)
    Expect.Is(owner, AST.isTypeDeclaration)
    const fn = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === 'Convert')
    Expect.Is(fn, AST.isFunctionDeclaration)
    const bridge = AST.streamAllContents(file).find(AST.isFromExpression)
    Expect.Is(bridge, AST.isFromExpression)
    const code = withAssociatedWitnessBindings(new Map([[owner, '_SourceWitness']]), () =>
      [
        Langium.toString(Compile.AssociatedMethodsDeclaration(owner)),
        Langium.toString(Compile.FunctionDeclaration(fn)),
      ].join('\n'))
    const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(code)
    const { default: TR } = await runtimeModule
    const scope: Record<string, any> = {}
    let received: unknown
    new Function('TR', '_Scope', bridgeBindingName(bridge), javascript)(TR, scope, (value: unknown) => {
      received = value
      return TR.Fail(TR.Value('Invalid'), 'invalid source')
    })
    Expect(() => TR.Call(scope['Convert'], TR.Value('supplied'))).toThrow('invalid source')
    Expect(received).toBe('supplied')
    // This proves emission propagation; the native body remains open in effect analysis.
    Expect(Type.associatedConverterDescriptor(Type.ownAssociatedConverters(owner)[0]!)?.signature.failures)
      .toEqual({ cases: ['Invalid'], open: false })
  })
})
