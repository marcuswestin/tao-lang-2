import { DesktopHost } from '@expo-host'
import { Errors, FS, ReleaseCapabilities } from '@shared'

/** Package one frozen web export into an unsigned, locally runnable macOS app. */
export async function buildDesktopApp(options: {
  appName: string
  outputRoot: string
  siteRoot: string
  agents?: { buildId: string }
}): Promise<string> {
  ReleaseCapabilities.require('desktop')
  const hostRoot = FS.resolvePath('.host', options.outputRoot)
  try {
    const host = await DesktopHost.prepare({
      appName: options.appName,
      root: hostRoot,
      siteRoot: options.siteRoot,
      agents: options.agents,
    })
    const builtApp = await DesktopHost.build(host)
    const destination = FS.resolvePath(FS.basename(builtApp), options.outputRoot)
    if (await FS.exists(destination)) {
      Errors.throwUnexpected(`Desktop app output already exists: ${destination}`)
    }
    await FS.move(builtApp, destination)
    return destination
  } finally {
    await FS.remove(hostRoot)
  }
}
