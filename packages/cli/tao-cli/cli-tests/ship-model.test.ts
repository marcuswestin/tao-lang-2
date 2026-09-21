import { Describe, Expect, Test } from '@shared/test'
import {
  bumpShipVersion,
  decideShipVersion,
  deriveShipIdentity,
  nextBuildNumber,
  parseShipVersion,
  shipInputHash,
  timestampBuildNumber,
} from '../cli-src/ship-model'

Describe('tao ship pure derivation', () => {
  Test("accepts only Apple's numeric SemVer core", () => {
    Expect(parseShipVersion('1.2.3')).toBe('1.2.3')
    Expect(parseShipVersion('01.2.3')).toBeUndefined()
    Expect(parseShipVersion('1.2')).toBeUndefined()
    Expect(parseShipVersion('1.2.3-beta.1')).toBeUndefined()
  })

  Test('applies every version policy branch', () => {
    Expect(decideShipVersion('1.2.3', { consumed: false })).toEqual({ bumped: false, version: '1.2.3' })
    Expect(decideShipVersion('1.2.3', { consumed: true })).toEqual({ bumped: true, version: '1.2.4' })
    Expect(decideShipVersion('1.2.3', { consumed: false, forcedBump: 'minor' })).toEqual({
      bumped: true,
      version: '1.3.0',
    })
    Expect(bumpShipVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  Test('derives stable primary and variant identities by table', () => {
    const common = { namespace: 'app.tao', primaryAppName: 'WordFlower', projectId: 'wordflower' }
    Expect(deriveShipIdentity({ ...common, appName: 'WordFlower' })).toEqual({
      bundleIdentifier: 'app.tao.wordflower',
      channel: 'wordflower',
    })
    Expect(deriveShipIdentity({ ...common, appName: 'WordFlowerInstantDB' })).toEqual({
      bundleIdentifier: 'app.tao.wordflower.wordflowerinstantdb',
      channel: 'wordflower-wordflowerinstantdb',
      variant: 'wordflowerinstantdb',
    })
  })

  Test('allocates monotonically above same-minute local and remote build numbers', () => {
    Expect(timestampBuildNumber(new Date('2026-09-02T14:05:59Z'))).toBe('202609021405')
    Expect(nextBuildNumber('202609021405', [])).toBe('202609021405')
    Expect(nextBuildNumber('202609021405', ['202609021405', '202609021407'])).toBe('202609021408')
    Expect(nextBuildNumber('202609021405', ['not-a-number', '202609021404'])).toBe('202609021405')
  })

  Test('derives a stable input hash', () => {
    Expect(shipInputHash({ b: 2, a: 1 })).toBe(shipInputHash({ a: 1, b: 2 }))
    Expect(shipInputHash({ a: 1 })).not.toBe(shipInputHash({ a: 2 }))
  })
})
