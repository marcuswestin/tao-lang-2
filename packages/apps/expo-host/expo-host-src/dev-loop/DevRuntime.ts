import { Errors, FS, ProjectLocal } from '@shared'
import { HostDependencies } from '../host-dependencies'
import { RuntimeToolchainPaths } from '../runtime-toolchain-paths'

const runtimeFiles = [
  'index.ts',
  'app.json',
  'app.config.js',
  'app-config.cjs',
  'metro.config.cjs',
  'package.json',
] as const

/** DevRuntime creates the project's own generated Expo host from the installed Tao toolchain. */
export const DevRuntime = { prepare }

async function prepare(projectRoot: string): Promise<{ root: string; sourceRoot: string }> {
  const sourceRoot = RuntimeToolchainPaths.packageRoot
  const root = ProjectLocal.cacheResolve('dev/runtime', projectRoot)
  await ProjectLocal.prepare(projectRoot)
  for (const file of runtimeFiles) {
    const source = FS.resolvePath(file, sourceRoot)
    if (!await FS.isFile(source)) {
      Errors.throwHostEnvironment(`Tao's development runtime is missing ${source}.`)
    }
    await FS.copyFile(source, FS.resolvePath(file, root))
  }
  // An installed Tao resolves its host's packages on first use, beside its resource root rather than
  // inside the host's files; inside a checkout this does nothing and they are the host's own.
  await HostDependencies.ensure()
  const modules = RuntimeToolchainPaths.dependencyRoot()
  if (!await FS.isDirectory(modules)) {
    Errors.throwHostEnvironment(`Tao's development runtime has no installed modules at ${modules}.`)
  }
  await FS.replaceSymlink(modules, FS.resolvePath('node_modules', root))
  // Expo resolves TypeScript and other tooling from parent node_modules, while the host package's
  // own node_modules contains only its declared runtime dependencies.
  const toolchainModules = FS.resolvePath('../../../node_modules', sourceRoot)
  if (await FS.isDirectory(toolchainModules)) {
    await FS.replaceSymlink(toolchainModules, FS.resolvePath('node_modules', FS.dirname(root)))
  }
  return { root, sourceRoot }
}
