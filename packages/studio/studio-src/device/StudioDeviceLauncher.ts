/**
 * The device tooling seam. `packages/dev` implements it with Expo, `xcrun devicectl` for a phone or
 * tablet, and `xcrun simctl` for an iOS simulator; the Studio server only serves what it is given,
 * so a packaged Studio without host tooling answers 501 instead of pretending.
 */

export type StudioDeviceLaunchHost = {
  id: string
  /** Whether the companion bundle id is installed; undefined when the host could not tell. */
  installed?: boolean
  /** A simulator runs on this Mac and reaches Studio over loopback; a device needs a LAN address. */
  kind: 'device' | 'simulator'
  name: string
}

export type StudioDeviceLaunchDiagnostic = {
  layer: 'devicectl' | 'expo' | 'metro' | 'network' | 'permission' | 'simulator'
  message: string
}

export type StudioDeviceLaunchInfo = {
  bundleIdentifier: string
  /** Metro hosts the device might reach, Expo's own choice first; never localhost. */
  candidates: readonly string[]
  diagnostics: readonly StudioDeviceLaunchDiagnostic[]
  hosts: readonly StudioDeviceLaunchHost[]
  installCommand: string
  metroPort: number
  /** The dev-client deep link that opens the installed shell on this project's Metro. */
  url?: string
  scheme: string
}

export type StudioDeviceLaunchOpenResult = {
  hostName: string
  launched: true
  url: string
}

export type StudioDeviceLauncher = {
  /** Describes launch facts for one session's Metro origin; never throws for a missing device. */
  describe(input: { metroOrigin: string }): Promise<StudioDeviceLaunchInfo>
  /** Launches the installed shell on one host; throws a `HostEnvironmentError` naming the failing layer. */
  open(input: { hostId: string; metroOrigin: string }): Promise<StudioDeviceLaunchOpenResult>
}
