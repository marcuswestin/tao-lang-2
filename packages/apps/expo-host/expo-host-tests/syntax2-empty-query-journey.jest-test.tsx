import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Syntax2 actual app empty query journey', () => {
  Test('renders an available empty collection without the app guard and creates its first live row', async () => {
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
    const seededBooks = `backend.seedServer(Array.from({ length: 83 }, (_, index) => ({
        ID: \`book-\${String(index + 1).padStart(3, '0')}\`,
        Title: \`Book \${index + 1}\`,
        Note: '',
      })))`
    Expect(provider.split(seededBooks)).toHaveLength(2)
    sources[providerPath] = provider.replace(seededBooks, 'backend.seedServer([])')
    sources['Empty.test.tao'] = `
      use LibraryApp from ./Main

      test "Syntax2 empty backend" {
        test "creates content from an available empty collection" {
          run LibraryApp
          expect text "Library"
          expect text "Ada Lovelace"
          expect text "All books."
          expect text "No books."
          expect missing text "BOOK 1"
          press "Group"
          expect text "Grouped books."
          expect text "No books."
          press "Group"
          expect text "All books."
          expect text "No books."
          enter "First book" into #draft
          press "Add"
          expect #draft input value ""
          expect text "FIRST BOOK"
          expect missing text "No books."
          expect missing text "Enter a title"
        }
      }
    `

    let registeredErrorGuard = false
    let guardInvocations = 0
    const readNet = TR.ReadNet
    const guard = jest.spyOn(TR, 'ReadNet').mockImplementation(handlers => {
      const error = handlers.error
      if (!error) {
        return readNet(handlers)
      }
      registeredErrorGuard = true
      return readNet({
        ...handlers,
        error: (...args) => {
          guardInvocations++
          return error(...args)
        },
      })
    })
    try {
      await withTaoFiles('tao-syntax2-empty-query-', sources, async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Empty.test.tao']!)
      })
      Expect(registeredErrorGuard).toBe(true)
      Expect(guardInvocations).toBe(0)
      Expect(await FS.readText(FS.resolvePath(providerPath, appRoot))).toBe(provider)
    } finally {
      guard.mockRestore()
    }
  })
})
