import { FS } from '@shared'

const TEST_APPS_DIR = 'Test Apps'
const CURRENT_DIR = 'Current'

/** discoverSwitchableAppPaths lists Tao app entry files under Apps without package subdirs. */
export async function discoverSwitchableAppPaths(appsRoot: string): Promise<string[]> {
  const appPaths: string[] = []

  for (const entry of await FS.listDir(appsRoot)) {
    if (entry === TEST_APPS_DIR) {
      continue
    }
    const appFamilyDirectory = FS.resolvePath(entry, appsRoot)
    await collectAppInDirectory(appFamilyDirectory, appPaths)
    await collectNamedAppInDirectory(FS.resolvePath(CURRENT_DIR, appFamilyDirectory), entry, appPaths)
  }

  const testAppsRoot = FS.resolvePath(TEST_APPS_DIR, appsRoot)
  if (await FS.isDirectory(testAppsRoot)) {
    for (const entry of await FS.listDir(testAppsRoot)) {
      await collectAppInDirectory(FS.resolvePath(entry, testAppsRoot), appPaths)
    }
  }

  return appPaths.sort(compareSwitchableAppPaths)
}

async function collectAppInDirectory(appDirectory: string, appPaths: string[]): Promise<void> {
  if (!await FS.isDirectory(appDirectory)) {
    return
  }

  const appName = FS.basename(appDirectory)
  await collectNamedAppInDirectory(appDirectory, appName, appPaths)
}

async function collectNamedAppInDirectory(
  appDirectory: string,
  appName: string,
  appPaths: string[],
): Promise<void> {
  if (!await FS.isDirectory(appDirectory)) {
    return
  }
  const appPath = FS.resolvePath(`${appName}.tao`, appDirectory)
  if (await FS.isFile(appPath)) {
    appPaths.push(appPath)
  }
}

function compareSwitchableAppPaths(left: string, right: string): number {
  const leftIsCurrent = FS.basename(FS.dirname(left)) === CURRENT_DIR
  const rightIsCurrent = FS.basename(FS.dirname(right)) === CURRENT_DIR
  if (leftIsCurrent !== rightIsCurrent) {
    return leftIsCurrent ? -1 : 1
  }
  return left.localeCompare(right)
}
