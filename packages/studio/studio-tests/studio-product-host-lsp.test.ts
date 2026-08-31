import { Expect, Test } from '@shared/test'
import type { StudioLspTransport } from '../studio-src/client/StudioApiClient'
import { StudioProductHostLspLifecycle } from '../studio-src/StudioProductHostLsp'

Test('Studio ProductHost LSP lifecycle connects lazily and closes its resolved transport', async () => {
  let connects = 0
  let closes = 0
  const lifecycle = new StudioProductHostLspLifecycle(async () => {
    connects += 1
    return transport(() => closes += 1)
  })

  Expect(connects).toBe(0)
  Expect(await lifecycle.open()).toBeDefined()
  Expect(connects).toBe(1)
  lifecycle.close()
  lifecycle.close()
  Expect(closes).toBe(1)
})

Test('Studio ProductHost LSP lifecycle closes a transport that resolves after disposal', async () => {
  let cancels = 0
  let closes = 0
  let resolve!: (transport: StudioLspTransport) => void
  const lifecycle = new StudioProductHostLspLifecycle(
    () =>
      new Promise<StudioLspTransport>(promiseResolve => {
        resolve = promiseResolve
      }),
    () => cancels += 1,
  )

  const opening = lifecycle.open()
  lifecycle.close()
  resolve(transport(() => closes += 1))

  Expect(await opening).toBeUndefined()
  Expect(cancels).toBe(1)
  Expect(closes).toBe(1)
})

function transport(close: () => void): StudioLspTransport {
  return {
    close,
    send() {},
    subscribe() {},
    unsubscribe() {},
  }
}
