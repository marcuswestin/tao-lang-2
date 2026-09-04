const nodeFs = require('node:fs')
const nodePath = require('node:path')

/** createExpoAppConfig derives Expo's checked-in host configuration from an optional ship manifest. */
function createExpoAppConfig(config, projectRoot) {
  const shipManifestPath = nodePath.resolve(projectRoot, '_gen_tao-app', 'ship.json')
  if (!nodeFs.existsSync(shipManifestPath)) {
    return config
  }

  const ship = JSON.parse(nodeFs.readFileSync(shipManifestPath, 'utf8'))
  const icon = ship.icon === 'badged'
    ? './assets/tao-app-icon-badged.png'
    : './assets/tao-app-icon.png'
  const updates = ship.updates === undefined
    ? {}
    : {
      runtimeVersion: ship.updates.runtimeVersion,
      updates: {
        enabled: true,
        requestHeaders: { 'expo-channel-name': ship.updates.channel },
        url: ship.updates.url,
      },
    }

  return {
    ...config,
    name: ship.name,
    slug: ship.slug,
    version: ship.version,
    icon,
    plugins: [...(config.plugins ?? []), './plugins/with-ios-fmt-compat.cjs'],
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
        usesNonExemptEncryption: ship.ios.usesNonExemptEncryption,
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

module.exports = { createExpoAppConfig }
