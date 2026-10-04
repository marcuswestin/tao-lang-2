import { Describe, Expect, Test } from '@shared/test'
import {
  captureActionHistory,
  onActionFailure,
  reportActionFailure,
  resetActionDiagnostics,
  TaoActionFailure,
} from '../TaoRuntime-src/TR-errors'
import { restoreRuntimeCapture, type TaoRuntimeJson } from '../TaoRuntime-src/TR-runtime-capture'

Describe('TR runtime capture', () => {
  Test('restores sanitized action diagnostics through the built-in domain', async () => {
    resetActionDiagnostics()
    const stopListening = onActionFailure(() => {})
    try {
      reportActionFailure(
        new TaoActionFailure('Unavailable', 'The service is unavailable.', 'The provider is offline.'),
        { externalEffects: false, frames: ['Save Note'] },
        'Save',
        ['visible', { password: 'hidden', title: 'Kept' }],
      )
    } finally {
      stopListening()
    }

    const actionHistory = captureActionHistory()
    Expect(actionHistory).toHaveLength(1)
    const capturedFailure = actionHistory[0]!
    Expect(capturedFailure).toMatchObject({
      action: 'Save',
      arguments: ['visible', { title: 'Kept' }],
      case: 'Unavailable',
      frames: ['Save Note'],
      message: 'The provider is offline.',
      retryEligible: true,
    })
    Expect(typeof capturedFailure.timestamp).toBe('number')

    resetActionDiagnostics()
    Expect(captureActionHistory()).toEqual([])
    await restoreRuntimeCapture({
      capturedAt: 1,
      domains: [{
        domain: 'action-history',
        value: actionHistory as TaoRuntimeJson,
        version: 1,
      }],
      version: 1,
    })
    Expect(captureActionHistory()).toEqual(actionHistory)
    resetActionDiagnostics()
  })
})
