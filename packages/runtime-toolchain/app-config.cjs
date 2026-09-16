const nodeFs = require('node:fs')
const nodePath = require('node:path')

/**
 * createExpoAppConfig derives Expo's checked-in host configuration from an optional ship manifest,
 * or from the dev data facts `tao dev` places in the environment (`env` defaults to the process's).
 */
function createExpoAppConfig(config, projectRoot, env = process.env) {
  const shipManifestPath = nodePath.resolve(projectRoot, '_gen_tao-app', 'ship.json')
  if (!nodeFs.existsSync(shipManifestPath)) {
    return withDevData(config, env)
  }

  const ship = JSON.parse(nodeFs.readFileSync(shipManifestPath, 'utf8'))
  const icon = ship.icon === 'badged'
    ? './assets/tao-app-icon-badged.png'
    : './assets/tao-app-icon.png'
  const updates = ship.updates === undefined
    ? {}
    : {
      // Tao computes the native closure before building and publishes updates under that exact
      // identity. Asking Expo to fingerprint again here includes generated ship state and produces
      // a different client request header from the publication runtime.
      runtimeVersion: ship.updates.runtimeVersion,
      updates: {
        enabled: true,
        requestHeaders: { 'expo-channel-name': ship.updates.channel },
        url: ship.updates.url,
      },
    }

  // An app bound to the iCloud datasource needs the iCloud Documents entitlements in its binary;
  // the manifest names the containers so the plugin never has to guess from the bundle identifier.
  const icloudPlugins = ship.icloud === undefined
    ? []
    : [[
      'tao-icloud-native',
      {
        containers: ship.icloud.containers,
        documentContainers: ship.icloud.documentContainers,
        services: ship.icloud.services,
      },
    ]]

  return {
    ...config,
    name: ship.name,
    slug: ship.slug,
    version: ship.version,
    icon,
    plugins: [...(config.plugins ?? []), './plugins/with-ios-fmt-compat.cjs', ...icloudPlugins],
    splash: {
      backgroundColor: '#171b2d',
      image: ship.splash ?? './assets/tao-app-icon.png',
      resizeMode: 'contain',
    },
    ios: {
      ...config.ios,
      buildNumber: ship.buildNumber,
      bundleIdentifier: ship.bundleIdentifier,
      config: {
        ...config.ios?.config,
        ...(ship.ios.usesNonExemptEncryption === undefined
          ? {}
          : { usesNonExemptEncryption: ship.ios.usesNonExemptEncryption }),
      },
    },
    ...updates,
    extra: {
      ...config.extra,
      tao: {
        ...config.extra?.tao,
        ship: {
          channel: ship.updates?.channel,
          git: ship.git,
          runtimeFingerprint: ship.updates?.runtimeFingerprint,
          schemaVersion: ship.schemaVersion,
        },
      },
    },
  }
}

/**
 * withDevData writes the tao-dev-data-v1 bootstrap fact a development build reads from its Expo
 * manifest when `tao dev` hosts a dev data server. A shipped build never carries it: the ship
 * manifest path above returns before this runs, and a plain `expo start` sets neither variable.
 * The variable names mirror `packages/dev/dev-src/dev-data/DevDataBootstrap.ts`.
 */
function withDevData(config, env) {
  const port = Number(env.TAO_DEV_DATA_PORT)
  const app = env.TAO_DEV_DATA_APP
  const capability = env.TAO_DEV_DATA_CAPABILITY
  if (
    !Number.isInteger(port) || port <= 0 || port > 65_535
    || typeof app !== 'string' || app === ''
    || typeof capability !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(capability)
  ) {
    return config
  }
  return {
    ...config,
    extra: {
      ...config.extra,
      taoDevData: { app, capability, port, protocol: 'tao-dev-data-v1' },
    },
  }
}

module.exports = { createExpoAppConfig }
