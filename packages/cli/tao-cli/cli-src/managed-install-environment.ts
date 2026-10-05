import { FS, Platform } from '@shared'

/** Stable paths shared with generated TypeScript and native output for one physical Tao origin. */
export const ManagedInstallEnvironment = {
  modulesRoot(consumerRoot: string, originRoot: string, namespace: string): string {
    return FS.resolvePath(originRoot) === FS.resolvePath(consumerRoot)
      ? FS.resolvePath('node_modules', consumerRoot)
      : FS.resolvePath(`.tao/cache/install/origins/${namespace}/node_modules`, consumerRoot)
  },
  /** Every npm tree Tao installs for a consumer lives under this one root. */
  installRoot(consumerRoot: string): string {
    return FS.resolvePath('.tao/cache/install', consumerRoot)
  },
  /** One npm prefix per origin namespace, holding every alias the origin requires in one tree. */
  environmentRoot(consumerRoot: string, namespace: string): string {
    return FS.resolvePath(`.tao/cache/install/environments/${namespace}`, consumerRoot)
  },
  /**
   * Where an install before environments shared one prefix put each alias. Read only to recognize
   * an alias link it left as Tao-managed, so the next install can move it.
   */
  legacyPackageRoot(consumerRoot: string, namespace: string, alias: string): string {
    return FS.resolvePath(
      `.tao/cache/install/packages/${namespace}/${Platform.sha256Hex([alias]).slice(0, 16)}`,
      consumerRoot,
    )
  },
  legacyNamespaceRoot(consumerRoot: string, namespace: string): string {
    return FS.resolvePath(`.tao/cache/install/packages/${namespace}`, consumerRoot)
  },
  generatedModulesLink(consumerRoot: string, namespace: string): string {
    return FS.resolvePath(`.tao-ts/.dependencies/${namespace}/node_modules`, consumerRoot)
  },
  runtimeModulesLink(runtimeWriterRoot: string, namespace: string): string {
    return FS.resolvePath(`modules/dependencies/${namespace}/node_modules`, runtimeWriterRoot)
  },
} as const
