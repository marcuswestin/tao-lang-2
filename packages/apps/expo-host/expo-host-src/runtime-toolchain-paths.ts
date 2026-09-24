import { FS, Platform, TaoResources } from '@shared'

const moduleDirectory = typeof __dirname === 'string' ? __dirname : import.meta.dirname
const resourceRoot = TaoResources.declaredRoot()

/**
 * RuntimeToolchainPaths locates package-owned host and harness resources without a Git root. An
 * installed binary answers from its resource root, because its own module directory is inside
 * `/$bunfs`, which neither Expo nor Metro nor Jest can read.
 *
 * Inside a checkout the host finds its dependencies, the runtime, and `@shared/core` where the
 * repository's layout puts them, and runs Expo under the Node the checkout provides. An installed
 * Tao has none of that around its host: its dependencies are installed beside the resource root,
 * the sources sit in the resource root under names of their own, and there is no Node. So it names
 * each location for Metro and runs Expo's script under itself.
 */
export const RuntimeToolchainPaths = {
  /** packageRoot is the host's own files: `metro.config.cjs`, `app.config.js`, `index.ts`, and the rest. */
  packageRoot: resourceRoot === undefined
    ? FS.resolvePath('..', moduleDirectory)
    : FS.resolvePath(TaoResources.HOST_DIRECTORY, resourceRoot),

  /**
   * hostInstallRoot is where an installed Tao resolves the host's dependencies, beside its resource
   * root, or undefined inside a checkout, whose own install already provides them.
   */
  hostInstallRoot: resourceRoot === undefined
    ? undefined
    : FS.resolvePath(`../${TaoResources.HOST_DEPENDENCIES_DIRECTORY}`, resourceRoot),

  dependencyRoot,
  expoCommand,
  expoEnvironment,
  installedExpoLauncher,
} as const

/** dependencyRoot is the `node_modules` a run of the host resolves packages from. */
function dependencyRoot(): string {
  return FS.resolvePath('node_modules', RuntimeToolchainPaths.hostInstallRoot ?? RuntimeToolchainPaths.packageRoot)
}

/**
 * expoEnvironment is what an installed Tao hands Expo so `metro.config.cjs` finds each location it
 * would otherwise climb the repository to reach. Inside a checkout it is empty.
 */
function expoEnvironment(): Record<string, string> {
  if (resourceRoot === undefined) {
    return {}
  }
  return {
    TAO_HOST_DEPENDENCY_ROOT: dependencyRoot(),
    TAO_RUNTIME_SOURCE_ROOT: FS.resolvePath(`${TaoResources.RUNTIME_DIRECTORY}/TaoRuntime-src`, resourceRoot),
    TAO_SHARED_CORE_SOURCE_ROOT: FS.resolvePath(TaoResources.SHARED_CORE_DIRECTORY, resourceRoot),
  }
}

/**
 * installedExpoLauncher is how the dev loop starts Expo from an installed Tao: the binary acting as
 * Bun on Expo's script, with the locations Metro needs. It is undefined inside a checkout, where the
 * dev loop keeps launching Expo through `bunx` as it always has.
 */
function installedExpoLauncher(
  runtimeRoot: string,
): { argsPrefix: string[]; env: Record<string, string>; executable: string; namesExpoScript: true } | undefined {
  if (resourceRoot === undefined) {
    return undefined
  }
  const expo = expoCommand(runtimeRoot, [])
  return { argsPrefix: expo.args, env: expo.env, executable: expo.command, namesExpoScript: true }
}

/** ExpoCommand is one Expo CLI invocation: what to run, with which arguments and extra environment. */
type ExpoCommand = { args: string[]; command: string; env: Record<string, string> }

/**
 * expoCommand runs Expo's CLI from `runtimeRoot`'s dependencies. An installed Tao runs the script
 * under its own binary acting as Bun, because the script starts `#!/usr/bin/env node` and a machine
 * with only Tao on it has no Node; `x --bun` does not reach that far in a compiled binary.
 */
function expoCommand(runtimeRoot: string, args: readonly string[]): ExpoCommand {
  const script = FS.resolvePath('node_modules/.bin/expo', runtimeRoot)
  if (resourceRoot === undefined) {
    return { args: [...args], command: script, env: {} }
  }
  return {
    args: ['--bun', script, ...args],
    command: Platform.runtimeProcess.execPath,
    env: { ...expoEnvironment(), BUN_BE_BUN: '1' },
  }
}
