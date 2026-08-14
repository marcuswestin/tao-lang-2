import { FS } from '@shared'

/** RuntimeToolchainPaths locates package-owned host and harness resources without a Git root. */
export const RuntimeToolchainPaths = {
  packageRoot: FS.resolvePath('..', __dirname),
} as const
