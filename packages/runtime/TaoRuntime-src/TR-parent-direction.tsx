import React from 'react'
import { createElement } from './TR-create-element'
import type { TaoLayoutDirection, TaoLayoutProps } from './TR-layout'

type ProviderProps = {
  children?: React.ReactNode
  direction?: TaoLayoutDirection
}

const defaultProps = { parentDirection: 'column' } as const satisfies TaoLayoutProps
const ReactParentDirectionContext = React.createContext<TaoLayoutDirection | undefined>(undefined)

/** ParentDirectionContext owns ambient runtime layout direction propagation. */
export const ParentDirectionContext = {
  Provider: ParentDirectionProvider,
  childrenForLayoutParent,
  defaultProps,
  propsForDirection,
  propsWithDefault,
  use,
} as const

function ParentDirectionProvider(props: ProviderProps): React.ReactElement {
  return props.direction
    ? createElement(ReactParentDirectionContext.Provider, { value: props.direction }, props.children)
    : createElement(React.Fragment, null, props.children)
}

function use(): TaoLayoutDirection | undefined {
  return React.useContext(ReactParentDirectionContext)
}

function propsForDirection(direction: TaoLayoutDirection | undefined): TaoLayoutProps | undefined {
  return direction ? { parentDirection: direction } : undefined
}

function propsWithDefault(props: TaoLayoutProps | undefined): TaoLayoutProps {
  return props
    ? { ...props, callerProps: appendCallerProps(props.callerProps, defaultProps) }
    : defaultProps
}

function appendCallerProps(props: TaoLayoutProps | undefined, callerProps: TaoLayoutProps): TaoLayoutProps {
  if (!props) {
    return callerProps
  }
  return {
    ...props,
    callerProps: appendCallerProps(props.callerProps, callerProps),
  }
}

function childrenForLayoutParent(children: React.ReactNode, style: unknown): React.ReactNode {
  const direction = directionFromStyle(style)
  return direction
    ? createElement(ParentDirectionProvider, { direction }, children)
    : children
}

function directionFromStyle(style: unknown): TaoLayoutDirection | undefined {
  if (Array.isArray(style)) {
    let direction: TaoLayoutDirection | undefined
    for (const item of style) {
      direction = directionFromStyle(item) ?? direction
    }
    return direction
  }
  if (!style || typeof style !== 'object') {
    return undefined
  }
  return layoutDirection((style as { flexDirection?: unknown }).flexDirection)
}

function layoutDirection(value: unknown): TaoLayoutDirection | undefined {
  return value === 'column' || value === 'row' ? value : undefined
}
