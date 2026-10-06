import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { CiGateAdmission } from '../verification-src/CiGateAdmission'

const GATES = ['_fix-dprint', 'studio-smoke', 'ship-bundle-proof', 'studio-canary']

Describe('CI host gate admission', () => {
  Test('admits every gate when no host selection is supplied', () => {
    Expect(CiGateAdmission.select(GATES)).toEqual({ gates: GATES, skipped: [] })
  })

  Test('keeps portable gates and selected host gates in canonical order', () => {
    Expect(CiGateAdmission.select(GATES, 'studio-canary,studio-smoke')).toEqual({
      gates: ['_fix-dprint', 'studio-smoke', 'ship-bundle-proof', 'studio-canary'],
      skipped: [],
    })
  })

  Test('an empty selection admits no host gates and reports each omitted gate', () => {
    Expect(CiGateAdmission.select(GATES, '')).toEqual({
      gates: ['_fix-dprint', 'ship-bundle-proof'],
      skipped: [
        'studio-smoke=Pending CI host admission',
        'studio-canary=Pending CI host admission',
      ],
    })
  })

  Test('rejects a name outside the lane gate list', () => {
    Expect(() => CiGateAdmission.select(GATES, 'studio-smoke-native')).toThrow(Errors.UserInputError)
  })

  Test('rejects a canonical gate that is not a host gate', () => {
    Expect(() => CiGateAdmission.select(GATES, '_fix-dprint')).toThrow(Errors.UserInputError)
  })

  Test('rejects duplicate host gate names', () => {
    Expect(() => CiGateAdmission.select(GATES, 'studio-smoke,studio-smoke')).toThrow(Errors.UserInputError)
  })
})
