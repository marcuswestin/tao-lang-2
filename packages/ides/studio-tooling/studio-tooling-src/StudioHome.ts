import { FS, Json, Platform, TaoHome } from '@shared'

type RecentProject = { appName: string; project: string; lastOpenedAt: string }

/** One canonical file lock coordinates recents migration and every Studio writer. */
export async function withStudioRecentsLock<Value>(path: string, work: () => Promise<Value>): Promise<Value> {
  const studioRoot = FS.dirname(path)
  const homeRoot = FS.basename(studioRoot) === 'studio' ? FS.dirname(studioRoot) : studioRoot
  await FS.mkdir(studioRoot)
  return await FS.withFileMutationLock(studioRoot, homeRoot, work, {
    lockDirectory: FS.resolvePath('cache/studio/locks', homeRoot),
  })
}

/** A missing or invalid recents file contributes no entries to a later valid write. */
export async function readStudioRecentProjects(path: string): Promise<RecentProject[] | undefined> {
  try {
    if (!await FS.isFile(path)) {
      return undefined
    }
    const value = await FS.readJson(path)
    if (!Json.isRecord(value) || value['version'] !== 1 || !Array.isArray(value['recent'])) {
      return undefined
    }
    return value['recent'].filter((item): item is RecentProject =>
      Json.isRecord(item)
      && typeof item['project'] === 'string' && item['project'].trim() !== ''
      && typeof item['appName'] === 'string' && item['appName'].trim() !== ''
      && typeof item['lastOpenedAt'] === 'string' && !Number.isNaN(Date.parse(item['lastOpenedAt']))
    )
  } catch {
    return undefined
  }
}

/** Merge stale snapshots by project and app, keeping the latest opening and the newest twelve. */
export function mergeStudioRecentProjects(
  current: readonly RecentProject[],
  incoming: readonly RecentProject[],
): RecentProject[] {
  const entries = new Map<string, RecentProject>()
  for (const entry of [...current, ...incoming]) {
    const key = JSON.stringify([entry.project, entry.appName])
    const previous = entries.get(key)
    if (previous === undefined || Date.parse(entry.lastOpenedAt) > Date.parse(previous.lastOpenedAt)) {
      entries.set(key, entry)
    }
  }
  return [...entries.values()].sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt)).slice(0, 12)
}

/** Stage beside the home cache, then replace the durable recents file atomically. */
export async function writeStudioRecentProjects(path: string, recent: readonly RecentProject[]): Promise<void> {
  const studioRoot = FS.dirname(path)
  const homeRoot = FS.basename(studioRoot) === 'studio' ? FS.dirname(studioRoot) : studioRoot
  const temporary = FS.resolvePath(`cache/studio/tmp/${Platform.randomUUID()}.json`, homeRoot)
  try {
    await FS.writeJson(temporary, { version: 1, recent })
    await FS.move(temporary, path)
  } finally {
    await FS.remove(temporary)
  }
}

/** Moves recognized home Studio state once, preserving unknown entries and destination conflicts. */
export async function prepareStudioHome(legacyRoot: string, homeRoot = TaoHome.root()): Promise<string> {
  const root = FS.resolvePath('studio', homeRoot)
  await FS.mkdir(root)
  await withStudioRecentsLock(FS.resolvePath('recent-projects.json', root), async () => {
    await mergeLegacyRecentProjects(legacyRoot, root)
    for (const entry of ['recent-projects.json', 'device-trust', 'launches', 'logs']) {
      await moveRecognized(FS.resolvePath(entry, legacyRoot), FS.resolvePath(entry, root))
    }
  })
  return root
}

async function moveRecognized(from: string, to: string): Promise<void> {
  if (!await FS.exists(from) || await FS.isSymbolicLink(from) || await FS.isSymbolicLink(to)) {
    return
  }
  if (await FS.isDirectory(from) && await FS.isDirectory(to)) {
    for (const entry of await FS.listDir(from)) {
      await moveRecognized(FS.resolvePath(entry, from), FS.resolvePath(entry, to))
    }
    return
  }
  if (await FS.exists(to)) {
    return
  }
  try {
    await FS.move(from, to)
  } catch (error) {
    // Another process may have prepared the same home concurrently.
    if (await FS.exists(from)) {
      throw error
    }
  }
}

async function mergeLegacyRecentProjects(legacyRoot: string, root: string): Promise<void> {
  const from = FS.resolvePath('recent-projects.json', legacyRoot)
  const to = FS.resolvePath('recent-projects.json', root)
  if (
    from === to || !await FS.isFile(from) || !await FS.isFile(to)
    || await FS.isSymbolicLink(from) || await FS.isSymbolicLink(to)
  ) {
    return
  }
  const older = await readStudioRecentProjects(from)
  const current = await readStudioRecentProjects(to)
  if (older === undefined || current === undefined) {
    return
  }
  const recent = mergeStudioRecentProjects(current, older)
  await writeStudioRecentProjects(to, recent)
  // Keep the full original as an upgrade backup while retiring its old import path.
  const contents = await FS.readText(from)
  const backup = FS.resolvePath(`migrations/recents/${Platform.sha256Hex(legacyRoot + contents)}.json`, root)
  if (!await FS.exists(backup)) {
    await FS.move(from, backup)
  } else {
    await FS.remove(from)
  }
}
