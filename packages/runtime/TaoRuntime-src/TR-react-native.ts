import type React from 'react'

/** ReactNativeRuntime declares the RN component set used by Tao runtime rendering. */
export type ReactNativeRuntime = {
  ActivityIndicator: React.ComponentType<any>
  BackHandler?: {
    addEventListener(event: 'hardwareBackPress', handler: () => boolean): { remove(): void }
  }
  Dimensions?: {
    get(name: string): { height?: number; width?: number }
  }
  Image: React.ComponentType<any>
  KeyboardAvoidingView: React.ComponentType<any>
  Modal?: React.ComponentType<any>
  TouchableOpacity?: any
  StatusBar?: any
  RefreshControl?: any
  FlatList?: any
  Platform?: { OS: string }
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
