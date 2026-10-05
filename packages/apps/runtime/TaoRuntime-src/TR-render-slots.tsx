import type React from 'react'
import { createElement } from './TR-create-element'
import type { TaoProps } from './TR-TaoProps'

const slotRendererBrand = Symbol('TaoSlotRenderer')

/** RenderSlotBodyProps carries current arguments, lexical captures and occurrence metadata into one body. */
export type RenderSlotBodyProps<Args, Environment> = Readonly<{
  args: Args
  environment: Environment
  taoProps?: TaoProps
}>

/** TaoSlotRenderer hides captures behind a hook-free, contravariant rendering operation. */
export type TaoSlotRenderer<Args> = Readonly<{
  [slotRendererBrand]: (args: Args, taoProps?: TaoProps) => React.ReactNode
}>

/** createSlotRenderer retains a stable body component and its lexical environment without executing either. */
export function createSlotRenderer<Args, Environment>(
  Body: React.ComponentType<RenderSlotBodyProps<Args, Environment>>,
  environment: Environment,
): TaoSlotRenderer<Args> {
  return {
    [slotRendererBrand]: (args, taoProps) => createElement(Body, { args, environment, taoProps }),
  }
}

/** selectRenderSlot distinguishes an absent supply from an explicit empty supply, preserving descriptor identity. */
export function selectRenderSlot<Renderer>(
  supplied: Readonly<Record<string, Renderer | null | undefined>> | undefined,
  name: string,
  fallback?: Renderer | null,
): Renderer | null {
  return supplied !== undefined && Object.hasOwn(supplied, name) ? supplied[name] ?? null : fallback ?? null
}

/** RenderSlotFrame mounts a body per placement; changing captures preserves its state, changing Body replaces it. */
export function RenderSlotFrame<Args>(
  props: Readonly<{
    renderer: TaoSlotRenderer<Args> | null
    args: Args
    taoProps?: TaoProps
  }>,
): React.ReactNode {
  return props.renderer === null ? null : props.renderer[slotRendererBrand](props.args, props.taoProps)
}
