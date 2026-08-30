import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { act, fireEventAsync, render, waitFor } from '@testing-library/react-native'
import { createElement, type ReactElement, useState } from 'react'
import * as RN from 'react-native'
import { InstantDBProvider } from '../../stdlib/@tao/data/providers/instantdb/InstantDB'
import { MemoryProvider } from '../../stdlib/@tao/data/providers/memory/Memory'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileFiles } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime', () => {
  Test('constructs the InstantDB provider without loading native modules before connect', () => {
    Expect(typeof InstantDBProvider().connect).toBe('function')
  })

  Test('shares one data catalog across the app, schema, and query modules', async () => {
    await testCompileFiles(
      'App.tao',
      {
        'App.tao': `
          use Memory from @tao/data/providers/memory
          use StackNav from @tao/nav
          use Main from ./Screen.tao

          app MultiFileData {
            Name "Multi-file data"
            Navigator StackNav { Initial Main }
            Datasource Memory { }
          }
        `,
        'Data.tao': `
          workspace data Notes / Note {
            Title text
          }
        `,
        'Screen.tao': `
          use Notes from ./Data.tao
          use Text from @tao/ui

          workspace view Main() {
            Title "Notes"
            query Notes { }
            render Text("Notes: { Notes.Count }")
          }
        `,
      },
      async screen => {
        await waitFor(() => ExpectScreen(screen).toHaveText('Notes: 0'))
      },
    )
  })

  Test('binds an app datasource after render without updating an existing query subscriber during render', async () => {
    const datasource = TR.Data.Configure(
      TR.Data.Declaration('Memory', memoryProvider()),
      {},
    )
    const schema = TR.Data.Schema({
      name: 'LifecycleSafeBinding',
      entities: {
        Entry: { collection: 'Entries', fields: {} },
      },
    })

    function QuerySubscriber(): ReactElement {
      const rows = TR.Data.Query(
        schema,
        { entity: 'Entry', filters: [] },
        TR.Value,
      ).evaluate().jsValue as unknown[] & { Error: string; Loading: boolean }
      const status = rows.Loading ? 'Loading' : rows.Error ? 'Provider error' : 'Bound'
      return createElement(RN.Text, null, status)
    }

    function ProviderBinding(): null {
      TR.Data.UseConfigured(schema, datasource)
      return null
    }

    const subscriber = render(createElement(QuerySubscriber))
    ExpectScreen(subscriber).toHaveText('Provider error')
    const consoleErrors: string[] = []
    const consoleError = jest.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
      consoleErrors.push(values.map(String).join(' '))
    })

    try {
      render(createElement(ProviderBinding))
      await act(async () => {
        await TR.Data.Settle(schema)
      })

      ExpectScreen(subscriber).toHaveText('Bound')
      Expect(consoleErrors.some(message =>
        message.includes('Cannot update a component')
        && message.includes('while rendering a different component')
      )).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  Test('binds a declaration-owned provider and StorageKey through UseConfigured', async () => {
    const provider = memoryProvider()
    const declaration = TR.Data.Declaration('ConfiguredMemory', provider)
    const configured = TR.Data.Configure(declaration, { StorageKey: TR.Value('configured-runtime') })
    const schema = TR.Data.Schema({
      name: 'ConfiguredRuntimeSchema',
      entities: {
        Entry: { collection: 'Entries', fields: { Name: { kind: 'text' } } },
      },
    })

    function ProviderBinding(): null {
      TR.Data.UseConfigured(schema, configured)
      return null
    }

    const binding = render(createElement(ProviderBinding))
    await act(async () => {
      await TR.Data.Settle(schema)
    })
    act(() => {
      TR.Data.Create(schema, 'Entry', { Name: TR.Value('Declaration bound') })
    })
    await act(async () => {
      await TR.Data.Settle(schema)
    })
    const revision = schema.snapshot()

    binding.rerender(createElement(ProviderBinding))

    Expect(schema.snapshot()).toBe(revision)
    Expect(await providerConnection(provider, 'ConfiguredRuntimeSchema').load()).toBeUndefined()
    Expect(await providerConnection(provider, 'configured-runtime').load()).toContain('Declaration bound')
  })

  Test('blocks provider load failures until recovery succeeds and the app remounts', async () => {
    let firstLoad = true
    let stored: string | undefined
    const provider: TR.DataConnection = {
      load: () => {
        if (firstLoad) {
          firstLoad = false
          throw new Error('storage unavailable')
        }
        return stored
      },
      save: snapshot => {
        stored = snapshot
      },
    }
    const schema = TR.Data.Schema({
      name: 'RecoveryOverlayData',
      schemaVersion: 1,
      entities: {
        Note: {
          collection: 'Notes',
          fields: { Title: { kind: 'text' } },
        },
      },
    }, provider)
    await TR.Data.Settle(schema)
    let mounts = 0

    function RecoveryRoot(): ReactElement {
      const [mount] = useState(() => ++mounts)
      return createElement(RN.Text, null, `Recovery root ${mount}`)
    }

    const screen = render(createElement(
      TR.AppShell,
      null,
      createElement(RecoveryRoot),
    ))

    ExpectScreen(screen).toHaveText("Couldn't load app data")
    ExpectScreen(screen).toHaveText('Could not load data: storage unavailable')
    Expect(screen.queryByText('Dismiss')).toBeNull()
    await fireEventAsync.press(screen.getByLabelText('Try loading data again'))
    await TR.Data.Settle(schema)

    Expect(screen.queryByLabelText('App data load failure')).toBeNull()
    ExpectScreen(screen).toHaveText('Recovery root 2')
    Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }).Error).toBe('')
    Expect(stored).toBeUndefined()
  })

  Test('offers destructive reset for a corrupt snapshot and wipes through connection.reset', async () => {
    let stored: string | undefined = '{"formatVersion":99}'
    let resets = 0
    const connection: TR.DataConnection = {
      load: () => stored,
      reset: () => {
        resets += 1
        stored = undefined
      },
      save: snapshot => {
        stored = snapshot
      },
    }
    const schema = TR.Data.Schema({
      name: 'CorruptResetData',
      schemaVersion: 1,
      entities: {
        Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } },
      },
    }, connection)
    await TR.Data.Settle(schema)

    const screen = render(createElement(TR.AppShell, null, createElement(RN.Text, null, 'App content')))

    ExpectScreen(screen).toHaveText("Couldn't load app data")
    await fireEventAsync.press(screen.getByLabelText('Reset app data and reload'))
    await TR.Data.Settle(schema)

    Expect(resets).toBe(1)
    Expect(screen.queryByLabelText('App data load failure')).toBeNull()
    Expect((schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }).Error).toBe('')
  })

  Test('recovers a corrupt snapshot destructively even when the connection has no reset', async () => {
    let stored: string | undefined = '{"formatVersion":99}'
    const connection: TR.DataConnection = {
      load: () => stored,
      save: snapshot => {
        stored = snapshot
      },
    }
    const schema = TR.Data.Schema({
      name: 'CorruptOverwriteData',
      schemaVersion: 1,
      entities: {
        Note: { collection: 'Notes', fields: { Title: { kind: 'text' } } },
      },
    }, connection)
    await TR.Data.Settle(schema)

    const screen = render(createElement(TR.AppShell, null, createElement(RN.Text, null, 'App content')))

    ExpectScreen(screen).toHaveText("Couldn't load app data")
    // Without reset, recovery overwrites the corrupt row with an empty envelope and reloads it.
    await fireEventAsync.press(screen.getByLabelText('Reset app data and reload'))
    await TR.Data.Settle(schema)

    Expect(screen.queryByLabelText('App data load failure')).toBeNull()
    Expect(stored).toContain('"formatVersion":1')
    const rows = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(rows).toHaveLength(0)
    Expect(rows.Error).toBe('')
  })
})

function memoryProvider(): TR.DataProvider {
  return MemoryProvider()
}

function providerConnection(provider: TR.DataProvider, storageKey: string): TR.DataConnection {
  return provider.connect({
    configuration: {},
    schema: { entities: {}, name: 'RuntimeToolchainTest' },
    storageKey,
  })
}
