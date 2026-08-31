import { DesignControls } from './TR-design'
import { LayoutControls, type TaoLayoutDirection, type TaoResolvedLayoutStyle } from './TR-layout'
import type { TaoProps } from './TR-TaoProps'

/** mountedDesignStyle resolves one host-owned element default through the nearest mounted app. */
export function mountedDesignStyle(
  props: TaoProps | undefined,
  elementDefault: string,
  direction?: TaoLayoutDirection,
): TaoResolvedLayoutStyle | undefined {
  const design = mountedApp(props)?.design
  const resolved = DesignControls.resolve(design, undefined, elementDefault)
  const layoutStyle = resolved.layout
    ? LayoutControls.resolve({ direction, entries: resolved.layout.entries })
    : undefined
  if (!layoutStyle && !resolved.style) {
    return undefined
  }
  return { ...layoutStyle, ...resolved.style }
}

function mountedApp(props: TaoProps | undefined): NonNullable<TaoProps['app']> | undefined {
  const visited = new Set<TaoProps>()
  let current = props
  while (current && !visited.has(current)) {
    if (current.app) {
      return current.app
    }
    visited.add(current)
    current = current.callerProps
  }
  return undefined
}
