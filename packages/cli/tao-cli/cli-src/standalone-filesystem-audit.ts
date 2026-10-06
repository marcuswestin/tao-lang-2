import { Errors, FS, HCI, Platform } from '@shared'

/** A metadata inventory of one writable guest volume; mounted filesystems are recorded but not entered. */
type Entry = Awaited<ReturnType<typeof FS.entryMetadata>>
type Issue = { error: string; path: string }
type Snapshot = {
  entries: Record<string, Entry>
  issues: Issue[]
  root: string
  skippedMounts: string[]
}
type Change = { after: Entry; before: Entry; path: string }
type Diff = {
  added: string[]
  beforeIssues: Issue[]
  beforeSkippedMounts: string[]
  changed: Change[]
  incomplete: boolean
  removed: string[]
  root: string
  afterIssues: Issue[]
  afterSkippedMounts: string[]
  violations: string[]
}
type AuditScope = {
  guestHome: string
  guestTemp: string
  root: string
  browserProfiles?: string[]
  vmProfile?: 'vanilla' | 'xcode'
}

const REPORT_LIMIT = 200

async function main(args: string[]): Promise<void> {
  if (args[0] === 'snapshot' && (args.length === 3 || args.length === 4)) {
    const snapshot = await capture(FS.resolvePath(args[1]!))
    if (args[3] !== undefined) {
      const logicalRoot = FS.resolvePath(args[3])
      const logical = (path: string) => FS.resolvePath(FS.relativePath(snapshot.root, path), logicalRoot)
      snapshot.entries = Object.fromEntries(
        Object.entries(snapshot.entries).map(([path, entry]) => [logical(path), entry]),
      )
      snapshot.issues = snapshot.issues.map(issue => ({ ...issue, path: logical(issue.path) }))
      snapshot.skippedMounts = snapshot.skippedMounts.map(logical)
      snapshot.root = logicalRoot
    }
    await FS.writeText(FS.resolvePath(args[2]!), `${JSON.stringify(snapshot)}\n`)
    HCI.writeLine(
      `Filesystem audit: recorded ${Object.keys(snapshot.entries).length} entries, `
        + `${snapshot.issues.length} unreadable paths, and ${snapshot.skippedMounts.length} other mounts.`,
    )
    return
  }
  if (args[0] === 'compare' && (args.length === 5 || args.length === 6)) {
    const before = await FS.readJson<Snapshot>(FS.resolvePath(args[1]!))
    const after = await FS.readJson<Snapshot>(FS.resolvePath(args[2]!))
    const diff = compare(before, after)
    if (args[5] !== undefined) {
      const scope = await FS.readJson<AuditScope>(FS.resolvePath(args[5]))
      diff.violations = violations(diff, scope, after.entries)
    }
    await FS.writeText(FS.resolvePath(args[3]!), `${JSON.stringify(diff)}\n`)
    await FS.writeText(FS.resolvePath(args[4]!), report(diff))
    HCI.writeLine(
      `Filesystem audit: ${diff.added.length} added, ${diff.changed.length} changed, `
        + `${diff.removed.length} removed; ${
          diff.incomplete ? 'incomplete (unreadable paths)' : 'complete in scanned volume'
        }; ${diff.violations.length} disallowed changes.`,
    )
    if (diff.violations.length > 0) {
      Errors.throwHostEnvironment(
        `Filesystem audit found ${diff.violations.length} disallowed or unobservable test paths. `
          + `See ${args[4]} and ${args[3]}.`,
      )
    }
    return
  }
  Errors.throwUserInput(
    'Usage: filesystem-audit snapshot <root> <output.json> [logical-root] | compare <before.json> <after.json> <diff.json> <report.txt> [scope.json]',
  )
}

/** capture walks the macOS Data volume without following symlinks or entering host-mounted volumes. */
async function capture(root: string): Promise<Snapshot> {
  const rootEntry = await FS.entryMetadata(root)
  if (rootEntry.kind !== 'directory') {
    Errors.throwHostEnvironment(`Filesystem audit root is not a directory: ${root}`)
  }
  const snapshot: Snapshot = { entries: {}, issues: [], root, skippedMounts: [] }
  const pending = [root]
  while (pending.length > 0) {
    const path = pending.pop()!
    let entry: Entry
    try {
      entry = await FS.entryMetadata(path)
    } catch (error) {
      snapshot.issues.push({ error: Errors.asError(error).message, path })
      continue
    }
    snapshot.entries[path] = entry
    if (entry.device !== rootEntry.device) {
      snapshot.skippedMounts.push(path)
      continue
    }
    if (entry.kind !== 'directory') {
      continue
    }
    let children: string[]
    try {
      children = await FS.listDir(path)
    } catch (error) {
      snapshot.issues.push({ error: Errors.asError(error).message, path })
      continue
    }
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push(FS.resolvePath(children[index]!, path))
    }
  }
  snapshot.issues.sort((left, right) => left.path.localeCompare(right.path))
  snapshot.skippedMounts.sort()
  return snapshot
}

