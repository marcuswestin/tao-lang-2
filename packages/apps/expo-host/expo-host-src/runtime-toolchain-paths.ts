import { FS } from '@shared'

const moduleDirectory = typeof __dirname === 'string' ? __dirname : import.meta.dirname

/** RuntimeToolchainPaths locates package-owned host and harness resources without a Git root. */
export const RuntimeToolchainPaths = {
  packageRoot: FS.resolvePath('..', moduleDirectory),
} as const
