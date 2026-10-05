import { Workspace } from '@compiler/workspace'
import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import * as ts from 'typescript'
import { BridgeMetadata } from '../compiler-src/bridge-metadata'

async function libraryFiles() {
  const root = FS.resolvePath('packages/apps/stdlib/@tao', Repo.getRoot())
  return {
    'core/Quantity.tao': await FS.readText(FS.resolvePath('core/Quantity.tao', root)),
    'core/Quantity.ts': await FS.readText(FS.resolvePath('core/Quantity.ts', root)),
    'time/Durations.tao': await FS.readText(FS.resolvePath('time/Durations.tao', root)),
    'time/Durations.ts': await FS.readText(FS.resolvePath('time/Durations.ts', root)),
    'View.tsx': 'export function Home() { return null }',
  }
}

const app = `app Demo { id "com.tao.quantity.stdlib" version "1.0.0" name "Quantity" view Home }
view Home() from ./View.tsx`

Describe('compiler: quantity and duration standard library', () => {
  Test('executes authored operations and fixed native timer samples through checked factories', async () => {
    await withTaoFiles('tao-quantity-duration-stdlib-', {
      ...await libraryFiles(),
      'DistanceNative.ts': `import { types } from './Main.tao'
        export const Seed = () => types.PreciseDistance.Factory.fromUnit(2, 'metres')`,
      'Main.tao': `
        use all from ./core/Quantity
        use Time, Timer, Wait from ./time/Durations
        public type Distance is Scalar with { units { metres 1 (default), centimetres 0.01 } }
        public type PreciseDistance is Distance
        public func NewDistance() -> PreciseDistance { return Seed() from ./DistanceNative.ts }
        public let DistanceSum = 2 metres + 50 centimetres
        public let DistanceDifference = 2 metres - 50 centimetres
        public let DistanceNegated = -DistanceSum
        public let DistanceLeftScaled = 2 * DistanceSum
        public let DistanceRightScaled = DistanceSum * 2
        public let DistanceDivided = DistanceSum / 2
        public let DistanceEqual = 2 metres == 200 centimetres
        public let DistanceNotEqual = 2 metres != 50 centimetres
        public let DistanceLess = 50 centimetres < 2 metres
        public let DistanceLessEqual = 2 metres <= 200 centimetres
        public let DistanceGreater = 2 metres > 50 centimetres
        public let DistanceGreaterEqual = 2 metres >= 200 centimetres
        public let DistanceEqualFalse = 2 metres == 50 centimetres
        public let DistanceNotEqualFalse = 2 metres != 200 centimetres
        public let DistanceLessFalse = 2 metres < 200 centimetres
        public let DistanceLessEqualFalse = 2 metres <= 50 centimetres
        public let DistanceGreaterFalse = 2 metres > 200 centimetres
        public let DistanceGreaterEqualFalse = 50 centimetres >= 2 metres
        public let ChildSum = NewDistance() + NewDistance()
        public func AddDistance(Left Distance, Right Distance) -> Distance { return Left + Right }
        public func AddChild(Left PreciseDistance, Right PreciseDistance) -> PreciseDistance { return Left + Right }
        public let Span = 2 minutes + 30 seconds
        public let Reverse = 30 seconds + 2 minutes
        public let Difference = 2 minutes - 30 seconds
        public let Scaled = 2 * Span
        public let RightScaled = Span * 2
        public let Divided = Span / 2
        public let Factor = Span / 30 seconds
        public let RatioScaled = Span * 50 percent
        public let RatioDivided = Span / 50 percent
        public let Offset = -2 seconds
        public let Negated = -Span
        public let Short = 250 milliseconds
        public let Long = 1 hours
        public let RatioSum = 50 percent + 100 permille
        public let RatioDifference = 50 percent - 100 permille
        public let RatioProduct = 50 percent * 2 unity
        public let RatioQuotient = 50 percent / 250 permille
        public let RatioLeftScaled = 2 * 50 percent
        public let RatioRightScaled = 50 percent * 2
        public let RatioNumberDivided = 50 percent / 2
        public let RatioOffset = -50 percent
        public let RatioNegated = -RatioSum
        public let SpanText = Span.seconds().ToText()
        public let FactorText = Factor.ToText()
        public let OffsetText = Offset.ToText()
        public let DurationEqual = 2 minutes == 120 seconds
        public let DurationNotEqual = 2 minutes != 30 seconds
        public let DurationLess = 30 seconds < 2 minutes
        public let DurationLessEqual = 2 minutes <= 120 seconds
        public let DurationGreater = 2 minutes > 30 seconds
        public let DurationGreaterEqual = 2 minutes >= 120 seconds
        public let RatioEqual = 50 percent == 500 permille
        public let RatioNotEqual = 50 percent != 100 permille
        public let RatioLess = 100 permille < 50 percent
        public let RatioLessEqual = 50 percent <= 500 permille
        public let RatioGreater = 50 percent > 100 permille
        public let RatioGreaterEqual = 50 percent >= 500 permille
        public let DurationLessFalse = 2 minutes < 120 seconds
        public let DurationGreaterFalse = 2 minutes > 120 seconds
        public let RatioLessFalse = 50 percent < 500 permille
        public let RatioGreaterFalse = 50 percent > 500 permille
        public func Compare(Left Duration, Right Duration) -> boolean { return Left < Right }
        public func Divide(Left Duration, Right Duration) -> Ratio { return Left / Right }
        public func Start() -> Timer { return Time.StartTimer() }
        public func WallNow() -> time { return Time.Now() }
        public func Sample(Value Timer) -> Duration { return Value.Duration() }
        public action Pause(Duration) { do Wait(Duration) }
        ${app}
      `,
    }, async (paths, root) => {
      const result = await Workspace.compile(paths['Main.tao'])
      const quantityFile = result.validation.files.find(file => file.path === paths['core/Quantity.tao'])
      Assert.defined(quantityFile, 'the real quantity source is part of the compiled graph')
      const surface = BridgeMetadata.quantitySurfaceFor(quantityFile.ast)
      Assert.defined(surface, 'the real quantity declarations publish checked factories')
      Expect(surface.declarations.map(row => row.declaration.name)).toEqual(['Duration', 'Ratio'])
      const leaf = result.files.find(file =>
        file.sourcePath === quantityFile.path && file.relativePath.endsWith('.quantities.ts')
      )
      Assert.defined(leaf, 'the real quantity source emits its canonical factory leaf')
      const duration = surface.declarations.find(row => row.declaration.name === 'Duration')!
      const ratio = surface.declarations.find(row => row.declaration.name === 'Ratio')!
      const mainFile = result.validation.files.find(file => file.path === paths['Main.tao'])!
      const familySurface = BridgeMetadata.quantitySurfaceFor(mainFile.ast)!
      const familyLeaf = result.files.find(file =>
        file.sourcePath === mainFile.path && file.relativePath.endsWith('.quantities.ts')
      )!
      const distance = familySurface.declarations.find(row => row.declaration.name === 'Distance')!
      const child = familySurface.declarations.find(row => row.declaration.name === 'PreciseDistance')!
      for (const generated of result.files) {
        await FS.writeText(FS.resolvePath(`types-out/${generated.relativePath}`, root), generated.code)
        if (generated.relativePath.endsWith('.d.ts')) {
          continue
        }
        await FS.writeText(
          FS.resolvePath(`out/${generated.relativePath.replace(/\.[cm]?tsx?$/, '.js')}`, root),
          ts.transpileModule(generated.code, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React },
          }).outputText,
        )
      }
      const nativeSources = result.files.filter(file =>
        file.sourcePath === paths['core/Quantity.ts'] || file.sourcePath === paths['time/Durations.ts']
      )
      Expect([...new Set(nativeSources.map(file => file.sourcePath))].sort()).toEqual([
        paths['core/Quantity.ts'],
        paths['time/Durations.ts'],
      ].sort())
      const nativeTypeDiagnostics = ts.getPreEmitDiagnostics(ts.createProgram(
        nativeSources.map(file => FS.resolvePath(`types-out/${file.relativePath}`, root)),
        {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['bun'],
          lib: ['lib.es2023.d.ts'],
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          allowSyntheticDefaultImports: true,
          jsx: ts.JsxEmit.React,
          allowImportingTsExtensions: true,
          paths: {
            '@runtime/*': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/*', Repo.getRoot())],
            react: [FS.resolvePath('packages/apps/runtime/node_modules/@types/react/index.d.ts', Repo.getRoot())],
          },
        },
      )).map(diagnostic => ({
        path: diagnostic.file?.fileName,
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      }))
      Expect(nativeTypeDiagnostics).toEqual([])
      await FS.writeText(
        FS.resolvePath('Clock.ts', root),
        `
        import { createContinuousClockNowMilliseconds } from ${
          JSON.stringify(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-continuous-clock.ts', Repo.getRoot()))
        }
        import { createNativeModules } from ${
          JSON.stringify(FS.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-native-modules.ts', Repo.getRoot()))
        }
        let reading = 1000
        export function setClock(value: number) { reading = value }
        export const nowMilliseconds = createContinuousClockNowMilliseconds(createNativeModules({
          'react-native': () => ({ Platform: { OS: 'ios' } }),
          'expo-modules-core': () => ({ requireNativeModule: (name: string) => {
            if (name !== 'TaoContinuousClock') throw new Error('wrong native clock module')
            return { nowMilliseconds: () => reading }
          } }),
        }))
      `,
      )
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        JSON.stringify({
          compilerOptions: {
            paths: {
              '@runtime/TR-continuous-clock': [FS.resolvePath('Clock.ts', root)],
              '@runtime/*': [FS.resolvePath('packages/apps/runtime/TaoRuntime-src/*', Repo.getRoot())],
              react: [FS.resolvePath('packages/apps/runtime/node_modules/react/index.js', Repo.getRoot())],
            },
          },
        }),
      )
      const program = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        program,
        `
        import * as App from './out/App.js'
        import { ScalarAdd } from './out/${
          nativeSources.find(file => file.sourcePath === paths['core/Quantity.ts'])!.relativePath.replace(
            /\.ts$/,
            '.js',
          )
        }'
        import TR from '@runtime/TR'
        import { captureActionContinuation, cancelActionContinuation, runActionScope } from '@runtime/TR-action-transactions'
        import { setClock } from './Clock.ts'
        import { ${duration.factoryExport} as Duration, ${ratio.factoryExport} as Ratio } from './out/${
          leaf.relativePath.replace(/\.ts$/, '.js')
        }'
        import { ${distance.factoryExport} as Distance, ${child.factoryExport} as Child } from './out/${
          familyLeaf.relativePath.replace(/\.ts$/, '.js')
        }'
        import * as Platform from ${
          JSON.stringify(FS.resolvePath('packages/shared/shared-src/Platform.ts', Repo.getRoot()))
        }
        const read = (name: string, factory = Duration) => factory.read(App[name].evaluate())
        const baseThenChild = TR.Call(App.AddDistance, App.DistanceSum, TR.Call(App.NewDistance)).evaluate()
        const childThenBase = TR.Call(App.AddDistance, TR.Call(App.NewDistance), App.DistanceSum).evaluate()
        let leftReads = 0
        let rightReads = 0
        const leftChanging = { evaluate: () => (++leftReads === 1 ? Distance.fromUnit(2, 'metres') : Ratio.fromUnit(1, 'unity')).evaluate() }
        const rightChanging = { evaluate: () => (++rightReads === 1 ? Distance.fromUnit(50, 'centimetres') : Ratio.fromUnit(1, 'unity')).evaluate() }
        const onceRead = Distance.read(ScalarAdd(leftChanging, rightChanging, Distance))
        const errorCase = (body: () => unknown) => { try { body(); return 'missing failure' } catch (error) { return error.caseName } }
        let wallClock
        TR.Clock.beginTest(1700000000000)
        try {
          const firstNow = TR.Call(App.WallNow)
          const firstNowReading = firstNow.getJSValue()
          TR.Clock.advance(1250)
          wallClock = [firstNowReading, firstNow.getJSValue(), TR.Call(App.WallNow).getJSValue()]
        } finally { TR.Clock.endTest() }
        const timer = TR.Call(App.Start)
        setClock(2100)
        const first = TR.Call(App.Sample, timer)
        const firstReading = Duration.read(first)
        setClock(5000)
        const second = TR.Call(App.Sample, timer).evaluate()
        let serialized = false
        try { JSON.stringify(timer.getJSValue()) } catch (error) { serialized = error.message.includes('cannot be serialized') }
        let forged = false
        try { TR.Call(App.Sample, TR.Value({})).evaluate() } catch (error) { forged = error.message.includes('requires a Timer created by StartTimer') }
        await TR.Do(App.Pause, Duration.fromUnit(-1, 'seconds'))
        await TR.Do(App.Pause, Duration.fromUnit(0, 'seconds'))
        let continuation = {}
        let cancellation
        const stop = TR.Errors.onFailure(() => undefined)
        try {
          await TR.Action(async () => {
            try {
              await runActionScope(async () => {
                continuation = captureActionContinuation()
                const pending = TR.Do(App.Pause, Duration.fromUnit(60, 'seconds'))
                await Promise.resolve()
                if (!cancelActionContinuation(continuation)) throw new Error('no active continuation')
                await pending
              })
            } catch (error) { cancellation = error.caseName; throw error }
          }).jsValue.invoke()
        } finally { stop() }
        Platform.runtimeConsole.info(JSON.stringify({
          duration: ['Span', 'Reverse', 'Difference', 'Scaled', 'RightScaled', 'Divided', 'RatioScaled', 'RatioDivided', 'Offset', 'Negated', 'Short', 'Long'].map(name => read(name)),
          ratio: ['Factor', 'RatioSum', 'RatioDifference', 'RatioProduct', 'RatioQuotient', 'RatioLeftScaled', 'RatioRightScaled', 'RatioNumberDivided', 'RatioOffset', 'RatioNegated'].map(name => read(name, Ratio)),
          comparisons: ['DurationEqual', 'DurationNotEqual', 'DurationLess', 'DurationLessEqual', 'DurationGreater', 'DurationGreaterEqual', 'RatioEqual', 'RatioNotEqual', 'RatioLess', 'RatioLessEqual', 'RatioGreater', 'RatioGreaterEqual'].map(name => App[name].getJSValue()),
          canonical: App.Span.getJSValue(),
          family: ['DistanceSum', 'DistanceDifference', 'DistanceNegated', 'DistanceLeftScaled', 'DistanceRightScaled', 'DistanceDivided'].map(name => read(name, Distance)),
          familyComparisons: ['DistanceEqual', 'DistanceNotEqual', 'DistanceLess', 'DistanceLessEqual', 'DistanceGreater', 'DistanceGreaterEqual'].map(name => App[name].getJSValue()),
          falseComparisons: ['DistanceEqualFalse', 'DistanceNotEqualFalse', 'DistanceLessFalse', 'DistanceLessEqualFalse', 'DistanceGreaterFalse', 'DistanceGreaterEqualFalse', 'DurationLessFalse', 'DurationGreaterFalse', 'RatioLessFalse', 'RatioGreaterFalse'].map(name => App[name].getJSValue()),
          child: Child.read(App.ChildSum.evaluate()),
          childOwns: Child.ownsPayload(App.ChildSum.evaluate().jsValue),
          mixedFamily: [Distance.read(baseThenChild), Distance.read(childThenBase)],
          mixedFamilyOwns: [Distance.ownsPayload(baseThenChild.jsValue), Distance.ownsPayload(childThenBase.jsValue)],
          mixedChildOwns: [Child.ownsPayload(baseThenChild.jsValue), Child.ownsPayload(childThenBase.jsValue)],
          onceRead, reads: [leftReads, rightReads],
          text: ['SpanText', 'FactorText', 'OffsetText'].map(name => App[name].getJSValue()),
          familyRejects: errorCase(() => TR.Call(App.AddDistance, App.DistanceSum, App.Span).evaluate()),
          wrongDomain: errorCase(() => TR.Call(App.Compare, App.Span, Ratio.fromUnit(50, 'percent')).evaluate()),
          zeroDivision: errorCase(() => TR.Call(App.Divide, App.Span, Duration.fromUnit(0, 'seconds')).evaluate()),
          first: firstReading, second: Duration.read(second), firstStillFixed: first.getJSValue(),
          wallClock,
          serialized, forged, cancellation,
        }))
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(JSON.parse(execution.stdout)).toEqual({
        duration: [
          { canonical: 150, unit: 'minutes' },
          { canonical: 150, unit: 'seconds' },
          { canonical: 90, unit: 'minutes' },
          { canonical: 300, unit: 'minutes' },
          { canonical: 300, unit: 'minutes' },
          { canonical: 75, unit: 'minutes' },
          { canonical: 75, unit: 'minutes' },
          { canonical: 300, unit: 'minutes' },
          { canonical: -2, unit: 'seconds' },
          { canonical: -150, unit: 'minutes' },
          { canonical: 0.25, unit: 'milliseconds' },
          { canonical: 3600, unit: 'hours' },
        ],
        ratio: [
          { canonical: 5, unit: 'unity' },
          { canonical: 0.6, unit: 'percent' },
          { canonical: 0.4, unit: 'percent' },
          { canonical: 1, unit: 'percent' },
          { canonical: 2, unit: 'percent' },
          { canonical: 1, unit: 'percent' },
          { canonical: 1, unit: 'percent' },
          { canonical: 0.25, unit: 'percent' },
          { canonical: -0.5, unit: 'percent' },
          { canonical: -0.6, unit: 'percent' },
        ],
        comparisons: Array(12).fill(true),
        canonical: 150,
        family: [
          { canonical: 2.5, unit: 'metres' },
          { canonical: 1.5, unit: 'metres' },
          { canonical: -2.5, unit: 'metres' },
          { canonical: 5, unit: 'metres' },
          { canonical: 5, unit: 'metres' },
          { canonical: 1.25, unit: 'metres' },
        ],
        familyComparisons: Array(6).fill(true),
        falseComparisons: Array(10).fill(false),
        child: { canonical: 4, unit: 'metres' },
        childOwns: true,
        mixedFamily: [{ canonical: 4.5, unit: 'metres' }, { canonical: 4.5, unit: 'metres' }],
        mixedFamilyOwns: [true, true],
        mixedChildOwns: [false, false],
        onceRead: { canonical: 2.5, unit: 'metres' },
        reads: [1, 1],
        text: ['150 seconds', '5 unity', '-2 seconds'],
        familyRejects: 'QuantityDomainMismatch',
        wrongDomain: 'QuantityDomainMismatch',
        zeroDivision: 'QuantityNonFinite',
        first: { canonical: 1.1, unit: 'seconds' },
        second: { canonical: 4, unit: 'seconds' },
        firstStillFixed: 1.1,
        wallClock: [1700000000000, 1700000000000, 1700000001250],
        serialized: true,
        forged: true,
        cancellation: 'cancelled',
      })
    }, { location: 'worktree' })
  })

  Test('rejects mixed semantic comparisons and abstract Scalar construction', async () => {
    await withTaoFiles('tao-quantity-duration-rejections-', {
      ...await libraryFiles(),
      'Main.tao': `use all from ./core/Quantity
        let Mixed = 2 seconds < 50 percent
        let AbstractValue = Scalar 1
        ${app}`,
    }, async paths => {
      const validation = await Workspace.validate(paths['Main.tao'])
      const messages = validation.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
        diagnostic.message
      )
      Expect(messages.some(message => /operator|comparison/i.test(message))).toBe(true)
      Expect(messages.some(message => /abstract.*Scalar|Scalar.*abstract/i.test(message))).toBe(true)
    }, { location: 'worktree' })
  })

  Test('rejects contextual operations after erasing concrete quantities to Scalar', async () => {
    await withTaoFiles('tao-erased-scalar-rejection-', {
      ...await libraryFiles(),
      'Main.tao': `use Scalar from ./core/Quantity
        public func Erased(Left Scalar, Right Scalar) -> Scalar { return Left + Right }
        public func ErasedComparison(Left Scalar, Right Scalar) -> boolean { return Left == Right }
        ${app}`,
    }, async paths => {
      const validation = await Workspace.validate(paths['Main.tao'])
      const messages = validation.diagnostics.filter(diagnostic =>
        diagnostic.severity === 'error' && diagnostic.filePath === paths['Main.tao']
      ).map(diagnostic => diagnostic.message)
      Expect(messages.some(message => /operator.*\+.*(?:contract|concrete|Self)/i.test(message))).toBe(true)
      Expect(messages.some(message => /operator.*==.*(?:contract|concrete|Self)/i.test(message))).toBe(true)
    }, { location: 'worktree' })
  })
})
