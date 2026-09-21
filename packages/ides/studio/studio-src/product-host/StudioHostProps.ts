import type TR from '@runtime/TR'
import type React from 'react'

/** The layout and tag every Tao-rendered host view receives. */
export type TaoStudioHostVisualProps = Readonly<{
  Layout?: Readonly<{ style?: React.CSSProperties }>
  Tag?: string
}>

export type TaoStudioHostAction = TR.ActionValue<[]>
export type TaoStudioHostTextAction = TR.ActionValue<[TR.Value<string>]>
export type TaoStudioHostNumberAction = TR.ActionValue<[TR.Value<number>]>
