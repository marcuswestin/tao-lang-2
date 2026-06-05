import TR from '@runtime/TR'
import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'

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

describe('TR views', () => {
  test('creates typed view components and render elements', () => {
    const parameters = TR.ViewParameterList({ Label: 'text' })
    const Label = TR.UiDeclaration(
      'Label',
      parameters,
      _ViewProps => TR.ViewBlock(_ViewProps, () => _ViewProps.Label.evaluate().jsValue),
    )
    const label = new TR.Value('Hello')

    const element = TR.Render(Label, TR.RenderProps({ Label: label })) as ReactElement<{ Label: TR.Value<string> }>

    expect(Label.displayName).toBe('Label')
    expect(element.type).toBe(Label)
    expect(element.props['Label']).toBe(label)
  })

  test('uses children when a view block renders no elements', () => {
    expect(TR.ViewBlock({ children: 'Fallback' }, () => [])).toBe('Fallback')
    expect(TR.RenderChildren(() => [])).toBeNull()
  })
})
