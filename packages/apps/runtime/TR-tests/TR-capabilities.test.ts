import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoEvaluable } from '../TaoRuntime-src/TR-action-values'
import { RuntimeAssert } from '../TaoRuntime-src/TR-assert'
import { createCapabilityRuntime, type TaoCapability } from '../TaoRuntime-src/TR-capabilities'
import { UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import { getJSValue } from '../TaoRuntime-src/TR-js-value'
import { completeRuntimeValue } from '../TaoRuntime-src/TR-reactive-values'

const capabilities = createCapabilityRuntime(TR.Function)

Describe('Capability witnesses', () => {
  Test('keeps receiver backing private so public property writes cannot diverge from selected witnesses', () => {
    const source = TR.Cell(TR.Value('Original'))
    const carrier = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>) => {
        Expect(receiver).toBe(source)
        return TR.Value(`Token:${getJSValue(receiver)}`)
      }),
    })
    const held = capabilities.method(carrier, 'display')
    Expect(Object.getOwnPropertyNames(carrier)).toEqual([])
    Expect(Object.getOwnPropertySymbols(carrier)).toEqual([])
    Object.assign(carrier, { source: TR.Value('Replacement') })
    Expect(carrier.getJSValue()).toBe('Original')
    Expect(TR.Call<string>(held).getJSValue()).toBe('Token:Original')
    source.set(TR.Value('Changed'))
    Expect(carrier.getJSValue()).toBe('Changed')
    Expect(TR.Call<string>(held).getJSValue()).toBe('Token:Changed')
  })

  Test('attaches, projects and binds legacy sources without getter probes or evaluations', () => {
    let reads = 0
    let evaluationAccesses = 0
    let current = 'Before'
    const source = {
      get evaluate() {
        evaluationAccesses += 1
        return () => {
          reads += 1
          return TR.Value(current)
        }
      },
      get jsValue() {
        RuntimeAssert(false, 'no direct source payload probe')
        return ''
      },
      get getJSValue() {
        RuntimeAssert(false, 'no source accessor probe')
        return undefined
      },
    }
    const display = TR.Function((receiver: TaoEvaluable<string>) => {
      Expect(receiver).toBe(source)
      return TR.Value(`Token:${getJSValue(receiver)}`)
    })
    const carrier = capabilities.attach(source, { display })
    const projected = capabilities.reproject(carrier, { text: 'display' })
    const held = capabilities.method(projected, 'text')
    Expect(carrier.evaluate()).toBe(carrier)
    Expect(projected.evaluate()).toBe(projected)
    Expect(Object.keys(carrier).includes('jsValue')).toBe(false)
    Expect(Object.keys(projected).includes('jsValue')).toBe(false)
    Expect([reads, evaluationAccesses]).toEqual([0, 0])
    Expect(TR.Call<string>(held).getJSValue()).toBe('Token:Before')
    current = 'After'
    Expect(TR.Call<string>(held).getJSValue()).toBe('Token:After')
    Expect(carrier.jsValue).toBe('After')
    Expect(projected.getJSValue()).toBe('After')
    Expect(getJSValue(projected)).toBe('After')
    Expect([reads, evaluationAccesses]).toEqual([5, 5])
  })

  Test('selects distinct implementations for identical erased payloads', () => {
    const source = TR.Value('Same')
    const token = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>) => TR.Value(`Token:${getJSValue(receiver)}`)),
    })
    const label = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>) => TR.Value(`Label:${getJSValue(receiver)}`)),
    })
    Expect(token.getJSValue()).toBe('Same')
    Expect(label.getJSValue()).toBe('Same')
    Expect(TR.Call<string>(capabilities.method(token, 'display')).getJSValue()).toBe('Token:Same')
    Expect(TR.Call<string>(capabilities.method(label, 'display')).getJSValue()).toBe('Label:Same')
  })

  Test('preserves attached and projected carriers through ordinary function arguments and returns', () => {
    const source = TR.Cell(TR.Value('Before'))
    const carrier = capabilities.attach(source, {
      display: TR.Function((receiver: TaoEvaluable<string>, suffix: TaoEvaluable<string>) => {
        Expect(receiver).toBe(source)
        return TR.Value(`Token:${getJSValue(receiver)}${getJSValue(suffix)}`)
      }),
    })
    const projected = capabilities.reproject(carrier, { text: 'display' })
    const relay = TR.Function((value: TaoCapability<string>) => value)
    const returned = TR.Call<string>(relay, projected)
    Expect(completeRuntimeValue(carrier)).toBe(carrier)
    Expect(completeRuntimeValue(projected)).toBe(projected)
    Expect(TR.Call<string>(relay, carrier)).toBe(carrier)
    Expect(returned).toBe(projected)
    const held = capabilities.method(returned as TaoCapability<string>, 'text')
    Expect(TR.Call<string>(held, TR.Value('!')).getJSValue()).toBe('Token:Before!')
    source.set(TR.Value('After'))
    Expect(TR.Call<string>(held, TR.Value('?')).getJSValue()).toBe('Token:After?')
    Expect(returned.getJSValue()).toBe('After')
    Expect(returned).toBe(projected)
  })

  Test('reprojects selected witnesses repeatedly while retaining the original receiver and argument order', () => {
    const source = TR.Value('Receiver')
    const first = TR.Value('First')
    const second = TR.Value('Second')
    let calls = 0
    const selected = TR.Function((receiver: TaoEvaluable<string>, a: TR.Value<string>, b: TR.Value<string>) => {
      calls += 1
      Expect(receiver).toBe(source)
      Expect(a).toBe(first)
      Expect(b).toBe(second)
      return TR.Value(`${getJSValue(receiver)}:${a.getJSValue()}:${b.getJSValue()}`)
    })
    const carrier = capabilities.attach(source, { selected, omitted: TR.Function(() => TR.Value('Unused')) })
    const projected = capabilities.reproject(carrier, { renamed: 'selected', another: 'selected' })
    const again = capabilities.reproject(projected, { final: 'renamed' })
    Expect(projected === carrier).toBe(false)
    Expect(again === projected).toBe(false)
    Expect(calls).toBe(0)
    Expect(TR.Call<string>(capabilities.method(again, 'final'), first, second).getJSValue())
      .toBe('Receiver:First:Second')
    Expect(TR.Call<string>(capabilities.method(projected, 'another'), first, second).getJSValue())
      .toBe('Receiver:First:Second')
    Expect(calls).toBe(2)
    Expect(() => capabilities.method(projected, 'omitted')).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.reproject(again, { restored: 'selected' })).toThrow(UnexpectedBehaviorError)
  })

  Test('retains ordinary callable results when a selected method returns another function or capability', () => {
    const source = TR.Value('Same')
    const nested = TR.Function(() => TR.Value('Nested'))
    const inner = capabilities.attach(source, { display: TR.Function(() => TR.Value('Inner')) })
    const outer = capabilities.attach(source, {
      function: TR.Function(() => nested),
      capability: TR.Function(() => inner),
    })
    const returnedFunction = capabilities.method(outer, 'function').invoke()
    Expect(returnedFunction).toBe(nested)
    Expect(TR.Call<string>(returnedFunction as TR.Function).getJSValue()).toBe('Nested')
    const returnedCapability = TR.Call<string>(capabilities.method(outer, 'capability'))
    Expect(returnedCapability).toBe(inner)
    Expect(TR.Call<string>(capabilities.method(returnedCapability as TaoCapability<string>, 'display')).getJSValue())
      .toBe('Inner')
  })

  Test('snapshots selected tables and treats prototype-looking keys as ordinary own requirements', () => {
    const selected = TR.Function(() => TR.Value('Selected'))
    const witnesses = { ['__proto__']: selected, constructor: selected }
    const carrier = capabilities.attach(TR.Value('Same'), witnesses)
    witnesses.constructor = TR.Function(() => TR.Value('Replacement'))
    const projected = capabilities.reproject(carrier, { ['__proto__']: 'constructor' })
    Expect(TR.Call<string>(capabilities.method(carrier, 'constructor')).getJSValue()).toBe('Selected')
    Expect(TR.Call<string>(capabilities.method(carrier, '__proto__')).getJSValue()).toBe('Selected')
    Expect(TR.Call<string>(capabilities.method(projected, '__proto__')).getJSValue()).toBe('Selected')
    Expect(() => capabilities.method(carrier, 'toString')).toThrow(UnexpectedBehaviorError)
  })

  Test('rejects unowned values and invalid selections without inspecting hostile value getters', () => {
    let probes = 0
    const unowned = {
      get evaluate() {
        probes += 1
        RuntimeAssert(false, 'no unowned value probe')
        return () => TR.Value('Unused')
      },
    } as unknown as TaoCapability<string>
    Expect(() => capabilities.method(unowned, 'display')).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.reproject(unowned, {})).toThrow(UnexpectedBehaviorError)
    Expect(probes).toBe(0)
    const carrier = capabilities.attach(TR.Value('Same'), {})
    Expect(() => capabilities.method(carrier, 'missing')).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.reproject(carrier, { text: 'missing' })).toThrow(UnexpectedBehaviorError)
    Expect(() => capabilities.attach(carrier, {})).toThrow(UnexpectedBehaviorError)
  })
})
