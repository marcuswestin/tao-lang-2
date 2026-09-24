import { CLI, Errors, FS, Json, Platform, TaoHome } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { CompanionIdentity } from './CompanionIdentity'
import {
  HOST_BINARIES,
  hostKey,
  hostKitProblems,
  type HostManifest,
  type HostPlatform,
  type NativeKit,
  parseHostManifest,
  readHostManifest,
  writeHostManifest,
} from './HostManifest'
import type { HostSearch, PrebuiltHost } from './PrebuiltHosts'

/*
 * Prebuilt hosts are published on Tao's public repository as GitHub releases, one per host build,
 * tagged `companion-host-<hostKey>` and carrying a manifest and a binary for each platform built. A
 * release is a prerelease and never "latest", so it cannot displace a Tao CLI release. `tao dev`
 * needs no account to read them: it lists the releases, reads each small manifest, and downloads the
 * first binary whose native kit covers its own into Tao's home, staged and moved into place so a
 * concurrent `tao dev` never finds half a host.
 */

const HOST_RELEASE_TAG_PREFIX = 'companion-host-'
/** The repository whose releases carry prebuilt hosts; `TAO_HOST_RELEASES` names another. */
const DEFAULT_HOST_RELEASES_REPOSITORY = 'marcuswestin/tao-lang-2'
const RELEASES_TO_CONSIDER = 30

/** HostReleaseAssets names one platform's two assets in a host release. */
export type HostReleaseAssets = { binary: string; manifest: string }

/** hostReleaseAssets names the assets a host release carries for `platform`. */
export function hostReleaseAssets(platform: HostPlatform): HostReleaseAssets {
  return {
    binary: platform === 'android' ? 'tao-companion-android.apk' : `tao-companion-${platform}.app.zip`,
    manifest: `tao-host-${platform}.json`,
  }
}

/** hostReleaseTag names the release that carries a host build. */
export function hostReleaseTag(manifest: HostManifest): string {
  return `${HOST_RELEASE_TAG_PREFIX}${hostKey(manifest)}`
}

/** hostReleasesRepository is the `owner/name` whose releases carry prebuilt hosts. */
export function hostReleasesRepository(): string {
  return Platform.runtimeProcess.env['TAO_HOST_RELEASES'] ?? DEFAULT_HOST_RELEASES_REPOSITORY
}

/** taoHostsRoot is where downloaded hosts live: `hosts/` in the Tao home. */
export function taoHostsRoot(): string {
  return TaoHome.resolve('hosts')
}

/** HostDownloadOptions are the seams a test replaces: the network, the repository, and the cache. */
export type HostDownloadOptions = {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  hostsRoot?: string
  repository?: string
}

type ReleaseAsset = { browser_download_url: string; name: string; size: number }
type Release = { assets: ReleaseAsset[]; draft: boolean; tag_name: string }

/**
 * downloadCompatibleHost finds the newest published host for `platform` whose kit covers
 * `required`, downloads it into the hosts root unless it is already there, and returns it with a
 * reason for each release it passed over. It throws when the releases cannot be listed at all.
 */
export async function downloadCompatibleHost(
  platform: HostPlatform,
  required: NativeKit,
  options: HostDownloadOptions = {},
): Promise<HostSearch> {
  const fetchImpl = options.fetch ?? fetch
  const repository = options.repository ?? hostReleasesRepository()
  const names = hostReleaseAssets(platform)
  const refused: string[] = []
  for (const release of await listReleases(fetchImpl, repository)) {
    if (release.draft || !release.tag_name.startsWith(HOST_RELEASE_TAG_PREFIX)) {
      continue
    }
    const manifestAsset = release.assets.find(asset => asset.name === names.manifest)
    const binaryAsset = release.assets.find(asset => asset.name === names.binary)
    if (manifestAsset === undefined || binaryAsset === undefined) {
      continue
    }
    const source = `${repository} release ${release.tag_name}`
    const manifest = parseHostManifest(await fetchJson(fetchImpl, manifestAsset.browser_download_url), source)
    const problems = manifest.platform === platform
      ? hostKitProblems(manifest.nativeKit, required)
      : [`its manifest is for ${manifest.platform}, not ${platform}`]
    if (problems.length > 0) {
      refused.push(`${source}: ${problems.join('; ')}`)
      continue
    }
    return { host: await installHost(fetchImpl, manifest, binaryAsset, options.hostsRoot ?? taoHostsRoot()), refused }
  }
  return { refused }
}

