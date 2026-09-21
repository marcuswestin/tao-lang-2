import { Describe, Expect, Test } from '@shared/test'
import { hostSessionTargetLeaseName } from '../host-control-src/session/HostSessionTarget'

Describe('host session targets', () => {
  Test('names every shared host target in one driver-neutral namespace', () => {
    Expect(hostSessionTargetLeaseName({ id: 'emulator-5554', kind: 'androidEmulator' })).toBe(
      'android-emulator:emulator-5554',
    )
    Expect(hostSessionTargetLeaseName({ id: 'context-1', kind: 'browserContext' })).toBe(
      'browser-context:context-1',
    )
    Expect(hostSessionTargetLeaseName({ id: 'iphone-1', kind: 'iosDevice' })).toBe('ios-device:iphone-1')
    Expect(hostSessionTargetLeaseName({ id: 'simulator-1', kind: 'iosSimulator' })).toBe(
      'ios-simulator:simulator-1',
    )
  })
})
