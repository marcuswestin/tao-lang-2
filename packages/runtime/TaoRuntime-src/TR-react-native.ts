import type React from 'react'

/** ReactNativeRuntime declares the RN component set used by Tao runtime rendering. */
export type ReactNativeRuntime = {
  Dimensions?: {
    get(name: string): { height?: number; width?: number }
  }
  KeyboardAvoidingView: React.ComponentType<any>
  Platform?: { OS: string }
  ScrollView: React.ComponentType<any>
  View: React.ComponentType<any>
  Text: React.ComponentType<any>
  Pressable: React.ComponentType<any>
  TextInput: React.ComponentType<any>
}

/** requireReactNativeRuntime returns the React Native module used by Tao runtime rendering. */
export function requireReactNativeRuntime(): ReactNativeRuntime {
  return require('react-native') as ReactNativeRuntime
}
