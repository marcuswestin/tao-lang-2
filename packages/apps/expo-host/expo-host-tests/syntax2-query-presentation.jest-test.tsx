import { Assert, FS, Repo } from '@shared'
import { Deferred, Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { act, fireEvent, waitFor } from '@testing-library/react-native'
import type { BookBackend } from '../../../../Apps/Syntax2/library/BookBackend'
import { compileAndRenderApp, registerRuntimeE2ELifecycle } from './test-compile-app'

type BackendControl = (backend: BookBackend) => void
const controlHost = globalThis as typeof globalThis & { syntax2QueryPresentationBackend?: BackendControl }
const backendControlSlot = testOverrideSlot({
  read: () => controlHost.syntax2QueryPresentationBackend,
  write: value => {
    if (value === undefined) {
      delete controlHost.syntax2QueryPresentationBackend
    } else {
      controlHost.syntax2QueryPresentationBackend = value
    }
  },
})

registerRuntimeE2ELifecycle()

Describe('Syntax2 mounted query presentation', () => {
  Test(
    'uses the app loading override, retains cached rows during refresh, and presents failed refresh as stale',
    async () => {
      const appRoot = Repo.resolvePath('Apps/Syntax2')
      const sources: Record<string, string> = {}
      for await (
        const path of FS.walk(appRoot, {
          extensions: ['.tao', '.ts', '.tsx'],
          excludeDirectory: name => name.startsWith('_gen') || name === 'node_modules',
        })
      ) {
        if (!path.endsWith('.test.tao')) {
          sources[FS.relativePath(appRoot, path)] = await FS.readText(path)
        }
      }

      const providerPath = 'library/BookStoreProvider.ts'
      const provider = sources[providerPath]
      Assert.defined(provider, 'the actual app provider is part of the isolated source copy')
      const constructor = 'const backend = new BookBackend()'
      Expect(provider.split(constructor)).toHaveLength(2)
      // Only expose the real backend's existing acquisition controls; provider publication stays unchanged.
      sources[providerPath] = provider.replace(
        constructor,
        `${constructor}
      ;(globalThis as typeof globalThis & {
        syntax2QueryPresentationBackend?: (backend: BookBackend) => void
      }).syntax2QueryPresentationBackend?.(backend)`,
      )

      const connected = Deferred<BookBackend>()
      const initial = Deferred<void>()
      const refreshing = Deferred<void>()
      const refreshStarted = Deferred<void>()
      let acquisitions = 0
      const restore = backendControlSlot.install(backend => {
        backend.setBeforePageCommit(async () => {
          acquisitions++
          if (acquisitions === 1) {
            await initial.promise
          } else if (acquisitions === 2) {
            refreshStarted.resolve()
            await refreshing.promise
          }
        })
        connected.resolve(backend)
      })

      try {
        await withTaoFiles('tao-syntax2-query-presentation-', sources, async paths => {
          const screen = await compileAndRenderApp(paths['Main.tao']!)
          const backend = await connected.promise
          await waitFor(() => Expect(screen.getByLabelText('Loading books')).toBeDefined())
          Expect(screen.queryByText('BOOK 1')).toBeNull()
          Expect(screen.queryByText('No books.')).toBeNull()
          Expect(screen.queryByLabelText('Refreshing books')).toBeNull()

          await act(async () => {
            initial.resolve()
          })
          await waitFor(() => Expect(screen.getByText('BOOK 1')).toBeDefined())
          Expect(screen.getByText('40 loaded')).toBeDefined()
          Expect(screen.queryByLabelText('Loading books')).toBeNull()
          Expect(screen.queryByText('Showing cached books.')).toBeNull()

          fireEvent.press(screen.getByText('Refresh'))
          await refreshStarted.promise
          await waitFor(() => Expect(screen.getByLabelText('Refreshing books')).toBeDefined())
          Expect(screen.getByText('BOOK 1')).toBeDefined()
          Expect(screen.getByText('40 loaded')).toBeDefined()
          Expect(screen.queryByLabelText('Loading books')).toBeNull()
          Expect(screen.queryByText('Showing cached books.')).toBeNull()

          await act(async () => {
            refreshing.resolve()
          })
          await waitFor(() => Expect(screen.queryByLabelText('Refreshing books')).toBeNull())
          Expect(screen.getByText('BOOK 1')).toBeDefined()

          backend.failNext('acquisition', 'Temporary refresh failure')
          fireEvent.press(screen.getByText('Refresh'))
          await waitFor(() => Expect(screen.getByText('Showing cached books.')).toBeDefined())
          Expect(screen.getByText('BOOK 1')).toBeDefined()
          Expect(screen.getByText('40 loaded')).toBeDefined()
          Expect(screen.queryByLabelText('Refreshing books')).toBeNull()
          Expect(screen.queryByLabelText('Loading books')).toBeNull()
        })
        Expect(await FS.readText(FS.resolvePath(providerPath, appRoot))).toBe(provider)
      } finally {
        initial.resolve()
        refreshing.resolve()
        restore()
      }
    },
  )
})
