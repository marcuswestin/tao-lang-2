import { FS, Platform } from '@shared'

/** Stable paths shared with generated TypeScript and native output for one physical Tao origin. */
export const ManagedInstallEnvironment = {
  modulesRoot(consumerRoot: string, originRoot: string, namespace: string): string {
    return FS.resolvePath(originRoot) === FS.resolvePath(consumerRoot)
      ? FS.resolvePath('node_modules', consumerRoot)
      : FS.resolvePath(`.tao/cache/install/origins/${namespace}/node_modules`, consumerRoot)
  },
  packageRoot(consumerRoot: string, namespace: string, alias: string): string {
    return FS.resolvePath(
      `.tao/cache/install/packages/${namespace}/${Platform.sha256Hex([alias]).slice(0, 16)}`,
      consumerRoot,
    )
  },
  generatedModulesLink(consumerRoot: string, namespace: string): string {
    return FS.resolvePath(`.tao-ts/.dependencies/${namespace}/node_modules`, consumerRoot)
  },
  runtimeModulesLink(runtimeWriterRoot: string, namespace: string): string {
    return FS.resolvePath(`modules/dependencies/${namespace}/node_modules`, runtimeWriterRoot)
  },
} as const
