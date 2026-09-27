import type TR from '@runtime/TR'
import { Assert } from '@shared/core'

/** MemoryProvider keeps full datasource snapshots in one isolated provider instance. */
export function MemoryProvider(): TR.DataProvider {
  const snapshots = new Map<string, string>()
  return {
    /** Memory enforces nothing, so it holds an account only for TestAuth's deterministic identities. */
    authenticate: async context => {
      Assert.input(
        context.testing === true,
        `Memory cannot enforce authenticated account access for ${context.provider}. Use an authenticated server provider, or Memory with TestAuth.`,
      )
      const proof = await context.proof('TestIdentity', context.signal)
      return { accountId: proof.accountId }
    },
    connect: context => ({
      load: () => snapshots.get(context.storageKey),
      referenceToken: reference => reference.id,
      reset: () => {
        snapshots.delete(context.storageKey)
      },
      resolveReference: reference => reference.token,
      save: snapshot => {
        snapshots.set(context.storageKey, snapshot)
      },
    }),
  }
}