/** compare keeps every path in machine-readable output; the text view stays bounded. */
function compare(before: Snapshot, after: Snapshot): Diff {
  if (before.root !== after.root) {
    Errors.throwUserInput(`Filesystem audit roots differ: ${before.root} and ${after.root}`)
  }
  const diff: Diff = {
    added: [],
    afterIssues: after.issues,
    afterSkippedMounts: after.skippedMounts,
    beforeIssues: before.issues,
    beforeSkippedMounts: before.skippedMounts,
    changed: [],
    incomplete: before.issues.length > 0 || after.issues.length > 0,
    removed: [],
    root: before.root,
    violations: [],
  }
  for (const path of Object.keys(after.entries)) {
    const old = before.entries[path]
    if (old === undefined) {
      diff.added.push(path)
      // A stopped VM disk gets a new host device number when remounted. It is not a file mutation.
    } else if (JSON.stringify({ ...old, device: 0 }) !== JSON.stringify({ ...after.entries[path], device: 0 })) {
      diff.changed.push({ after: after.entries[path]!, before: old, path })
    }
  }
  for (const path of Object.keys(before.entries)) {
    if (after.entries[path] === undefined) {
      diff.removed.push(path)
    }
  }
  diff.added.sort()
  diff.changed.sort((left, right) => left.path.localeCompare(right.path))
  diff.removed.sort()
  return diff
}

