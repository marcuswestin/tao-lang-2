import type React from 'react'

/** ReactNativeRuntime declares the RN component set used by Tao runtime rendering. */
export type ReactNativeRuntime = {
  AccessibilityInfo?: {
    addEventListener?(event: 'reduceTransparencyChanged', handler: (enabled: boolean) => void): { remove(): void }
    isReduceTransparencyEnabled?(): Promise<boolean>
    sendAccessibilityEvent(host: object, eventType: 'focus'): void
  }
  ActivityIndicator: React.ComponentType<any>
  Appearance?: {
    getColorScheme(): 'dark' | 'light' | null | undefined
    addChangeListener(handler: () => void): { remove(): void }
  }
  AppState?: {
    addEventListener(event: 'change', handler: (state: string) => void): { remove(): void }
    currentState: string
  }
  BackHandler?: {
    addEventListener(event: 'hardwareBackPress', handler: () => boolean): { remove(): void }
  }
  Dimensions?: {
    get(name: string): { height?: number; width?: number }
  }
  Image: React.ComponentType<any>
  KeyboardAvoidingView: React.ComponentType<any>
  Linking?: {
    openURL(url: string): Promise<any>
  }
  LogBox?: { ignoreAllLogs(ignore?: boolean): void }
  Modal?: React.ComponentType<any>
  TouchableOpacity?: any
  StatusBar?: any
  RefreshControl?: any
  FlatList?: any
  Platform?: { OS: string; isMacCatalyst?: boolean }
  PlatformColor?: (...names: string[]) => unknown
  Pressable: React.ComponentType<any>
  ScrollView: React.ComponentType<any>
  Switch: React.ComponentType<any>
  Text: React.ComponentType<any>
  TextInput: React.ComponentType<any>
  View: React.ComponentType<any>
}

/** requireReactNativeRuntime returns the React Native module used by Tao runtime rendering. */
export function requireReactNativeRuntime(): ReactNativeRuntime {
  return require('react-native') as ReactNativeRuntime
}
