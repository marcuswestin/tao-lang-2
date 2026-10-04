import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { requireMatchingEditorRelease } from '../ide-extension-src/language/release-profile'

Describe('Editor release compatibility', () => {
  Test('refuses a pinned public project under a development language server', async () => {
    const root = await mkTestDir('editor-release-')
    try {
      await FS.writeText(FS.resolvePath('.tao/lock.jsonc', root), '{"toolchain":{"version":"0.4.1"}}')
      await Expect(requireMatchingEditorRelease(FS.resolvePath('nested', root))).rejects.toThrow(
        'This project pins Tao 0.4.1, but this editor bundles Tao development phase development.',
      )
      await FS.writeText(FS.resolvePath('nested/.tao/lock.jsonc', root), '{}')
      await Expect(requireMatchingEditorRelease(FS.resolvePath('nested', root))).resolves.toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })
})
