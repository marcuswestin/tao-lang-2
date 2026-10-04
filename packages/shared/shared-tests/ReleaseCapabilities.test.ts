import { Describe, Expect, Test } from '@shared/test'
import { ReleaseCapabilities } from '../shared-src/ReleaseCapabilities'

Describe('release capability catalog', () => {
  Test('phases accumulate shipped capabilities and never enable deferred ones', () => {
    const expected = [
      ['core'],
      ['core', 'http-data', 'ios-simulator'],
      ['core', 'http-data', 'ios-simulator', 'advanced-design', 'studio'],
      ['core', 'http-data', 'ios-simulator', 'advanced-design', 'studio', 'companion', 'cloudkit'],
      ['core', 'http-data', 'ios-simulator', 'advanced-design', 'studio', 'companion', 'cloudkit', 'ship'],
    ]
    for (const phase of [1, 2, 3, 4, 5] as const) {
      const profile = ReleaseCapabilities.profile(phase)
      const allowed = Object.keys(ReleaseCapabilities.catalog).filter(capability =>
        ReleaseCapabilities.allows(capability as keyof typeof ReleaseCapabilities.catalog, profile)
      )
      Expect(allowed).toEqual(expected[phase - 1])
      Expect(Object.isFrozen(profile)).toBe(true)
    }
    Expect(ReleaseCapabilities.allows('auth', ReleaseCapabilities.profile('development'))).toBe(true)
    Expect(ReleaseCapabilities.fingerprint(ReleaseCapabilities.profile(1))).not.toBe(
      ReleaseCapabilities.fingerprint(ReleaseCapabilities.profile(2)),
    )
  })

  Test('package matching respects path boundaries', () => {
    Expect(ReleaseCapabilities.packageCapability('@tao/data/providers/http')).toBe('http-data')
    Expect(ReleaseCapabilities.packageCapability('/stdlib/@tao/data/providers/instantdb/InstantDB.tao')).toBe(
      'hosted-data',
    )
    Expect(ReleaseCapabilities.packageCapability('@tao/auth/local')).toBe('auth')
    Expect(ReleaseCapabilities.packageCapability('@tao/authors')).toBe('core')
    Expect(ReleaseCapabilities.packageCapability('@tao/data/providers/local/Local.tao')).toBe('core')
    Expect(() => ReleaseCapabilities.require('android', ReleaseCapabilities.profile(5))).toThrow(
      'Android is unavailable',
    )
  })

  Test('experimental entry points and auth pairing syntax stay deferred in every public phase', () => {
    const phase5 = ReleaseCapabilities.profile(5)
    for (
      const capability of [
        ReleaseCapabilities.commandCapability('bridge'),
        ReleaseCapabilities.commandCapability('secrets'),
        ReleaseCapabilities.commandCapability('instantdb'),
        ReleaseCapabilities.targetCapability('visionos'),
        ReleaseCapabilities.targetCapability('watchos'),
        ReleaseCapabilities.syntaxCapability('ConfigurationAccepts'),
        ReleaseCapabilities.keywordCapability('ConfigurationIssues', 'issues'),
      ]
    ) {
      Expect(ReleaseCapabilities.allows(capability, phase5)).toBe(false)
    }
    Expect(ReleaseCapabilities.commandCapability('run')).toBe('core')
    Expect(ReleaseCapabilities.commandCapability('dev')).toBe('unclassified')
    Expect(ReleaseCapabilities.optionCapability('run', '--device')).toBe('companion')
    Expect(ReleaseCapabilities.optionCapability('_preview qa', '--device')).toBe('studio')
  })
})
