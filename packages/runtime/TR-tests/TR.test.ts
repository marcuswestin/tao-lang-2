import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { ReactElement } from 'react'

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
})

Describe('TR views', () => {
  Test('creates typed view components and render elements', () => {
    const parameters = TR.ViewParameterList({ Label: 'text' })
    const Label = TR.UiDeclaration(
      'Label',
      parameters,
      _ViewProps => TR.ViewBlock(_ViewProps, () => _ViewProps.Label.evaluate().jsValue),
    )
    const label = new TR.Value('Hello')

    const element = TR.Render(Label, TR.RenderProps({ Label: label })) as ReactElement<{ Label: TR.Value<string> }>

    Expect(Label.displayName).toBe('Label')
    Expect(element.type).toBe(Label)
    Expect(element.props['Label']).toBe(label)
  })

  Test('uses children when a view block renders no elements', () => {
    Expect(TR.ViewBlock({ children: 'Fallback' }, () => [])).toBe('Fallback')
    Expect(TR.RenderChildren(() => [])).toBeNull()
  })
})
