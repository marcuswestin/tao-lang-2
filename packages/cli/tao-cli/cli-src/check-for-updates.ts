import { Errors, HCI, Json, Platform } from '@shared'
import { TaoVersion } from './tao-version'

/**
 * `tao check-for-updates` says whether a newer Tao release is published, and how to install it. It
 * reads the same release listing the install script does and picks the same way: the highest stable
 * `vX.Y.Z` tag that is neither a draft nor a prerelease, because the repository's `latest` marker
 * belongs to Studio. It installs nothing and moves no project's pin.
 */

/** LISTING_ENV points at another release listing, as the install script also reads it. */
const LISTING_ENV = 'TAO_RELEASE_INDEX_URL'

/** PAGE_SIZE is the most releases GitHub returns in one page of the listing. */
const PAGE_SIZE = 100

/** A published CLI release tag: `v` and a stable three-part version. */
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/

/** runCheckForUpdates reports on this release against the newest published one. */
export async function runCheckForUpdates(): Promise<void> {
  const own = TaoVersion.current()
  const releases = TaoVersion.releases()
  if (own === TaoVersion.DEVELOPMENT || releases === undefined) {
    HCI.writeLine('This is a development build of Tao, not a published release, so there is nothing to compare.')
    return
  }
  const latest = latestStableRelease(await fetchReleases(releases))
  if (latest === undefined) {
    HCI.writeLine(`No published Tao release was found at ${releases}.`)
    return
  }
  if (compareVersions(latest, own) <= 0) {
    HCI.writeLine(`Tao ${own} is the latest release.`)
    return
  }
  HCI.writeLine(
    `Tao ${latest} is available; this is ${own}. Install it with:\n\n`
      + `  curl -fsSL ${releases}/download/v${latest}/install.sh | sh\n\n`
      + 'A project keeps the release its .tao/lock.jsonc pins in toolchain.version until that '
      + 'is changed.',
  )
}

/** latestStableRelease picks the highest stable, published CLI release from a GitHub release listing. */
export function latestStableRelease(listing: unknown): string | undefined {
  if (!Array.isArray(listing)) {
    return undefined
  }
  let best: string | undefined
  for (const release of listing) {
    if (!Json.isRecord(release) || release['draft'] !== false || release['prerelease'] !== false) {
      continue
    }
    const tag = release['tag_name']
    if (typeof tag !== 'string' || !STABLE_TAG.test(tag)) {
      continue
    }
    const version = tag.slice(1)
    if (best === undefined || compareVersions(version, best) > 0) {
      best = version
    }
  }
  return best
}

/** compareVersions orders two `X.Y.Z` versions numerically, ignoring any prerelease suffix. */
function compareVersions(left: string, right: string): number {
  const parts = (version: string) => version.split('-')[0]!.split('.').map(Number)
  const [a, b] = [parts(left), parts(right)]
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

/**
 * fetchReleases reads the whole release listing, a page at a time until a short page, because the CLI
 * shares the repository's releases with Studio and the prebuilt hosts. An override listing is one
 * document, as the install script also reads it.
 */
async function fetchReleases(releases: string): Promise<unknown[]> {
  const override = Platform.runtimeProcess.env[LISTING_ENV]
  if (override !== undefined && override.length > 0) {
    const listing = await fetchListing(override)
    return Array.isArray(listing) ? listing : []
  }
  const repository = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/?$/.exec(releases)?.[1]
  if (repository === undefined) {
    return Errors.throwHostEnvironment(`Cannot list releases at ${releases}; set ${LISTING_ENV} to a release listing.`)
  }
  return await readReleasePages(page =>
    fetchListing(`https://api.github.com/repos/${repository}/releases?per_page=${PAGE_SIZE}&page=${page}`)
  )
}

/** readReleasePages joins listing pages from the first until one is short or is not a listing. */
export async function readReleasePages(fetchPage: (page: number) => Promise<unknown>): Promise<unknown[]> {
  const all: unknown[] = []
  for (let page = 1;; page += 1) {
    const listing = await fetchPage(page)
    if (!Array.isArray(listing)) {
      return all
    }
    all.push(...listing)
    if (listing.length < PAGE_SIZE) {
      return all
    }
  }
}

async function fetchListing(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) {
    return Errors.throwHostEnvironment(`Could not list Tao releases at ${url} (HTTP ${response.status}).`)
  }
  return await response.json()
}
