/**
 * TAO_RELEASE_VERSION is replaced with a string literal when `standalone-build.ts` compiles a
 * release, through `bun build --define`, and is never declared anywhere else. From source it does
 * not exist, which is why `current` asks `typeof` rather than reading it: a bare read would throw.
 */
declare const TAO_RELEASE_VERSION: string | undefined

/**
 * TAO_RELEASES_URL is the GitHub Releases page a release build was published to, defined the same
 * way, so the version shim and `tao check-for-updates` know where other versions live.
 */
declare const TAO_RELEASES_URL: string | undefined

/** DEVELOPMENT is what Tao run from source reports, since no release number describes it. */
const DEVELOPMENT = 'development'

/**
 * TaoVersion is the release this CLI is. A standalone release build stamps its version in; a run
 * from a checkout has none, and says so rather than borrowing the number of a release it is not.
 */
export const TaoVersion = {
  DEVELOPMENT,
  current,
  releases,
} as const

/** current returns the stamped release version, or `development` when Tao runs from source. */
function current(): string {
  return typeof TAO_RELEASE_VERSION === 'string' ? TAO_RELEASE_VERSION : DEVELOPMENT
}

/** releases returns where this release's versions are published, or undefined for a development build. */
function releases(): string | undefined {
  return typeof TAO_RELEASES_URL === 'string' ? TAO_RELEASES_URL : undefined
}
