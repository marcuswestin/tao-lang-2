import { Describe, Expect, Test } from '@shared/test'
import {
  createHostTestEnvironment,
  type HostTestClock,
  HostTestControlError,
} from '../TaoRuntime-src/host-testing/HostTestEnvironment'
import { attachNativeHostTestControl } from '../TaoRuntime-src/host-testing/NativeHostTestControlCore'

Describe('Native host-test control receipts', () => {
  Test('publishes only after a valid control URL advances the matching environment', async () => {
    const clock = ownedClock()
    const environment = createHostTestEnvironment({ epochMs: 50, runId: 'native-receipt', seed: 9 }, clock.port)
    const received: Array<{ advanceMs: number | undefined; monotonicMs: number }> = []
    let listener: ((event: Readonly<{ url: string }>) => void) | undefined
    const control = attachNativeHostTestControl(environment, {
      addEventListener(_type, callback) {
        listener = callback
        return { remove() {} }
      },
      getInitialURL: async () => null,
    }, {
      onAdvance(snapshot) {
        received.push({ advanceMs: snapshot.lastControlAdvanceMs, monotonicMs: snapshot.monotonicMs })
      },
    })
    await control.ready

    Expect(() => control.receive('taohostpoc-native-receipt://control?runId=other&advanceMs=1000'))
      .toThrow(HostTestControlError)
    Expect(() => control.receive('taohostpoc-native-receipt://control?runId=native-receipt&advanceMs=-1'))
      .toThrow("Host-test advanceMs '-1' must be a decimal integer.")
    Expect(received).toEqual([])
    Expect(environment.snapshot()).toMatchObject({ monotonicMs: 0 })

    listener?.({ url: 'taohostpoc-native-receipt://control?runId=native-receipt&advanceMs=1000' })

    Expect(received).toEqual([{ advanceMs: 1_000, monotonicMs: 1_000 }])
    Expect(environment.snapshot()).toMatchObject({ lastControlAdvanceMs: 1_000, monotonicMs: 1_000 })
    control.dispose()
    environment.dispose()
  })
})

function ownedClock(): Readonly<{ port: HostTestClock }> {
  let nowMs = 0
  return {
    port: {
      begin(epochMs: number): void {
        nowMs = epochMs
      },
      now(): number {
        return nowMs
      },
      advance(advanceMs: number): void {
        nowMs += advanceMs
      },
      end(): void {},
    },
  }
}
