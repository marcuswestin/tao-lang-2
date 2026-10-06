import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const AUDIT = Repo.resolvePath('packages/cli/tao-cli/cli-src/standalone-filesystem-audit.ts')

Describe('standalone filesystem audit', () => {
  Test(
    'accepts observed Tahoe metadata shapes but rejects changed ownership, links, children, and Bun shims',
    async () => {
      const fixture = await mkTestDir('tao-filesystem-tahoe-metadata-')
      const before = FS.resolvePath('before.json', fixture)
      const after = FS.resolvePath('after.json', fixture)
      const diff = FS.resolvePath('diff.json', fixture)
      const report = FS.resolvePath('diff.txt', fixture)
      const scope = FS.resolvePath('scope.json', fixture)
      const prefix = '/guest/admin/'
      const shapes = [
        ['Library/Caches/com.apple.Safari.SafeBrowsing', 'directory', 160, 192],
        ['Library/Caches/com.apple.Safari.SafeBrowsing/Cache.db-shm', 'file', 32768, 32768],
        ['Library/Caches/com.apple.Safari.SafeBrowsing/Cache.db-wal', 'file', 41232, 49472],
        ['Library/Safari/PasswordBreachStore.plist', 'file', 335, 335],
      ] as const
      const entry = (kind: string, size: number, modifiedMs: number) => ({
        kind,
        size,
        modifiedMs,
        device: 1,
        mode: kind === 'file' ? 0o100644 : 0o40755,
        uid: 501,
        gid: 20,
      })
      const snapshot = (entries: Record<string, unknown>) => ({
        entries,
        issues: [],
        root: '/guest',
        skippedMounts: [],
      })
      const prior = Object.fromEntries(shapes.map(([path, kind, size]) => [prefix + path, entry(kind, size, 1)]))
      const current = Object.fromEntries(shapes.map(([path, kind, , size]) => [prefix + path, entry(kind, size, 2)]))
      for (const path of ['Library/PrivateCloudCompute', 'Library/Caches/com.apple.Safari.SafeBrowsing/fsCachedData']) {
        current[prefix + path] = entry('directory', 64, 2)
      }
      prior['/guest/acceptance/home/.tao'] = entry('directory', 64, 1)
      current['/guest/acceptance/home/.tao'] = entry('directory', 64, 2)
      const compare = () =>
        CLI.run(Platform.runtimeProcess.execPath, {
          args: ['run', AUDIT, 'compare', before, after, diff, report, scope],
        })
      try {
        await FS.writeJson(scope, { guestHome: '/admin', guestTemp: '/tmp', root: '/acceptance' })
        await FS.writeJson(before, snapshot(prior))
        await FS.writeJson(after, snapshot(current))
        const initial = await compare()
        Expect((await FS.readJson<{ violations: string[] }>(diff)).violations).toEqual([])
        Expect(initial.exitCode).toBe(0)
        for (const path of [prefix + shapes[0][0], prefix + shapes[1][0], `${prefix}Library/PrivateCloudCompute`]) {
          const value = current[path]!
          for (
            const mutation of [{ uid: 502 }, { gid: 0 }, { mode: 0o40777 }, { kind: 'symlink', linkTarget: '/outside' }]
          ) {
            await FS.writeJson(after, snapshot({ ...current, [path]: { ...value, ...mutation } }))
            Expect((await compare()).exitCode).not.toBe(0)
            Expect((await FS.readJson<{ violations: string[] }>(diff)).violations).toContain(path)
          }
        }
        const forbidden = [
          `${prefix}Library/PrivateCloudCompute/tool-cache`,
          `${prefix}Library/Caches/com.apple.Safari.SafeBrowsing/fsCachedData/tool-cache`,
          '/guest/private/tmp/bun-node-744846f84',
          '/guest/private/tmp/bun-node-744846f84/node',
        ]
        await FS.writeJson(
          after,
          snapshot({
            ...current,
            ...Object.fromEntries(forbidden.map(path => [path, entry('file', 10, 2)])),
          }),
        )
        Expect((await compare()).exitCode).not.toBe(0)
        Expect((await FS.readJson<{ violations: string[] }>(diff)).violations).toEqual(forbidden.sort())
      } finally {
        await FS.remove(fixture)
      }
    },
  )

  Test('compares remounted disks under one logical root without losing real metadata changes', async () => {
    const fixture = await mkTestDir('tao-filesystem-remount-')
    const disk = FS.resolvePath('mounted-disk', fixture)
    const before = FS.resolvePath('before.json', fixture)
    const after = FS.resolvePath('after.json', fixture)
    const diff = FS.resolvePath('diff.json', fixture)
    const report = FS.resolvePath('diff.txt', fixture)
    try {
      await FS.writeText(FS.resolvePath('file', disk), 'unchanged')
      await run('snapshot', disk, before, '/guest')
      const remounted = await FS.readJson<{ entries: Record<string, { device: number; mode: number }>; root: string }>(
        before,
      )
      Expect(remounted.root).toBe('/guest')
      Expect(Object.keys(remounted.entries)).toEqual(['/guest', '/guest/file'])
      for (const entry of Object.values(remounted.entries)) {
        entry.device += 100
      }
      await FS.writeJson(after, remounted)
      await run('compare', before, after, diff, report)
      Expect((await FS.readJson<{ changed: unknown[] }>(diff)).changed).toEqual([])
      remounted.entries['/guest/file']!.mode ^= 0o100
      await FS.writeJson(after, remounted)
      await run('compare', before, after, diff, report)
      Expect((await FS.readJson<{ changed: Array<{ path: string }> }>(diff)).changed.map(change => change.path))
        .toEqual(['/guest/file'])
    } finally {
      await FS.remove(fixture)
    }
  })

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
      await FS.mkdir(FS.resolvePath('admin/tao-harness/logs', volume))
      await FS.writeJson(scopePath, {
        guestHome: '/admin',
        guestTemp: '/tmp',
        root: '/acceptance',
        browserProfiles: ['/tmp/tao-studio-chrome-E2iYLY'],
      })
      await run('snapshot', volume, before)
      await FS.writeText(FS.resolvePath('acceptance/home/.tao/cache/bun/package', volume), 'expected')
      await FS.writeText(FS.resolvePath('admin/tao-harness/logs/steps/acceptance.log', volume), 'fixture log')
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
          'tmp/tao-studio-chrome-E2iYLY/Default/Cache/data',
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
        'admin/tao-harness/input/changed',
        'admin/tao-harness/logs-adjacent/unexpected',
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
        'tmp/tao-studio-chrome-unexpected/file',
        'tmp/tao-studio-chrome-ABC123/Default/Cache/data',
        'tmp/tao-studio-chrome-E2iYLY-adjacent/file',
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

  Test(
    'allows named offline boot services while rejecting adjacent writes and protecting acceptance HOME',
    async () => {
      const fixture = await mkTestDir('tao-filesystem-boot-')
      const before = FS.resolvePath('before.json', fixture)
      const after = FS.resolvePath('after.json', fixture)
      const diffPath = FS.resolvePath('diff.json', fixture)
      const reportPath = FS.resolvePath('diff.txt', fixture)
      const scopePath = FS.resolvePath('scope.json', fixture)
      const allowed = [
        '/acceptance/home/.tao',
        '/admin/.zsh_sessions/session.historynew',
        '/admin/Library/Accessibility/voicedb.sqlite-shm',
        '/admin/Library/Accounts/persona.cache',
        '/admin/Library/Contacts/accounts.accountdb-shm',
        '/admin/Library/DoNotDisturb/DB/IconCache/AppInfoMetadata.plist',
        '/admin/Library/FrontBoard/applicationState.db-shm',
        '/admin/Library/IntelligencePlatform/graph.db-wal',
        '/admin/Library/Caches/com.apple.HomeKit/configuration',
        '/admin/Library/Caches/com.apple.akd/Cache.db',
        '/admin/Library/Caches/com.apple.amsaccountsd/Cache.db-shm',
        '/admin/Library/Caches/com.apple.containermanagerd/Dead',
        '/admin/Library/Caches/com.apple.remindd/Cache.db',
        '/admin/Library/Caches/com.apple.AMPLibraryAgent/Cache.db-wal',
        '/admin/Library/Caches/com.apple.Spotlight/index',
        '/admin/Library/Caches/com.apple.helpd/HelpCache.plist',
        '/admin/Library/Caches/com.apple.tipsd/Cache.db-wal',
        '/admin/Library/Caches/com.apple.geoanalyticsd/APDB.db-shm',
        '/admin/Library/Caches/com.apple.geoanalyticsd/APDB.db-wal',
        '/admin/Library/Caches/com.google.GoogleUpdater/Cache.db-wal',
        '/admin/Library/HTTPStorages/com.apple.akd/httpstorages.sqlite-wal',
        '/admin/Library/HTTPStorages/com.apple.amsaccountsd/httpstorages.sqlite-wal',
        '/admin/Library/HTTPStorages/com.apple.appleaccountd/httpstorages.sqlite-wal',
        '/admin/Library/HTTPStorages/com.apple.appstoreagent/httpstorages.sqlite-wal',
        '/admin/Library/HTTPStorages/com.apple.itunescloudd/httpstorages.sqlite-wal',
        '/admin/Library/HTTPStorages/com.apple.AMPLibraryAgent/httpstorages.sqlite-wal',
        '/admin/Library/HTTPStorages/com.apple.tipsd/httpstorages.sqlite-wal',
        '/admin/Library/HTTPStorages/com.apple.weatherd/httpstorages.sqlite-wal',
        '/admin/Library/HTTPStorages/com.google.GoogleUpdater/httpstorages.sqlite-wal',
        '/admin/Library/Assistant/assistantdDidLaunch',
        '/admin/Library/Logs/Assistant/log',
        '/admin/Library/Logs/DiagnosticReports/tao.diag',
        '/admin/Library/Logs/CrashReporter/DiagnosticLogs/Search/spotlight_heartbeat_last.log',
        '/admin/Library/Logs/PhotosSearch.aapbz',
        '/admin/Library/Safari/PasswordBreachStore.plist',
        '/admin/Library/Google',
        '/admin/Library/Google/GoogleSoftwareUpdate',
        '/admin/Library/Google/GoogleSoftwareUpdate/Actives',
        '/admin/Library/Google/GoogleSoftwareUpdate/GoogleSoftwareUpdate.bundle/Contents/Info.plist',
        '/admin/Library/LaunchAgents',
        '/admin/Library/LaunchAgents/com.google.GoogleUpdater.wake.plist',
        '/admin/Library/LaunchAgents/com.google.keystone.agent.plist',
        '/admin/Library/LaunchAgents/com.google.keystone.xpcservice.plist',
        '/admin/Library/PPM',
        '/admin/Library/PPM/PAT',
        '/admin/Library/PPM/PAT/Tokens_22_09_2026_06_46_01.pat',
        '/admin/Library/Sharing/AirDropHashDB/data',
        '/admin/Library/Sharing/AutoUnlock/pairing-records.plist',
        '/admin/Library/Shortcuts/Shortcuts.sqlite-wal',
        '/admin/Library/Spotlight/ExtensionsCache/fileProviderBundleMap.plist',
        '/admin/Library/StatusKit/database/statuskit-cloud.db-shm',
        '/admin/Library/com.apple.AppleMediaServices/PersistedBags/bag',
        '/admin/Library/com.apple.bluetooth.services.cloud/CachedRecords/record',
        '/admin/Library/com.apple.iTunesCloud/play_activity.sqlitedb-wal',
        '/Library/Application Support/CrashReporter/AnonymousIdentifier.plist',
        '/Library/Application Support/com.apple.TCC/REG.db',
        '/Library/CoreAnalytics',
        '/Library/CoreAnalytics/taskedConfig.json',
        '/Library/OSAnalytics/Diagnostics/com.apple.osanalytics.submissionStatus.plist',
        '/Library/Receipts',
        '/Library/Receipts/InstallHistory.plist',
        '/Library/Updates/index.plist',
        '/Library/Bluetooth/com.apple.MobileBluetooth.ledevices.paired.db-wal',
        '/Library/Caches/com.apple.amsengagementd.classicdatavault/analytics/jetpackByteCode',
        '/Library/Keychains/System.keychain',
        '/Library/Keychains/system-keychain-2.db-shm',
        '/Library/SystemExtensions/.staging',
        '/MobileSoftwareUpdate/restore.log',
        '/Volumes/Macintosh HD',
        '/admin/Movies',
        '/admin/Movies/TV',
        '/admin/Movies/TV/Media.localized/.Media Preferences.plist',
        '/admin/Movies/TV/TV Library.tvlibrary/Library.tvdb',
        '/private/tmp/powerlog',
        '/private/var/dirs_cleaner',
        '/private/var/networkd/db/netusage.sqlite-wal',
        '/private/var/sntpd/state.bin',
        '/private/var/rpc/ncacn_np/mdssvc',
        '/private/var/rpc/ncalrpc/NETLOGON',
        '/private/var/run/com.apple.AssetCache/AssetCache.pid',
        '/private/var/run/com.apple.security.cryptexd/codex.system/boot-session',
        '/private/var/run/syslog.pid',
        '/private/var/run/com.apple.launchd.aB123',
        '/private/var/run/com.apple.launchd.aB123/Listeners',
        '/tmp/com.google.GoogleUpdater.GoogleUpdater_chrome_url_fetcher_.dFjktf',
        '/tmp/com.google.GoogleUpdater.GoogleUpdater_chrome_url_fetcher_.dFjktf/8fbe8b1374dbf567b9f5b2b92af1edc52456ad43f2b528caf34b104961aa6899',
        '/tmp/com.google.GoogleUpdater.GoogleUpdater_chrome_url_fetcher_.dFjktf/decoded_xz',
        ...[
          '.AddressBookLocks',
          'AudioComponentRegistrar',
          'AudioConverterService',
          'CrashHandlerService',
          'SandboxHelper',
          'SpeechModelCache',
          'StatusKitAgent',
          'assessmentagent',
          'betaenrollmentagent',
          'heard',
          'homed',
          'icdd',
          'itunescloudd',
          'mobiletimerd',
          'studentd',
          'talagent',
        ].map(name => `/tmp/${name}/state`),
      ]
      const unexpected = [
        '/admin/.zsh_sessions-adjacent/session',
        '/admin/Library/Caches/com.apple.akd-unknown/file',
        '/admin/Library/Caches/com.apple.unknown/file',
        '/admin/Library/Caches/com.apple.geoanalyticsd-adjacent/APDB.db-wal',
        '/admin/Library/Caches/com.google.GoogleUpdater-adjacent/Cache.db',
        '/admin/Library/HTTPStorages/com.apple.akd-unknown/file',
        '/admin/Library/HTTPStorages/com.apple.weatherd-adjacent/httpstorages.sqlite',
        '/admin/Library/HTTPStorages/com.google.GoogleUpdater-adjacent/httpstorages.sqlite',
        '/admin/Library/Sharing/unknown/file',
        '/admin/Library/Safari/PasswordBreachStore.plist-adjacent',
        '/admin/Library/Logs/CrashReporter/DiagnosticLogs/Search-adjacent/log',
        '/admin/Library/Logs/PhotosSearch.aapbz-adjacent',
        '/admin/Library/Google/unexpected',
        '/admin/Library/Google/GoogleSoftwareUpdate/unexpected',
        '/admin/Library/Google/GoogleSoftwareUpdate/Actives-adjacent/item',
        '/admin/Library/Google/GoogleSoftwareUpdate/GoogleSoftwareUpdate.bundle-adjacent/Contents/Info.plist',
        '/admin/Library/LaunchAgents/com.google.other.plist',
        '/admin/Library/LaunchAgents/com.google.keystone.agent.plist-adjacent',
        '/admin/Library/PPM/other',
        '/admin/Library/PPM/PAT-adjacent/token.pat',
        '/admin/Library/PPM/PAT/Tokens_2_09_2026_06_46_01.pat',
        '/Library/Application Support/com.apple.unknown/file',
        '/Library/Bluetooth/unexpected',
        '/Library/Caches/com.apple.unknown/file',
        '/Library/SystemExtensions/.staging/unexpected',
        '/MobileSoftwareUpdate/unexpected',
        '/Volumes/unexpected',
        '/private/tmp/powerlog/unexpected',
        '/private/tmp/tmp-mount-unknown',
        '/private/var/networkd/db/unexpected',
        '/private/var/rpc/ncalrpc/unexpected',
        '/private/var/rpc/ncacn_np/mdssvc/unexpected',
        '/private/var/run/com.apple.unknown',
        '/private/var/run/com.apple.AssetCache/unexpected',
        '/private/var/run/com.apple.security.cryptexd/unexpected',
        '/private/var/run/com.apple.launchd.aB123/unexpected',
        '/private/var/run/com.apple.launchd.aB123/Listeners/unexpected',
        '/private/var/run/com.apple.launchd.aB123-unknown',
        '/tmp/SpeechModelCache-unknown/file',
        '/tmp/BlobRegistryFiles-unknown',
        '/tmp/CFNetworkDownload_unknown.tmp',
        '/tmp/tao-test-runs/file',
        '/tmp/assistantd-adjacent/file',
        '/tmp/siriknowledged-adjacent/file',
        '/tmp/com.google.GoogleUpdater.GoogleUpdater_chrome_url_fetcher_.short/file',
        '/tmp/com.google.GoogleUpdater.GoogleUpdater_chrome_url_fetcher_.dFjktf/unexpected',
        '/tmp/com.google.GoogleUpdater.GoogleUpdater_chrome_url_fetcher_.dFjktf/decoded_xz/unexpected',
        '/tmp/com.google.GoogleUpdater.other_chrome_url_fetcher_.dFjktf/file',
        '/admin/.tao/file',
        '/acceptance/home/.zsh_sessions/session',
        '/acceptance/home/Library/Caches/com.apple.akd/file',
        '/Library/CoreAnalytics/unexpected',
        '/Library/Receipts/unexpected',
        '/Library/Updates/unexpected',
        '/Library/OSAnalytics-adjacent/unexpected',
        '/admin/Movies/unexpected',
        '/admin/Movies/TV/unexpected',
        '/admin/Movies/TV/Media.localized-adjacent/leak',
        '/admin/Movies/TV/TV Library.tvlibrary-adjacent/leak',
        '/acceptance/home/Library/Caches/com.apple.AMPLibraryAgent/leak',
        '/acceptance/home/Library/Caches/com.apple.Spotlight/leak',
        '/acceptance/home/Library/Caches/com.apple.helpd/leak',
        '/acceptance/home/Library/Caches/com.apple.tipsd/leak',
        '/acceptance/home/Library/HTTPStorages/com.apple.AMPLibraryAgent/leak',
        '/acceptance/home/Library/HTTPStorages/com.apple.tipsd/leak',
        '/acceptance/home/Library/Logs/DiagnosticReports/leak',
        '/acceptance/home/Library/Safari/PasswordBreachStore.plist',
        '/acceptance/home/Movies/TV/Media.localized/leak',
        '/acceptance/home/Movies/TV/TV Library.tvlibrary/leak',
        '/acceptance/home/Library/Caches/com.apple.geoanalyticsd/APDB.db-wal',
        '/acceptance/home/Library/Caches/com.google.GoogleUpdater/Cache.db-wal',
        '/acceptance/home/Library/HTTPStorages/com.apple.weatherd/httpstorages.sqlite-wal',
        '/acceptance/home/Library/HTTPStorages/com.google.GoogleUpdater/httpstorages.sqlite-wal',
        '/acceptance/home/Library/Google/GoogleSoftwareUpdate/GoogleSoftwareUpdate.bundle/Contents/Info.plist',
        '/acceptance/home/Library/LaunchAgents/com.google.keystone.agent.plist',
        '/acceptance/home/Library/Logs/CrashReporter/DiagnosticLogs/Search/log',
        '/acceptance/home/Library/Logs/PhotosSearch.aapbz',
        '/acceptance/home/Library/PPM/PAT/Tokens_22_09_2026_06_46_01.pat',
      ]
      try {
        await FS.writeJson(scopePath, { guestHome: '/admin', guestTemp: '/tmp', root: '/acceptance' })
        await FS.writeJson(before, { entries: {}, issues: [], root: '/guest', skippedMounts: [] })
        const snapshot = (paths: string[]) => ({
          entries: Object.fromEntries(paths.map(path => [`/guest${path}`, { kind: 'directory' }])),
          issues: [{ error: 'permission denied', path: '/guest/private/var/run/com.apple.launchd.aB123' }],
          root: '/guest',
          skippedMounts: [],
        })
        await FS.writeJson(after, snapshot(allowed))
        await run('compare', before, after, diffPath, reportPath, scopePath)
        Expect(await FS.readJson<{ violations: string[]; incomplete: boolean }>(diffPath))
          .toMatchObject({ incomplete: true, violations: [] })
        await FS.writeJson(after, {
          ...snapshot([...allowed, ...unexpected]),
          issues: [
            '/private/var/run/com.apple.launchd.aB123/unexpected',
            '/private/var/run/com.apple.launchd.aB123/Listeners',
            '/private/var/run/com.apple.unknown',
            '/acceptance/home/.zsh_sessions',
          ].map(path => ({ error: 'permission denied', path: `/guest${path}` })),
        })
        const result = await CLI.run(Platform.runtimeProcess.execPath, {
          args: ['run', AUDIT, 'compare', before, after, diffPath, reportPath, scopePath],
        })
        Expect(result.exitCode).not.toBe(0)
        const { violations } = await FS.readJson<{ violations: string[] }>(diffPath)
        for (const path of unexpected) {
          Expect(violations).toContain(`/guest${path}`)
        }
        Expect(violations).toContain('unobservable: /guest/private/var/run/com.apple.launchd.aB123/Listeners')
        Expect(violations).toContain('unobservable: /guest/private/var/run/com.apple.launchd.aB123/unexpected')
        Expect(violations).toContain('unobservable: /guest/private/var/run/com.apple.unknown')
        Expect(violations).toContain('unobservable: /guest/acceptance/home/.zsh_sessions')
      } finally {
        await FS.remove(fixture)
      }
    },
  )

  Test('allows only the observed Chrome install shape and News directory timestamp in both profiles', async () => {
    const fixture = await mkTestDir('tao-filesystem-browser-install-')
    const before = FS.resolvePath('before.json', fixture)
    const after = FS.resolvePath('after.json', fixture)
    const diffPath = FS.resolvePath('diff.json', fixture)
    const reportPath = FS.resolvePath('diff.txt', fixture)
    const scopePath = FS.resolvePath('scope.json', fixture)
    const root = '/guest/tmp/scoped_dirgxOAsr'
    const marker = `${root}/.com.google.Chrome.eTe4CV`
    const manifest = `${root}/CRX_INSTALL/manifest.json`
    const news = '/guest/admin/Library/News/com.apple.news.public-com.apple.news.private-production'
    const directory = { kind: 'directory', mode: 0o755, modifiedMs: 1 }
    const file = { kind: 'file', mode: 0o644, modifiedMs: 1 }
    const snapshot = { issues: [], root: '/guest', skippedMounts: [] }
    const installation = {
      [root]: directory,
      [marker]: file,
      [manifest]: file,
      [`${root}/CRX_INSTALL`]: directory,
      [`${root}/CRX_INSTALL/_locales/en/messages.json`]: file,
    }
    const baseline = { ...snapshot, entries: { [news]: directory } }
    const observed = {
      ...snapshot,
      entries: {
        '/guest/acceptance/home/.tao': directory,
        [news]: { ...directory, modifiedMs: 2 },
        ...installation,
      },
    }
    const compare = () =>
      CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', AUDIT, 'compare', before, after, diffPath, reportPath, scopePath],
      })
    try {
      for (const vmProfile of ['vanilla', 'xcode']) {
        await FS.writeJson(scopePath, { guestHome: '/admin', guestTemp: '/tmp', root: '/acceptance', vmProfile })
        await FS.writeJson(before, baseline)
        await FS.writeJson(after, observed)
        Expect((await compare()).exitCode).toBe(0)
        Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toEqual([])

        const emptyInstall = {
          ...observed,
          entries: Object.fromEntries(
            Object.entries(observed.entries).filter(([path]) => !path.startsWith(`${root}/CRX_INSTALL/`)),
          ),
        }
        await FS.writeJson(after, emptyInstall)
        Expect((await compare()).exitCode).toBe(0)
        Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toEqual([])
        const payload = `${root}/CRX_INSTALL/unexpected.js`
        await FS.writeJson(after, { ...emptyInstall, entries: { ...emptyInstall.entries, [payload]: file } })
        Expect((await compare()).exitCode).not.toBe(0)
        Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toEqual([payload])

        // Existing artifacts also qualify when their marker, directory, and manifest changed.
        await FS.writeJson(before, { ...baseline, entries: { ...baseline.entries, ...installation } })
        await FS.writeJson(after, {
          ...observed,
          entries: {
            ...observed.entries,
            [marker]: { ...file, modifiedMs: 2 },
            [manifest]: { ...file, modifiedMs: 2 },
            [`${root}/CRX_INSTALL`]: { ...directory, modifiedMs: 2 },
          },
        })
        Expect((await compare()).exitCode).toBe(0)

        const unexpected = [
          '/guest/tmp/scoped_dirABC123/unexpected',
          `${root}/unexpected`,
          `${root}/CRX_INSTALL-adjacent/file`,
          `${marker}/unexpected`,
          `${root}/.com.google.Chrome.eTe4CV-adjacent`,
          `${news}/unexpected`,
          `${news}-adjacent`,
        ]
        for (const malformed of ['scoped_dirgxOAsr-adjacent', 'scoped_dirshort', 'nested/scoped_dirgxOAsr']) {
          unexpected.push(
            `/guest/tmp/${malformed}`,
            `/guest/tmp/${malformed}/.com.google.Chrome.eTe4CV`,
            `/guest/tmp/${malformed}/CRX_INSTALL`,
            `/guest/tmp/${malformed}/CRX_INSTALL/manifest.json`,
          )
        }
        await FS.writeJson(before, baseline)
        await FS.writeJson(after, {
          ...observed,
          entries: { ...observed.entries, ...Object.fromEntries(unexpected.map(path => [path, file])) },
        })
        Expect((await compare()).exitCode).not.toBe(0)
        const result = await FS.readJson<{ violations: string[] }>(diffPath)
        for (const path of unexpected) {
          Expect(result.violations).toContain(path)
        }

        for (const missing of [marker, manifest, `${root}/CRX_INSTALL`]) {
          await FS.writeJson(after, {
            ...observed,
            entries: Object.fromEntries(Object.entries(observed.entries).filter(([path]) => path !== missing)),
          })
          Expect((await compare()).exitCode).not.toBe(0)
          const rejected = missing === manifest ? `${root}/CRX_INSTALL/_locales/en/messages.json` : root
          Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toContain(rejected)
          // A removed artifact cannot be the evidence that authorizes the remaining install tree.
          await FS.writeJson(before, { ...baseline, entries: { ...baseline.entries, [missing]: file } })
          Expect((await compare()).exitCode).not.toBe(0)
          Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toContain(rejected)
          await FS.writeJson(before, baseline)
        }

        await FS.writeJson(before, { ...snapshot, entries: {} })
        await FS.writeJson(after, observed)
        Expect((await compare()).exitCode).not.toBe(0)
        Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toContain(news)
        await FS.writeJson(before, baseline)
        for (const replacement of [{ ...directory, mode: 0o777 }, file]) {
          await FS.writeJson(after, { ...observed, entries: { ...observed.entries, [news]: replacement } })
          Expect((await compare()).exitCode).not.toBe(0)
          Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toContain(news)
        }
      }
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('bounds Xcode allowances by profile, artifact shape, and observed operation', async () => {
    const fixture = await mkTestDir('tao-filesystem-xcode-')
    const before = FS.resolvePath('before.json', fixture)
    const after = FS.resolvePath('after.json', fixture)
    const diffPath = FS.resolvePath('diff.json', fixture)
    const reportPath = FS.resolvePath('diff.txt', fixture)
    const scopePath = FS.resolvePath('scope.json', fixture)
    const scope = { guestHome: '/admin', guestTemp: '/tmp', root: '/acceptance' }
    const cryptex = '/private/var/run/com.apple.security.cryptexd'
    const added = [
      '/Library/Developer/CoreSimulator/Images/images.plist',
      '/admin/Library/Developer/CoreSimulator/Devices/device_set.plist',
      '/admin/Library/Logs/CoreSimulator/CoreSimulator.log',
      '/private/tmp/tart-guest-agent.log',
      '/private/tmp/tart-guest-daemon.log',
      '/private/var/tmp',
      '/private/var/tmp/SoftwareUpdateCore_NRD/EventReporterPersistedState',
      '/private/var/tmp/SoftwareUpdateCore_NRD/EventReporterPersistedState/SUCoreEventReporterState.state',
      '/private/var/tmp/SoftwareUpdateCore_NRD/RecorderSplunkRecords',
      '/tmp/xcrun_db',
      `${cryptex}/codex.system/boot-session/com.apple.iPhoneOS.SimulatorRuntime-v24.1.434.0`,
      `${cryptex}/codex.system/live/com.apple.MobileAsset.MetalToolchain-v27.1.266.1`,
      `${cryptex}/mnt/com.apple.XROS.SimulatorRuntime-v24.13.362.0.FzizPR`,
    ]
    const removed = [
      '/private/var/run/hdiejectd.pid',
      '/tmp/adb.501.log',
      '/tmp/hsperfdata_admin',
      '/tmp/metrickitd',
      '/tmp/cryptex.personalize.2MZ61Q',
      '/tmp/cryptex.personalize.2MZ61Q/im4m',
      '/tmp/cryptex_personalized_manifest.0jUyTJ',
      `${cryptex}/codex.system/stage/protex.8FXdTX`,
    ]
    const timestamps = [
      '/admin/.rbenv/shims',
      '/tmp/assistantd',
      '/tmp/assistantd/TemporaryItems',
      '/tmp/siriknowledged',
    ]
    const unexpected = [
      '/Library/Developer/CoreSimulator-adjacent/file',
      '/admin/Library/Developer/CoreSimulator-adjacent/file',
      '/admin/Library/Logs/CoreSimulator-adjacent/file',
      '/private/tmp/tart-guest-agent.log/unexpected',
      '/private/tmp/tart-guest-daemon.log-adjacent',
      '/private/tmp/unexpected',
      '/private/var/tmp/unexpected',
      '/private/var/tmp/SoftwareUpdateCore_NRD/unexpected',
      '/private/var/tmp/SoftwareUpdateCore_NRD/RecorderSplunkRecords/unexpected',
      '/admin/.rbenv/shims/ruby',
      '/admin/.rbenv/versions/ruby',
      '/admin/unexpected',
      '/tmp/adb.502.log',
      '/tmp/xcrun_db/unexpected',
      '/tmp/assistantd/unexpected',
      '/tmp/siriknowledged/unexpected',
      '/tmp/hsperfdata_admin/unexpected',
      '/tmp/metrickitd/unexpected',
      '/tmp/cryptex.personalize.2MZ61Q/unexpected',
      '/tmp/cryptex.personalize.2MZ61Q-adjacent/im4m',
      '/tmp/cryptex_personalized_manifest.0jUyTJ/unexpected',
      `${cryptex}/unknown`,
      `${cryptex}/mnt/com.apple.Unknown-v24.1.434.0.ABC123`,
      `${cryptex}/codex.system/live/com.apple.iPhoneOS.SimulatorRuntime-v24.1.434.0/unexpected`,
      '/admin/.tao/cache/leak',
      '/admin/.bun/cache/leak',
      '/admin/.expo/leak',
      '/admin/Library/Caches/bun/leak',
      '/tmp/tao-test-runs/leak',
      '/tmp/metro-cache/leak',
      '/acceptance/home/Library/Developer/CoreSimulator/leak',
    ]
    const entries = (paths: string[], modifiedMs = 1) =>
      Object.fromEntries(paths.map(path => [`/guest${path}`, { kind: 'directory', mode: 0o755, modifiedMs }]))
    const unreadable = [added[10]!, added[11]!, added[12]!]
    const snapshot = { issues: [], root: '/guest', skippedMounts: [] }
    const baseline = {
      ...snapshot,
      entries: entries([...removed, ...timestamps]),
      issues: [{ error: 'permission denied', path: `/guest${removed[7]}` }],
    }
    const observed = {
      ...snapshot,
      entries: { ...entries(['/acceptance/home/.tao', ...added]), ...entries(timestamps, 2) },
      issues: unreadable.map(path => ({ error: 'permission denied', path: `/guest${path}` })),
    }
    const compare = () =>
      CLI.run(Platform.runtimeProcess.execPath, {
        args: ['run', AUDIT, 'compare', before, after, diffPath, reportPath, scopePath],
      })
    try {
      await FS.writeJson(before, baseline)
      await FS.writeJson(after, observed)
      await FS.writeJson(scopePath, { ...scope, vmProfile: 'xcode' })
      Expect((await compare()).exitCode).toBe(0)
      Expect(await FS.readJson(diffPath)).toMatchObject({ incomplete: true, violations: [] })

      for (const vmProfile of [undefined, 'vanilla']) {
        await FS.writeJson(scopePath, { ...scope, vmProfile })
        Expect((await compare()).exitCode).not.toBe(0)
        const { violations } = await FS.readJson<{ violations: string[] }>(diffPath)
        for (const path of [...added, ...removed, ...timestamps]) {
          Expect(violations).toContain(`/guest${path}`)
        }
        Expect(violations).toContain(`unobservable: /guest${unreadable[0]}`)
      }

      await FS.writeJson(scopePath, { ...scope, vmProfile: 'xcode' })
      await FS.writeJson(after, {
        ...observed,
        entries: { ...observed.entries, ...entries(unexpected) },
        issues: [
          ...observed.issues,
          ...unexpected.map(path => ({ error: 'permission denied', path: `/guest${path}` })),
        ],
      })
      Expect((await compare()).exitCode).not.toBe(0)
      const { violations } = await FS.readJson<{ violations: string[] }>(diffPath)
      for (const path of unexpected) {
        Expect(violations).toContain(`/guest${path}`)
        Expect(violations).toContain(`unobservable: /guest${path}`)
      }

      // Cleanup exceptions must never authorize creating or modifying their matching artifacts.
      for (const operation of ['added', 'changed'] as const) {
        await FS.writeJson(before, operation === 'added' ? { ...snapshot, entries: {} } : baseline)
        await FS.writeJson(after, {
          ...observed,
          entries: { ...observed.entries, ...entries(removed, 2), ...entries(timestamps, 2) },
        })
        Expect((await compare()).exitCode).not.toBe(0)
        const result = await FS.readJson<{ violations: string[] }>(diffPath)
        for (const path of [...removed, ...(operation === 'added' ? timestamps : [])]) {
          Expect(result.violations).toContain(`/guest${path}`)
        }
      }
      await FS.writeJson(before, baseline)
      await FS.writeJson(after, {
        ...observed,
        entries: {
          ...observed.entries,
          '/guest/admin/.rbenv/shims': { kind: 'directory', mode: 0o777, modifiedMs: 2 },
        },
      })
      Expect((await compare()).exitCode).not.toBe(0)
      Expect((await FS.readJson<{ violations: string[] }>(diffPath)).violations).toContain('/guest/admin/.rbenv/shims')

      for (const vmProfile of ['unknown', null]) {
        await FS.writeJson(scopePath, { ...scope, vmProfile })
        const result = await compare()
        Expect(result.exitCode).not.toBe(0)
        Expect(result.stderr).toContain('Invalid filesystem audit VM profile:')
      }
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('permits only removal of exact baseline temporary artifacts and keeps incomplete evidence', async () => {
    const fixture = await mkTestDir('tao-filesystem-baseline-cleanup-')
    const before = FS.resolvePath('before.json', fixture)
    const after = FS.resolvePath('after.json', fixture)
    const diffPath = FS.resolvePath('diff.json', fixture)
    const reportPath = FS.resolvePath('diff.txt', fixture)
    const scopePath = FS.resolvePath('scope.json', fixture)
    const mount = '/guest/private/tmp/tmp-mount-3nVTcs'
    const artifacts = [mount, '/guest/tmp/BlobRegistryFiles-bghqW6Fr', '/guest/tmp/CFNetworkDownload_TZj7l3.tmp']
    const baseline = {
      entries: Object.fromEntries(artifacts.map(path => [path, { kind: 'directory', mode: 0o700 }])),
      issues: [{ error: 'permission denied', path: mount }],
      root: '/guest',
      skippedMounts: [],
    }
    const cleaned = {
      entries: { '/guest/acceptance/home/.tao': { kind: 'directory' } },
      issues: [],
      root: '/guest',
      skippedMounts: [],
    }
    try {
      await FS.writeJson(scopePath, { guestHome: '/admin', guestTemp: '/tmp', root: '/acceptance' })
      await FS.writeJson(before, baseline)
      await FS.writeJson(after, cleaned)
      await run('compare', before, after, diffPath, reportPath, scopePath)
      Expect(await FS.readJson(diffPath)).toMatchObject({ incomplete: true, removed: artifacts, violations: [] })
      Expect(await FS.readText(reportPath)).toContain(`${mount}: permission denied`)
      for (const operation of ['added', 'changed'] as const) {
        await FS.writeJson(before, operation === 'added' ? { ...cleaned, entries: {} } : baseline)
        await FS.writeJson(after, {
          ...baseline,
          entries: {
            ...cleaned.entries,
            ...Object.fromEntries(artifacts.map(path => [path, { kind: 'directory', mode: 0o755 }])),
          },
        })
        const result = await CLI.run(Platform.runtimeProcess.execPath, {
          args: ['run', AUDIT, 'compare', before, after, diffPath, reportPath, scopePath],
        })
        Expect(result.exitCode).not.toBe(0)
        const { violations } = await FS.readJson<{ violations: string[] }>(diffPath)
        for (const path of artifacts) {
          Expect(violations).toContain(path)
        }
        Expect(violations).toContain(`unobservable: ${mount}`)
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
