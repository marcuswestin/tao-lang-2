import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('TR Scheme environment', () => {
  Test('resolves scenario, preference, and System in precedence order', () => {
    Expect(TR.Scheme.resolve(
      { appearance: 'light', scenario: 'dark' },
      { platform: 'web', system: 'light' },
    )).toEqual({
      capability: 'reactive-browser',
      requested: 'dark',
      resolved: 'dark',
      source: 'scenario',
    })
    Expect(TR.Scheme.resolve(
      { appearance: 'dark' },
      { platform: 'web', system: 'light' },
    )).toEqual({
      capability: 'reactive-browser',
      requested: 'dark',
      resolved: 'dark',
      source: 'preference',
    })
    Expect(TR.Scheme.resolve(
      { appearance: 'system' },
      { platform: 'web', system: 'dark' },
    )).toEqual({
      capability: 'reactive-browser',
      requested: 'system',
      resolved: 'dark',
      source: 'system',
    })
  })

  Test('keeps cells independent and reports the explicit fixed-Light native boundary', () => {
    const first = TR.Scheme.resolve({ scenario: 'dark' }, { platform: 'web', system: 'light' })
    const second = TR.Scheme.resolve({ appearance: 'system' }, { platform: 'web', system: 'light' })
    const native = TR.Scheme.resolve({ scenario: 'dark' }, { platform: 'native', system: 'dark' })

    Expect(first.resolved).toBe('dark')
    Expect(second.resolved).toBe('light')
    Expect(native).toEqual({
      capability: 'fixed-light-native',
      requested: 'dark',
      resolved: 'light',
      source: 'native-fixed',
    })
  })

  Test('replay freezes the captured resolution and promotion pins that resolved frame', () => {
    const captured = TR.Scheme.resolve(
      { appearance: 'system' },
      { platform: 'web', system: 'dark' },
    )
    const replayed = TR.Scheme.resolve(
      { appearance: 'light', replay: captured, scenario: 'light' },
      { platform: 'native', system: 'light' },
    )

    Expect(replayed).toBe(captured)
    Expect(replayed).toEqual({
      capability: 'reactive-browser',
      requested: 'system',
      resolved: 'dark',
      source: 'system',
    })
    Expect(TR.Scheme.appearancePin(replayed)).toBe('dark')
  })

  Test('rejects replay snapshots that claim an impossible native resolution', () => {
    Expect(() =>
      TR.Scheme.resolve({
        replay: {
          capability: 'fixed-light-native',
          requested: 'dark',
          resolved: 'dark',
          source: 'native-fixed',
        },
      }, { platform: 'web', system: 'light' })
    ).toThrow('snapshot is invalid')
  })
})
