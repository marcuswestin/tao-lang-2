import { CLI, Errors, FS, HCI, Platform, TaoHome } from '@shared'
import { type DownloadPromptOptions, OneTimeDownload } from './one-time-download'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'

/**
 * HostDependencies installs the Expo host's packages for an installed Tao: once per version, from
 * the manifest and lockfile its release embeds, into the directory beside its resource root. Every
 * project on the machine then shares that one install. Inside a checkout there is nothing to do,
 * because the repository's own install already provides them.
 *
 * The first install asks first (`OneTimeDownload`), because it is a one-time download of about
 * 400 MB.
 */

/** INSTALLED_STAMP holds the lockfile's identity, written after the install completes. */
const INSTALLED_STAMP = '.tao-host-installed'

/** APPROXIMATE_SIZE is measured: 741 packages and 388 MB on 2026-09-24. */
const APPROXIMATE_SIZE = 'about 400 MB'

/** HOST_INSTALL_FILES are the host files the install reads, copied beside the packages they resolve. */
const HOST_INSTALL_FILES = ['package.json', 'bun.lock'] as const

/** HostDependencies owns installing the host's packages for an installed Tao. */
export const HostDependencies = {
  CONSENT_ENV: OneTimeDownload.CONSENT_ENV,
  INSTALLED_STAMP,
  ensure,
  ensureIn,
} as const

type EnsureOptions = DownloadPromptOptions

/** HostInstall is where one install happens and how; `ensureIn` takes it so a test can supply a fake. */
type HostInstall = {
  /** hostFiles holds the embedded manifest and lockfile. */
  hostFiles: string
  /** installRoot receives them and the `node_modules` they resolve. */
  installRoot: string
  /** install resolves `installRoot`'s packages; the real one runs this binary as Bun. */
  install: (installRoot: string) => Promise<void>
}

/** ensure installs this Tao's host packages if it has none yet; inside a checkout it does nothing. */
async function ensure(options: EnsureOptions = {}): Promise<void> {
  const installRoot = RuntimeToolchainPaths.hostInstallRoot
  if (installRoot === undefined) {
    return
  }
  await ensureIn({ hostFiles: RuntimeToolchainPaths.packageRoot, install: installWithThisBinary, installRoot }, options)
}

/**
 * ensureIn installs into `installRoot` unless it already holds an install of exactly this lockfile.
 * Two first runs serialize on one lock, and the second finds the first's stamp.
 */
async function ensureIn(host: HostInstall, options: EnsureOptions = {}): Promise<void> {
  const lock = await FS.readFile(FS.resolvePath('bun.lock', host.hostFiles))
  const patches = await readHostPatches(host.hostFiles)
  const identity = hostInstallIdentity(lock, patches)
  if (await installedWith(host.installRoot, identity)) {
    await FS.withFileMutationLock(host.installRoot, FS.dirname(host.installRoot), async () => {
      await RuntimeToolchainPaths.prepareNodeLauncher(host.installRoot)
    })
    await linkBesideHostFiles(host)
    return
  }
  const what = `its Expo host once for this version (${APPROXIMATE_SIZE})`
  if (!await OneTimeDownload.approve(`Tao needs to download ${what}. Download it now?`, options)) {
    Errors.throwUserInput(OneTimeDownload.refusalMessage(what))
  }
  await FS.mkdir(host.installRoot)
  await FS.withFileMutationLock(host.installRoot, FS.dirname(host.installRoot), async () => {
    await RuntimeToolchainPaths.prepareNodeLauncher(host.installRoot)
    if (await installedWith(host.installRoot, identity)) {
      return
    }
    HCI.writeLine(
      `Installing Tao's Expo host for this version: ${APPROXIMATE_SIZE}, once; later runs reuse it.`,
      options,
    )
    for (const name of HOST_INSTALL_FILES) {
      await FS.copyFile(FS.resolvePath(name, host.hostFiles), FS.resolvePath(name, host.installRoot))
    }
    for (const patch of patches) {
      await FS.writeFile(FS.resolvePath(patch.path, host.installRoot), patch.contents)
    }
    await host.install(host.installRoot)
    await FS.writeText(FS.resolvePath(INSTALLED_STAMP, host.installRoot), identity)
  })
  await linkBesideHostFiles(host)
}

