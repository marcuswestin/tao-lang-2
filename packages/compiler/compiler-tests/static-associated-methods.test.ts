import { ASTUtils } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { withAssociatedWitnessBindings } from '../compiler-src/codegen/react-native/app/AssociatedMethodsCompiler'
import { bridgeBindingName } from '../compiler-src/codegen/react-native/app/injection-plan'
import { Compile } from '../compiler-src/codegen/react-native/Compile'

const runtimeModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts', Repo.getRoot()))
const timingModule = import(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-time.ts', Repo.getRoot()))

async function compile(source: string) {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
  const file = parsed.entry.ast
  for (const call of AST.streamAllContents(file).filter(AST.isMethodCallExpression)) {
    const resolved = ASTUtils.resolveAssociatedMethodInvocation(call)
    Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
  }
  const owners = file.statements.filter(AST.isTypeDeclaration).filter(owner =>
    ASTUtils.ownAssociatedMethods(owner).length
  )
  const bindings = new Map(owners.map((owner, index) => [owner, `_Witness${index}`]))
  const code = withAssociatedWitnessBindings(bindings, () =>
    [
      ...owners.map(owner => Langium.toString(Compile.AssociatedMethodsDeclaration(owner))),
      ...file.statements.filter(AST.isFunctionDeclaration).map(fn => Langium.toString(Compile.FunctionDeclaration(fn))),
    ].join('\n'))
  return { file, javascript: new Bun.Transpiler({ loader: 'ts' }).transformSync(code) }
}

Describe('compiler: static associated methods', () => {
  Test(
    'executes inherited static factories without a receiver and instance methods with the actual wrapper',
    async () => {
      const { javascript } = await compile(`
      type Title is text with {
        static func Default(Prefix text default "fallback") -> Title { return Title Prefix }
        func ToText() -> text { return Title }
      }
      type Child is Title
      type Count is number with { static func Zero() -> Count { return Count 0 } }
      type Box is { Value number static func Default() -> Box { return Box { Value 3 } } }
      func Read() -> text { return Child.Default().ToText() }
      func Supplied(Prefix text) -> text { return Title.Default(Prefix: Prefix).ToText() }
      func Zero() -> Count { return Count.Zero() }
      func Boxed() -> Box { return Box.Default() }
      func Yes() -> boolean { return yes }
      func No() -> boolean { return no }
    `)
      const { default: TR } = await runtimeModule
      const scope: Record<string, any> = { Title: TR.Value('lexical outer value') }
      new Function('TR', '_Scope', javascript)(TR, scope)
      Expect(TR.Call(scope['Read']).getJSValue()).toBe('fallback')
      Expect(TR.Call(scope['Supplied'], TR.Value('supplied')).getJSValue()).toBe('supplied')
      Expect(TR.Call(scope['Zero']).getJSValue()).toBe(0)
      Expect(TR.Call(scope['Boxed']).getJSValue()).toEqual({ Value: 3 })
      Expect(TR.Call(scope['Yes']).getJSValue()).toBe(true)
      Expect(TR.Call(scope['No']).getJSValue()).toBe(false)
      Expect(scope['Title'].getJSValue()).toBe('lexical outer value')
      Expect(javascript).toContain('_TaoAssociatedReceiver')
    },
  )

  Test('executes an authored static start and opaque instance duration through the committed timer ABI', async () => {
    const { file, javascript } = await compile(`
      type Duration is number
      type Timer is { Marker boolean
        func Duration() -> Duration { return NativeDuration(Timer) }
      }
      type Time is number with { static func StartTimer() -> Timer { return NativeStartTimer() } }
      func NativeStartTimer() -> Timer { return NativeStartTimer() from ./Clock.ts }
      func NativeDuration(Value Timer) -> Duration { return NativeDuration(Value) from ./Clock.ts }
      func Start() -> Timer { return Time.StartTimer() }
      func Read(Value Timer) -> Duration { return Value.Duration() }
    `)
    const [{ default: TR }, { startTimer }] = await Promise.all([runtimeModule, timingModule])
    let now = 1_000
    const scope: Record<string, any> = {}
    const bridges = [...AST.streamAllContents(file)].filter(AST.isFromExpression)
    const native = bridges.map(bridge => {
      Expect.Is(bridge.expression, AST.isFunctionCallExpression)
      return bridge.expression.function.$refText === 'NativeStartTimer'
        ? () => startTimer({ fromJSValue: TR.Value }, () => now)
        : (timer: { Duration(): { getJSValue(): unknown } }) => timer.Duration().getJSValue()
    })
    new Function('TR', '_Scope', ...bridges.map(bridgeBindingName), javascript)(TR, scope, ...native)
    const timer = TR.Call(scope['Start'])
    Expect(Object.keys(timer.getJSValue())).toEqual([])
    now = 3_500
    const first = TR.Call(scope['Read'], timer)
    now = 8_000
    const second = TR.Call(scope['Read'], timer)
    Expect(first.getJSValue()).toBe(2.5)
    Expect(second.getJSValue()).toBe(7)
    Expect(first.getJSValue()).toBe(2.5)
  })
})
