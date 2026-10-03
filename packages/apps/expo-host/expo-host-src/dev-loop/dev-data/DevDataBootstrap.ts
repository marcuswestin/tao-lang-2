import { Platform } from '@shared'

/**
 * The bootstrap facts a development build needs to find the dev data server: mirrored by
 * `packages/apps/stdlib/@tao/data/providers/dev/Dev.ts`, which reads them from the Expo manifest, and
 * kept in step with it by hand because a stdlib sidecar imports nothing from this package.
 */
export const DevDataProtocol = {
  manifestKey: 'taoDevData',
  name: 'tao-dev-data-v1',
  path: '/data',
  probePath: '/data/probe',
} as const

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
 * devDataAppKey routes one app through a server shared by multiple projects. The project digest
 * keeps same-named apps apart there; it is not part of their per-project storage directory.
 */
export function devDataAppKey(projectRoot: string, appName: string): string {
  const digest = Platform.sha256Hex(projectRoot).slice(0, 8)
  return `${devDataSafeAppName(appName)}-${digest}`
}

/** A readable, path-safe directory for one app inside a project's own dev-data folder. */
export function devDataSafeAppName(appName: string): string {
  const name = appName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[^A-Za-z0-9]+/, '')
  return name === '' ? 'app' : name
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
