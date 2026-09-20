import { Platform } from '@shared'

/**
 * The bootstrap facts a development build needs to find the dev data server: mirrored by
 * `packages/stdlib/@tao/data/providers/dev/Dev.ts`, which reads them from the Expo manifest, and
 * kept in step with it by hand because a stdlib sidecar imports nothing from this package.
 */
export const DevDataProtocol = {
  manifestKey: 'taoDevData',
  name: 'tao-dev-data-v1',
  path: '/data',
  probePath: '/data/probe',
} as const

/** The directory the dev data server persists every app's development snapshots under. */
export const DEV_DATA_ROOT_PATH = '.artifacts/user/dev-data'

/** The environment `tao dev` hands Expo so the checked-in `app.config.js` can write the manifest fact. */
const DevDataEnvironment = {
  app: 'TAO_DEV_DATA_APP',
  capability: 'TAO_DEV_DATA_CAPABILITY',
  port: 'TAO_DEV_DATA_PORT',
} as const

export type DevDataManifest = {
  app: string
  capability: string
  port: number
  protocol: typeof DevDataProtocol.name
}

/**
 * devDataAppKey names one app's storage: the app name for a person reading the directory, and a
 * short digest of the project root so two projects declaring the same app name never share data.
 * `tao dev` and Studio derive the same key for the same app, so both see the same rows.
 */
export function devDataAppKey(projectRoot: string, appName: string): string {
  const digest = Platform.sha256Hex(projectRoot).slice(0, 8)
  const name = appName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '')
  return `${name === '' ? 'app' : name}-${digest}`
}

/** devDataManifest is the `expo.extra.taoDevData` value a development build reads. */
export function devDataManifest(port: number, app: string, capability: string): DevDataManifest {
  return { app, capability, port, protocol: DevDataProtocol.name }
}

/** devDataEnvironment is the same fact as environment variables, for `app.config.js` to read. */
export function devDataEnvironment(port: number, app: string, capability: string): Readonly<Record<string, string>> {
  return {
    [DevDataEnvironment.app]: app,
    [DevDataEnvironment.capability]: capability,
    [DevDataEnvironment.port]: String(port),
  }
}
