import { CLI, Errors, FS, HCI, Platform, TaoHome } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'

/**
 * HostDependencies installs the Expo host's packages for an installed Tao: once per version, from
 * the manifest and lockfile its release embeds, into the directory beside its resource root. Every
 * project on the machine then shares that one install. Inside a checkout there is nothing to do,
 * because the repository's own install already provides them.
 *
 * The first install asks first, as the Developer decided, because it is a one-time download of
 * about 400 MB. A terminal gets the question; anything else needs `TAO_HOST_INSTALL=yes` to go
 * ahead, and is told so rather than left waiting on a prompt nobody can answer.
 */

/** INSTALLED_STAMP holds the lockfile's identity, written after the install completes. */
const INSTALLED_STAMP = '.tao-host-installed'

/** CONSENT_ENV lets a run with no terminal approve the one-time download ahead of time. */
const CONSENT_ENV = 'TAO_HOST_INSTALL'

/** APPROXIMATE_SIZE is measured: 741 packages and 388 MB on 2026-09-24. */
const APPROXIMATE_SIZE = 'about 400 MB'

/** HOST_INSTALL_FILES are the host files the install reads, copied beside the packages they resolve. */
const HOST_INSTALL_FILES = ['package.json', 'bun.lock'] as const

/** HostDependencies owns installing the host's packages for an installed Tao. */
export const HostDependencies = {
  CONSENT_ENV,
  INSTALLED_STAMP,
  ensure,
  ensureIn,
} as const

/** EnsureOptions are the terminal a consent question uses, and the environment consent is read from. */
type EnsureOptions = {
  environment?: Record<string, string | undefined>
  input?: Readable
  interactive?: boolean
  output?: Writable
}

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
  const identity = Platform.sha256Hex(await FS.readFile(FS.resolvePath('bun.lock', host.hostFiles)))
  if (await installedWith(host.installRoot, identity)) {
    return
  }
  if (!await consented(options)) {
    Errors.throwUserInput(
      `Tao needs to download its Expo host once for this version (${APPROXIMATE_SIZE}) first. Run the `
        + `command again in a terminal to approve it, or set ${CONSENT_ENV}=yes to approve it ahead of time.`,
    )
  }
  await FS.mkdir(host.installRoot)
  await FS.withFileMutationLock(host.installRoot, FS.dirname(host.installRoot), async () => {
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
    await host.install(host.installRoot)
    await FS.writeText(FS.resolvePath(INSTALLED_STAMP, host.installRoot), identity)
  })
}

async function installedWith(installRoot: string, identity: string): Promise<boolean> {
  return await FS.readText(FS.resolvePath(INSTALLED_STAMP, installRoot)).then(
    content => content === identity,
    () => false,
  )
}

async function consented(options: EnsureOptions): Promise<boolean> {
  if ((options.environment ?? Platform.runtimeProcess.env)[CONSENT_ENV] === 'yes') {
    return true
  }
  if (!HCI.isInteractive(options)) {
    return false
  }
  return await HCI.askConfirm({
    ...options,
    defaultValue: true,
    message: `Tao needs to download its Expo host once for this version (${APPROXIMATE_SIZE}). Download it now?`,
  })
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
      BUN_BE_BUN: '1',
      BUN_INSTALL_CACHE_DIR: TaoHome.resolve('cache/bun'),
    },
    stdio: 'inherit',
  })
}
