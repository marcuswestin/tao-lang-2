import React from 'react'

export type TaoModalAnimation = 'fade' | 'none' | 'slide'
export type TaoModalPresentation = 'formSheet' | 'fullScreen' | 'overFullScreen' | 'pageSheet'

export type TaoModalAction = {
  invoke(): void
}

export type TaoModalProps = {
  animation?: string
  children?: React.ReactNode
  onDismiss?: TaoModalAction
  onRequestClose?: TaoModalAction
  presentation?: string
  transparent?: boolean
  visible?: boolean
}

type ReactNativeModalModule = {
  Modal: React.ComponentType<Record<string, unknown>>
}

/** Modal exposes React Native modal overlay helpers. */
export const Modal = {
  /** action adapts modal lifecycle work into a Modal-compatible action. */
  action(work: () => void): TaoModalAction {
    return {
      invoke() {
        work()
      },
    }
  },

  /** Root renders a React Native modal with normalized props. */
  Root(props: TaoModalProps): React.JSX.Element {
    const RN = requireReactNativeModal()
    return React.createElement(
      RN.Modal,
      {
        animationType: animation(props.animation),
        onDismiss: callback(props.onDismiss),
        onRequestClose: callback(props.onRequestClose),
        presentationStyle: presentation(props.presentation),
        transparent: props.transparent === true,
        visible: props.visible === true,
      },
      props.children,
    )
  },

  /** animation normalizes supported React Native modal animation types. */
  animation,

  /** presentation normalizes supported React Native modal presentation styles. */
  presentation,
} as const

function animation(value: string | undefined): TaoModalAnimation {
  return value === 'fade' || value === 'slide' ? value : 'none'
}

function presentation(value: string | undefined): TaoModalPresentation {
  return value === 'formSheet' || value === 'overFullScreen' || value === 'pageSheet' ? value : 'fullScreen'
}

function callback(action: TaoModalProps['onDismiss']): (() => void) | undefined {
  if (!action) {
    return undefined
  }
  return () => action.invoke()
}

function requireReactNativeModal(): ReactNativeModalModule {
  return require('react-native') as ReactNativeModalModule
}