/** Require every observed change to belong to the acceptance or an explicit macOS-owned area. */
function violations(diff: Diff, scope: AuditScope, afterEntries: Snapshot['entries']): string[] {
  if (scope.vmProfile !== undefined && scope.vmProfile !== 'vanilla' && scope.vmProfile !== 'xcode') {
    Errors.throwUserInput(`Invalid filesystem audit VM profile: ${scope.vmProfile}`)
  }
  for (const path of [scope.root, scope.guestHome, scope.guestTemp]) {
    if (!FS.isAbsolute(path)) {
      Errors.throwUserInput(`Filesystem audit scope path must be absolute: ${path}`)
    }
  }
  const onVolume = (path: string) => FS.resolvePath(path.slice(1), diff.root)
  const acceptanceRoot = onVolume(scope.root)
  const acceptanceHome = FS.resolvePath('home', acceptanceRoot)
  const guestHome = onVolume(scope.guestHome)
  const guestTemp = onVolume(scope.guestTemp)
  const browserProfiles = (scope.browserProfiles ?? []).map(path => {
    if (FS.dirname(path) !== scope.guestTemp || !/^tao-studio-chrome-[A-Za-z0-9]{6}$/.test(FS.basename(path))) {
      Errors.throwUserInput(`Invalid browser fixture profile: ${path}`)
    }
    return onVolume(path)
  })
  const fixtureLogs = FS.resolvePath('tao-harness/logs', guestHome)
  const permittedHome = ['.tao', 'a-tally-counter', 'a-reading-list'].map(name => FS.resolvePath(name, acceptanceHome))
  const permittedHarness = ['releases', 'releases.json', 'watchman-bin']
    .map(name => FS.resolvePath(name, acceptanceRoot))
  const forbiddenExternal = [
    '.tao',
    '.cache/tao',
    '.local/share/tao',
    '.bun',
    '.expo',
    'Library/Caches/bun',
    'Library/Caches/dotslash',
  ].map(path => FS.resolvePath(path, guestHome))
  const forbiddenTemp = ['metro-cache', 'tao-test-runs', 'tao-ship-coordination']
    .map(path => FS.resolvePath(path, guestTemp))
  // These OS allowances are inferred from exact service/product-named VM snapshot paths;
  // the audit evidence does not independently identify the writer process for each artifact.
  const guestCache = [
    'CloudKit',
    'GeoServices',
    'PassKit',
    'com.apple.appleaccountd',
    'com.apple.appstoreagent',
    'com.apple.duetexpertd',
    'com.apple.chrono',
    'com.apple.AppleMediaServices',
    'com.apple.dataaccess.dataaccessd',
    'com.apple.passd',
    'com.apple.amsengagementd',
    'com.apple.ap.adprivacyd',
    'com.apple.cache_delete',
    'com.apple.feedbacklogger',
    'com.apple.askpermissiond',
    'com.apple.proactive.eventtracker',
    'com.apple.parsecd',
    'com.apple.itunescloudd',
    'com.apple.managedappdistributionagent',
    'com.apple.nsurlsessiond',
    'com.apple.CloudTelemetry',
    'com.apple.HomeKit',
    'com.apple.akd',
    'com.apple.amsaccountsd',
    'com.apple.containermanagerd',
    'com.apple.remindd',
    'com.apple.AMPLibraryAgent',
    'com.apple.Spotlight',
    'com.apple.helpd',
    'com.apple.tipsd',
    'com.apple.geoanalyticsd',
    'com.google.GoogleUpdater',
  ].map(name => FS.resolvePath(`Library/Caches/${name}`, guestHome))
  const guestSystem = [
    // The base image's login shell runs outside the isolated acceptance HOME.
    '.zsh_sessions',
    'Library/Accessibility',
    'Library/Accounts',
    'Library/Contacts',
    'Library/DoNotDisturb',
    'Library/FrontBoard',
    'Library/IntelligencePlatform',
    'Library/Logs/Assistant',
    'Library/Sharing/AirDropHashDB',
    'Library/Sharing/AutoUnlock',
    'Library/Shortcuts',
    'Library/Spotlight/ExtensionsCache',
    'Library/StatusKit',
    'Library/com.apple.AppleMediaServices',
    'Library/com.apple.bluetooth.services.cloud',
    'Library/com.apple.iTunesCloud',
    'Library/HTTPStorages/com.apple.akd',
    'Library/HTTPStorages/com.apple.amsaccountsd',
    'Library/HTTPStorages/com.apple.appleaccountd',
    'Library/HTTPStorages/com.apple.appstoreagent',
    'Library/HTTPStorages/com.apple.itunescloudd',
    'Library/HTTPStorages/com.apple.AMPLibraryAgent',
    'Library/HTTPStorages/com.apple.tipsd',
    'Library/HTTPStorages/com.apple.weatherd',
    'Library/HTTPStorages/com.google.GoogleUpdater',
    'Library/AppleMediaServices',
    'Library/Application Scripts',
    'Library/Application Support',
    'Library/Biome',
    'Library/ContainerManager',
    'Library/Containers',
    'Library/Daemon Containers',
    'Library/DataDeliveryServices',
    'Library/DuetExpertCenter',
    'Library/Finance',
    'Library/Group Containers',
    'Library/HomeKit',
    'Library/HTTPStorages/com.apple.askpermissiond',
    'Library/HTTPStorages/com.apple.amsondevicestoraged',
    'Library/HTTPStorages/com.apple.managedappdistributionagent',
    'Library/Assistant/SiriVocabulary',
    'Library/IdentityServices',
    'Library/Keychains',
    'Library/Logs/com.apple.CloudTelemetry',
    'Library/Logs/DiagnosticReports',
    'Library/Logs/CrashReporter/DiagnosticLogs/Search',
    'Library/Google/GoogleSoftwareUpdate/Actives',
    'Library/Google/GoogleSoftwareUpdate/GoogleSoftwareUpdate.bundle',
    'Library/Messages',
    'Library/Metadata',
    'Library/Passes',
    'Library/PersonalizationPortrait',
    'Library/Photos/Libraries/Syndication.photoslibrary',
    'Library/Preferences',
    'Library/Suggestions',
    'Library/Trial',
    'Library/Weather',
    'Library/com.apple.aiml.instrumentation',
    'Pictures/Photos Library.photoslibrary',
  ].map(path => FS.resolvePath(path, guestHome))
  const system = [
    '/.fseventsd',
    '/System/Library/AssetsV2',
    '/System/Library/Caches',
    '/Library/Trial',
    '/Library/OSAnalytics',
    '/Library/Application Support/CrashReporter',
    '/Library/Application Support/com.apple.TCC',
    '/Library/Caches/com.apple.amsengagementd.classicdatavault',
    '/Library/Logs/DiagnosticReports',
    '/Library/Preferences',
    '/Library/Caches/com.apple.iconservices.store',
    '/private/var/db',
    '/private/var/folders',
    '/private/var/log',
    '/private/var/protected',
    '/private/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress',
  ].map(onVolume)
  const systemExact = [
    '/Library/CoreAnalytics/taskedConfig.json',
    '/Library/Receipts/InstallHistory.plist',
    '/Library/Updates/index.plist',
  ].map(onVolume)
  const guestSystemExact = [
    'Library/Safari/PasswordBreachStore.plist',
    'Library/Caches/com.apple.Safari.SafeBrowsing/Cache.db-wal',
    'Library/LaunchAgents/com.google.GoogleUpdater.wake.plist',
    'Library/LaunchAgents/com.google.keystone.agent.plist',
    'Library/LaunchAgents/com.google.keystone.xpcservice.plist',
    'Library/Logs/PhotosSearch.aapbz',
  ].map(path => FS.resolvePath(path, guestHome))
  const guestSystemTrees = [
    // Apple documents Movies/TV as the default location for TV media libraries:
    // https://support.apple.com/en-ie/guide/tvapp-mac/atvebf18f94f/mac
    'Movies/TV/Media.localized',
    'Movies/TV/TV Library.tvlibrary',
  ].map(path => FS.resolvePath(path, guestHome))
  const systemParents = [
    '/System',
    '/System/Library',
    '/Library',
    '/Library/Caches',
    '/Library/Keychains',
    '/Library/Keychains/apsd.keychain',
    '/Library/Keychains/System.keychain',
    '/Library/Keychains/system-keychain-2.db-shm',
    '/Library/Keychains/system-keychain-2.db-wal',
    '/Library/Application Support',
    '/Library/Bluetooth',
    ...['other', 'paired'].flatMap(kind =>
      ['', '-shm', '-wal'].map(suffix => `/Library/Bluetooth/com.apple.MobileBluetooth.ledevices.${kind}.db${suffix}`)
    ),
    '/Library/SystemExtensions',
    '/Library/SystemExtensions/.staging',
    '/MobileSoftwareUpdate',
    '/MobileSoftwareUpdate/restore.log',
    '/Volumes',
    '/Volumes/Macintosh HD',
    '/Library/Logs',
    '/Library/CoreAnalytics',
    '/Library/Receipts',
    '/Library/Updates',
    '/Library/Updates/ProductMetadata.plist',
    '/private',
    '/private/var',
    '/private/var/run/mds',
    '/private/var/dirs_cleaner',
    '/private/var/networkd',
    '/private/var/networkd/db',
    '/private/var/networkd/db/netusage.sqlite-shm',
    '/private/var/networkd/db/netusage.sqlite-wal',
    '/private/var/sntpd',
    '/private/var/sntpd/state.bin',
    '/private/var/rpc',
    '/private/var/rpc/ncacn_np',
    ...['lsarpc', 'mdssvc', 'srvsvc', 'wkssvc'].map(name => `/private/var/rpc/ncacn_np/${name}`),
    '/private/var/rpc/ncalrpc',
    ...['NETLOGON', 'lsarpc', 'srvsvc', 'wkssvc'].map(name => `/private/var/rpc/ncalrpc/${name}`),
    '/private/var/run',
    ...[
      '.sim_diagnosticd_socket',
      'MobileAssetCriticalDomainsUpdated.plist',
      'MobileAssetStartupActivation.doneThisBoot',
      'automount.initialized',
      'bootSessionMA.txt',
      'com.apple.AssetCache',
      'com.apple.AssetCache/AssetCache.pid',
      'com.apple.DumpPanic.finishedThisBoot',
      'com.apple.WindowServer.didRunThisBoot',
      'com.apple.logind.didRunThisBoot',
      'com.apple.loginwindow.didRunThisBoot',
      'com.apple.mdmclient.daemon.didRunThisBoot',
      'com.apple.security.cryptexd',
      'com.apple.security.cryptexd/codex.system',
      ...['boot-session', 'bootstrap', 'live', 'remote', 'stage'].map(name =>
        `com.apple.security.cryptexd/codex.system/${name}`
      ),
      ...['init', 'mnt', 'shdw'].map(name => `com.apple.security.cryptexd/${name}`),
      'cupsd',
      'diskarbitrationd.pid',
      'filesystemui.socket',
      'kdc.pid',
      'mDNSResponder',
      'portmap.socket',
      'pppconfd',
      'resolv.conf',
      'syslog',
      'syslog.pid',
      'systemkeychaincheck.done',
      'systemkeychaincheck.socket',
      'usbmuxd',
      'utmpx',
      'vpncontrol.sock',
    ].map(name => `/private/var/run/${name}`),
    '/private/tmp/.AppleMiniSetupDidRun',
    '/private/tmp/.appleLogoTransition',
    '/private/tmp/.skipHello',
    '/private/tmp/powerlog',
    '/private/tmp',
  ].map(onVolume)
  const guestParents = [
    guestHome,
    FS.resolvePath('Library', guestHome),
    FS.resolvePath('Library/Caches', guestHome),
    FS.resolvePath('Library/Caches/com.apple.nsservicescache.plist', guestHome),
    FS.resolvePath('Library/Assistant', guestHome),
    FS.resolvePath('Library/Assistant/assistantdDidLaunch', guestHome),
    FS.resolvePath('Library/Sharing', guestHome),
    FS.resolvePath('Library/Spotlight', guestHome),
    FS.resolvePath('Library/Assistant/sync_flagcom.apple.siri.applications', guestHome),
    FS.resolvePath('Library/homeenergyd', guestHome),
    FS.resolvePath('Library/HTTPStorages', guestHome),
    FS.resolvePath('Library/Logs', guestHome),
    FS.resolvePath('Library/Google', guestHome),
    FS.resolvePath('Library/Google/GoogleSoftwareUpdate', guestHome),
    FS.resolvePath('Library/LaunchAgents', guestHome),
    FS.resolvePath('Library/PPM', guestHome),
    FS.resolvePath('Library/PPM/PAT', guestHome),
    FS.resolvePath('Library/Safari', guestHome),
    FS.resolvePath('Library/Photos', guestHome),
    FS.resolvePath('Library/Photos/Libraries', guestHome),
    FS.resolvePath('Movies', guestHome),
    FS.resolvePath('Movies/TV', guestHome),
    ...['', '-shm', '-wal'].map(suffix =>
      FS.resolvePath(`Library/Safari/IgnoredSiriSuggestedSites.db${suffix}`, guestHome)
    ),
    FS.resolvePath('Pictures', guestHome),
  ]
  // These exact artifacts shipped in the VM baseline; only their cleanup is expected.
  const baselineMount = onVolume('/private/tmp/tmp-mount-3nVTcs')
  const removedBaselineArtifacts = [
    baselineMount,
    FS.resolvePath('BlobRegistryFiles-bghqW6Fr', guestTemp),
    FS.resolvePath('CFNetworkDownload_TZj7l3.tmp', guestTemp),
  ]
  const runtimeRoot = onVolume('/private/var/run')
  const ppmPatRoot = FS.resolvePath('Library/PPM/PAT', guestHome)
  const ppmPatArtifact = (path: string) =>
    path === ppmPatRoot
    || /^Tokens_\d{2}_\d{2}_\d{4}_\d{2}_\d{2}_\d{2}\.pat$/u.test(FS.relativePath(ppmPatRoot, path))
  const googleUpdaterTempPath = (path: string) => {
    const [root, child, ...rest] = FS.relativePath(guestTemp, path).split('/')
    return /^com\.google\.GoogleUpdater\.GoogleUpdater_chrome_url_fetcher_\.[A-Za-z0-9]{6}$/u.test(root ?? '')
      && rest.length === 0
      && (child === undefined || child === 'decoded_xz' || /^[a-f0-9]{64}$/u.test(child))
  }
  const launchdDirectory = (path: string) =>
    /^com\.apple\.launchd\.[A-Za-z0-9]+$/.test(
      FS.relativePath(runtimeRoot, path),
    )
  const launchdPath = (path: string) =>
    /^com\.apple\.launchd\.[A-Za-z0-9]+(?:\/Listeners)?$/.test(
      FS.relativePath(runtimeRoot, path),
    )
  const xcodeSystem = scope.vmProfile === 'xcode'
    ? [
      onVolume('/Library/Developer/CoreSimulator'),
      FS.resolvePath('Library/Developer/CoreSimulator', guestHome),
      FS.resolvePath('Library/Logs/CoreSimulator', guestHome),
    ]
    : []
  const xcodeExact = scope.vmProfile === 'xcode'
    ? [
      '/private/tmp/tart-guest-agent.log',
      '/private/tmp/tart-guest-daemon.log',
      '/private/var/tmp',
      '/private/var/tmp/SoftwareUpdateCore_NRD/EventReporterPersistedState',
      '/private/var/tmp/SoftwareUpdateCore_NRD/EventReporterPersistedState/SUCoreEventReporterState.state',
      '/private/var/tmp/SoftwareUpdateCore_NRD/RecorderSplunkRecords',
    ].map(onVolume)
    : []
  // These baseline directories changed only their timestamp, not their entries or permissions.
  const xcodeTimestampDirectories = [
    FS.resolvePath('.rbenv/shims', guestHome),
    ...['assistantd', 'assistantd/TemporaryItems', 'siriknowledged'].map(name => FS.resolvePath(name, guestTemp)),
  ]
  const xcodeTemporaryDirectories = scope.vmProfile === 'xcode'
    ? ['assistantd', 'assistantd/TemporaryItems', 'siriknowledged'].map(name => FS.resolvePath(name, guestTemp))
    : []
  const xcodeTemporaryDirectoryChanges = new Set(
    diff.changed.filter(change =>
      xcodeTemporaryDirectories.includes(change.path)
      && change.before.kind === 'directory' && change.after.kind === 'directory'
      && JSON.stringify({ ...change.before, device: 0, inode: 0, modifiedMs: 0 })
        === JSON.stringify({ ...change.after, device: 0, inode: 0, modifiedMs: 0 })
    ).map(change => change.path),
  )
  const timestampChanged = new Set(
    diff.changed.filter(change =>
      change.before.kind === 'directory' && change.after.kind === 'directory'
      && JSON.stringify({ ...change.before, device: 0, modifiedMs: 0 })
        === JSON.stringify({ ...change.after, device: 0, modifiedMs: 0 })
    ).map(change => change.path),
  )
  const newsDirectory = FS.resolvePath(
    'Library/News/com.apple.news.public-com.apple.news.private-production',
    guestHome,
  )
  // Observed Tahoe background metadata only: exact paths and shapes, never their descendants.
  const observedMetadata = new Map<string, { kind: string; beforeSize: number; afterSize: number }>(([
    ['Library/Caches/com.apple.Safari.SafeBrowsing', { kind: 'directory', beforeSize: 160, afterSize: 192 }],
    ['Library/Caches/com.apple.Safari.SafeBrowsing/Cache.db-shm', {
      kind: 'file',
      beforeSize: 32768,
      afterSize: 32768,
    }],
    ['Library/Caches/com.apple.Safari.SafeBrowsing/Cache.db-wal', {
      kind: 'file',
      beforeSize: 41232,
      afterSize: 49472,
    }],
    ['Library/Safari/PasswordBreachStore.plist', { kind: 'file', beforeSize: 335, afterSize: 335 }],
  ] as const).map(([path, shape]) => [FS.resolvePath(path, guestHome), shape]))
  const observedMetadataChanges = new Set(
    diff.changed.filter(({ path, before, after }) => {
      const shape = observedMetadata.get(path)
      return shape !== undefined && before.kind === shape.kind && after.kind === shape.kind
        && before.size === shape.beforeSize && after.size === shape.afterSize
        && after.uid === 501 && after.gid === 20 && after.mode === (shape.kind === 'file' ? 0o100644 : 0o40755)
        && JSON.stringify({ ...before, device: 0, modifiedMs: 0, size: 0 })
          === JSON.stringify({ ...after, device: 0, modifiedMs: 0, size: 0 })
    }).map(change => change.path),
  )
  for (const relative of ['Library/Caches/com.apple.Safari.SafeBrowsing/fsCachedData', 'Library/PrivateCloudCompute']) {
    const path = FS.resolvePath(relative, guestHome)
    const entry = afterEntries[path]
    if (
      diff.added.includes(path) && entry?.kind === 'directory' && entry.size === 64
      && entry.mode === 0o40755 && entry.uid === 501 && entry.gid === 20
    ) {
      observedMetadataChanges.add(path)
    }
  }
  // Recognize the observed extension-install shape, without attributing who wrote it.
  const retainedChanges = new Set([...diff.added, ...diff.changed.map(change => change.path)])
  const chromeInstallRoots = new Set(
    [...retainedChanges].filter(path =>
      /^scoped_dir[A-Za-z0-9]{6}\/\.com\.google\.Chrome\.[A-Za-z0-9]{6}$/.test(FS.relativePath(guestTemp, path))
      && retainedChanges.has(FS.resolvePath('CRX_INSTALL', FS.dirname(path)))
    ).map(path => FS.dirname(path)),
  )
  // Chromium corroborates scoped_dir and bundle-ID temp naming, not the writer here:
  // https://chromium.googlesource.com/chromium/src/+/refs/tags/127.0.6527.0/base/files/scoped_temp_dir.cc
  // https://chromium.googlesource.com/chromium/src/+/refs/tags/129.0.6668.39/base/files/file_util_posix.cc
  // Treat this as an inferred writer only for the exact empty Xcode staging pair observed in the snapshot.
  const xcodeChromeStagingPaths = new Set<string>()
  if (scope.vmProfile === 'xcode') {
    for (const root of diff.added.filter(path => /^scoped_dir[A-Za-z0-9]{6}$/.test(FS.relativePath(guestTemp, path)))) {
      const marker = diff.added.find(path =>
        FS.dirname(path) === root && /^\.com\.google\.Chrome\.[A-Za-z0-9]{6}$/.test(FS.basename(path))
      )
      const directory = afterEntries[root]
      const file = marker === undefined ? undefined : afterEntries[marker]
      if (
        marker !== undefined
        && directory?.kind === 'directory' && directory.mode === 0o40700 && directory.size === 96
        && directory.uid === 501 && directory.gid === 20
        && file?.kind === 'file' && file.mode === 0o100600 && file.size === 0
        && file.uid === 501 && file.gid === 20
      ) {
        xcodeChromeStagingPaths.add(root)
        xcodeChromeStagingPaths.add(marker)
      }
    }
  }
  const cryptexRoot = onVolume('/private/var/run/com.apple.security.cryptexd')
  const xcodeCryptex = (path: string) => {
    if (scope.vmProfile !== 'xcode') {
      return false
    }
    const relative = FS.relativePath(cryptexRoot, path)
    const asset =
      'com\\.apple\\.(?:(?:AppleTVOS|WatchOS|XROS|iPhoneOS)\\.SimulatorRuntime|MobileAsset\\.MetalToolchain)'
      + '-v[0-9]+(?:\\.[0-9]+){3}'
    return new RegExp(`^(?:codex\\.system/(?:boot-session|live)/${asset}|mnt/${asset}\\.[A-Za-z0-9]{6})$`)
      .test(relative)
      || (/^codex\.system\/stage\/protex\.[A-Za-z0-9]{6}$/.test(relative) && diff.removed.includes(path)
        && !diff.afterIssues.some(issue => issue.path === path) && !diff.afterSkippedMounts.includes(path))
  }
  const xcodeRemoved = (path: string) =>
    scope.vmProfile === 'xcode' && diff.removed.includes(path) && (
      path === onVolume('/private/var/run/hdiejectd.pid')
      || ['adb.501.log', 'hsperfdata_admin', 'metrickitd'].some(name => path === FS.resolvePath(name, guestTemp))
      || /^cryptex\.personalize\.[A-Za-z0-9]{6}(?:\/im4m)?$/.test(FS.relativePath(guestTemp, path))
      || /^cryptex_personalized_manifest\.[A-Za-z0-9]{6}$/.test(FS.relativePath(guestTemp, path))
    )
  const allowedSystem = [...system, ...guestSystem, ...guestCache, ...guestSystemTrees, ...xcodeSystem]
  const changed = [
    ...diff.added,
    ...diff.changed.map(change => change.path),
    ...diff.removed,
  ]
  const violations = changed.filter(path => {
    if (FS.pathIsWithin(path, acceptanceHome)) {
      return path !== acceptanceHome && !permittedHome.some(allowed => FS.pathIsWithin(path, allowed))
    }
    if (FS.pathIsWithin(path, acceptanceRoot)) {
      return path !== acceptanceRoot && !permittedHarness.some(allowed => FS.pathIsWithin(path, allowed))
    }
    if ([...forbiddenExternal, ...forbiddenTemp].some(forbidden => FS.pathIsWithin(path, forbidden))) {
      return true
    }
    if (
      xcodeExact.includes(path) || systemExact.includes(path) || guestSystemExact.includes(path)
      || ppmPatArtifact(path) || googleUpdaterTempPath(path)
      || xcodeChromeStagingPaths.has(path)
      || xcodeCryptex(path) || xcodeRemoved(path)
      || xcodeTemporaryDirectoryChanges.has(path)
      || (scope.vmProfile === 'xcode' && xcodeTimestampDirectories.includes(path) && timestampChanged.has(path))
      || (path === newsDirectory && timestampChanged.has(path))
      || observedMetadataChanges.has(path)
    ) {
      return false
    }
    if (removedBaselineArtifacts.includes(path)) {
      return !diff.removed.includes(path)
    }
    if (launchdPath(path)) {
      return false
    }
    if (FS.pathIsWithin(path, fixtureLogs)) {
      return false
    }
    if (FS.pathIsWithin(path, guestTemp)) {
      if (scope.vmProfile === 'xcode' && path === FS.resolvePath('xcrun_db', guestTemp)) {
        return false
      }
      if (
        [...chromeInstallRoots].some(root =>
          path === root || path === FS.resolvePath('CRX_INSTALL', root)
          || (retainedChanges.has(FS.resolvePath('CRX_INSTALL/manifest.json', root))
            && FS.pathIsWithin(path, FS.resolvePath('CRX_INSTALL', root)))
          || (FS.dirname(path) === root && /^\.com\.google\.Chrome\.[A-Za-z0-9]{6}$/.test(FS.basename(path))
            && retainedChanges.has(path))
        )
      ) {
        return false
      }
      const child = path.slice(guestTemp.length + 1).split('/')[0] ?? ''
      return path !== guestTemp && !child.startsWith('com.apple.')
        && !child.startsWith('com.google.Chrome.') && !child.startsWith('.com.google.Chrome.')
        // Only the recorded browser fixture may retain its Chrome profile here.
        && !browserProfiles.some(profile => FS.pathIsWithin(path, profile))
        && ![
          '.LINKS',
          'TemporaryItems',
          'duetexpertd',
          'diagnosticextensionsd',
          'proactived',
          'contentlinkingd',
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
        ].includes(child)
    }
    return ![diff.root, ...systemParents, ...guestParents].includes(path)
      && !allowedSystem.some(allowed => FS.pathIsWithin(path, allowed))
  })
  const unobservableSystem = [
    '/.Spotlight-V100',
    '/.fseventsd',
    '/Library/Application Support/Apple/AssetCache/Data',
    '/Library/Application Support/Apple/ParentalControls/Users',
    '/Library/Caches/com.apple.amsengagementd.classicdatavault',
    '/Library/Caches/com.apple.aned',
    '/Library/Caches/com.apple.aneuserd',
    '/private/etc/cups/certs',
    '/private/var/OOPJit',
    '/private/var/agentx',
    '/private/var/at/tabs',
    '/private/var/at/tmp',
    '/private/var/audit',
    '/private/var/backups',
    '/private/var/dirs_cleaner',
    '/private/var/install',
    '/private/var/jabberd',
    '/private/var/lib/postfix',
    '/private/var/ma',
    '/private/var/networkd/Library',
    '/private/var/networkd/db',
    '/private/var/root',
    '/private/var/run/mds',
    '/private/var/spool/cups',
    '/private/var/spool/mqueue',
    '/private/var/spool/postfix/active',
    '/private/var/spool/postfix/bounce',
    '/private/var/spool/postfix/corrupt',
    '/private/var/spool/postfix/defer',
    '/private/var/spool/postfix/deferred',
    '/private/var/spool/postfix/flush',
    '/private/var/spool/postfix/hold',
    '/private/var/spool/postfix/incoming',
    '/private/var/spool/postfix/maildrop',
    '/private/var/spool/postfix/private',
    '/private/var/spool/postfix/public',
    '/private/var/spool/postfix/saved',
    '/private/var/spool/postfix/trace',
  ].map(onVolume)
  const unobservable = [
    ...diff.beforeIssues.map(issue => issue.path),
    ...diff.afterIssues.map(issue => issue.path),
    ...diff.beforeSkippedMounts,
    ...diff.afterSkippedMounts,
  ].filter(path => {
    if (FS.pathIsWithin(path, acceptanceRoot)) {
      return true
    }
    if ([...forbiddenExternal, ...forbiddenTemp].some(forbidden => FS.pathIsWithin(path, forbidden))) {
      return true
    }
    if (
      path === baselineMount && diff.removed.includes(path)
      && !diff.afterIssues.some(issue => issue.path === path) && !diff.afterSkippedMounts.includes(path)
    ) {
      return false
    }
    if (launchdDirectory(path)) {
      return false
    }
    if (xcodeCryptex(path)) {
      return false
    }
    if ([onVolume('/Volumes/My Shared Files'), onVolume('/home')].includes(path)) {
      return false
    }
    return !unobservableSystem.includes(path)
      && !allowedSystem.some(allowed => FS.pathIsWithin(path, allowed))
  })
  violations.push(...unobservable.map(path => `unobservable: ${path}`))
  if (!changed.some(path => FS.pathIsWithin(path, acceptanceRoot))) {
    violations.push(`acceptance root absent from the diff: ${acceptanceRoot}`)
  }
  return [...new Set(violations)].sort()
}

