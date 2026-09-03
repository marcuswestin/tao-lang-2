import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runFmt } from '../cli-src/source-commands'
import { statusByFile, withTaoFixture } from './test-cli-files'

Describe('tao fmt', () => {
  Test('formats .tao files in place across nested directories', async () => {
    await withTaoFixture({
      'unformatted.tao': 'view   MainView()    {   }',
      'nested/formatted.tao': 'view MainView() { }\n',
      'ignored.txt': 'view   Ignored()    {   }',
    }, async (rootDir) => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'unformatted.tao': 'changed',
        'nested/formatted.tao': 'unchanged',
      })
      Expect(await FS.readText(FS.resolvePath('unformatted.tao', rootDir))).toBe('view MainView() { }\n')
      Expect(await FS.readText(FS.resolvePath('ignored.txt', rootDir))).toBe('view   Ignored()    {   }')
    })
  })

  Test('reports syntax errors per file and leaves the file untouched', async () => {
    await withTaoFixture({
      'broken.tao': 'view Broken() {',
      'valid.tao': 'view   MainView() { }',
    }, async (rootDir) => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'broken.tao': 'error',
        'valid.tao': 'changed',
      })
      const broken = results.find(result => result.status === 'error')
      Expect(broken?.error).toContain('Tao source without syntax errors')
      Expect(await FS.readText(FS.resolvePath('broken.tao', rootDir))).toBe('view Broken() {')
    })
  })

  Test('reports a user error for a missing path', async () => {
    await Expect(runFmt('/__tao__/missing-fmt-path')).rejects.toThrow('No file or directory found at')
  })

  Test('formats an explicitly named file that directory walks would skip', async () => {
    await withTaoFixture({
      '.hidden.tao': 'view   HiddenFile() { }',
      '.hidden-dir/skipped.tao': 'view   Skipped() { }',
      'node_modules/.hidden.tao': 'view   MainView() { }',
    }, async (rootDir) => {
      const path = FS.resolvePath('node_modules/.hidden.tao', rootDir)

      Expect((await runFmt(rootDir)).length).toBe(0)
      Expect((await runFmt(path)).map(result => result.status)).toEqual(['changed'])
      Expect(await FS.readText(FS.resolvePath('.hidden.tao', rootDir))).toBe('view   HiddenFile() { }')
      Expect(await FS.readText(FS.resolvePath('.hidden-dir/skipped.tao', rootDir))).toBe(
        'view   Skipped() { }',
      )
      Expect(await FS.readText(path)).toBe('view MainView() { }\n')
    })
  })

  Test('formats a single file path', async () => {
    await withTaoFixture({
      'app.tao': 'app   MyApp { view MainView }\nview MainView() { }\n',
    }, async (rootDir) => {
      const path = FS.resolvePath('app.tao', rootDir)
      const results = await runFmt(path)

      Expect(results.map(result => result.status)).toEqual(['changed'])
      Expect(await FS.readText(path)).toBe('app MyApp {\n   view MainView\n}\n\nview MainView() { }\n')
    })
  })

  Test('checks an explicitly named generated file without rewriting it', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({ '@/studio/Generated.tao': generated }, async rootDir => {
      const path = FS.resolvePath('@/studio/Generated.tao', rootDir)
      const results = await runFmt(path)

      Expect(results).toEqual([{
        error: 'Generated source under @/ is not canonical; regenerate it instead of rewriting it.',
        path,
        status: 'error',
      }])
      Expect(await FS.readText(path)).toBe(generated)
    })
  })
})
