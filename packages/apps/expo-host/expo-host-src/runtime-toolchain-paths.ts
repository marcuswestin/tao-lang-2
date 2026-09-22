import { FS, TaoResources } from '@shared'

const moduleDirectory = typeof __dirname === 'string' ? __dirname : import.meta.dirname

/**
 * RuntimeToolchainPaths locates package-owned host and harness resources without a Git root. An
 * installed binary answers from its resource root, because its own module directory is inside
 * `/$bunfs`, which neither Expo nor Metro nor Jest can read.
 */
export const RuntimeToolchainPaths = {
  packageRoot: TaoResources.resolve(TaoResources.HOST_DIRECTORY) ?? FS.resolvePath('..', moduleDirectory),
} as const
