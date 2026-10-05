import type { ReactNode } from 'react'
import type { TaoRuntimeValueInput } from './TR-reactive-values'

/** renderTextValue omits bare empty text while retaining the existing Text view for present values. */
export function renderTextValue<ValueT extends TaoRuntimeValueInput<string>>(
  value: ValueT,
  render: (value: ValueT) => ReactNode,
): ReactNode {
  return value.evaluate().jsValue === '' ? null : render(value)
}
