import { Errors } from '@shared/core'

/** ICloudDocumentObserver receives each distinct contents a watched document takes, or a failure. */
export type ICloudDocumentObserver = Readonly<{
  changed(contents: string | undefined): void
  failed(message: string): void
}>

/**
 * ICloudDocuments is the document boundary a Tao datasource provider drives: named documents in
 * the app's iCloud container, read and written whole, watched for changes made by any device on
 * the same iCloud account. An absent document reads as `undefined`.
 */
export type ICloudDocuments = {
  read(container: string | undefined, name: string): Promise<string | undefined>
  watch(container: string | undefined, name: string, observer: ICloudDocumentObserver): () => void
  write(container: string | undefined, name: string, contents: string): Promise<void>
}

/** ICloudDocumentChangedEvent is one native watch event; `contents` is null for a missing document. */
export type ICloudDocumentChangedEvent = {
  contents?: string | null
  error?: string
  watchId: string
}

/** TaoICloudNativeModule is the JavaScript face of the Swift `TaoICloud` module. */
export type TaoICloudNativeModule = {
  addListener(
    event: 'documentChanged',
    listener: (event: ICloudDocumentChangedEvent) => void,
  ): { remove(): void }
  readDocument(container: string | null, name: string): Promise<string | null>
  startWatching(watchId: string, container: string | null, name: string): Promise<void>
  stopWatching(watchId: string): Promise<void>
  writeDocument(container: string | null, name: string, contents: string): Promise<void>
}

const nativeModuleName = 'TaoICloud'

let nextWatchId = 0

/** iCloudDocumentsOver adapts one native module instance to the document boundary. */
export function iCloudDocumentsOver(native: TaoICloudNativeModule): ICloudDocuments {
  return {
    read: async (container, name) => (await hostCall(native.readDocument(container ?? null, name))) ?? undefined,
    watch: (container, name, observer) => {
      nextWatchId += 1
      const watchId = `watch-${nextWatchId}`
      let stopped = false
      const subscription = native.addListener('documentChanged', event => {
        if (stopped || event.watchId !== watchId) {
          return
        }
        if (event.error !== undefined) {
          observer.failed(event.error)
        } else {
          observer.changed(event.contents ?? undefined)
        }
      })
      native.startWatching(watchId, container ?? null, name).catch((error: unknown) => {
        if (!stopped) {
          observer.failed(Errors.messageOf(error))
        }
      })
      return () => {
        if (stopped) {
          return
        }
        stopped = true
        subscription.remove()
        void native.stopWatching(watchId).catch(() => undefined)
      }
    },
    write: (container, name, contents) => hostCall(native.writeDocument(container ?? null, name, contents)),
  }
}

/** hostCall classifies a rejected native call as the host-environment failure it is. */
async function hostCall<T>(call: Promise<T>): Promise<T> {
  try {
    return await call
  } catch (error) {
    return Errors.throwHostEnvironment(Errors.messageOf(error), { cause: error })
  }
}

/**
 * loadICloudDocuments binds the Swift module. It is called once per datasource connection rather
 * than at import time, so a bundle that never mounts an iCloud datasource never touches the
 * native side, and a platform without it fails at the mount with a host-environment error.
 */
export function loadICloudDocuments(): ICloudDocuments {
  let native: TaoICloudNativeModule | undefined
  let failure: unknown
  try {
    const expo = require('expo') as { requireNativeModule(name: string): TaoICloudNativeModule }
    native = expo.requireNativeModule(nativeModuleName)
  } catch (error) {
    failure = error
  }
  if (native === undefined) {
    Errors.throwHostEnvironment(
      'iCloud sync needs the Tao iCloud native module, which this build does not include: build the app for iOS with tao-icloud-native linked, or bind another datasource for this platform.',
      { cause: failure },
    )
  }
  return iCloudDocumentsOver(native)
}
