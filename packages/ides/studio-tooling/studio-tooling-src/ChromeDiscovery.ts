import { CLI, FS, Platform } from '@shared'

export type DiscoveredChrome = { configured: boolean; path: string }

const applicationCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
] as const

const commandCandidates = ['google-chrome', 'chromium', 'chromium-browser'] as const

/**
 * Finds the Chrome or Chromium the browser lanes drive: an explicit `TAO_STUDIO_CHROME_PATH` or
 * `CHROME_PATH`, then an installed application, then one on PATH, then a Chromium a Playwright
 * install left under `PLAYWRIGHT_BROWSERS_PATH`, as hosted Linux containers preinstall.
 */
export async function findChromeExecutable(): Promise<DiscoveredChrome | undefined> {
  const env = Platform.runtimeProcess.env
  const configured = env['TAO_STUDIO_CHROME_PATH'] ?? env['CHROME_PATH']
  if (configured !== undefined && configured.trim() !== '' && await FS.isFile(configured)) {
    return { configured: true, path: configured }
  }
  for (const candidate of applicationCandidates) {
    if (await FS.isFile(candidate)) {
      return { configured: false, path: candidate }
    }
  }
  for (const command of commandCandidates) {
    const path = await CLI.commandPath(command)
    if (path !== undefined) {
      return { configured: false, path }
    }
  }
  const playwright = await findPlaywrightChromium(env['PLAYWRIGHT_BROWSERS_PATH'])
  return playwright === undefined ? undefined : { configured: false, path: playwright }
}

/** Chrome refuses to start its sandbox as root, which is how hosted Linux containers run. */
export function chromeSandboxArgs(): string[] {
  return Platform.hostPlatform === 'linux' && Platform.runtimeProcess.uid === 0 ? ['--no-sandbox'] : []
}

/** The newest Chromium a Playwright browsers root holds, preferring its `chromium` link. */
export async function findPlaywrightChromium(browsersRoot: string | undefined): Promise<string | undefined> {
  if (browsersRoot === undefined || browsersRoot.trim() === '' || !await FS.isDirectory(browsersRoot)) {
    return undefined
  }
  const linked = FS.resolvePath('chromium', browsersRoot)
  if (await FS.isFile(linked)) {
    return linked
  }
  const revisions = (await FS.listDir(browsersRoot))
    .filter(name => /^chromium-\d+$/u.test(name))
    .sort((left, right) => Number(right.slice('chromium-'.length)) - Number(left.slice('chromium-'.length)))
  for (const revision of revisions) {
    for (
      const relative of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']
    ) {
      const path = FS.resolvePath(`${revision}/${relative}`, browsersRoot)
      if (await FS.isFile(path)) {
        return path
      }
    }
  }
  return undefined
}
