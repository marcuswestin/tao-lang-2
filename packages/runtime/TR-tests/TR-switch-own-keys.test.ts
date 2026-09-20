import { Describe, Expect, Test } from '@shared/test'
import { StudioDeviceProtocol } from '../TaoRuntime-src/TR-studio-device-protocol'
import RuntimeSwitch from '../TaoRuntime-src/TR-switch'

Describe('RuntimeSwitch reads its own keys only', () => {
  Test('a wire message typed as an inherited Object member is unhandled, not dispatched', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      Expect(() => RuntimeSwitch.type({ type } as { type: 'known' }, { known: () => 'handled' }))
        .toThrow('Unhandled runtime switch value')
    }
  })

  Test('a device-protocol frame typed as an inherited Object member is not a message', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      Expect(StudioDeviceProtocol.parseClearMessage({ evil: 'payload', type })).toBeUndefined()
    }
  })
})