function report(diff: Diff): string {
  const lines = [
    `Filesystem audit of ${diff.root}`,
    `Added: ${diff.added.length}; changed: ${diff.changed.length}; removed: ${diff.removed.length}.`,
    `Unreadable paths: ${diff.beforeIssues.length} before, ${diff.afterIssues.length} after.`,
    `Disallowed or unobservable test paths: ${diff.violations.length}.`,
    'This compares path metadata (type, size, modification time, ownership, mode, symlink target), not file contents.',
    'It excludes other mounted volumes and cannot see files created and removed between snapshots.',
    'Full path lists and metadata are in filesystem-diff.json; macOS background changes may appear.',
    'The policy rejects every observed change outside the acceptance and explicit macOS-owned paths.',
    'Allowed OS directories can also contain unobserved tool writes; this snapshot cannot attribute writers.',
  ]
  if (diff.violations.length > 0) {
    lines.push('', 'Disallowed or unobservable test paths (first 200):', ...diff.violations.slice(0, REPORT_LIMIT))
  }
  for (
    const [label, paths] of [
      ['Added', diff.added],
      ['Changed', diff.changed.map(change => change.path)],
      ['Removed', diff.removed],
    ] as const
  ) {
    lines.push('', `${label} (first ${Math.min(paths.length, REPORT_LIMIT)}):`)
    lines.push(...paths.slice(0, REPORT_LIMIT))
  }
  if (diff.incomplete) {
    lines.push('', 'Unreadable paths (first 20):')
    lines.push(
      ...[...diff.beforeIssues, ...diff.afterIssues].slice(0, 20).map(issue => `${issue.path}: ${issue.error}`),
    )
  }
  return `${lines.join('\n')}\n`
}

try {
  await main(Platform.runtimeProcess.argv.slice(2))
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}
