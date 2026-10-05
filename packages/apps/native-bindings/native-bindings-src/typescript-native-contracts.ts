import { maintainedNativeSources } from './maintained-native-sources'
import type { NativeApiCallbackOwnership, NativeApiEventControl, NativeApiImport } from './native-api'

type NativeDeclarationOwner = {
  packageName: string
  packageVersion?: string
  declaration: string
  typeName?: string
  member: string
}

export type NativeOperationContract = NativeDeclarationOwner & {
  pending?: true
  callbacks?: {
    parameter: string
    fields: string[]
    lifetime: NativeApiCallbackOwnership['lifetime']
  }[]
  callbackEffect?: 'cancel-receiver'
  event?: {
    kind: 'register' | 'remove' | 'property'
    listener: string
    protocolType: string
    callback?: string
    eventName?: string
    options?: string
    permittedControls: NativeApiEventControl[]
    returnContract: 'ignored'
  }
}

export type NativeDeferredContract = {
  packageName: string
  packageVersion: string
  declaration: string
  symbols: string[]
  disposition: NonNullable<NativeApiImport['defer']>[number]['disposition']
  reason: string
}

const nativeControls: NativeApiEventControl[] = ['preventDefault', 'stopPropagation', 'stopImmediatePropagation']

// DOM listener results are ignored by event dispatch. Controls apply to the raw Event before queued delivery.
export const standardOperations: readonly NativeOperationContract[] = [
  ...[{ typeName: 'AbortSignal', callback: 'listener' }, { typeName: 'EventTarget', callback: 'callback' }].flatMap((
    { typeName, callback },
  ) =>
    (['register', 'remove'] as const).map(kind => ({
      packageName: 'typescript',
      declaration: 'lib/lib.dom.d.ts',
      typeName,
      member: kind === 'register' ? 'addEventListener' : 'removeEventListener',
      event: {
        kind,
        listener: 'EventListener',
        protocolType: 'EventListenerOrEventListenerObject',
        callback,
        eventName: 'type',
        options: 'options',
        permittedControls: nativeControls,
        returnContract: 'ignored' as const,
      },
    }))
  ),
  {
    packageName: 'typescript',
    declaration: 'lib/lib.dom.d.ts',
    typeName: 'AbortSignal',
    member: 'onabort',
    event: {
      kind: 'property',
      listener: 'EventListener',
      protocolType: 'EventListenerOrEventListenerObject',
      permittedControls: nativeControls,
      returnContract: 'ignored',
    },
  },
]

// Pinned network task options retain callbacks until the returned task is cancelled or released.
export const expoOperations: readonly NativeOperationContract[] = [
  ...[
    {
      typeName: 'File',
      member: 'upload',
      declaration: 'build/File.d.ts',
      lifetime: { kind: 'promise' } as const,
      pending: true as const,
    },
    {
      typeName: 'File',
      member: 'downloadFileAsync',
      declaration: 'build/File.d.ts',
      lifetime: { kind: 'promise' } as const,
      pending: true as const,
    },
    {
      typeName: 'File',
      member: 'createUploadTask',
      declaration: 'build/File.d.ts',
      lifetime: { kind: 'resource', result: true } as const,
    },
    {
      typeName: 'File',
      member: 'createDownloadTask',
      declaration: 'build/File.d.ts',
      lifetime: { kind: 'resource', result: true } as const,
    },
    {
      typeName: 'UploadTask',
      member: 'constructor',
      declaration: 'build/NetworkTasks.d.ts',
      lifetime: { kind: 'resource', result: true } as const,
    },
    {
      typeName: 'DownloadTask',
      member: 'constructor',
      declaration: 'build/NetworkTasks.d.ts',
      lifetime: { kind: 'resource', result: true } as const,
    },
    {
      typeName: 'DownloadTask',
      member: 'fromSavable',
      declaration: 'build/NetworkTasks.d.ts',
      lifetime: { kind: 'resource', result: true } as const,
    },
  ].map(({ lifetime, ...operation }) => ({
    packageName: 'expo-file-system',
    packageVersion: '57.0.7',
    ...operation,
    callbacks: [{ parameter: 'options', fields: ['onProgress'], lifetime }],
  })),
  ...[
    { typeName: 'UploadTask', member: 'uploadAsync' },
    { typeName: 'DownloadTask', member: 'downloadAsync' },
    { typeName: 'DownloadTask', member: 'resumeAsync' },
    { typeName: 'DownloadTask', member: 'pauseAsync' },
  ].map(operation => ({
    packageName: 'expo-file-system',
    packageVersion: '57.0.7',
    declaration: 'build/NetworkTasks.d.ts',
    ...operation,
    pending: true as const,
  })),
  ...['UploadTask', 'DownloadTask'].flatMap(typeName =>
    ['release', 'cancel'].map(member => ({
      packageName: 'expo-file-system',
      packageVersion: '57.0.7',
      declaration: 'build/NetworkTasks.d.ts',
      typeName,
      member,
      callbackEffect: 'cancel-receiver' as const,
    }))
  ),
]

export const expoDeferred: readonly NativeDeferredContract[] = maintainedNativeSources.flatMap(source =>
  source.defer.map(({ symbol, declaration, disposition, reason }) => ({
    packageName: source.packageName,
    packageVersion: source.version,
    declaration,
    symbols: [symbol],
    disposition,
    reason,
  }))
)
