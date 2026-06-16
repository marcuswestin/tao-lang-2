import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('TR.Value', () => {
  Test('wraps JavaScript values as evaluable Tao runtime values', () => {
    const value: TR.Value<string> = new TR.Value('Hello')

    Expect(value.jsValue).toBe('Hello')
    Expect(value.evaluate()).toBe(value)
  })
})

Describe('TR.Alias', () => {
  Test('wraps evaluable Tao values as aliases', () => {
    const value: TR.Value<number> = new TR.Value(3)
    const alias: TR.Alias<number> = TR.Alias(value)

    Expect(alias.evaluate()).toBe(value)
    Expect(alias.evaluate().jsValue).toBe(3)
  })

  Test('re-evaluates lazy alias values on each use', () => {
    let evaluations = 0
    const alias: TR.Alias<string> = TR.Alias(() => {
      evaluations += 1
      return new TR.Value(`lazy ${evaluations}`)
    })

    Expect(evaluations).toBe(0)
    Expect(alias.evaluate().jsValue).toBe('lazy 1')
    Expect(alias.evaluate().jsValue).toBe('lazy 2')
    Expect(evaluations).toBe(2)
  })
})

Describe('TR.Action', () => {
  Test('exposes invokable action payloads', () => {
    const calls: number[] = []
    const action = TR.Action((step: number) => calls.push(step))

    action.jsValue.invoke(2)

    Expect(action.evaluate()).toBe(action)
    Expect(action.evaluate().jsValue).toBe(action.jsValue)
    Expect(calls).toEqual([2])
  })

  Test('invokes action payloads through TR.Do with runtime arguments', () => {
    const calls: number[] = []
    const action = TR.Action((step: number) => calls.push(step))

    TR.Do(action, 3)

    Expect(calls).toEqual([3])
  })
})

Describe('TR.Set', () => {
  Test('updates state wrappers with evaluated runtime values', () => {
    let assigned: number | undefined
    const state = {
      evaluate: () => new TR.Value(1),
      set(value: TR.Value<number>) {
        assigned = value.evaluate().jsValue
      },
    } as TR.State<number>

    TR.Set(state, () => new TR.Value(5))

    Expect(assigned).toBe(5)
  })
})

Describe('TR.CompoundSet', () => {
  Test('computes numeric compound state updates', () => {
    const state = {
      evaluate: () => new TR.Value(8),
    } as TR.State<number>

    Expect(TR.CompoundSet(state, '+=', new TR.Value(2)).jsValue).toBe(10)
    Expect(TR.CompoundSet(state, '-=', new TR.Value(2)).jsValue).toBe(6)
    Expect(TR.CompoundSet(state, '*=', new TR.Value(2)).jsValue).toBe(16)
    Expect(TR.CompoundSet(state, '/=', new TR.Value(2)).jsValue).toBe(4)
  })
})

Describe('TR.BlockScope', () => {
  Test('creates child scopes that can shadow parent declarations', () => {
    const parent: TR.Scope = {
      Name: TR.Alias(new TR.Value('parent')),
    }

    const result = TR.BlockScope(parent, child => {
      child['Name'] = TR.Alias(new TR.Value('child'))
      return {
        child,
        value: child['Name'].evaluate().jsValue,
      }
    })

    Expect(result.value).toBe('child')
    Expect(parent['Name'].evaluate().jsValue).toBe('parent')
    Expect(Object.getPrototypeOf(result.child)).toBe(parent)
  })
})

Describe('TR.Use', () => {
  Test('binds imported declarations lazily so cyclic modules resolve after initialization', () => {
    const scope: TR.Scope = {}
    let imported: TR.Alias<string> | undefined
    TR.Use(scope, 'Greeting', () => imported)

    imported = TR.Alias(new TR.Value('Hello'))

    Expect(scope['Greeting']).toBe(imported)
    Expect(scope['Greeting'].evaluate().jsValue).toBe('Hello')
  })

  Test('reflects live updates of the imported binding', () => {
    const scope: TR.Scope = {}
    let imported = TR.Alias(new TR.Value('first'))
    TR.Use(scope, 'Name', () => imported)

    Expect(scope['Name'].evaluate().jsValue).toBe('first')
    imported = TR.Alias(new TR.Value('second'))
    Expect(scope['Name'].evaluate().jsValue).toBe('second')
  })

  Test('lets child scopes shadow imported bindings', () => {
    const scope: TR.Scope = {}
    TR.Use(scope, 'Name', () => TR.Alias(new TR.Value('imported')))

    const shadowed = TR.BlockScope(scope, child => {
      child['Name'] = TR.Alias(new TR.Value('local'))
      return child['Name'].evaluate().jsValue
    })

    Expect(shadowed).toBe('local')
    Expect(scope['Name'].evaluate().jsValue).toBe('imported')
  })
})

Describe('TR.Views', () => {
  Test('exposes runtime-backed stdlib primitive views', () => {
    Expect(typeof TR.Views.Text).toBe('function')
    Expect(typeof TR.Views.Number).toBe('function')
    Expect(typeof TR.Views.Button).toBe('function')
    Expect(typeof TR.Views.Box).toBe('function')
    Expect(typeof TR.Views.Stack).toBe('function')
    Expect(typeof TR.Views.WrappingRow).toBe('function')
  })
})
