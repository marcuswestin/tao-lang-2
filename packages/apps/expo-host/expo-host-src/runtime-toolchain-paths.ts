import { Errors, FS, Platform, TaoResources } from '@shared'

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

  /**
   * managedNode is where an installed Tao keeps the Node `tao test` runs under and the manifest that
   * names it, or undefined inside a checkout, whose devenv profile provides Node.
   */
  managedNode: resourceRoot === undefined ? undefined : {
    installRoot: FS.resolvePath(`../${TaoResources.MANAGED_NODE_DIRECTORY}`, resourceRoot),
    manifest: FS.resolvePath(TaoResources.MANAGED_NODE_MANIFEST, resourceRoot),
  },

  dependencyRoot,
  expoCommand,
  expoEnvironment,
  installedExpoLauncher,
  nodeScriptCommand,
  prepareNodeLauncher,
  nodeLauncherEnvironment,
} as const

/** dependencyRoot is the `node_modules` a run of the host resolves packages from. */
function dependencyRoot(): string {
  return FS.resolvePath('node_modules', RuntimeToolchainPaths.hostInstallRoot ?? RuntimeToolchainPaths.packageRoot)
}

/**
 * expoEnvironment is what an installed Tao hands the host's tools so `metro.config.cjs` and
 * `jest.shared.config.cjs` find each location they would otherwise climb the repository to reach.
 * Inside a checkout it is empty.
 */
function expoEnvironment(): Record<string, string> {
  if (resourceRoot === undefined) {
    return {}
  }
  return {
    TAO_HOST_DEPENDENCY_ROOT: dependencyRoot(),
    TAO_RUNTIME_SOURCE_ROOT: FS.resolvePath(`${TaoResources.RUNTIME_DIRECTORY}/TaoRuntime-src`, resourceRoot),
    TAO_SHARED_CORE_SOURCE_ROOT: FS.resolvePath(TaoResources.SHARED_CORE_DIRECTORY, resourceRoot),
    TAO_SHARED_SOURCE_ROOT: FS.resolvePath(TaoResources.SHARED_SOURCE_DIRECTORY, resourceRoot),
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
 * explicitly under its own binary acting as Bun. Forcing `--bun` also creates global fallback
 * executables; an absolute script needs no such flag, and children use the owned node launcher.
 */
function expoCommand(runtimeRoot: string, args: readonly string[]): ExpoCommand {
  return nodeScriptCommand(runtimeRoot, 'expo', args)
}

/** Run a host CLI script with the Tao binary when the installed host has no Node. */
function nodeScriptCommand(runtimeRoot: string, name: string, args: readonly string[]): ExpoCommand {
  const script = FS.resolvePath(`node_modules/.bin/${name}`, runtimeRoot)
  if (resourceRoot === undefined) {
    return { args: [...args], command: script, env: {} }
  }
  return {
    args: [script, ...args],
    command: Platform.runtimeProcess.execPath,
    env: { ...expoEnvironment(), ...nodeLauncherEnvironment(RuntimeToolchainPaths.hostInstallRoot), BUN_BE_BUN: '1' },
  }
}

/** Child-only PATH keeps Bun's fallback node executable inside the version-owned host install. */
function nodeLauncherEnvironment(installRoot: string | undefined): Record<string, string> {
  if (installRoot === undefined) {
    return {}
  }
  const directory = FS.resolvePath('.tao-runtime-bin', installRoot)
  return { PATH: `${directory}:${Platform.runtimeProcess.env['PATH'] ?? '/usr/bin:/bin'}` }
}

/** Prepare our exact launcher, refusing existing entries that do not match this installation. */
async function prepareNodeLauncher(installRoot: string, executable = Platform.runtimeProcess.execPath): Promise<void> {
  const directory = FS.resolvePath('.tao-runtime-bin', installRoot)
  const directoryEntry = await FS.entryMetadata(directory).catch(error => {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw error
    }
    return undefined
  })
  if (directoryEntry !== undefined && directoryEntry.kind !== 'directory') {
    Errors.throwHostEnvironment(`Cannot prepare Tao's runtime launcher: ${directory} is not a directory.`)
  }
  const path = FS.resolvePath('node', directory)
  const quoted = `'${executable.replaceAll("'", "'\\''")}'`
  const script = `#!/bin/sh\nBUN_BE_BUN=1 exec ${quoted} "$@"\n`
  const entry = await FS.entryMetadata(path).catch(error => {
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw error
    }
    return undefined
  })
  if (entry !== undefined) {
    if (entry.kind !== 'file' || await FS.readText(path) !== script || (entry.mode & 0o111) === 0) {
      Errors.throwHostEnvironment(`Cannot replace an unrecognized runtime launcher at ${path}.`)
    }
    return
  }
  await FS.writeText(path, script, { mode: 0o755 })
}