async function listReleases(
  fetchImpl: NonNullable<HostDownloadOptions['fetch']>,
  repository: string,
): Promise<Release[]> {
  const url = `https://api.github.com/repos/${repository}/releases?per_page=${RELEASES_TO_CONSIDER}`
  const body = await fetchJson(fetchImpl, url, { Accept: 'application/vnd.github+json' })
  if (!Array.isArray(body)) {
    Errors.throwHostEnvironment(`GitHub answered ${url} with something other than a list of releases.`)
  }
  return body.filter(isRelease)
}

function isRelease(value: unknown): value is Release {
  return Json.isRecord(value)
    && typeof value['tag_name'] === 'string'
    && typeof value['draft'] === 'boolean'
    && Array.isArray(value['assets'])
    && value['assets'].every(asset =>
      Json.isRecord(asset)
      && typeof asset['name'] === 'string'
      && typeof asset['browser_download_url'] === 'string'
      && typeof asset['size'] === 'number'
    )
}

async function fetchJson(
  fetchImpl: NonNullable<HostDownloadOptions['fetch']>,
  url: string,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const response = await fetchResponse(fetchImpl, url, headers)
  try {
    return await response.json()
  } catch (error) {
    return Errors.throwHostEnvironment(`${url} did not answer with JSON.`, { cause: error })
  }
}

async function fetchResponse(
  fetchImpl: NonNullable<HostDownloadOptions['fetch']>,
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: { 'User-Agent': 'tao-dev', ...headers } })
  } catch (error) {
    return Errors.throwHostEnvironment(`Could not reach ${new URL(url).host}: ${Errors.messageOf(error)}`, {
      cause: error,
    })
  }
  if (!response.ok) {
    Errors.throwHostEnvironment(`${new URL(url).host} answered ${response.status} ${response.statusText} for ${url}.`)
  }
  return response
}

/**
 * The binary downloads beside its final directory and moves into place with its manifest. When
 * another `tao dev` finished the same host first, that one is kept and this download discarded.
 */
async function installHost(
  fetchImpl: NonNullable<HostDownloadOptions['fetch']>,
  manifest: HostManifest,
  asset: ReleaseAsset,
  hostsRoot: string,
): Promise<PrebuiltHost> {
  const directory = FS.resolvePath(`${hostKey(manifest)}/${manifest.platform}`, hostsRoot)
  const binaryPath = FS.resolvePath(HOST_BINARIES[manifest.platform], directory)
  if (await readHostManifest(directory) !== undefined && await FS.exists(binaryPath)) {
    return { binaryPath, directory, manifest }
  }
  DevLoopOutput.logDevLoop(
    'dev',
    `Downloading ${CompanionIdentity.name} ${manifest.hostVersion} for ${manifest.platform} `
      + `(${Math.round(asset.size / 1_000_000)} MB) into ${FS.displayPath(directory)}.`,
  )
  const bytes = new Uint8Array(await (await fetchResponse(fetchImpl, asset.browser_download_url)).arrayBuffer())
  if (bytes.byteLength !== asset.size) {
    Errors.throwHostEnvironment(
      `The download of ${asset.name} stopped at ${bytes.byteLength} of ${asset.size} bytes; run again to retry.`,
    )
  }
  const staging = `${directory}.staging-${Platform.randomUUID()}`
  await FS.mkdir(staging)
  if (manifest.platform === 'android') {
    await FS.writeFile(FS.resolvePath(HOST_BINARIES.android, staging), bytes)
  } else {
    await unzipAppBundle(bytes, staging, HOST_BINARIES[manifest.platform])
  }
  await writeHostManifest(staging, manifest)
  try {
    await FS.move(staging, directory)
  } catch (error) {
    await FS.remove(staging)
    if (await readHostManifest(directory) === undefined) {
      throw error
    }
  }
  return { binaryPath, directory, manifest }
}

/**
 * A simulator host is published as its app bundle zipped with its folder; `ditto` unpacks it whole,
 * keeping the bundle's symbolic links and modes, and the zip is removed once the bundle is in place.
 */
async function unzipAppBundle(bytes: Uint8Array, staging: string, bundleName: string): Promise<void> {
  const archive = FS.resolvePath('host.zip', staging)
  await FS.writeFile(archive, bytes)
  await CLI.mustRun('ditto', { args: ['-x', '-k', archive, staging] })
  await FS.remove(archive)
  if (!await FS.isDirectory(FS.resolvePath(bundleName, staging))) {
    Errors.throwHostEnvironment(`The downloaded host archive did not hold ${bundleName}.`)
  }
}
