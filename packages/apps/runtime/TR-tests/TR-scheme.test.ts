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

  Test('pins native scenarios and follows device appearance in shipped apps', () => {
    // A scenario's appearance is part of the scenario, so a device running that cell renders it.
    // `devices:tabletDark` declares dark and used to arrive on the phone in Light.
    Expect(TR.Scheme.resolve({ scenario: 'dark' }, { platform: 'native', system: 'light' })).toEqual({
      capability: 'pinned-native',
      requested: 'dark',
      resolved: 'dark',
      source: 'scenario',
    })

    Expect(TR.Scheme.resolve({ appearance: 'system' }, { platform: 'native', system: 'dark' })).toEqual({
      capability: 'reactive-native',
      requested: 'system',
      resolved: 'dark',
      source: 'system',
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

  Test('Catalyst follows System and keeps a scenario reactive', () => {
    const environment = { platform: 'catalyst', system: 'dark' } as const
    const captured = TR.Scheme.resolve({}, environment)
    Expect(captured).toEqual({
      capability: 'reactive-catalyst',
      requested: 'system',
      resolved: 'dark',
      source: 'system',
    })
    Expect(TR.Scheme.resolve({ appearance: 'dark', scenario: 'light' }, environment)).toEqual({
      capability: 'reactive-catalyst',
      requested: 'light',
      resolved: 'light',
      source: 'scenario',
    })
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
