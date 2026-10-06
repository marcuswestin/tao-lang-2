import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import React from 'react'
import { runAction, type TaoActionReceipt } from '../TaoRuntime-src/TR-action-transactions'
import { memoryKeyValueStorage } from '../TaoRuntime-src/TR-data-provider'
import { getJSValue } from '../TaoRuntime-src/TR-js-value'
import { makeQuantityType } from '../TaoRuntime-src/TR-quantity-values'
import { writablePath } from '../TaoRuntime-src/TR-reactive-values'
import { runtimeTestOverrideSlot } from '../TaoRuntime-src/TR-test-override'

const Duration = makeQuantityType({
  domain: 'AccessorDuration',
  defaultUnit: 'Seconds',
  units: { Seconds: 1, Minutes: 60 },
}, TR.Value)

const hooks = runtimeTestOverrideSlot({
  read: () => ({
    context: React.useContext,
    effect: React.useEffect,
    reducer: React.useReducer,
    ref: React.useRef,
    state: React.useState,
  }),
  equals: (left, right) =>
    left.context === right.context && left.effect === right.effect && left.reducer === right.reducer
    && left.ref === right.ref && left.state === right.state,
  write: value => {
    React.useContext = value.context
    React.useEffect = value.effect
    React.useReducer = value.reducer
    React.useRef = value.ref
    React.useState = value.state
  },
})

/** Constructs real runtime wrappers at the hook seam; it does not model a mounted React view. */
function atHookSeam<T>(create: () => T): T {
  const restore = hooks.install({
    context: (() => undefined) as typeof React.useContext,
    effect: () => {},
    reducer: (() => [0, () => {}]) as unknown as typeof React.useReducer,
    ref: (<ValueT>(initial: ValueT) => ({ current: initial })) as typeof React.useRef,
    state: (<ValueT>(initial: ValueT | (() => ValueT)) => [
      typeof initial === 'function' ? (initial as () => ValueT)() : initial,
      () => {},
    ]) as unknown as typeof React.useState,
  })
  try {
    return create()
  } finally {
    restore()
  }
}

function identity(name: string): TR.DeclarationIdentity {
  return TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'JSValue', 'app', name])
}

/** This is the structural value shape native callers used before accessors existed. */
function legacyValue<T>(jsValue: T) {
  return {
    jsValue,
    evaluate() {
      return this
    },
  }
}

