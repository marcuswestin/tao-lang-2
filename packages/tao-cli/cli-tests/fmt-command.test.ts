import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { type FmtFileResult, runFmt } from '../cli-src/fmt-command'

Describe('tao fmt', () => {
  Test('formats .tao files in place across nested directories', async () => {
    await withFmtFixture({
      'unformatted.tao': 'ui   MainView    {   }',
      'nested/formatted.tao': 'ui MainView { }\n',
      'ignored.txt': 'ui   Ignored    {   }',
    }, async (rootDir) => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'unformatted.tao': 'formatted',
        'nested/formatted.tao': 'unchanged',
      })
      Expect(await FS.readText(FS.resolvePath('unformatted.tao', { cwd: rootDir }))).toBe('ui MainView { }\n')
      Expect(await FS.readText(FS.resolvePath('ignored.txt', { cwd: rootDir }))).toBe('ui   Ignored    {   }')
    })
  })

  Test('reports syntax errors per file and leaves the file untouched', async () => {
    await withFmtFixture({
      'broken.tao': 'ui Broken {',
      'valid.tao': 'ui   MainView { }',
    }, async (rootDir) => {
      const results = await runFmt(rootDir)

      Expect(statusByFile(results, rootDir)).toEqual({
        'broken.tao': 'error',
        'valid.tao': 'formatted',
      })
      const broken = results.find(result => result.status === 'error')
      Expect(broken?.error).toContain('Tao source without syntax errors')
      Expect(await FS.readText(FS.resolvePath('broken.tao', { cwd: rootDir }))).toBe('ui Broken {')
    })
  })

  Test('formats a single file path', async () => {
    await withFmtFixture({
      'app.tao': 'app   MyApp { ui MainView }\nui MainView { }\n',
    }, async (rootDir) => {
      const path = FS.resolvePath('app.tao', { cwd: rootDir })
      const results = await runFmt(path)

      Expect(results.map(result => result.status)).toEqual(['formatted'])
      Expect(await FS.readText(path)).toBe('app MyApp {\n    ui MainView\n}\n\nui MainView { }\n')
    })
  })
})

async function withFmtFixture(
  files: Record<string, string>,
  testsFunction: (rootDir: string) => Promise<void>,
): Promise<void> {
  const rootDir = await FS.mkTmpDir(FS.resolvePath('tao-fmt-test', { cwd: FS.tmpdir() }))
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      await FS.writeText(FS.resolvePath(relativePath, { cwd: rootDir }), source)
    }
    await testsFunction(rootDir)
  } finally {
    await FS.remove(rootDir)
  }
}

function statusByFile(results: readonly FmtFileResult[], rootDir: string): Record<string, string> {
  return Object.fromEntries(results.map(result => [FS.relativePath(rootDir, result.path), result.status]))
}
