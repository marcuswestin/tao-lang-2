import type TR from '@runtime/TR'

/** MemoryProvider keeps full datasource snapshots in one isolated provider instance. */
export function MemoryProvider(): TR.DataProvider {
  const snapshots = new Map<string, string>()
  return {
    connect: context => ({
      load: () => snapshots.get(context.storageKey),
      reset: () => {
        snapshots.delete(context.storageKey)
      },
      save: snapshot => {
        snapshots.set(context.storageKey, snapshot)
      },
    }),
  }
}
