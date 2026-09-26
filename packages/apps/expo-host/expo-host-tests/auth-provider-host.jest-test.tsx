import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { act, render } from '@testing-library/react-native'
import React from 'react'
import { Text } from 'react-native'

Describe('authentication provider host', () => {
  Test('wraps app content and auth presentation with the once-evaluated connection configuration', async () => {
    const ProviderContext = React.createContext('missing provider host')
    const hostConfigurations: Readonly<Record<string, unknown>>[] = []
    const connectionConfigurations: Readonly<Record<string, unknown>>[] = []
    let evaluations = 0
    let closes = 0
    let scope: TR.AuthScope | undefined
    const source = TR.Auth.Configure(
      TR.Auth.Declaration('Hosted', {
        Host: ({ configuration, children }) => {
          hostConfigurations.push(configuration)
          return TR.createElement(ProviderContext.Provider, { value: String(configuration['key']) }, children)
        },
        connect: ({ configuration }) => {
          connectionConfigurations.push(configuration)
          return connection(() => {
            closes += 1
          })
        },
      }),
      {
        key: {
          evaluate: () => {
            evaluations += 1
            return { jsValue: `public-key-${evaluations}` }
          },
        },
      },
    )
    function Content({ label }: { label: string }): React.ReactElement {
      const auth = TR.Auth.UseContext()
      const key = React.useContext(ProviderContext)
      return TR.createElement(Text, null, `${label}: ${key}, ${auth.session.state}`)
    }
    function MountedApp({ label }: { label: string }): React.ReactElement {
      scope = TR.Auth.UseScope(source)
      return TR.createElement(TR.Auth.Host, { scope }, TR.createElement(Content, { label }))
    }
    const screen = render(TR.createElement(MountedApp, { label: 'App' }))
    let presentation: Promise<TR.AuthOutcome> | undefined
    try {
      await act(async () => {
        await TR.Auth.SettleAll()
      })
      Expect(screen.getByText('App: public-key-1, SignedOut')).toBeTruthy()
      Expect(connectionConfigurations).toHaveLength(1)
      Expect(hostConfigurations.length).toBeGreaterThan(0)
      Expect(connectionConfigurations[0]).toEqual({ key: 'public-key-1' })
      Expect(Object.isFrozen(connectionConfigurations[0])).toBe(true)

      await act(async () => {
        screen.rerender(TR.createElement(MountedApp, { label: 'Rerendered app' }))
        presentation = scope!.requestSignIn(() => TR.createElement(Content, { label: 'Sign in' }))
      })
      Expect(screen.getByText('Rerendered app: public-key-1, SignedOut')).toBeTruthy()
      Expect(screen.getByText('Sign in: public-key-1, SignedOut')).toBeTruthy()
      Expect(evaluations).toBe(1)
      Expect(connectionConfigurations).toHaveLength(1)
      for (const configuration of hostConfigurations) {
        Expect(configuration).toBe(connectionConfigurations[0])
      }
    } finally {
      screen.unmount()
      scope?.dispose()
      await presentation
    }
    Expect(closes).toBe(1)
  })

  Test('mounts and restores a provider without an optional host', async () => {
    let connects = 0
    let scope: TR.AuthScope | undefined
    const source = TR.Auth.Configure(
      TR.Auth.Declaration('Unhosted', {
        connect: () => {
          connects += 1
          return connection()
        },
      }),
      {},
    )
    function Content(): React.ReactElement {
      return TR.createElement(Text, null, TR.Auth.UseContext().session.state)
    }
    function MountedApp(): React.ReactElement {
      scope = TR.Auth.UseScope(source)
      return TR.createElement(TR.Auth.Host, { scope }, TR.createElement(Content))
    }
    const screen = render(TR.createElement(MountedApp))
    try {
      await act(async () => {
        await TR.Auth.SettleAll()
      })
      Expect(screen.getByText('SignedOut')).toBeTruthy()
      Expect(connects).toBe(1)
    } finally {
      screen.unmount()
      scope?.dispose()
    }
  })
})

function connection(close?: () => void): TR.AuthConnection {
  return {
    capabilities: { methods: [] },
    restore: async () => ({ state: 'SignedOut' }),
    signIn: async () => ({ outcome: { status: 'cancelled' } }),
    signOut: async () => ({ status: 'completed' }),
    credential: async request => ({ audience: request.audience, value: 'fixture-credential' }),
    close,
  }
}
