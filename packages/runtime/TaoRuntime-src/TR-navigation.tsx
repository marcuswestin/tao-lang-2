import React from 'react'

export type TaoNavigationRef = {
  canGoBack(): boolean
  goBack(): void
  isReady(): boolean
  navigate(name: string, params?: object): void
}

type ReactNavigationModule = {
  NavigationContainer: React.ComponentType<any>
  createNavigationContainerRef(): TaoNavigationRef
}

type NativeStackModule = {
  createNativeStackNavigator(): unknown
}

/** Navigation exposes React Navigation-backed app routing helpers. */
export const Navigation = {
  /** Container renders the React Navigation root container. */
  Container(props: { children?: React.ReactNode; ref?: TaoNavigationRef }): React.JSX.Element {
    const { NavigationContainer } = reactNavigation()
    return React.createElement(NavigationContainer, { ref: props.ref }, props.children)
  },

  /** createRef creates an imperative navigation reference for generated/injected app code. */
  createRef(): TaoNavigationRef {
    return reactNavigation().createNavigationContainerRef()
  },

  /** createNativeStack creates a native-stack navigator for generated/injected app code. */
  createNativeStack() {
    return nativeStack().createNativeStackNavigator()
  },

  /** navigate moves a ready navigation container to a named route. */
  navigate(ref: TaoNavigationRef, name: string, params?: object): void {
    if (ref.isReady()) {
      ref.navigate(name, params)
    }
  },

  /** back returns to the previous route when the container is ready. */
  back(ref: TaoNavigationRef): void {
    if (ref.isReady() && ref.canGoBack()) {
      ref.goBack()
    }
  },
} as const

function reactNavigation(): ReactNavigationModule {
  return require('@react-navigation/native') as ReactNavigationModule
}

function nativeStack(): NativeStackModule {
  return require('@react-navigation/native-stack') as NativeStackModule
}
