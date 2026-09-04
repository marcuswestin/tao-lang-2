import { Describe, Expect, Test } from '@shared/test'
import {
  dispatchInteractionHardwareKey,
  interactionKeyFromHardwareEvent,
  normalizeInteractionKey,
} from '../TaoRuntime-src/TR-interaction-keys'

Describe('TR.Interaction key ingress', () => {
  Test('normalizes Tao strings and maps primary to the platform modifier', () => {
    Expect(normalizeInteractionKey(' primary + K ')).toBe('primary+k')
    Expect(interactionKeyFromHardwareEvent(
      { key: 'k', metaKey: true },
      { navigatorPlatform: 'MacIntel', platformOS: 'web' },
    )).toBe('primary+k')
    Expect(interactionKeyFromHardwareEvent(
      { ctrlKey: true, key: 'K' },
      { navigatorPlatform: 'Linux x86_64', platformOS: 'web' },
    )).toBe('primary+k')
    Expect(interactionKeyFromHardwareEvent(
      { ctrlKey: true, key: 'k' },
      { platformOS: 'ios' },
    )).toBe('control+k')
  })

  Test('uses the physical Slash key for unshifted hints and shifted question mark', () => {
    Expect(interactionKeyFromHardwareEvent({ code: 'Slash', key: 'Dead' })).toBe('/')
    Expect(interactionKeyFromHardwareEvent({ code: 'Slash', key: '/', shiftKey: true })).toBe('?')
  })

  Test('returns reducer handling without preventing or claiming unhandled input', () => {
    const keys: string[] = []
    Expect(dispatchInteractionHardwareKey(
      { code: 'Slash', key: '?' },
      key => {
        keys.push(key)
        return key === '/'
      },
    )).toBe(true)
    Expect(dispatchInteractionHardwareKey({ key: 'F7' }, () => false)).toBe(false)
    Expect(keys).toEqual(['/'])
  })
})
