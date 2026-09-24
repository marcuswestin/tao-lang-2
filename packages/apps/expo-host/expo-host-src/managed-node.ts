import { CLI, Errors, FS, HCI, Platform } from '@shared'
import { type DownloadPromptOptions, OneTimeDownload } from './one-time-download'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'

/**
 * ManagedNode gives an installed Tao the Node that `tao test` runs Jest under. Jest does not run
 * under Bun — its CommonJS runtime cannot load the ESM-only packages the Tao runtime reaches — and a
 * newcomer's machine may have no Node at all, so each Tao version downloads its own, as the
 * Developer decided: the release build records the Node the repository tests with and its SHA-256
 * from nodejs.org's published `SHASUMS256.txt`, and the first `tao test` fetches exactly that file,
 * refuses anything else, and unpacks it beside the binary. Inside a checkout the devenv profile's
 * Node is used instead.
 */

/** INSTALLED_STAMP holds the tarball's SHA-256, written after the unpack completes. */
const INSTALLED_STAMP = '.tao-node-installed'

/** APPROXIMATE_SIZE is the compressed darwin-arm64 tarball's size, rounded. */
const APPROXIMATE_SIZE = 'about 50 MB'

/** NodeManifest is what a release records about its Node in the resource root. */
export type NodeManifest = {
  sha256: string
  url: string
  version: string
}

/** NodeInstall is one install: where it goes and how it downloads, so a test can supply a fake. */
type NodeInstall = {
  download: (url: string) => Promise<Uint8Array>
  installRoot: string
  manifest: NodeManifest
}

/** ManagedNode owns downloading and unpacking an installed Tao's Node. */
export const ManagedNode = {
  INSTALLED_STAMP,
  ensure,
  ensureIn,
} as const

/** ensure returns this Tao's own Node, installing it first if needed, or undefined inside a checkout. */
async function ensure(options: DownloadPromptOptions = {}): Promise<string | undefined> {
  const managed = RuntimeToolchainPaths.managedNode
  if (managed === undefined) {
    return undefined
  }
  const manifest = await FS.readJson<NodeManifest>(managed.manifest)
  return await ensureIn({ download: downloadBytes, installRoot: managed.installRoot, manifest }, options)
}

/**
 * ensureIn installs `install.manifest`'s Node into `installRoot` unless it already holds exactly that
 * tarball's contents, and returns its `node` executable. The unpack happens beside `installRoot` and
 * is renamed into place, so a failed or interrupted one never leaves a half-unpacked Node behind.
 */
async function ensureIn(install: NodeInstall, options: DownloadPromptOptions = {}): Promise<string> {
  const binary = FS.resolvePath('bin/node', install.installRoot)
  if (await installedWith(install.installRoot, install.manifest.sha256)) {
    return binary
  }
  const what =
    `Node ${install.manifest.version}, which it runs tests under, once for this version (${APPROXIMATE_SIZE})`
  if (!await OneTimeDownload.approve(`Tao needs to download ${what}. Download it now?`, options)) {
    Errors.throwUserInput(OneTimeDownload.refusalMessage(what))
  }
  const parent = FS.dirname(install.installRoot)
  await FS.mkdir(parent)
  await FS.withFileMutationLock(install.installRoot, parent, async () => {
    if (await installedWith(install.installRoot, install.manifest.sha256)) {
      return
    }
    HCI.writeLine(`Downloading Node ${install.manifest.version} for tao test: ${APPROXIMATE_SIZE}, once.`, options)
    const tarball = await install.download(install.manifest.url)
    const actual = Platform.sha256Hex(tarball)
    if (actual !== install.manifest.sha256) {
      Errors.throwHostEnvironment(
        `The Node download from ${install.manifest.url} does not match the SHA-256 this release recorded `
          + `(${install.manifest.sha256}, got ${actual}); nothing was installed.`,
      )
    }
    const staging = `${install.installRoot}.tmp-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
    try {
      await FS.mkdir(staging)
      const archive = FS.resolvePath('node.tar.gz', staging)
      await FS.writeFile(archive, tarball)
      // The system `tar` keeps the executable bit the archive records.
      await CLI.mustRun('/usr/bin/tar', { args: ['-xzf', archive, '-C', staging, '--strip-components', '1'] })
      await FS.remove(archive)
      await FS.writeText(FS.resolvePath(INSTALLED_STAMP, staging), install.manifest.sha256)
      await FS.remove(install.installRoot)
      await FS.move(staging, install.installRoot)
    } finally {
      await FS.remove(staging).catch(() => undefined)
    }
  })
  return binary
}

async function installedWith(installRoot: string, sha256: string): Promise<boolean> {
  const stamped = await FS.readText(FS.resolvePath(INSTALLED_STAMP, installRoot)).then(
    content => content === sha256,
    () => false,
  )
  return stamped && await FS.isFile(FS.resolvePath('bin/node', installRoot))
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    return Errors.throwHostEnvironment(`Downloading ${url} failed with HTTP ${response.status}.`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
