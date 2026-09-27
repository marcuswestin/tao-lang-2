import type { HostManifest } from '@expo-host/dev-loop/prebuilt-host/HostManifest'
import { downloadCompatibleHost, type HostDownloadOptions } from '@expo-host/dev-loop/prebuilt-host/HostReleases'
import { CLI, Errors, FS, Platform } from '@shared'

// Run only in the owned child: Linux supplies a PATH-local ZIP-backed ditto fixture;
// macOS exercises the system ditto, including its actual bundle extraction behavior.
const root = Platform.runtimeProcess.argv[2]
const bundleName = Platform.runtimeProcess.argv[3]
if (root === undefined || bundleName === undefined) {
  Errors.throwUnexpected('The host archive fixture needs its directory and bundle name.')
}
const app = FS.resolvePath(`bundle/${bundleName}`, root)
await FS.writeText(FS.resolvePath('Info.plist', app), '<plist/>')
const zip = FS.resolvePath('tao-companion-ios-simulator.app.zip', root)
await CLI.mustRun('ditto', { args: ['-c', '-k', '--keepParent', app, zip] })
const archive = (await FS.readFile(zip)).slice().buffer
const manifest: HostManifest = { format: 1, hostVersion: '1.0.0', nativeKit: {}, platform: 'ios-simulator' }
const routes: Record<string, unknown> = {
  'https://api.github.com/repos/tao/tao/releases?per_page=30&page=1': [{
    assets: [
      { browser_download_url: 'https://dl/ios/m.json', name: 'tao-host-ios-simulator.json', size: 1 },
      {
        browser_download_url: 'https://dl/ios/app.zip',
        name: 'tao-companion-ios-simulator.app.zip',
        size: archive.byteLength,
      },
    ],
    draft: false,
    tag_name: 'companion-host-1.0.0-ios',
  }],
  'https://dl/ios/m.json': manifest,
  'https://dl/ios/app.zip': archive,
}
const fetch: HostDownloadOptions['fetch'] = async url => {
  const body = routes[url]
  if (body === undefined) {
    return new Response('Not Found', { status: 404 })
  }
  return body instanceof ArrayBuffer ? new Response(body) : Response.json(body)
}
let result: { binaryPath?: string; error?: string }
try {
  const search = await downloadCompatibleHost('ios-simulator', {}, {
    fetch,
    hostsRoot: FS.resolvePath('hosts', root),
    repository: 'tao/tao',
  })
  result = { binaryPath: search.host?.binaryPath }
} catch (error) {
  result = { error: Errors.asError(error).message }
}
await FS.writeJson(FS.resolvePath('result.json', root), result)
