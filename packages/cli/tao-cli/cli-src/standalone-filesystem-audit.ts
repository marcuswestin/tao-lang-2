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
type AuditScope = { guestHome: string; guestTemp: string; root: string }

const REPORT_LIMIT = 200

async function main(args: string[]): Promise<void> {
  if (args[0] === 'snapshot' && args.length === 3) {
    const snapshot = await capture(FS.resolvePath(args[1]!))
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
      diff.violations = violations(diff, scope)
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
    'Usage: filesystem-audit snapshot <root> <output.json> | compare <before.json> <after.json> <diff.json> <report.txt> [scope.json]',
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
    } else if (JSON.stringify(old) !== JSON.stringify(after.entries[path])) {
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
function violations(diff: Diff, scope: AuditScope): string[] {
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
  ].map(name => FS.resolvePath(`Library/Caches/${name}`, guestHome))
  const guestSystem = [
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
    '/Library/Logs/DiagnosticReports',
    '/Library/Preferences',
    '/Library/Caches/com.apple.iconservices.store',
    '/private/var/db',
    '/private/var/folders',
    '/private/var/log',
    '/private/var/protected',
    '/private/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress',
  ].map(onVolume)
  const systemParents = [
    '/System',
    '/System/Library',
    '/Library',
    '/Library/Caches',
    '/Library/Keychains',
    '/Library/Keychains/apsd.keychain',
    '/Library/Logs',
    '/Library/Updates',
    '/Library/Updates/ProductMetadata.plist',
    '/private',
    '/private/var',
    '/private/var/run/mds',
    '/private/tmp',
  ].map(onVolume)
  const guestParents = [
    guestHome,
    FS.resolvePath('Library', guestHome),
    FS.resolvePath('Library/Caches', guestHome),
    FS.resolvePath('Library/Caches/com.apple.nsservicescache.plist', guestHome),
    FS.resolvePath('Library/Assistant', guestHome),
    FS.resolvePath('Library/Assistant/sync_flagcom.apple.siri.applications', guestHome),
    FS.resolvePath('Library/homeenergyd', guestHome),
    FS.resolvePath('Library/HTTPStorages', guestHome),
    FS.resolvePath('Library/Logs', guestHome),
    FS.resolvePath('Library/Safari', guestHome),
    FS.resolvePath('Library/Photos', guestHome),
    FS.resolvePath('Library/Photos/Libraries', guestHome),
    ...['', '-shm', '-wal'].map(suffix =>
      FS.resolvePath(`Library/Safari/IgnoredSiriSuggestedSites.db${suffix}`, guestHome)
    ),
    FS.resolvePath('Pictures', guestHome),
  ]
  const allowedSystem = [...system, ...guestSystem, ...guestCache]
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
    if (FS.pathIsWithin(path, guestTemp)) {
      const child = path.slice(guestTemp.length + 1).split('/')[0] ?? ''
      return path !== guestTemp && !child.startsWith('com.apple.')
        && !child.startsWith('com.google.Chrome.') && !child.startsWith('.com.google.Chrome.')
        && !['.LINKS', 'TemporaryItems', 'duetexpertd', 'diagnosticextensionsd', 'proactived', 'contentlinkingd']
          .includes(child)
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
