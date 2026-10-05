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
  aliasPackageRoot(consumerRoot: string, namespace: string, alias: string): string {
    return FS.resolvePath(
      `.tao/cache/install/packages/${namespace}/${Platform.sha256Hex([alias]).slice(0, 16)}`,
      consumerRoot,
    )
  },
  /** Every per-alias tree one origin's earlier installs left, removed once its aliases have moved. */
  aliasNamespaceRoot(consumerRoot: string, namespace: string): string {
    return FS.resolvePath(`.tao/cache/install/packages/${namespace}`, consumerRoot)
  },
  /** The per-alias tree from before installs moved under `.tao/cache`; its links are still managed. */
  legacyPackageRoot(consumerRoot: string, namespace: string, alias: string): string {
    return FS.resolvePath(
      `.tao/install/packages/${namespace}/${Platform.sha256Hex([alias]).slice(0, 16)}`,
      consumerRoot,
    )
  },
  legacyModulesRoot(consumerRoot: string, namespace: string): string {
    return FS.resolvePath(`.tao/install/origins/${namespace}/node_modules`, consumerRoot)
  },
  /**
   * Every target an alias link from any Tao install layout may hold, the current shared tree first.
   * A link to any of them is Tao-managed and is moved to the first by the next install.
   */
  aliasLinkTargets(consumerRoot: string, namespace: string, alias: string): string[] {
    return [
      ManagedInstallEnvironment.environmentRoot(consumerRoot, namespace),
      ManagedInstallEnvironment.aliasPackageRoot(consumerRoot, namespace, alias),
      ManagedInstallEnvironment.legacyPackageRoot(consumerRoot, namespace, alias),
    ].map(prefix => FS.resolvePath(`node_modules/${alias}`, prefix))
  },
  generatedModulesLink(consumerRoot: string, namespace: string): string {
    return FS.resolvePath(`.tao-ts/.dependencies/${namespace}/node_modules`, consumerRoot)
  },
  runtimeModulesLink(runtimeWriterRoot: string, namespace: string): string {
    return FS.resolvePath(`modules/dependencies/${namespace}/node_modules`, runtimeWriterRoot)
  },
} as const
