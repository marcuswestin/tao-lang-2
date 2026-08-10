import { FS } from '@shared'

const TEST_APPS_DIR = 'Test Apps'
// The canonical MVP app lives one level deeper so its target sketch can sit beside it.
const NESTED_APP_DIRS = [TEST_APPS_DIR, 'MVP']

/** discoverSwitchableAppPaths lists Tao app entry files under Apps without package subdirs. */
export async function discoverSwitchableAppPaths(appsRoot: string): Promise<string[]> {
  const appPaths: string[] = []

  for (const entry of await FS.listDir(appsRoot)) {
    if (NESTED_APP_DIRS.includes(entry)) {
      continue
    }
    await collectAppInDirectory(FS.resolvePath(entry, appsRoot), appPaths)
  }

  for (const nested of NESTED_APP_DIRS) {
    const nestedRoot = FS.resolvePath(nested, appsRoot)
    if (!await FS.isDirectory(nestedRoot)) {
      continue
    }
    for (const entry of await FS.listDir(nestedRoot)) {
      await collectAppInDirectory(FS.resolvePath(entry, nestedRoot), appPaths)
    }
  }

  return appPaths.sort((left, right) => left.localeCompare(right))
}

async function collectAppInDirectory(appDirectory: string, appPaths: string[]): Promise<void> {
  if (!await FS.isDirectory(appDirectory)) {
    return
  }

  const appName = FS.basename(appDirectory)
  const appPath = FS.resolvePath(`${appName}.tao`, appDirectory)
  if (await FS.isFile(appPath)) {
    appPaths.push(appPath)
    return
  }
  // A directory may hold one differently named app entry, as `Apps/MVP/Current/Still.tao` does.
  const entries = await FS.listDir(appDirectory)
  const taoEntries = entries.filter(entry => entry.endsWith('.tao') && !entry.endsWith('.test.tao'))
  const soleEntry = taoEntries.length === 1 ? taoEntries[0] : undefined
  if (soleEntry) {
    appPaths.push(FS.resolvePath(soleEntry, appDirectory))
  }
}
