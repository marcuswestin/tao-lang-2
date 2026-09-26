import { Assert } from '@shared'
import type { NativeApiSource } from './native-api'
import { readTypeScriptApi } from './typescript-api-source'

/** ExpoApiSource imports the public module surface of an installed Expo package. */
export const ExpoApiSource: NativeApiSource = {
  name: 'expo',
  read: request => readTypeScriptApi('expo', request),
}

/** ReactNativeApiSource imports one public React Native object, retaining its method receiver. */
export const ReactNativeApiSource: NativeApiSource = {
  name: 'react-native',
  read(request) {
    Assert.input(request.packageName === 'react-native', 'The React Native source requires package react-native.')
    Assert.input(request.exportName !== undefined, 'Select a public React Native export, such as Vibration.')
    return readTypeScriptApi('react-native', request)
  },
}
