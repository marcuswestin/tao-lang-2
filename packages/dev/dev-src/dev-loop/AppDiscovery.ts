import { FS } from '@shared'

const TEST_APPS_DIR = 'Test Apps'

/** discoverSwitchableAppPaths lists Tao app entry files under Apps without package subdirs. */
export async function discoverSwitchableAppPaths(appsRoot: string): Promise<string[]> {
  const appPaths: string[] = []

  for (const entry of await FS.listDir(appsRoot)) {
    if (entry === TEST_APPS_DIR) {
      continue
    }
    await collectAppInDirectory(FS.resolvePath(entry, { cwd: appsRoot }), appPaths)
  }

  const testAppsRoot = FS.resolvePath(TEST_APPS_DIR, { cwd: appsRoot })
  if (await FS.isDirectory(testAppsRoot)) {
    for (const entry of await FS.listDir(testAppsRoot)) {
      await collectAppInDirectory(FS.resolvePath(entry, { cwd: testAppsRoot }), appPaths)
    }
  }

  return appPaths.sort((left, right) => left.localeCompare(right))
}

async function collectAppInDirectory(appDirectory: string, appPaths: string[]): Promise<void> {
  if (!await FS.isDirectory(appDirectory)) {
    return
  }

  const appName = FS.basename(appDirectory)
  const appPath = FS.resolvePath(`${appName}.tao`, { cwd: appDirectory })
  if (await FS.isFile(appPath)) {
    appPaths.push(appPath)
  }
}
