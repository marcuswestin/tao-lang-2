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
  changed: Change[]
  incomplete: boolean
  removed: string[]
  root: string
  afterIssues: Issue[]
}

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
  if (args[0] === 'compare' && args.length === 5) {
    const before = await FS.readJson<Snapshot>(FS.resolvePath(args[1]!))
    const after = await FS.readJson<Snapshot>(FS.resolvePath(args[2]!))
    const diff = compare(before, after)
    await FS.writeText(FS.resolvePath(args[3]!), `${JSON.stringify(diff)}\n`)
    await FS.writeText(FS.resolvePath(args[4]!), report(diff))
    HCI.writeLine(
      `Filesystem audit: ${diff.added.length} added, ${diff.changed.length} changed, `
        + `${diff.removed.length} removed; ${
          diff.incomplete ? 'incomplete (unreadable paths)' : 'complete in scanned volume'
        }.`,
    )
    return
  }
  Errors.throwUserInput(
    'Usage: filesystem-audit snapshot <root> <output.json> | compare <before.json> <after.json> <diff.json> <report.txt>',
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
    beforeIssues: before.issues,
    changed: [],
    incomplete: before.issues.length > 0 || after.issues.length > 0,
    removed: [],
    root: before.root,
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

function report(diff: Diff): string {
  const lines = [
    `Filesystem audit of ${diff.root}`,
    `Added: ${diff.added.length}; changed: ${diff.changed.length}; removed: ${diff.removed.length}.`,
    `Unreadable paths: ${diff.beforeIssues.length} before, ${diff.afterIssues.length} after.`,
    'This compares path metadata (type, size, modification time, ownership, mode, symlink target), not file contents.',
    'It excludes other mounted volumes and cannot see files created and removed between snapshots.',
    'Full path lists and metadata are in filesystem-diff.json; macOS background changes may appear.',
  ]
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