Describe('native JavaScript value accessors', () => {
  Test('accepts a minimal evaluable input and evaluates exactly once per read', () => {
    let evaluations = 0
    let payloadReads = 0
    const input = {
      evaluate() {
        evaluations += 1
        const current = evaluations
        return {
          get jsValue() {
            payloadReads += 1
            return current
          },
        }
      },
    }

    Expect(getJSValue(input)).toBe(1)
    Expect([evaluations, payloadReads]).toEqual([1, 1])
    Expect(getJSValue(input)).toBe(2)
    Expect([evaluations, payloadReads]).toEqual([2, 2])
  })

  Test('returns canonical numbers from typed quantity helpers and object methods', () => {
    const quantity = Duration.fromUnit(2, 'Minutes')
    const helperNumber: number = getJSValue<typeof quantity.jsValue>(quantity)
    const methodNumber: number = quantity.getJSValue()

    Expect(helperNumber).toBe(120)
    Expect(methodNumber).toBe(120)
    Expect(Duration.read(quantity)).toEqual({ canonical: 120, unit: 'Minutes' })
  })

  Test('keeps primitive payloads and quantity-shaped ordinary records unchanged', () => {
    for (const payload of [null, undefined, false, true, '', 'native', 0, 4]) {
      Expect(getJSValue(TR.Value(payload))).toBe(payload)
      Expect(TR.Value(payload).getJSValue()).toBe(payload)
    }
    const ordinary = { canonical: 120, domain: 'AccessorDuration', unit: 'Minutes' }
    const sameRecord: typeof ordinary = getJSValue(TR.Value(ordinary))

    Expect(sameRecord).toBe(ordinary)
    Expect(TR.Value(ordinary).getJSValue()).toBe(ordinary)
  })

  Test('preserves record and list identity without flattening nested quantities or wrappers', () => {
    const quantity = Duration.fromUnit(2, 'Minutes')
    const nestedWrapper = TR.Value('retained wrapper')
    const list = [quantity.jsValue, nestedWrapper]
    const record = { Amount: quantity.jsValue, Nested: { Value: nestedWrapper }, List: list }
    const sameRecord: typeof record = getJSValue(TR.Value(record))
    const sameList: typeof list = TR.Value(list).getJSValue()

    Expect(sameRecord).toBe(record)
    Expect(sameList).toBe(list)
    Expect(sameRecord.Amount).toBe(quantity.jsValue)
    Expect(sameRecord.Nested.Value).toBe(nestedWrapper)
    Expect(sameList[0]).toBe(quantity.jsValue)
    Expect(sameList[1]).toBe(nestedWrapper)
    Expect(TR.Value(record).getJSValue()).toBe(record)
  })

  Test('preserves live entity handles, functions and opaque object payloads', () => {
    const schema = TR.Data.Schema({
      name: 'AccessorNotes',
      entities: { Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } } },
    }, { load: () => undefined, save: () => {} })
    TR.Data.Create(schema, 'Note', { Title: TR.Value('Before') })
    const handle = schema.query({ entity: 'Note', filters: [] })[0]
    const callback = (value: string) => value.toUpperCase()
    const opaque = new Date('2026-01-01T00:00:00Z')

    Expect(handle).toBeDefined()
    Expect(getJSValue(TR.Value(handle))).toBe(handle)
    Expect(TR.Value(handle).getJSValue()).toBe(handle)
    Expect(getJSValue(TR.Value(callback))).toBe(callback)
    Expect(TR.Value(callback).getJSValue()).toBe(callback)
    Expect(getJSValue(TR.Value(opaque))).toBe(opaque)
    Expect(TR.Value(opaque).getJSValue()).toBe(opaque)
    TR.Data.Update(TR.Value(handle), { Title: TR.Value('After') })
    Expect(TR.Member(TR.Value(handle), ['Title']).getJSValue()).toBe('After')
  })

  Test('reads a lazy alias initializer once and afresh through each accessor', () => {
    let initializations = 0
    let evaluations = 0
    const alias = TR.Alias(() => {
      initializations += 1
      return {
        evaluate() {
          evaluations += 1
          return TR.Value(`read ${evaluations}`)
        },
      }
    })

    Expect([initializations, evaluations]).toEqual([0, 0])
    Expect(alias.getJSValue()).toBe('read 1')
    Expect([initializations, evaluations]).toEqual([1, 1])
    Expect(getJSValue(alias)).toBe('read 2')
    Expect([initializations, evaluations]).toEqual([2, 2])
    Expect(alias.getJSValue()).toBe('read 3')
    Expect([initializations, evaluations]).toEqual([3, 3])
  })

  Test('completes legacy plural, selected and fallback case outputs and callable results', () => {
    let reads = 0
    let current = 'Before'
    const legacy = {
      evaluate() {
        return this
      },
      get jsValue() {
        reads += 1
        return current
      },
    }
    const plural = TR.Plural(legacyValue(2), { other: legacy }, 'en')
    const selected = TR.WhenCase<string>(legacyValue(true), [['true', () => legacy]], () => legacyValue('Unused'))
    const fallback = TR.WhenCase<string>(legacyValue(false), [['true', () => legacyValue('Unused')]], () => legacy)
    const fn = TR.Function(() => legacy)
    const called = TR.Call<string>(fn)
    Expect(reads).toBe(0)
    current = 'After'
    for (const output of [plural, selected, fallback, called]) {
      Expect(output.getJSValue()).toBe('After')
      Expect(output.evaluate().getJSValue()).toBe('After')
    }
    Expect(reads).toBe(8)
    let evaluations = 0
    const mapped = TR.Mapped(() => ({
      evaluate() {
        evaluations += 1
        return legacy
      },
      jsValue: 'Unused',
    }), TR.Action((_next: TR.Value<string>) => {}))
    const snapshot = mapped.evaluate()
    Expect(evaluations).toBe(1)
    Expect(reads).toBe(8)
    Expect(snapshot.getJSValue()).toBe('After')
    Expect(evaluations).toBe(1)
    Expect(reads).toBe(9)
    const compound = TR.CompoundSet({ evaluate: () => legacyValue(2) }, '+=', legacyValue(3))
    Expect(compound.getJSValue()).toBe(5)
    const concatenated = TR.CompoundSet({ evaluate: () => legacyValue('a') }, '+=', legacyValue('b'))
    Expect(concatenated.getJSValue()).toBe('ab')
  })

  Test('preserves scoped callable returns and complete wrapper identity', () => {
    const scoped = TR.Function(() => legacyValue('Scoped'))
    const returned = TR.Function(() => scoped).invoke()
    Expect(returned).toBe(scoped)
    Expect(TR.Call<string>(returned as TR.Function).getJSValue()).toBe('Scoped')
    const value = TR.Value('Complete')
    const completeValues = [value, TR.Readonly<string>(legacyValue('Readonly')), TR.Cell(legacyValue('Cell'))]
    for (const complete of completeValues) {
      const output = TR.Call<string>(TR.Function(() => complete))
      Expect(output).toBe(complete)
      Expect('jsValue' in output).toBe(true)
      Expect(output.jsValue).toBe(output.getJSValue())
      Expect(output.evaluate().getJSValue()).toBe(output.jsValue)
    }
  })

  Test('preserves complete value identity consistently through selection, plural and mapped outputs', () => {
    const value = TR.Value('Complete')
    const selected = TR.WhenCase<string>(TR.Value(true), [['true', () => value]], () => TR.Value('Unused'))
    const fallback = TR.WhenCase<string>(TR.Value(false), [['true', () => TR.Value('Unused')]], () => value)
    const plural = TR.Plural(TR.Value(2), { other: value }, 'en')
    const mapped = TR.Mapped(() => value, TR.Action((_next: TR.Value<string>) => {}))
    for (const output of [selected, fallback, plural, mapped.evaluate(), TR.Call<string>(TR.Function(() => value))]) {
      Expect(output).toBe(value)
      Expect(output.evaluate()).toBe(value)
      Expect(output.getJSValue()).toBe('Complete')
    }
  })

  Test('completes function-returned legacy aliases without changing direct alias evaluation', () => {
    let evaluations = 0
    let payloadReads = 0
    let current = 'Current'
    const legacy = {
      evaluate() {
        evaluations += 1
        return this
      },
      get jsValue() {
        payloadReads += 1
        return current
      },
    }
    const alias = TR.Alias(legacy)
    const output = TR.Call<string>(TR.Function(() => alias))
    Expect([evaluations, payloadReads]).toEqual([0, 0])
    Expect(output.jsValue).toBe('Current')
    Expect([evaluations, payloadReads]).toEqual([1, 1])
    const evaluated = output.evaluate()
    Expect(typeof evaluated.getJSValue).toBe('function')
    Expect([evaluations, payloadReads]).toEqual([2, 1])
    Expect(evaluated.getJSValue()).toBe('Current')
    Expect(output.getJSValue()).toBe('Current')
    current = 'Updated'
    Expect(output.jsValue).toBe('Updated')
    Expect(output.getJSValue()).toBe('Updated')
    Expect(output.evaluate().getJSValue()).toBe('Updated')
    Expect(alias.evaluate()).toBe(legacy)
    Expect('getJSValue' in alias.evaluate()).toBe(false)
  })

  Test('keeps quantity extraction and payload identity coherent in completed alias outputs', () => {
    for (const canonical of [120, 0, -0]) {
      const quantity = Duration.fromJSValue(canonical)
      const input = legacyValue(quantity.jsValue)
      const output = TR.Call<typeof quantity.jsValue>(TR.Function(() => TR.Alias(input)))
      const native: number = output.getJSValue()
      Expect(Object.is(native, canonical)).toBe(true)
      Expect(output.jsValue).toBe(quantity.jsValue)
      Expect(output.evaluate().jsValue).toBe(quantity.jsValue)
      Expect(Object.is(output.evaluate().getJSValue(), canonical)).toBe(true)
    }
    const payload = { Nested: [TR.Value('Opaque')] }
    const output = TR.Call<typeof payload>(TR.Function(() => TR.Alias(legacyValue(payload))))
    Expect(output.jsValue).toBe(payload)
    Expect(output.getJSValue()).toBe(payload)
    Expect(output.evaluate().getJSValue()).toBe(payload)
  })

  Test('completes accessor-bearing structural inputs whose evaluated outputs are legacy values', () => {
    let evaluations = 0
    let discoveryReads = 0
    let current = 'Current'
    const legacy = {
      evaluate() {
        return this
      },
      get jsValue() {
        return current
      },
    }
    const input = {
      get jsValue() {
        discoveryReads += 1
        return 'Untrusted surface'
      },
      getJSValue() {
        discoveryReads += 1
        return 'Untrusted accessor'
      },
      evaluate() {
        evaluations += 1
        return legacy
      },
    }
    const output = TR.Call<string>(TR.Function(() => input))
    Expect([evaluations, discoveryReads]).toEqual([0, 0])
    Expect(output.jsValue).toBe('Current')
    Expect(evaluations).toBe(1)
    const evaluated = output.evaluate()
    Expect(typeof evaluated.getJSValue).toBe('function')
    Expect(evaluated.jsValue).toBe('Current')
    Expect(evaluated.getJSValue()).toBe('Current')
    Expect(evaluations).toBe(2)
    current = 'Updated'
    Expect(output.getJSValue()).toBe('Updated')
    Expect(output.evaluate().getJSValue()).toBe('Updated')
    Expect(evaluations).toBe(4)
    Expect(discoveryReads).toBe(0)
  })

  Test('completes noncallable legacy accessor properties without invoking getters', () => {
    let getterReads = 0
    const inputs = [
      { ...legacyValue('Undefined'), getJSValue: undefined },
      { ...legacyValue('Noncallable'), getJSValue: 'Reserved' },
      {
        ...legacyValue('Getter'),
        get getJSValue() {
          getterReads += 1
          return undefined
        },
      },
    ]
    for (const input of inputs) {
      const result = TR.Call<string>(TR.Function(() => input))
      Expect(typeof result.getJSValue).toBe('function')
      const evaluated = result.evaluate()
      Expect(typeof evaluated.getJSValue).toBe('function')
      Expect(result.getJSValue()).toBe(input.jsValue)
      Expect(evaluated.getJSValue()).toBe(input.jsValue)
    }
    Expect(getterReads).toBe(0)
  })

  Test('preserves unavailable account metadata through callable and case outputs', async () => {
    const connection: TR.AuthConnection = {
      capabilities: { methods: [] },
      restore: async () => ({ state: 'SignedOut' }),
      signIn: async () => ({ outcome: { status: 'cancelled' } }),
      signOut: async () => ({ status: 'completed' }),
      proof: async () => ({ kind: 'Session', issuer: 'accessor-test', subject: 'unused', value: {} }),
    }
    const source = TR.Auth.Configure(TR.Auth.Declaration('AccessorAuth', { connect: () => connection }), {})
    const scope = TR.Auth.CreateScope(source)
    const account = TR.Auth.Account(scope)
    const called = TR.Call(TR.Function(() => account))
    try {
      const selected = TR.WhenCase(TR.Value(true), [['true', () => account]], () => TR.Value('Unused'))
      for (const value of [account, called, selected]) {
        Expect(TR.IsCase(value, 'loading').getJSValue()).toBe(true)
      }
      Expect(called.getJSValue()).toBeUndefined()
      Expect(selected.getJSValue()).toBeUndefined()
      await scope.restore()
      const fallback = TR.WhenCase(TR.Value(false), [['true', () => TR.Value('Unused')]], () => account)
      for (const value of [account, called, fallback]) {
        Expect(TR.IsCase(value, 'unauthorized').getJSValue()).toBe(true)
      }
    } finally {
      scope.dispose()
    }
  })

  Test('keeps produced accessor methods nonenumerable and inspection free of live reads', () => {
    let evaluations = 0
    const source = {
      evaluate() {
        evaluations += 1
        return TR.Value({ Title: 'Current' })
      },
    }
    const readonly = TR.Readonly<{ Title: string }>(source)
    const alias = TR.Alias(source)
    const cell = TR.Cell(TR.Value({ Title: 'Current' }))
    const mapped = TR.Mapped(
      () => legacyValue(cell.evaluate().jsValue),
      TR.Action((next: TR.Value<{ Title: string }>) => cell.set(next)),
    )
    const member = TR.Member(cell, ['Title'])
    const values = [TR.Value('Current'), readonly, alias, cell, mapped, member, TR.Copy(cell)]

    for (const value of values) {
      Expect(typeof value.getJSValue).toBe('function')
      Expect(Object.keys(value)).not.toContain('getJSValue')
      Expect(Object.prototype.propertyIsEnumerable.call(value, 'getJSValue')).toBe(false)
      Expect(Object.prototype.hasOwnProperty.call(Object.assign({}, value), 'getJSValue')).toBe(false)
    }
    Expect(evaluations).toBe(0)
    Expect(readonly.getJSValue()).toEqual({ Title: 'Current' })
    Expect(evaluations).toBe(1)
    Expect(alias.getJSValue()).toEqual({ Title: 'Current' })
    Expect(evaluations).toBe(2)
    Expect(cell.getJSValue()).toEqual({ Title: 'Current' })
    Expect(mapped.getJSValue()).toEqual({ Title: 'Current' })
    Expect(mapped.evaluate().getJSValue()).toEqual({ Title: 'Current' })
    Expect(member.getJSValue()).toBe('Current')
  })

  Test('retains legacy structural inputs for cells, copies, field lenses and sets', () => {
    const original = { Details: { Title: 'Before', Body: 'Keep' } }
    const cell = TR.Cell(legacyValue(original))
    const copied = TR.Copy(legacyValue(original))
    let current = original
    const structuralOwner = {
      evaluate: () => legacyValue(current),
      set(next: { evaluate(): { jsValue: unknown } }) {
        const payload = next.evaluate().jsValue
        Expect(payload).toEqual({ Details: { Title: 'After', Body: 'Keep' } })
        current = payload as typeof original
      },
    }
    const lens = writablePath(structuralOwner, ['Details', 'Title'])

    lens.set(legacyValue('After'))
    TR.Set(cell, () => legacyValue({ Details: { Title: 'Assigned', Body: 'Keep' } }))

    Expect(lens.getJSValue()).toBe('After')
    Expect(current).toEqual({ Details: { Title: 'After', Body: 'Keep' } })
    Expect(original).toEqual({ Details: { Title: 'Before', Body: 'Keep' } })
    Expect(cell.getJSValue()).toEqual({ Details: { Title: 'Assigned', Body: 'Keep' } })
    Expect(copied.getJSValue()).toEqual({ Details: { Title: 'Before', Body: 'Keep' } })
    Expect(getJSValue(legacyValue('legacy'))).toBe('legacy')
  })

  Test('reads real State wrappers at the hook seam through updates, defaults and rollback', async () => {
    const state = atHookSeam(() => TR.State(() => legacyValue(280)))
    const Failure = TR.Enum(identity('StateAccessorRejected'), ['Rejected'])
    const observations: number[] = []
    let receipt: TaoActionReceipt | undefined
    const stopFailure = TR.Errors.onFailure(() => {})
    try {
      Expect(state.getJSValue()).toBe(280)
      state.set(legacyValue(420))
      Expect(state.getJSValue()).toBe(420)
      Expect(state.defaultValue().getJSValue()).toBe(280)
      for (const value of [state, state.evaluate(), state.defaultValue()]) {
        Expect(typeof value.getJSValue).toBe('function')
        Expect(Object.keys(value)).not.toContain('getJSValue')
        Expect(Object.prototype.hasOwnProperty.call(Object.assign({}, value), 'getJSValue')).toBe(false)
      }
      await runAction(
        'reject state accessor',
        [],
        () => {
          state.set(legacyValue(900))
          observations.push(state.getJSValue(), getJSValue(state), state.evaluate().getJSValue())
          state.reset()
          observations.push(state.getJSValue(), state.defaultValue().getJSValue())
          TR.Fail(Failure['Rejected']!, 'Keep the view width.')
        },
        false,
        false,
        undefined,
        value => {
          receipt = value
        },
      )

      Expect(receipt?.outcome).toBe('failed')
      Expect(receipt?.failure?.case).toBe('Rejected')
      Expect(observations).toEqual([900, 900, 900, 280, 280])
      Expect(state.getJSValue()).toBe(420)
      Expect(state.evaluate().getJSValue()).toBe(420)
      Expect(state.defaultValue().getJSValue()).toBe(280)
      state.reset()
      Expect(state.getJSValue()).toBe(280)
    } finally {
      stopFailure()
    }
  })

  Test('accesses local, copied and legacy writable parameter cells at the hook seam', async () => {
    let current = { Title: 'Shared' }
    let writes = 0
    const legacyWritable = {
      evaluate: () => legacyValue(current),
      set(next: { evaluate(): { jsValue: typeof current } }) {
        writes += 1
        current = next.evaluate().jsValue
      },
    }
    const { local, shared, copied } = atHookSeam(() => ({
      local: TR.UseParameterCell(legacyValue({ Title: 'Local' })),
      shared: TR.UseParameterCell(legacyWritable),
      copied: TR.UseParameterCell(legacyWritable, { copy: true }),
    }))

    Expect(local.getJSValue()).toEqual({ Title: 'Local' })
    Expect(shared.getJSValue()).toBe(current)
    Expect(copied.getJSValue()).toEqual({ Title: 'Shared' })
    Expect(copied.getJSValue()).not.toBe(current)
    TR.Set(shared, () => legacyValue({ Title: 'Forwarded' }))
    TR.Set(local, () => legacyValue({ Title: 'Updated local' }))

    Expect(writes).toBe(1)
    Expect(current).toEqual({ Title: 'Forwarded' })
    Expect(shared.getJSValue()).toBe(current)
    Expect(local.getJSValue()).toEqual({ Title: 'Updated local' })
    Expect(copied.getJSValue()).toEqual({ Title: 'Shared' })
    for (const value of [local, shared, copied]) {
      Expect(Object.keys(value)).not.toContain('getJSValue')
      Expect(Object.prototype.hasOwnProperty.call(Object.assign({}, value), 'getJSValue')).toBe(false)
    }
    const Failure = TR.Enum(identity('ParameterAccessorRejected'), ['Rejected'])
    const observations: string[] = []
    let receipt: TaoActionReceipt | undefined
    const stopFailure = TR.Errors.onFailure(() => {})
    try {
      await runAction(
        'reject parameter accessors',
        [],
        () => {
          TR.Set(local, () => legacyValue({ Title: 'Pending local' }))
          TR.Set(copied, () => legacyValue({ Title: 'Pending copy' }))
          observations.push(local.getJSValue().Title, getJSValue(copied).Title)
          TR.Fail(Failure['Rejected']!, 'Keep the parameter drafts.')
        },
        false,
        false,
        undefined,
        value => {
          receipt = value
        },
      )

      Expect(receipt?.outcome).toBe('failed')
      Expect(receipt?.failure?.case).toBe('Rejected')
      Expect(observations).toEqual(['Pending local', 'Pending copy'])
      Expect(local.getJSValue()).toEqual({ Title: 'Updated local' })
      Expect(copied.getJSValue()).toEqual({ Title: 'Shared' })
      Expect(shared.getJSValue()).toBe(current)
      Expect(writes).toBe(1)
    } finally {
      stopFailure()
    }
  })

  Test('reads persisted defaults, hydration and reset through nonenumerable accessors', async () => {
    const storage = memoryKeyValueStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    const numberType = { kind: 'primitive', name: 'number' } as const
    try {
      const state = TR.PersistedState(
        () => legacyValue(280),
        identity('AccessorDefaults'),
        'Width',
        numberType,
        'com.tao.test.accessor-defaults',
      )
      storage.values.set(state.key, JSON.stringify({ formatVersion: 1, type: numberType, value: 360 }))
      const called = TR.Call<number>(TR.Function(() => state))
      const snapshot = state.evaluate()
      Expect(TR.Call<number>(TR.Function(() => snapshot))).toBe(snapshot)
      Expect(TR.WhenCase<number>(TR.Value(true), [['true', () => snapshot]], () => TR.Value(0))).toBe(snapshot)

      Expect(state.getJSValue()).toBe(280)
      Expect(called.jsValue).toBe(280)
      Expect(called.evaluate().getJSValue()).toBe(280)
      Expect(state.defaultValue().getJSValue()).toBe(280)
      await state.load()
      Expect(state.getJSValue()).toBe(360)
      Expect(called.jsValue).toBe(360)
      Expect(called.getJSValue()).toBe(360)
      Expect(called.evaluate().getJSValue()).toBe(360)
      Expect(getJSValue(state)).toBe(360)
      Expect(state.evaluate().getJSValue()).toBe(360)
      Expect(state.defaultValue().getJSValue()).toBe(280)
      for (const value of [state, state.evaluate(), state.defaultValue()]) {
        Expect(typeof value.getJSValue).toBe('function')
        Expect(Object.keys(value)).not.toContain('getJSValue')
        Expect(Object.prototype.hasOwnProperty.call(Object.assign({}, value), 'getJSValue')).toBe(false)
      }
      state.reset()
      await state.settleWrites()

      Expect(state.getJSValue()).toBe(280)
      Expect(called.jsValue).toBe(280)
      Expect(called.evaluate().getJSValue()).toBe(280)
      Expect(state.evaluate().getJSValue()).toBe(280)
      Expect(storage.values.get(state.key)).toBe(JSON.stringify({ formatVersion: 1, type: numberType, value: 280 }))
    } finally {
      restore()
    }
  })

  Test('preserves persisted text snapshot identity across every value-returning helper', () => {
    const state = TR.PersistedState(
      () => legacyValue('Complete'),
      identity('AccessorSnapshotIdentity'),
      'Title',
      { kind: 'primitive', name: 'text' },
      'com.tao.test.accessor-snapshot',
    )
    const snapshot = state.evaluate()
    const selected = TR.WhenCase<string>(TR.Value(true), [['true', () => snapshot]], () => TR.Value('Unused'))
    const plural = TR.Plural(TR.Value(2), { other: snapshot }, 'en')
    const called = TR.Call<string>(TR.Function(() => snapshot))
    for (const output of [selected, plural, called]) {
      Expect(output).toBe(snapshot)
      Expect(output.evaluate()).toBe(snapshot)
      Expect(output.jsValue).toBe('Complete')
      Expect(output.getJSValue()).toBe('Complete')
    }
  })

  Test('reads persisted transaction overlays and restores accessor parity after rollback', async () => {
    const storage = memoryKeyValueStorage()
    const restore = TR.Persisted.setStorageForTests(storage)
    const stopFailure = TR.Errors.onFailure(() => {})
    const numberType = { kind: 'primitive', name: 'number' } as const
    try {
      const state = TR.PersistedState(
        () => legacyValue(280),
        identity('AccessorTransactions'),
        'Width',
        numberType,
        'com.tao.test.accessor-transactions',
      )
      const Failure = TR.Enum(identity('AccessorRejected'), ['Rejected'])
      const observations: number[] = []
      let committed: TaoActionReceipt | undefined
      let rejected: TaoActionReceipt | undefined
      let afterFailure = false
      await state.load()
      await runAction(
        'commit persisted accessor',
        [],
        () => {
          TR.Set(state, () => legacyValue(420))
          observations.push(state.getJSValue(), getJSValue(state), state.evaluate().getJSValue())
        },
        false,
        false,
        undefined,
        receipt => {
          committed = receipt
        },
      )
      await state.settleWrites()

      Expect(committed?.outcome).toBe('committed')
      Expect(observations).toEqual([420, 420, 420])
      Expect(state.getJSValue()).toBe(420)
      Expect(storage.values.get(state.key)).toBe(JSON.stringify({ formatVersion: 1, type: numberType, value: 420 }))

      await runAction(
        'reject persisted accessor',
        [],
        () => {
          TR.Set(state, () => legacyValue(900))
          observations.push(state.getJSValue(), getJSValue(state), state.evaluate().getJSValue())
          state.reset()
          observations.push(state.getJSValue(), state.defaultValue().getJSValue())
          TR.Fail(Failure['Rejected']!, 'Keep the saved width.')
          afterFailure = true
        },
        false,
        false,
        undefined,
        receipt => {
          rejected = receipt
        },
      )
      await state.settleWrites()

      Expect(rejected?.outcome).toBe('failed')
      Expect(rejected?.failure?.case).toBe('Rejected')
      Expect(afterFailure).toBe(false)
      Expect(observations).toEqual([420, 420, 420, 900, 900, 900, 280, 280])
      Expect(state.getJSValue()).toBe(420)
      Expect(getJSValue(state)).toBe(420)
      Expect(state.evaluate().getJSValue()).toBe(420)
      Expect(state.defaultValue().getJSValue()).toBe(280)
      Expect(storage.values.get(state.key)).toBe(JSON.stringify({ formatVersion: 1, type: numberType, value: 420 }))
    } finally {
      stopFailure()
      restore()
    }
  })
})
