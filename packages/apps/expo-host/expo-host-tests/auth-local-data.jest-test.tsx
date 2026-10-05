import { jest } from '@jest/globals'
import AsyncStorage from '@react-native-async-storage/async-storage'
import TR from '@runtime/TR'
import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { act, fireEventAsync, waitFor } from '@testing-library/react-native'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileFiles } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('compiled authenticated local-only app', () => {
  Test('mounts and recovers its scoped Local store through the native persistence boundary', async () => {
    const root = await mkTestDir('auth-local-native-storage-')
    const path = (key: string) => FS.resolvePath(Platform.sha256Hex(key), root)
    const savedKeys = new Set<string>()
    // Override the native storage boundary, retaining the emitted Local provider and auth mount.
    // Ordinary Tao journeys replace snapshot providers and cannot prove this connection wiring.
    const get = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async key =>
      await FS.exists(path(key)) ? await FS.readText(path(key)) : null
    )
    const set = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
      await FS.writeText(path(key), value)
      savedKeys.add(key)
    })
    const remove = jest.spyOn(AsyncStorage, 'removeItem').mockImplementation(async key => {
      await FS.remove(path(key))
    })
    const files = {
      '.tao/store/project.json': '{"id":"9f77de33-02da-4bfd-a527-35496b04dd1b"}',
      'App.tao': `
        use TestAuth from @tao/auth/testing
        use Col, FormButton, Text from @tao/ui
        data Drafts / Draft { Body text, local only }
        app DraftsApp { id "draftsapp" version "1.0.0" name "DraftsApp" Auth TestAuth { State "SignedIn", AccountId "alice" } view Main }
        view Main() {
          query Drafts = Drafts with { }
          action Add() { create Draft { Body: "Persisted local draft" } }
          render Col() {
            Text("Drafts: { Drafts.Count }")
            FormButton("Add draft") { on press Add }
            loop Drafts / Draft { Text(Draft.Body) }
          }
        }
      `,
    }
    try {
      await testCompileFiles('App.tao', files, async screen => {
        try {
          await waitFor(() => ExpectScreen(screen).toHaveText('Drafts: 0'))
          await fireEventAsync.press(screen.getByText('Add draft'))
          await act(async () => {
            await TR.Data.SettleAll()
          })
          ExpectScreen(screen).toHaveText('Drafts: 1')
          ExpectScreen(screen).toHaveText('Persisted local draft')
          const localKeys = [...savedKeys].filter(key => key.startsWith('tao-data:'))
          Expect(localKeys).toHaveLength(1)
          Expect(JSON.parse(localKeys[0]!.slice('tao-data:'.length))).toEqual([
            'tao.auth.local',
            1,
            JSON.stringify([
              'tao.declaration',
              1,
              '9f77de33-02da-4bfd-a527-35496b04dd1b',
              '@workspace',
              'App',
              'app',
              'DraftsApp',
            ]),
            'LocalData',
            'tao:test',
            'alice',
            'alice',
          ])
          const snapshot = JSON.parse(await FS.readText(path(localKeys[0]!)))
          Expect(snapshot.rows.Draft).toMatchObject([{ Body: 'Persisted local draft' }])
        } finally {
          screen.unmount()
        }
      })
      await testCompileFiles('App.tao', files, async screen => {
        try {
          await waitFor(() => ExpectScreen(screen).toHaveText('Drafts: 1'))
          ExpectScreen(screen).toHaveText('Persisted local draft')
        } finally {
          screen.unmount()
        }
      })
    } finally {
      get.mockRestore()
      set.mockRestore()
      remove.mockRestore()
    }
  })
})
