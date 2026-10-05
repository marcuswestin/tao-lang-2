import { Assert } from '@shared'
import type { NativeApiSource } from './native-api'
import { type NativeCallbackContract, type NativeGenericContract, readTypeScriptApi } from './typescript-api-source'
import { expoDeferred, expoOperations, standardOperations } from './typescript-native-contracts'

// The standard FormData traversal calls each callback during the forEach invocation.
// Pin the declaration owner so unrelated user classes cannot acquire this contract.
const standardCallbacks: readonly NativeCallbackContract[] = [
  {
    packageName: 'typescript',
    declaration: 'lib/lib.dom.d.ts',
    typeName: 'FormData',
    member: 'forEach',
    lifetime: 'call',
  },
  { packageName: 'bun-types', declaration: 'globals.d.ts', typeName: 'FormData', member: 'forEach', lifetime: 'call' },
  {
    packageName: 'undici-types',
    declaration: 'formdata.d.ts',
    typeName: 'FormData',
    member: 'forEach',
    lifetime: 'call',
  },
]

// Reflect the finite byte-view specializations reached by the imported API graph.
const standardGenerics: readonly NativeGenericContract[] = [{
  packageName: 'typescript',
  declaration: 'lib/lib.dom.d.ts',
  typeName: 'ReadableStream',
  member: 'pipeThrough',
  bindings: { T: 'receiver-element' },
}, {
  packageName: 'typescript',
  declaration: 'lib/lib.dom.d.ts',
  typeName: 'ReadableStreamBYOBReader',
  member: 'read',
  bindings: { T: 'reached-byte-view' },
}]

/** ExpoApiSource imports the public module surface of an installed Expo package. */
export const ExpoApiSource: NativeApiSource = {
  name: 'expo',
  read: request =>
    readTypeScriptApi(
      'expo',
      request,
      [
        { packageName: 'expo-modules-core', typeName: 'EventSubscription', disposal: 'remove' },
        {
          packageName: 'expo-file-system',
          typeName: 'WatchSubscription',
          declaration: 'build/FileSystemWatcher.types.d.ts',
          disposal: 'remove',
        },
      ],
      standardCallbacks,
      standardGenerics,
      [...standardOperations, ...expoOperations],
      expoDeferred,
    ),
}

/** ReactNativeApiSource imports one public React Native object, retaining its method receiver. */
export const ReactNativeApiSource: NativeApiSource = {
  name: 'react-native',
  read(request) {
    Assert.input(request.packageName === 'react-native', 'The React Native source requires package react-native.')
    Assert.input(request.exportName !== undefined, 'Select a public React Native export, such as Vibration.')
    return readTypeScriptApi('react-native', request, [], standardCallbacks, standardGenerics, standardOperations)
  },
}
