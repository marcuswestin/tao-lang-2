import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import { QuantityFailureCases } from '../TaoRuntime-src/TR-quantity-values'

Describe('checked plain numeric storage', () => {
  Test('preserves finite backing including signed zero and binary64 extremes', () => {
    for (const input of [0, -0, -2, 1.5, Number.MIN_VALUE, Number.MAX_VALUE]) {
      Expect(Object.is(TR.checkedNumericBacking(input), input)).toBe(true)
    }
  })

  Test('rejects every nonfinite value as a modeled backing failure', () => {
    for (const input of [NaN, Infinity, -Infinity]) {
      let failure: unknown
      try {
        TR.checkedNumericBacking(input, 'Reading')
      } catch (error) {
        failure = error
      }
      Expect(failure).toBeInstanceOf(TaoActionFailure)
      Expect((failure as TaoActionFailure).caseName).toBe(QuantityFailureCases.NonFinite)
      Expect((failure as TaoActionFailure).message).toBe("A 'Reading' value needs finite backing.")
    }
  })

  Test('rejects wrong storage without coercion or reading user objects', () => {
    let probes = 0
    const coercible = {
      valueOf: () => {
        probes++
        return 2
      },
      get jsValue() {
        probes++
        return 2
      },
    }
    for (const input of ['2', null, undefined, true, {}, coercible]) {
      let failure: unknown
      try {
        TR.checkedNumericBacking(input)
      } catch (error) {
        failure = error
      }
      Expect(failure).toBeInstanceOf(TaoActionFailure)
      Expect((failure as TaoActionFailure).caseName).toBe(QuantityFailureCases.BadShape)
      Expect((failure as TaoActionFailure).message).toBe("A 'numeric' value needs numeric backing.")
    }
    Expect(probes).toBe(0)
  })
})
