import type { ComponentType, ReactElement } from 'react'
import { RuntimeAssert } from './TR-assert'
import type { TaoRuntimeValueInput } from './TR-reactive-values'
import { mountUiComponent } from './TR-ui-render'

declare const renderedBrand: unique symbol
/** Rendered is an opaque description; constructing it never mounts its component. */
export type TaoRendered = Readonly<{ [renderedBrand]: true }>

type ViewDescription = Readonly<{
  component: ComponentType<any>
  props: Readonly<Record<string, unknown>>
}>
const descriptions = new WeakMap<TaoRendered, ViewDescription>()

/** Associated view witnesses preserve their real component and caller-bound receiver. */
export function describeRenderedView<PropsT extends object>(
  component: ComponentType<PropsT>,
  props: PropsT,
): TaoRendered {
  const rendered = Object.freeze({}) as TaoRendered
  descriptions.set(rendered, { component, props: Object.freeze({ ...props }) })
  return rendered
}

/** Occurrence metadata belongs to the mount, rather than to the capability call creating it. */
export function mountRenderedView(
  value: TaoRuntimeValueInput<TaoRendered>,
  occurrence: Readonly<Record<string, unknown>> = {},
): ReactElement {
  const rendered = value.evaluate().jsValue
  const description = descriptions.get(rendered)
  RuntimeAssert.input(description, 'This render requires content produced by a view.')
  return mountUiComponent(description.component, { ...description.props, ...occurrence })
}
