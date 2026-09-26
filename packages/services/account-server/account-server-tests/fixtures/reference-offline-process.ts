import type TR from '@runtime/TR'
import { Assert, Errors, FS, Platform } from '@shared'
import { ReferenceProvider } from '../../../../apps/stdlib/@tao/data/providers/reference/Reference'

const [, , input, output] = Platform.runtimeProcess.argv
Assert.defined(input, 'offline process fixture input')
Assert.defined(output, 'offline process fixture output')
const fixture = await FS.readJson<{
  accountId: string
  configuration: Record<string, unknown>
  root: string
  schema: TR.DataSchemaDefinition
  storageKey: string
  vault: Record<string, string>
}>(input)

// This file-backed fixture models a persistent native vault contract. It is deliberately test
// input, not a production secret store or evidence for device Keychain/Keystore behavior.
const connection = ReferenceProvider({
  operationId: () => Platform.randomUUID(),
  request: () => Promise.reject(new Errors.HostEnvironmentError('The child process has no network.')),
  schedule: () => () => {},
  secureStorage: () => ({
    getItem: key => Promise.resolve(fixture.vault[key] ?? null),
    setItem: (key, value) => {
      fixture.vault[key] = value
      return Promise.resolve()
    },
    removeItem: key => {
      delete fixture.vault[key]
      return Promise.resolve()
    },
  }),
  storage: () => ({
    getItem: async key => {
      const path = FS.resolvePath(Platform.sha256Hex(key), fixture.root)
      return await FS.isFile(path) ? await FS.readText(path) : null
    },
    setItem: (key, value) => FS.writeText(FS.resolvePath(Platform.sha256Hex(key), fixture.root), value),
  }),
}).connect({
  auth: {
    accountId: fixture.accountId,
    credential: () => Promise.resolve({ audience: 'notes', value: 'unused-offline-credential' }),
    generation: 1,
    signal: new AbortController().signal,
  },
  configuration: fixture.configuration,
  schema: fixture.schema,
  storageKey: fixture.storageKey,
})
try {
  const snapshot = await connection.load()
  await FS.writeJson(output, { offline: connection.offline!.status(), snapshot })
} finally {
  connection.close?.()
}
