import React from 'react'
import { StyleRuntime } from './TR-style'

export type TaoRefreshAction = {
  invoke(): void
}

export type TaoRefreshControlProps = {
  action?: TaoRefreshAction
  color?: string
  enabled?: boolean
  refreshing?: boolean
  title?: string
}

type ReactNativeRefreshControlModule = {
  RefreshControl: React.ComponentType<Record<string, unknown>>
}

/** RefreshControl exposes React Native pull-to-refresh helpers. */
export const RefreshControl = {
  /** action adapts refresh work into a RefreshControl-compatible action. */
  action(refresh: () => void): TaoRefreshAction {
    return {
      invoke() {
        refresh()
      },
    }
  },

  /** Control renders a React Native RefreshControl with Tao defaults. */
  Control(props: TaoRefreshControlProps): React.JSX.Element {
    const RN = requireReactNativeRefreshControl()
    const palette = StyleRuntime.usePalette()
    const tintColor = props.color ?? palette.accent
    return React.createElement(RN.RefreshControl, {
      colors: [tintColor],
      enabled: props.enabled !== false,
      onRefresh: callback(props.action),
      refreshing: props.refreshing === true,
      tintColor,
      title: props.title,
      titleColor: palette.mutedText,
    })
  },

  /** refreshing normalizes refresh-control busy state. */
  refreshing(value: unknown): boolean {
    return value === true
  },
} as const

function callback(action: TaoRefreshControlProps['action']): (() => void) | undefined {
  if (!action) {
    return undefined
  }
  return () => action.invoke()
}

function requireReactNativeRefreshControl(): ReactNativeRefreshControlModule {
  return require('react-native') as ReactNativeRefreshControlModule
}
