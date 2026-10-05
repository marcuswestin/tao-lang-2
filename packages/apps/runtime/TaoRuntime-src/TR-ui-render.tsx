import type { ComponentType, ReactElement, ReactNode } from 'react'
import { createElement } from './TR-create-element'
import type { TaoRuntimeValueInput } from './TR-reactive-values'

/** renderTextValue omits bare empty text while retaining the existing Text view for present values. */
export function renderTextValue<ValueT extends TaoRuntimeValueInput<string>>(
  value: ValueT,
  render: (value: ValueT) => ReactNode,
): ReactNode {
  return value.evaluate().jsValue === '' ? null : render(value)
}

/** mountUiComponent receives the selected component and fully bound props from the shared witness planner. */
export function mountUiComponent<PropsT extends object>(
  component: ComponentType<PropsT>,
  props: PropsT,
): ReactElement<PropsT> {
  return createElement(component, props)
}
