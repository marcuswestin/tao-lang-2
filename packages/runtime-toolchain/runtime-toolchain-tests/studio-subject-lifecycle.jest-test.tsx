import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import { RuntimeAppDefinition } from '@runtime/TR-navigation-app'
import { Describe, Expect, Test } from '@shared/test'
import { act, render } from '@testing-library/react-native'
import React from 'react'

Describe('Studio synthetic app commit lifecycle', () => {
  Test('survives the StrictMode effect replay and disposes only after the real unmount', async () => {
    const committed = jest.spyOn(RuntimeAppDefinition.prototype, 'commitRegistration')
    const disposed = jest.spyOn(RuntimeAppDefinition.prototype, 'dispose')
    const home = TR.Navigation.View({ name: 'Strict Home', render: () => null })
    const slot = TR.Navigation.Declaration('Strict Slot', TR.NavKind.Slot())
    const screen = render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(TR.Studio.SubjectHost, {
          arguments: {},
          definition: () => ({
            auxiliaries: () => ({}),
            name: 'Strict Subject',
            navigator: () => TR.Navigation.Configure(slot, { Initial: home }),
            restoration: { exclusions: [], mode: 'fresh' as const, variant: 'studio-subject' },
          }),
        }),
      ),
    )

    try {
      Expect(committed).toHaveBeenCalledTimes(2)
      Expect(disposed).not.toHaveBeenCalled()
      screen.unmount()
      await act(async () => await Promise.resolve())
      Expect(disposed).toHaveBeenCalledTimes(1)
    } finally {
      committed.mockRestore()
      disposed.mockRestore()
    }
  })
})
