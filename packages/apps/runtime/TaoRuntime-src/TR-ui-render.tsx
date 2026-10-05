import type { ComponentType, ReactElement, ReactNode } from 'react'
import { createElement } from './TR-create-element'
import type { TaoRuntimeValueInput } from './TR-reactive-values'
import { RenderSlotFrame, type TaoSlotRenderer } from './TR-render-slots'
import type { TaoProps } from './TR-TaoProps'

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

/** mountKeyedSlotRow mounts one previously selected row body under its stable occurrence key. */
export function mountKeyedSlotRow<Args>(
  row: Readonly<{ key: string; args: Args; taoProps?: TaoProps }>,
  renderer: TaoSlotRenderer<Args> | null,
): ReactElement {
  return createElement(RenderSlotFrame<Args>, {
    key: row.key,
    args: row.args,
    taoProps: row.taoProps,
    renderer,
  })
}
