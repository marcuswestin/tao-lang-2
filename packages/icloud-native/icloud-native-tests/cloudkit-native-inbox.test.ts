import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

const nativeSourcePath = Repo.resolvePath('packages/icloud-native/ios/TaoCloudKitModule.swift')

Describe('tao-icloud-native durable CloudKit inbox', () => {
  Test('fails before restoring an advanced checkpoint when an existing inbox cannot be read exactly', async () => {
    const source = await FS.readText(nativeSourcePath)
    const restoreInbox = source.indexOf('inbox = try Self.loadInbox(at: inboxURL)')
    const restoreCheckpoint = source.indexOf('stateSerialization: Self.loadState(at: stateURL)')
    const loadStart = source.indexOf('private static func loadInbox(at url: URL) throws -> [[String: Any]]')
    const loadEnd = source.indexOf('private static func inboxLoadError', loadStart)

    Expect(restoreInbox).toBeGreaterThan(0)
    Expect(restoreCheckpoint).toBeGreaterThan(restoreInbox)
    Expect(loadStart).toBeGreaterThan(0)
    Expect(loadEnd).toBeGreaterThan(loadStart)

    const loadInbox = source.slice(loadStart, loadEnd)
    Expect(loadInbox).toContain('FileManager.default.fileExists(atPath: url.path)')
    Expect(loadInbox).toContain('data = try Data(contentsOf: url)')
    Expect(loadInbox).toContain('value = try JSONSerialization.jsonObject(with: data)')
    Expect(loadInbox).toContain('batchIds.insert(batchId).inserted')
    Expect(loadInbox).not.toContain('try?')
    Expect(loadInbox).not.toContain('catch {\n      return []')
  })
})
