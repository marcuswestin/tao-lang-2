import React from 'react'

export type TaoStatusBarStyle = 'dark-content' | 'default' | 'light-content'

export type TaoStatusBarProps = {
  animated?: boolean
  backgroundColor?: string
  hidden?: boolean
  style?: string
}

type ReactNativeStatusBarModule = {
  StatusBar: React.ComponentType<Record<string, unknown>>
}

/** StatusBar exposes React Native status-bar rendering helpers. */
export const StatusBar = {
  /** Bar renders a React Native StatusBar with normalized props. */
  Bar(props: TaoStatusBarProps = {}): React.JSX.Element {
    const RN = requireReactNativeStatusBar()
    return React.createElement(RN.StatusBar, {
      animated: props.animated,
      backgroundColor: props.backgroundColor,
      barStyle: statusBarStyle(props.style),
      hidden: props.hidden,
    })
  },

  /** style normalizes supported React Native status-bar styles. */
  style(style: string | undefined): TaoStatusBarStyle {
    return statusBarStyle(style)
  },
} as const

function statusBarStyle(style: string | undefined): TaoStatusBarStyle {
  return style === 'dark-content' || style === 'light-content' ? style : 'default'
}

function requireReactNativeStatusBar(): ReactNativeStatusBarModule {
  return require('react-native') as ReactNativeStatusBarModule
}
