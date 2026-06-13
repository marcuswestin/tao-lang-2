import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runFmt } from '../cli-src/fmt-command'
import { statusByFile, withTaoFixture } from './test-cli-files'

Describe('tao fmt', () => {
  Test('formats .tao files in place across nested directories', async () => {
    await withTaoFixture({
      'unformatted.tao': 'ui   MainView    {   }',
      'nested/formatted.tao': 'ui MainView { }\n',
      'ignored.txt': 'ui   Ignored    {   }',
    }, async (rootDir) => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'unformatted.tao': 'changed',
        'nested/formatted.tao': 'unchanged',
      })
      Expect(await FS.readText(FS.resolvePath('unformatted.tao', { cwd: rootDir }))).toBe('ui MainView { }\n')
      Expect(await FS.readText(FS.resolvePath('ignored.txt', { cwd: rootDir }))).toBe('ui   Ignored    {   }')
    })
  })

  Test('reports syntax errors per file and leaves the file untouched', async () => {
    await withTaoFixture({
      'broken.tao': 'ui Broken {',
      'valid.tao': 'ui   MainView { }',
    }, async (rootDir) => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'broken.tao': 'error',
        'valid.tao': 'changed',
      })
      const broken = results.find(result => result.status === 'error')
      Expect(broken?.error).toContain('Tao source without syntax errors')
      Expect(await FS.readText(FS.resolvePath('broken.tao', { cwd: rootDir }))).toBe('ui Broken {')
    })
  })

  Test('reports a user error for a missing path', async () => {
    await Expect(runFmt('/__tao__/missing-fmt-path')).rejects.toThrow('No file or directory found at')
  })

  Test('formats an explicitly named file that directory walks would skip', async () => {
    await withTaoFixture({
      '.hidden.tao': 'ui   MainView { }',
    }, async (rootDir) => {
      const path = FS.resolvePath('.hidden.tao', { cwd: rootDir })

      Expect((await runFmt(rootDir)).length).toBe(0)
      Expect((await runFmt(path)).map(result => result.status)).toEqual(['changed'])
      Expect(await FS.readText(path)).toBe('ui MainView { }\n')
    })
  })

  Test('formats a single file path', async () => {
    await withTaoFixture({
      'app.tao': 'app   MyApp { ui MainView }\nui MainView { }\n',
    }, async (rootDir) => {
      const path = FS.resolvePath('app.tao', { cwd: rootDir })
      const results = await runFmt(path)

      Expect(results.map(result => result.status)).toEqual(['changed'])
      Expect(await FS.readText(path)).toBe('app MyApp {\n   ui MainView\n}\n\nui MainView { }\n')
    })
  })
})
