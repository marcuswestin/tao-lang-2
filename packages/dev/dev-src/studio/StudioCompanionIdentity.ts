/**
 * The fixed identity of the Tao Companion development build. `packages/ides/studio-companion-app/app.json`
 * declares the same values for Expo prebuild; the preview runtime and the device launcher read them
 * from here so a deep link, an installed-app check, and the native shell can never disagree.
 */
export const StudioCompanionIdentity = {
  bundleIdentifier: 'dev.tao-lang.studio.companion',
  name: 'Tao Companion',
  packagePath: 'packages/ides/studio-companion-app',
  scheme: 'taostudiocompanion',
  slug: 'tao-studio-companion',
} as const
