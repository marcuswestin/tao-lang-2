import TR from '@runtime/TR'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import * as ts from 'typescript'
import { TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import { QuantityArithmetic, quantityOperand, scalarOperand } from '../TaoRuntime-src/TR-quantity-arithmetic'
import { makeQuantityType, QuantityFailureCases } from '../TaoRuntime-src/TR-quantity-values'

const Duration = makeQuantityType({
  domain: 'Duration',
  defaultUnit: 'seconds',
  units: { seconds: 1, milliseconds: 0.001, minutes: 60, hours: 3600 },
}, TR.Value)
const Ratio = makeQuantityType({
  domain: 'Ratio',
  defaultUnit: 'unity',
  units: { unity: 1, percent: 0.01, permille: 0.001 },
}, TR.Value)
const Probability = makeQuantityType({
  domain: 'Probability',
  defaultUnit: 'unity',
  units: { unity: 1, percent: 0.01 },
  invariant: canonical => canonical >= 0 && canonical <= 1,
}, TR.Value)
const Reading = makeQuantityType({ domain: 'Reading', defaultUnit: 'Base', units: { Base: 1, Double: 2 } }, TR.Value)
const ReadingSibling = makeQuantityType(
  { domain: 'Reading', defaultUnit: 'Base', units: { Base: 1, Double: 2 } },
  TR.Value,
)
const ForeignReading = makeQuantityType(
  { domain: 'ForeignReading', defaultUnit: 'Base', units: { Base: 1, Double: 2 } },
  TR.Value,
)
const Celsius = makeQuantityType({
  domain: 'Celsius',
  defaultUnit: 'Celsius',
  units: { Celsius: 1, Fahrenheit: 5 / 9 },
}, TR.Value)
const Fahrenheit = makeQuantityType({
  domain: 'Fahrenheit',
  defaultUnit: 'Fahrenheit',
  units: { Celsius: 1, Fahrenheit: 5 / 9 },
}, TR.Value)
const ReadingChild = Reading.derive({ domain: 'ReadingChild', defaultUnit: 'Double' })

function expectFailure(body: () => unknown, expected: string): void {
  let raised: unknown
  try {
    body()
  } catch (error) {
    raised = error
  }
  Expect(raised).toBeInstanceOf(TaoActionFailure)
  Expect((raised as TaoActionFailure).caseName).toBe(expected)
}

Describe('authored quantity arithmetic', () => {
  Test('uses signed ordered canonical arithmetic and preserves the left quantity view', () => {
    const left = Duration.fromUnit(-2, 'minutes')
    const right = Duration.fromUnit(30, 'seconds')
    Expect(
      Duration.read(
        QuantityArithmetic.add(Duration, quantityOperand(Duration, left), quantityOperand(Duration, right)),
      ),
    )
      .toEqual({ canonical: -90, unit: 'minutes' })
    Expect(
      Duration.read(
        QuantityArithmetic.subtract(Duration, quantityOperand(Duration, right), quantityOperand(Duration, left)),
      ),
    )
      .toEqual({ canonical: 150, unit: 'seconds' })
    Expect(Duration.read(QuantityArithmetic.divide(Duration, scalarOperand(-4), quantityOperand(Duration, left))))
      .toEqual({ canonical: 1 / 30, unit: 'minutes' })
    Expect(Duration.read(QuantityArithmetic.divide(Duration, quantityOperand(Duration, left), scalarOperand(-4))))
      .toEqual({ canonical: 30, unit: 'minutes' })
    Expect(Duration.read(QuantityArithmetic.negate(Duration, quantityOperand(Duration, right))))
      .toEqual({ canonical: -30, unit: 'seconds' })
  })

  Test('keeps one quantity view regardless of numeric operand order and honors explicit result units', () => {
    const minutes = Duration.fromUnit(2, 'minutes')
    Expect(Duration.read(QuantityArithmetic.multiply(Duration, scalarOperand(3), quantityOperand(Duration, minutes))))
      .toEqual({ canonical: 360, unit: 'minutes' })
    Expect(Duration.read(QuantityArithmetic.multiply(Duration, quantityOperand(Duration, minutes), scalarOperand(3))))
      .toEqual({ canonical: 360, unit: 'minutes' })
    Expect(
      Duration.read(
        QuantityArithmetic.multiply(Duration, quantityOperand(Duration, minutes), scalarOperand(3), 'seconds'),
      ),
    )
      .toEqual({ canonical: 360, unit: 'seconds' })
    Expect(Duration.read(QuantityArithmetic.add(Duration, scalarOperand(5), scalarOperand(7))))
      .toEqual({ canonical: 12, unit: 'seconds' })
    expectFailure(
      () => QuantityArithmetic.add(Duration, scalarOperand(1), scalarOperand(2), 'percent' as never),
      QuantityFailureCases.UnknownUnit,
    )
  })

  Test('retains unrestricted signed ratios and selects result-domain defaults or explicit units', () => {
    const negativeRatio = Ratio.fromUnit(-250, 'percent')
    const positiveRatio = Ratio.fromUnit(50, 'percent')
    const duration = Duration.fromUnit(2, 'minutes')
    Expect(
      Ratio.read(
        QuantityArithmetic.add(Ratio, quantityOperand(Ratio, negativeRatio), quantityOperand(Ratio, positiveRatio)),
      ),
    )
      .toEqual({ canonical: -2, unit: 'percent' })
    Expect(
      Duration.read(
        QuantityArithmetic.multiply(
          Duration,
          quantityOperand(Duration, duration),
          quantityOperand(Ratio, negativeRatio),
        ),
      ),
    )
      .toEqual({ canonical: -300, unit: 'minutes' })
    Expect(
      Duration.read(
        QuantityArithmetic.multiply(
          Duration,
          quantityOperand(Ratio, negativeRatio),
          quantityOperand(Duration, duration),
        ),
      ),
    )
      .toEqual({ canonical: -300, unit: 'minutes' })
    Expect(
      Ratio.read(
        QuantityArithmetic.divide(
          Ratio,
          quantityOperand(Duration, duration),
          quantityOperand(Duration, Duration.fromUnit(30, 'seconds')),
        ),
      ),
    ).toEqual({ canonical: 4, unit: 'unity' })
    Expect(
      Reading.read(
        QuantityArithmetic.add(Reading, quantityOperand(Duration, Duration.fromUnit(2, 'minutes')), scalarOperand(1)),
      ),
    )
      .toEqual({ canonical: 121, unit: 'Base' })
    Expect(Reading.read(QuantityArithmetic.add(
      Reading,
      quantityOperand(Duration, Duration.fromUnit(2, 'minutes')),
      scalarOperand(1),
      'Double',
    ))).toEqual({ canonical: 121, unit: 'Double' })
  })

  Test('authenticates views by actual owner ancestry and constructs the declared result role', () => {
    const childView = ReadingChild.fromUnit(3, 'Double')
    const parentResult = QuantityArithmetic.add(Reading, quantityOperand(ReadingChild, childView), scalarOperand(2))
    Expect(Reading.read(parentResult)).toEqual({ canonical: 8, unit: 'Double' })
    expectFailure(() => ReadingChild.read(parentResult), QuantityFailureCases.DomainMismatch)

    const sameName = ReadingSibling.fromUnit(4, 'Double')
    expectFailure(
      () => QuantityArithmetic.add(Reading, quantityOperand(Reading, sameName), scalarOperand(1)),
      QuantityFailureCases.DomainMismatch,
    )
    const foreign = ForeignReading.fromUnit(4, 'Double')
    expectFailure(
      () => QuantityArithmetic.add(Reading, quantityOperand(Reading, foreign), scalarOperand(1)),
      QuantityFailureCases.DomainMismatch,
    )
    expectFailure(
      () => QuantityArithmetic.compare(Celsius, Celsius.fromUnit(20, 'Celsius'), Fahrenheit.fromUnit(20, 'Fahrenheit')),
      QuantityFailureCases.DomainMismatch,
    )
  })

  Test('compares exact canonical magnitudes only after both values enter one supplied domain', () => {
    const oneMinute = Duration.fromUnit(1, 'minutes')
    const sixtySeconds = Duration.fromUnit(60, 'seconds')
    const twoMinutes = Duration.fromUnit(2, 'minutes')
    Expect(QuantityArithmetic.compare(Duration, oneMinute, sixtySeconds)).toBe(0)
    Expect(QuantityArithmetic.compare(Duration, oneMinute, twoMinutes)).toBe(-1)
    Expect(QuantityArithmetic.compare(Duration, twoMinutes, oneMinute)).toBe(1)
  })

  Test('reports modeled nonfinite, invariant, and bad-unit failures', () => {
    expectFailure(
      () =>
        QuantityArithmetic.add(
          Duration,
          quantityOperand(Duration, Duration.fromJSValue(Number.MAX_VALUE)),
          scalarOperand(Number.MAX_VALUE),
        ),
      QuantityFailureCases.NonFinite,
    )
    expectFailure(
      () => QuantityArithmetic.divide(Duration, quantityOperand(Duration, Duration.fromJSValue(1)), scalarOperand(0)),
      QuantityFailureCases.NonFinite,
    )
    expectFailure(
      () =>
        QuantityArithmetic.divide(
          Duration,
          quantityOperand(Duration, Duration.fromJSValue(1)),
          scalarOperand(Infinity),
        ),
      QuantityFailureCases.NonFinite,
    )
    for (const input of [NaN, Infinity, -Infinity]) {
      expectFailure(
        () => QuantityArithmetic.add(Duration, scalarOperand(input), scalarOperand(1)),
        QuantityFailureCases.NonFinite,
      )
    }
    expectFailure(
      () => QuantityArithmetic.add(Duration, scalarOperand('not a number' as never), scalarOperand(1)),
      QuantityFailureCases.BadShape,
    )
    expectFailure(
      () => QuantityArithmetic.add(Duration, quantityOperand(Duration, TR.Value(1)), scalarOperand(1)),
      QuantityFailureCases.BadShape,
    )
    expectFailure(
      () =>
        QuantityArithmetic.add(
          Probability,
          quantityOperand(Probability, Probability.fromJSValue(0.75)),
          scalarOperand(0.5),
        ),
      QuantityFailureCases.Invariant,
    )
  })

  Test('evaluates operands once in order and preserves their original payloads and views', () => {
    const left = Duration.fromUnit(2, 'minutes')
    const right = Duration.fromUnit(30, 'seconds')
    const leftPayload = left.jsValue
    const rightPayload = right.jsValue
    const events: string[] = []
    const leftAlias = TR.Alias(() => {
      events.push('left')
      return left
    })
    const rightAlias = TR.Alias(() => {
      events.push('right')
      return right
    })
    const result = QuantityArithmetic.subtract(
      Duration,
      quantityOperand(Duration, leftAlias),
      quantityOperand(Duration, rightAlias),
    )
    Expect(Duration.read(result)).toEqual({ canonical: 90, unit: 'minutes' })
    Expect(events).toEqual(['left', 'right'])
    Expect(left.jsValue).toBe(leftPayload)
    Expect(right.jsValue).toBe(rightPayload)
    Expect(Duration.read(left)).toEqual({ canonical: 120, unit: 'minutes' })
    Expect(Duration.read(right)).toEqual({ canonical: 30, unit: 'seconds' })
  })

  Test('checks a computed result invariant once and retains the explicitly requested view', () => {
    let checks = 0
    const Checked = makeQuantityType({
      domain: 'Checked',
      defaultUnit: 'Base',
      units: { Base: 1, Double: 2 },
      invariant: canonical => {
        checks += 1
        return canonical >= 0
      },
    }, TR.Value)
    const result = QuantityArithmetic.add(Checked, scalarOperand(2), scalarOperand(3), 'Double')
    Expect(Checked.read(result)).toEqual({ canonical: 5, unit: 'Double' })
    Expect(checks).toBe(1)
  })

  Test('keeps factory result typing through a narrowed emitted-factory facade', () => {
    const sample = Duration.fromJSValue(2)
    const narrowed = {
      definition: Duration.definition,
      fromJSValue: Duration.fromJSValue,
      read(value: typeof sample) {
        return Duration.read(value)
      },
      inUnit(value: typeof sample, unit: 'seconds' | 'milliseconds' | 'minutes' | 'hours') {
        return Duration.inUnit(value, unit)
      },
      acceptsPayload: Duration.acceptsPayload,
    }
    const result: ReturnType<typeof Duration.fromJSValue> = QuantityArithmetic.add(
      narrowed,
      quantityOperand(Duration, sample),
      scalarOperand(1),
    )
    Expect(Duration.read(result)).toEqual({ canonical: 3, unit: 'seconds' })
    if (false) {
      // @ts-expect-error An authored Reading result cannot be assigned the Duration role.
      const wrongRole: ReturnType<typeof Reading.fromJSValue> = QuantityArithmetic.add(
        Duration,
        scalarOperand(1),
        scalarOperand(2),
      )
      void wrongRole
    }
  })

  Test('type-checks narrowed factory input and preserves its supplied result role', () => {
    const scratch = FS.resolvePath('packages/apps/runtime/.scratch', Repo.getRoot())
    const fixture = FS.resolvePath('quantity-arithmetic-types.ts', scratch)
    const source = `
import { QuantityArithmetic, quantityOperand, scalarOperand } from '../TaoRuntime-src/TR-quantity-arithmetic'
import { makeQuantityType } from '../TaoRuntime-src/TR-quantity-values'
import type { TaoRuntimeValue } from '../TaoRuntime-src/TR-reactive-values'
declare const wrap: <T>(payload: T) => TaoRuntimeValue<T>
const units = { Base: 1, Double: 2 } as const
type DurationProof = { readonly duration: true }
type ReadingProof = { readonly reading: true }
const Duration = makeQuantityType<'Duration', typeof units, DurationProof>({ domain: 'Duration', defaultUnit: 'Base', units }, wrap)
const Reading = makeQuantityType<'Reading', typeof units, ReadingProof>({ domain: 'Reading', defaultUnit: 'Base', units }, wrap)
const sample = Duration.fromJSValue(2)
const EmittedDuration = {
  definition: Duration.definition,
  fromJSValue: Duration.fromJSValue,
  read(value: typeof sample) { return Duration.read(value) },
  inUnit(value: typeof sample, unit: keyof typeof units) { return Duration.inUnit(value, unit) },
  acceptsPayload: Duration.acceptsPayload,
}
const result: ReturnType<typeof Duration.fromJSValue> = QuantityArithmetic.add(EmittedDuration, quantityOperand(Duration, sample), scalarOperand(1))
const wrongRole: ReturnType<typeof Reading.fromJSValue> = QuantityArithmetic.add(Duration, scalarOperand(1), scalarOperand(2))
QuantityArithmetic.add({ definition: Duration.definition, fromJSValue: Duration.fromJSValue }, scalarOperand(1), scalarOperand(2))
`
    const configPath = FS.resolvePath('packages/apps/runtime/tsconfig.json', Repo.getRoot())
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    Expect(config.error).toBeUndefined()
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, FS.dirname(configPath))
    Expect(parsed.errors).toEqual([])
    const options: ts.CompilerOptions = { ...parsed.options, noUnusedLocals: false, noEmit: true }
    const host = ts.createCompilerHost(options)
    const originalGetSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
      path === fixture
        ? ts.createSourceFile(path, source, languageVersion, true)
        : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
    const program = ts.createProgram([fixture], options, host)
    const allDiagnostics = ts.getPreEmitDiagnostics(program)
    const implementationPath = FS.resolvePath(
      'packages/apps/runtime/TaoRuntime-src/TR-quantity-arithmetic.ts',
      Repo.getRoot(),
    )
    Expect(allDiagnostics.filter(diagnostic => diagnostic.file?.fileName === implementationPath)).toEqual([])
    const diagnostics = allDiagnostics.filter(diagnostic => diagnostic.file?.fileName === fixture)
    Expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([2322, 2345])
    const wrongRoleDiagnostic = diagnostics.find(diagnostic => diagnostic.code === 2322)
    const incompleteFactoryDiagnostic = diagnostics.find(diagnostic => diagnostic.code === 2345)
    for (
      const [diagnostic, expectedLine, expectedMessage] of [
        [wrongRoleDiagnostic, 'wrongRole', 'reading'],
        [incompleteFactoryDiagnostic, 'QuantityArithmetic.add({ definition:', 'acceptsPayload'],
      ] as const
    ) {
      Assert.defined(diagnostic, `the ${expectedLine} TypeScript diagnostic exists`)
      Assert.defined(diagnostic.file, 'the diagnostic belongs to the virtual fixture')
      Assert.defined(diagnostic.start, 'the diagnostic has a source position')
      const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
      Expect(diagnostic.file.text.split('\n')[line]).toContain(expectedLine)
      Expect(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).toContain(expectedMessage)
    }
  })
})
