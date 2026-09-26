import { DesktopHost } from '@expo-host'
import { Errors, FS } from '@shared'

/** Package one frozen web export into an unsigned, locally runnable macOS app. */
export async function buildDesktopApp(options: {
  appName: string
  outputRoot: string
  siteRoot: string
  workRoot: string
  agents?: { buildId: string }
}): Promise<string> {
  const host = await DesktopHost.prepare({
    appName: options.appName,
    root: FS.resolvePath('desktop-host', options.workRoot),
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
}
