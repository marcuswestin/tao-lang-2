import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck, runFmt } from '../cli-src/source-commands'
import { checkedProjectFile, statusByFile, withTaoFixture } from './test-cli-files'

/** brokenSource is source whose first syntax error sits mid-line, where it carries a position. */
const brokenSource = 'view Broken() {\n   let ? = 1\n}\n'

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

  Test('reports a positioned syntax error per file and leaves the file untouched', async () => {
    await withTaoFixture({
      'broken.tao': brokenSource,
      'valid.tao': 'view   MainView() { }',
    }, async (rootDir) => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'broken.tao': 'error',
        'valid.tao': 'changed',
      })
      const broken = results.find(result => result.status === 'error')
      // The formatter's own invariant is not an author-facing message: a file that does not parse is
      // reported through its diagnostics, which carry the position the CLI renders.
      Expect(broken?.error).toBeUndefined()
      Expect(broken?.diagnostics).toHaveLength(1)
      const diagnostic = broken?.diagnostics?.[0]
      Expect(diagnostic?.filePath).toBe(FS.resolvePath('broken.tao', rootDir))
      Expect(diagnostic?.severity).toBe('error')
      Expect(['lexer', 'parser']).toContain(diagnostic?.source)
      Expect(diagnostic?.range?.start).toEqual({ character: 7, line: 1 })
      Expect(await FS.readText(FS.resolvePath('broken.tao', rootDir))).toBe(brokenSource)
    })
  })

  // A1: `fmt` and `check` reach a file that does not parse by different routes, and an author who
  // ran either must be told the same thing about it.
  Test('reports the same syntax error `tao check` reports', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'broken.tao': brokenSource,
    }, async (rootDir) => {
      const formatted = await runFmt(rootDir)
      const checked = await runCheck(rootDir)

      Expect(formatted).toEqual(checked)
      Expect(formatted.map(result => result.status)).toEqual(['error'])
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

  Test('checks an explicitly named generated file without rewriting it', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({
      '.tao/.gitkeep': '',
      '@/studio/Generated.tao': generated,
    }, async rootDir => {
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

  Test('protects generated roots owned by nested Tao projects during repository-wide formatting', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({
      'Nested/.tao/.gitkeep': '',
      'Nested/@/studio/Generated.tao': generated,
      'Nested/Authored.tao': 'view   Authored() { }',
    }, async rootDir => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'Nested/@/studio/Generated.tao': 'error',
        'Nested/Authored.tao': 'changed',
      })
      Expect(await FS.readText(FS.resolvePath('Nested/@/studio/Generated.tao', rootDir))).toBe(generated)
      Expect(await FS.readText(FS.resolvePath('Nested/Authored.tao', rootDir))).toBe('view Authored() { }\n')
    })
  })

  Test('formats an undeclared nested @ directory instead of treating it as the project-root package', async () => {
    const generated = 'view   Generated() { }'
    await withTaoFixture({
      '.tao/.gitkeep': '',
      'Apps/Created/@/studio/Generated.tao': generated,
      'Apps/Created/Authored.tao': 'view   Authored() { }',
    }, async rootDir => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'Apps/Created/@/studio/Generated.tao': 'changed',
        'Apps/Created/Authored.tao': 'changed',
      })
      Expect(await FS.readText(FS.resolvePath('Apps/Created/@/studio/Generated.tao', rootDir))).toBe(
        'view Generated() { }\n',
      )
      Expect(await FS.readText(FS.resolvePath('Apps/Created/Authored.tao', rootDir))).toBe('view Authored() { }\n')
    })
  })
})
