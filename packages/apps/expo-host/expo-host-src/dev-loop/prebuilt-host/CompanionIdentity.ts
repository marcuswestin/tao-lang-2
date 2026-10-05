/**
 * The fixed identity of the Tao Companion development build, the shared prebuilt host.
 * `packages/ides/studio-companion-app/app.json` declares the same values for Expo prebuild, and a
 * test holds the two equal, so a deep link, an installed-app check, and the native shell can never
 * disagree. Both platforms' identifiers are the reverse of Tao's domain, devtao.com; it has no
 * hyphen, which Android package names cannot carry, so the two spell the same.
 */
export const CompanionIdentity = {
  androidPackage: 'com.devtao.studio.companion',
  bundleIdentifier: 'com.devtao.studio.companion',
  name: 'Tao Companion',
  packagePath: 'packages/ides/studio-companion-app',
  scheme: 'taostudiocompanion',
  slug: 'tao-studio-companion',
} as const

/**
 * companionDevClientUrl is the link that opens the Companion on the Metro server at `host:port`:
 * the development client's own launcher route, with Metro's origin as its `url` parameter.
 */
export function companionDevClientUrl(input: { host: string; port: number; scheme?: string }): string {
  const origin = `http://${input.host}:${input.port}`
  return companionLaunchUrl(
    `${input.scheme ?? CompanionIdentity.scheme}://expo-development-client/?url=${encodeURIComponent(origin)}`,
  )
}

/** Keep Expo tools available on demand through Tao's menu, without launch-time chrome. */
export function companionLaunchUrl(link: string): string {
  const url = new URL(link)
  if (url.hostname !== 'expo-development-client') {
    return link
  }
  // These are the outer launcher flags supported by our pinned Expo SDK 57 on both platforms.
  url.searchParams.set('disableOnboarding', '1')
  url.searchParams.set('disableAutoLaunch', '1')
  url.searchParams.set('disableFab', '1')
  return url.toString()
}
