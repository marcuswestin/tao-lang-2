const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins')

const apsEnvironmentKey = 'aps-environment'
const backgroundModesKey = 'UIBackgroundModes'
const remoteNotificationMode = 'remote-notification'

const containersKey = 'com.apple.developer.icloud-container-identifiers'
const servicesKey = 'com.apple.developer.icloud-services'
const ubiquityContainersKey = 'com.apple.developer.ubiquity-container-identifiers'
const cloudKitContainersInfoKey = 'TaoCloudKitContainerIdentifiers'
const cloudDocumentsService = 'CloudDocuments'
const cloudKitService = 'CloudKit'
const knownServices = [cloudDocumentsService, cloudKitService]

/** resolveServices picks the iCloud services to grant; omitted, the Documents service alone. */
function resolveServices(services) {
  const declared = Array.isArray(services) ? services.filter(value => knownServices.includes(value)) : []
  return declared.length > 0 ? [...new Set(declared)] : [cloudDocumentsService]
}

/** resolveContainers picks the declared containers, defaulting to the bundle identifier's own. */
function resolveContainers(containers, bundleIdentifier) {
  const declared = Array.isArray(containers)
    ? containers.filter(value => typeof value === 'string' && value.length > 0)
    : []
  if (declared.length > 0) {
    return [...new Set(declared)]
  }
  if (typeof bundleIdentifier === 'string' && bundleIdentifier.length > 0) {
    return [`iCloud.${bundleIdentifier}`]
  }
  throw new Error(
    'The Tao iCloud plugin needs either explicit `containers` or an iOS bundle identifier to derive the default container from.',
  )
}

/** iCloudEntitlements merges the iCloud entitlements for the given services into a plist. */
function iCloudEntitlements(
  entitlements,
  containers,
  services = [cloudDocumentsService],
  documentContainers = services.includes(cloudDocumentsService) ? containers : [],
) {
  const merged = (existing, additions) => [...new Set([...(Array.isArray(existing) ? existing : []), ...additions])]
  const result = {
    ...entitlements,
    [containersKey]: merged(entitlements[containersKey], containers),
    [servicesKey]: merged(entitlements[servicesKey], services),
  }
  if (services.includes(cloudDocumentsService)) {
    result[ubiquityContainersKey] = merged(entitlements[ubiquityContainersKey], documentContainers)
  }
  return result
}

/** cloudKitInfoPlist records the plugin's declared containers for the native module's launch guard. */
function cloudKitInfoPlist(infoPlist, containers) {
  return {
    ...infoPlist,
    [cloudKitContainersInfoKey]: containers,
  }
}

/**
 * withTaoICloud grants the iCloud entitlements Tao's Apple datasources need: iCloud Documents for
 * `ICloud`, CloudKit for `CloudKit`, both when an app binds both.
 */
function withTaoICloud(config, props = {}) {
  const services = resolveServices(props.services)
  const entitled = withEntitlementsPlist(config, modConfig => {
    const containers = resolveContainers(props.containers, modConfig.ios && modConfig.ios.bundleIdentifier)
    const documentContainers = Array.isArray(props.documentContainers)
      ? [...new Set(props.documentContainers.filter(value => containers.includes(value)))]
      : containers
    modConfig.modResults = iCloudEntitlements(modConfig.modResults, containers, services, documentContainers)
    if (services.includes(cloudKitService)) {
      // CloudKit's sync engine learns of other devices' changes through silent pushes.
      modConfig.modResults[apsEnvironmentKey] = modConfig.modResults[apsEnvironmentKey] || 'production'
    }
    return modConfig
  })
  if (!services.includes(cloudKitService)) {
    return entitled
  }
  return withInfoPlist(entitled, modConfig => {
    const containers = resolveContainers(props.containers, modConfig.ios && modConfig.ios.bundleIdentifier)
    const modes = Array.isArray(modConfig.modResults[backgroundModesKey])
      ? modConfig.modResults[backgroundModesKey]
      : []
    modConfig.modResults = cloudKitInfoPlist(
      {
        ...modConfig.modResults,
        [backgroundModesKey]: [...new Set([...modes, remoteNotificationMode])],
      },
      containers,
    )
    return modConfig
  })
}

module.exports = withTaoICloud
module.exports.cloudKitContainersInfoKey = cloudKitContainersInfoKey
module.exports.iCloudEntitlements = iCloudEntitlements
module.exports.resolveContainers = resolveContainers
module.exports.resolveServices = resolveServices
