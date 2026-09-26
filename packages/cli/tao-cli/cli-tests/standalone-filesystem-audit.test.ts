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

  Test('requires test writes to stay in the Tao home or project and rejects an external Bun cache', async () => {
    const fixture = await mkTestDir('tao-filesystem-policy-')
    const volume = FS.resolvePath('volume', fixture)
    const output = FS.resolvePath('logs', fixture)
    const before = FS.resolvePath('before.json', output)
    const after = FS.resolvePath('after.json', output)
    const diffPath = FS.resolvePath('diff.json', output)
    const reportPath = FS.resolvePath('diff.txt', output)
    const scopePath = FS.resolvePath('scope.json', output)
    try {
      await FS.mkdir(volume)
      await FS.writeJson(scopePath, { guestHome: '/admin', guestTemp: '/tmp', root: '/acceptance' })
      await run('snapshot', volume, before)
      await FS.writeText(FS.resolvePath('acceptance/home/.tao/cache/bun/package', volume), 'expected')
      await FS.writeText(FS.resolvePath('acceptance/home/a-tally-counter/App.tao', volume), 'expected')
      await FS.writeText(FS.resolvePath('private/var/db/os-state', volume), 'expected OS change')
      await FS.writeText(
        FS.resolvePath('admin/Library/Caches/com.apple.parsecd/Cohorts/cohorts.sqlite', volume),
        'OS cache',
      )
      await FS.writeText(FS.resolvePath('admin/Library/Caches/com.apple.itunescloudd/Cache.db-wal', volume), 'OS cache')
      await FS.writeText(FS.resolvePath('admin/Library/Assistant/sync_flagcom.apple.siri.applications', volume), '')
      await FS.mkdir(FS.resolvePath('admin/Library/homeenergyd', volume))
      await FS.writeText(
        FS.resolvePath('admin/Library/HTTPStorages/com.apple.askpermissiond/httpstorages.sqlite-shm', volume),
        'OS cache',
      )
      await FS.writeText(FS.resolvePath('admin/Library/Safari/IgnoredSiriSuggestedSites.db-shm', volume), 'OS cache')
      await FS.writeText(FS.resolvePath('Library/Keychains/apsd.keychain', volume), 'OS keychain')
      for (
        const path of [
          'admin/Library/Caches/com.apple.managedappdistributionagent/Cache.db',
          'admin/Library/Caches/com.apple.nsurlsessiond/Downloads/com.apple.bird/file',
          'admin/Library/Caches/com.apple.nsservicescache.plist',
          'admin/Library/Caches/com.apple.CloudTelemetry/XPCService/com.apple.identityservicesd/eventcache/cache.db-shm',
          'admin/Library/Logs/com.apple.CloudTelemetry/XPCService/com.apple.identityservicesd/messageLog.txt',
          'admin/Library/HTTPStorages/com.apple.amsondevicestoraged/httpstorages.sqlite',
          'admin/Library/HTTPStorages/com.apple.managedappdistributionagent/httpstorages.sqlite',
          'admin/Library/Assistant/SiriVocabulary/Modules/Task/Registry',
          'admin/Library/Photos/Libraries/Syndication.photoslibrary/resources/derivatives/thumbs/thumbnailConfiguration',
          'Library/Logs/DiagnosticReports/tao.diag',
          'Library/Updates/ProductMetadata.plist',
          'tmp/proactived/file',
          'tmp/contentlinkingd/file',
          'tmp/com.google.Chrome.123/SingletonCookie',
          'tmp/.com.google.Chrome.456',
        ]
      ) {
        await FS.writeText(FS.resolvePath(path, volume), 'OS service write')
      }
      await run('snapshot', volume, after)
      await run('compare', before, after, diffPath, reportPath, scopePath)
      Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toEqual([])

      await FS.writeText(FS.resolvePath('admin/Library/Caches/bun/unexpected', volume), 'leak')
      await run('snapshot', volume, after)
      const failed = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', AUDIT, 'compare', before, after, diffPath, reportPath, scopePath],
      })
      Expect(failed.exitCode).not.toBe(0)
      Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations)
        .toContain(FS.resolvePath('admin/Library/Caches/bun/unexpected', volume))

      await FS.writeText(FS.resolvePath('admin/unexpected', volume), 'unknown write')
      await run('snapshot', volume, after)
      await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', AUDIT, 'compare', before, after, diffPath, reportPath, scopePath],
      })
      Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations)
        .toContain(FS.resolvePath('admin/unexpected', volume))

      const unexpected = [
        'admin/Library/Caches/com.apple.parsecd-unknown/file',
        'admin/Library/Caches/com.apple.unknown/file',
        'admin/Library/Assistant/unexpected',
        'admin/Library/homeenergyd/unexpected',
        'admin/Library/HTTPStorages/unknown/file',
        'admin/Library/Safari/unexpected',
        'Library/Keychains/unexpected',
        'Library/Updates/unexpected',
        'Library/Logs/unexpected',
        'admin/Library/Logs/unexpected',
        'tmp/com.google.ChromeUnknown/file',
        'tmp/tao-test-runs/leak',
        'acceptance/home/Library/Caches/com.apple.parsecd/file',
      ]
      for (const path of unexpected) {
        await FS.writeText(FS.resolvePath(path, volume), 'unexpected')
      }
      await run('snapshot', volume, after)
      const adjacent = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', AUDIT, 'compare', before, after, diffPath, reportPath, scopePath],
      })
      Expect(adjacent.exitCode).not.toBe(0)
      const violations = (await FS.readJson<{ violations: string[] }>(diffPath)).violations
      for (const path of unexpected) {
        Expect(violations).toContain(FS.resolvePath(path, volume))
      }
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('does not hide unreadable paths behind broad macOS parent directories', async () => {
    const fixture = await mkTestDir('tao-filesystem-unreadable-')
    const volume = FS.resolvePath('volume', fixture)
    const before = FS.resolvePath('before.json', fixture)
    const after = FS.resolvePath('after.json', fixture)
    const diffPath = FS.resolvePath('diff.json', fixture)
    const reportPath = FS.resolvePath('diff.txt', fixture)
    const scopePath = FS.resolvePath('scope.json', fixture)
    try {
      const acceptance = FS.resolvePath('acceptance/home/.tao', volume)
      const unknown = FS.resolvePath('private/var/unknown', volume)
      const library = FS.resolvePath('Library/unknown', volume)
      const expectedOs = FS.resolvePath('private/var/db/locked', volume)
      const spotlight = FS.resolvePath('private/var/run/mds', volume)
      await FS.writeJson(before, { entries: {}, issues: [], root: volume, skippedMounts: [] })
      await FS.writeJson(after, {
        entries: { [acceptance]: { kind: 'directory' }, [spotlight]: { kind: 'directory' } },
        issues: [unknown, library, expectedOs, spotlight].map(path => ({ error: 'permission denied', path })),
        root: volume,
        skippedMounts: [],
      })
      await FS.writeJson(scopePath, { guestHome: '/admin', guestTemp: '/tmp', root: '/acceptance' })

      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', AUDIT, 'compare', before, after, diffPath, reportPath, scopePath],
      })
      Expect(result.exitCode).not.toBe(0)
      const { violations } = await FS.readJson<{ violations: string[] }>(diffPath)
      Expect(violations).toContain(`unobservable: ${unknown}`)
      Expect(violations).toContain(`unobservable: ${library}`)
      Expect(violations).not.toContain(`unobservable: ${expectedOs}`)
      Expect(violations).not.toContain(spotlight)
      Expect(violations).not.toContain(`unobservable: ${spotlight}`)
    } finally {
      await FS.remove(fixture)
    }
  })
})

async function run(...args: string[]): Promise<void> {
  await CLI.mustRun(Platform.runtimeProcess.execPath, { args: ['run', AUDIT, ...args] })
}
