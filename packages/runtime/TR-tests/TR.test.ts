import TR from '@runtime/TR'
import { describe, expect, test } from 'bun:test'

describe('TR.Value', () => {
  test('wraps JavaScript values as evaluable Tao runtime values', () => {
    const value: TR.Value<string> = new TR.Value('Hello')

    expect(value.jsValue).toBe('Hello')
    expect(value.evaluate()).toBe(value)
  })
})

describe('TR.Alias', () => {
  test('wraps evaluable Tao values as aliases', () => {
    const value: TR.Value<number> = new TR.Value(3)
    const alias: TR.Alias<number> = TR.Alias(value)

    expect(alias.evaluate()).toBe(value)
    expect(alias.evaluate().jsValue).toBe(3)
  })
})

describe('TR.BlockScope', () => {
  test('creates child scopes that can shadow parent declarations', () => {
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

    expect(result.value).toBe('child')
    expect(parent['Name'].evaluate().jsValue).toBe('parent')
    expect(Object.getPrototypeOf(result.child)).toBe(parent)
  })
})
