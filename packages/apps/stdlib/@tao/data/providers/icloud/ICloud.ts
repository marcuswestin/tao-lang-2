import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import type { ICloudDocuments } from 'tao-icloud'
import { optionalConfigurationText } from '../provider-configuration'

const providerName = 'ICloud'

/**
 * ICloudProvider keeps each datasource's complete snapshot in one document of the app's iCloud
 * Drive container and publishes the document as a replacement snapshot whenever another device on
 * the same iCloud account rewrites it. iCloud keeps a local copy, so an offline launch loads the
 * last synced document and offline saves upload when the device reconnects.
 *
 * Concurrent writers are last-snapshot-wins, as with InstantDB: iCloud conflict versions collapse
 * to the newest one. The connection grants no `reset`, since wiping the document would erase the
 * account's other devices' rows as well.
 */
export function ICloudProvider(loadDocuments: () => ICloudDocuments = nativeDocuments): TR.DataProvider {
  return {
    connect: context => {
      const container = optionalConfigurationText(providerName, context, 'Container')
      const documents = loadDocuments()
      const name = documentName(context.storageKey)
      // The snapshot this connection most recently handed iCloud. It suppresses only echoes while
      // that remains the document's current history: once a different remote value arrives it is
      // cleared, so another device can later legitimately restore the same bytes.
      let lastWritten: string | undefined
      // Writes in flight, and whether the watch fired during one. The watch may read the document
      // between two back-to-back writes and report the earlier one after the later has been
      // recorded as `lastWritten`; publishing that would revert the store. So while a write is in
      // flight the watch only notes that something changed, and the connection re-reads the
      // document once the writes settle.
      let writesInFlight = 0
      let changedDuringWrite = false
      let publish: ((contents: string | undefined) => void) | undefined
      let stopWatch: (() => void) | undefined

      const settleAfterWrites = async (): Promise<void> => {
        if (writesInFlight > 0 || !changedDuringWrite) {
          return
        }
        changedDuringWrite = false
        try {
          publish?.(await documents.read(container, name))
        } catch (error) {
          warn(error)
        }
      }

      return {
        close: () => {
          stopWatch?.()
          stopWatch = undefined
        },
        load: () => documents.read(container, name),
        // The document round-trips row ids untouched, so identity tokens restore across relaunches
        // exactly as for the local snapshot providers.
        referenceToken: reference => reference.id,
        resolveReference: reference => reference.token,
        save: async snapshot => {
          lastWritten = snapshot
          writesInFlight += 1
          try {
            await documents.write(container, name, snapshot)
          } finally {
            writesInFlight -= 1
            await settleAfterWrites()
          }
        },
        subscribe: observer => {
          stopWatch?.()
          let active = true
          publish = contents => {
            if (!active) {
              return
            }
            // A missing document never reaches the store: nothing in this design deletes it, so an
            // absent item is iCloud's own bookkeeping mid-flight, never a request to drop rows.
            if (contents === undefined) {
              return
            }
            if (contents === lastWritten) {
              return
            }
            lastWritten = undefined
            observer.snapshot(contents)
          }
          const stop = documents.watch(container, name, {
            changed: contents => {
              if (writesInFlight > 0) {
                changedDuringWrite = true
                return
              }
              publish?.(contents)
            },
            failed: message => {
              if (active) {
                observer.error(new Errors.HostEnvironmentError(message))
              }
            },
          })
          const unsubscribe = (): void => {
            if (!active) {
              return
            }
            active = false
            publish = undefined
            if (stopWatch === unsubscribe) {
              stopWatch = undefined
            }
            stop()
          }
          stopWatch = unsubscribe
          return unsubscribe
        },
      }
    },
  }
}

/**
 * documentName keeps one document per storage key. The key is spelled safely for a file name and
 * suffixed with a hash of its exact text, so keys differing only by letter case stay distinct on a
 * case-insensitive volume.
 */
function documentName(storageKey: string): string {
  return `${encodeURIComponent(storageKey)}.${stableHash(storageKey)}.json`
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function warn(error: unknown): void {
  if (typeof console !== 'undefined') {
    console.warn('The iCloud document could not be re-read after a save; the next change will be published.', error)
  }
}

function nativeDocuments(): ICloudDocuments {
  const native = require('tao-icloud') as { loadICloudDocuments(): ICloudDocuments }
  return native.loadICloudDocuments()
}
