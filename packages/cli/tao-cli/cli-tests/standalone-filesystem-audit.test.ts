import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const AUDIT = Repo.resolvePath('packages/cli/tao-cli/cli-src/standalone-filesystem-audit.ts')

Describe('standalone filesystem audit', () => {
  Test('records added, changed, and removed entries without following a symlink', async () => {
    const fixture = await mkTestDir('tao-filesystem-audit-')
    const root = FS.resolvePath('guest', fixture)
    const output = FS.resolvePath('logs', fixture)
    const before = FS.resolvePath('before.json', output)
    const after = FS.resolvePath('after.json', output)
    const diffPath = FS.resolvePath('diff.json', output)
    const reportPath = FS.resolvePath('diff.txt', output)
    try {
      await FS.writeText(FS.resolvePath('changed.txt', root), 'before')
      await FS.writeText(FS.resolvePath('removed.txt', root), 'removed')
      await FS.symlink('changed.txt', FS.resolvePath('shortcut', root))
      await run('snapshot', root, before)

      await FS.writeText(FS.resolvePath('changed.txt', root), 'after is longer')
      await FS.remove(FS.resolvePath('removed.txt', root))
      await FS.writeText(FS.resolvePath('added.txt', root), 'added')
      await run('snapshot', root, after)
      await run('compare', before, after, diffPath, reportPath)

      const diff = await FS.readJson<{
        added: string[]
        changed: Array<{ path: string }>
        incomplete: boolean
        removed: string[]
      }>(diffPath)
      Expect(diff.added).toContain(FS.resolvePath('added.txt', root))
      Expect(diff.changed.map(change => change.path)).toContain(FS.resolvePath('changed.txt', root))
      Expect(diff.removed).toContain(FS.resolvePath('removed.txt', root))
      Expect(diff.incomplete).toBe(false)
      Expect(await FS.readText(reportPath)).toContain('file contents')
      const first = await FS.readJson<{ entries: Record<string, { kind: string; linkTarget?: string }> }>(before)
      Expect(first.entries[FS.resolvePath('shortcut', root)]?.kind).toBe('symlink')
      Expect(first.entries[FS.resolvePath('shortcut', root)]?.linkTarget).toBe('changed.txt')
    } finally {
      await FS.remove(fixture)
    }
  })
})

async function run(...args: string[]): Promise<void> {
  await CLI.mustRun(Platform.runtimeProcess.execPath, { args: ['run', AUDIT, ...args] })
}
