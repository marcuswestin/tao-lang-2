import type { ConfigPlugin } from 'expo/config-plugins'

/** TaoICloudService names one iCloud service an entitled app uses. */
export type TaoICloudService = 'CloudDocuments' | 'CloudKit'

/**
 * TaoICloudPluginProps names the iCloud containers to grant (omitted, the bundle identifier's own),
 * the subset used for Documents ubiquity, and the services to enable (omitted, Documents alone).
 */
export type TaoICloudPluginProps = {
  containers?: readonly string[]
  documentContainers?: readonly string[]
  services?: readonly TaoICloudService[]
}

/** Info.plist handoff consumed by the native CloudKit launch guard. */
export const cloudKitContainersInfoKey: 'TaoCloudKitContainerIdentifiers'

/** iCloudEntitlements merges the iCloud entitlements for the given services into a plist. */
export function iCloudEntitlements(
  entitlements: Record<string, unknown>,
  containers: readonly string[],
  services?: readonly TaoICloudService[],
  documentContainers?: readonly string[],
): Record<string, unknown>

/** resolveContainers picks the declared containers, defaulting to the bundle identifier's own. */
export function resolveContainers(containers: unknown, bundleIdentifier: unknown): string[]

/** resolveServices picks the declared services, defaulting to iCloud Documents alone. */
export function resolveServices(services: unknown): TaoICloudService[]

declare const withTaoICloud: ConfigPlugin<TaoICloudPluginProps | undefined>

export default withTaoICloud