type HostPatch = { key: string; path: string; contents: Uint8Array }

async function readHostPatches(hostFiles: string): Promise<HostPatch[]> {
  const manifest = await FS.readJson<{ patchedDependencies?: Record<string, string> }>(
    FS.resolvePath('package.json', hostFiles),
  )
  const patches: HostPatch[] = []
  for (
    const [key, patchPath] of Object.entries(manifest.patchedDependencies ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ) {
    if (!isSafePatchPath(patchPath)) {
      Errors.throwHostEnvironment(`The Expo host has an invalid patched dependency path for ${key}: ${patchPath}.`)
    }
    const patchesRoot = FS.resolvePath('patches', hostFiles)
    const patchFile = FS.resolvePath(patchPath, hostFiles)
    const pathFromPatches = FS.relativePath(patchesRoot, patchFile)
    if (pathFromPatches === '..' || pathFromPatches.startsWith('../') || !await FS.isFile(patchFile)) {
      Errors.throwHostEnvironment(`The Expo host patch for ${key} is missing or outside patches/: ${patchPath}.`)
    }
    patches.push({ key, path: patchPath, contents: await FS.readFile(patchFile) })
  }
  return patches
}

function isSafePatchPath(path: string): boolean {
  return !FS.isAbsolute(path)
    && !path.includes('\\')
    && !path.includes('\0')
    && path.startsWith('patches/')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function hostInstallIdentity(lock: Uint8Array, patches: readonly HostPatch[]): string {
  if (patches.length === 0) {
    return Platform.sha256Hex(lock)
  }
  return Platform.sha256Hex([
    'tao-host-install-with-patches-v1\0',
    lock,
    ...patches.flatMap(({ key, path, contents }) => [`\0${key}\0${path}\0${contents.byteLength}\0`, contents]),
  ])
}

/**
 * linkBesideHostFiles gives the host's own files a `node_modules` that points at the install, the
 * shape they have inside the repository. Jest resolves its preset and the host's modules from its
 * root directory, which is the host's files, so this is what lets `tao test` run there unchanged.
 * A new resource payload replaces those files whole, so the link is made again on every call.
 */
async function linkBesideHostFiles(host: HostInstall): Promise<void> {
  await FS.replaceSymlink(
    FS.resolvePath('node_modules', host.installRoot),
    FS.resolvePath('node_modules', host.hostFiles),
  )
}

async function installedWith(installRoot: string, identity: string): Promise<boolean> {
  const stamped = await FS.readText(FS.resolvePath(INSTALLED_STAMP, installRoot)).then(
    content => content === identity,
    () => false,
  )
  // The stamp can outlive a removed or partial node_modules directory. Expo and Jest are direct
  // dependencies needed by the two installed host paths, and isFile follows Bun's package links.
  return stamped
    && await FS.isFile(FS.resolvePath('node_modules/expo/package.json', installRoot))
    && await FS.isFile(FS.resolvePath('node_modules/jest/package.json', installRoot))
}

/**
 * installWithThisBinary runs the compiled Tao as Bun, the only package manager an installed machine
 * is sure to have, with the frozen lockfile so the install is exactly what the release resolved.
 */
async function installWithThisBinary(installRoot: string): Promise<void> {
  await CLI.mustRun(Platform.runtimeProcess.execPath, {
    args: ['install', '--frozen-lockfile', '--cwd', installRoot],
    env: {
      ...Platform.runtimeProcess.env,
      ...RuntimeToolchainPaths.nodeLauncherEnvironment(installRoot),
      BUN_BE_BUN: '1',
      BUN_INSTALL_CACHE_DIR: TaoHome.resolve('cache/bun'),
    },
    stdio: 'inherit',
  })
}
