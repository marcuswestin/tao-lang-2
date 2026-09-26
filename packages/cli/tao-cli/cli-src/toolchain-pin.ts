import { CLI, Errors, FS, HCI, Json, Platform, TaoHome, Text } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { PROJECT_LOCK_RELATIVE_PATH } from './project-lock-path'
import { TaoVersion } from './tao-version'

/**
 * ToolchainPin makes a project run under the Tao release it pins. `.tao-project/lock.jsonc` carries
 * `toolchain.version`, which `tao create` writes; `tao +0.4.1 <command>` and `TAO_VERSION` choose a
 * release explicitly and win over the pin, in that order. A project with no pin runs under
 * whichever release `bin/tao` points at.
 *
 * Every release binary is its own shim. Before the CLI loads, `tao-standalone.ts` asks `delegate`
 * which release this run wants; if it is not this one, that release's binary runs the command and
 * this one exits with its status. A release that is not installed is downloaded after asking, the way
 * the install script does, and a run with no terminal to ask fails naming the command that installs
 * it. A development build has no release to compare, so it ignores all of this.
 */

/** VERSION_ENV names a release explicitly for this run, as the install script also reads it. */
const VERSION_ENV = 'TAO_VERSION'

/**
 * HANDED_OFF_ENV marks a run one release handed to another. A release that is handed a run for a
 * version it is not has a mislabelled binary, and handing it on again could loop forever.
 */
const HANDED_OFF_ENV = 'TAO_HANDED_OFF_BY'

/** A version is plain semver, because it becomes a directory name and a download URL. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** ASSET is the one binary the first release publishes: macOS on Apple silicon. */
const ASSET = 'tao-darwin-arm64.gz'

/** ToolchainPin owns which Tao release a run uses, and handing the run to it. */
export const ToolchainPin = {
  VERSION_ENV,
  delegate,
  projectPin,
  requestedVersion,
  versionBinary,
} as const

/** VersionRequest is the release a run asks for, why, and the arguments left once `+x.y.z` is taken off. */
type VersionRequest = {
  args: string[]
  source: 'argument' | 'environment' | 'project'
  version: string
}

/** Delegation says whether this binary runs the command, and with which arguments, or already ran it elsewhere. */
type Delegation = { args: string[] } | { exitCode: number }

/** DelegateOptions are the seams a test replaces, and the terminal a download question uses. */
type DelegateOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
  input?: Readable
  interactive?: boolean
  output?: Writable
  ownVersion?: string
  /** taoHome is the Tao home's root, `TaoHome.root()` unless a test gives its own. */
  taoHome?: string
  /** Test seams for the terminal decision and published release bytes. */
  confirmDownload?: (message: string) => Promise<boolean>
  downloadBytes?: (url: string) => Promise<Uint8Array>
  releasesUrl?: string
}

/**
 * requestedVersion reads which release a run asks for: `+x.y.z` as the first argument, then
 * `TAO_VERSION`, then the nearest project's pin. Undefined means the run asks for none.
 */
async function requestedVersion(
  args: readonly string[],
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<VersionRequest | undefined> {
  const [first, ...rest] = args
  if (first !== undefined && first.startsWith('+')) {
    return { args: rest, source: 'argument', version: first.slice(1) }
  }
  const fromEnvironment = env[VERSION_ENV]
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
    return { args: [...args], source: 'environment', version: fromEnvironment }
  }
  const pinned = await projectPin(cwd)
  return pinned === undefined ? undefined : { args: [...args], source: 'project', version: pinned }
}

/**
 * projectPin returns the `toolchain.version` of the nearest project lock at or above `start`. The
 * nearest lock decides even when it pins nothing, so a project nested in another does not inherit
 * the outer one's release.
 */
async function projectPin(start: string): Promise<string | undefined> {
  let directory = FS.resolvePath(start)
  while (true) {
    const lock = FS.resolvePath(PROJECT_LOCK_RELATIVE_PATH, directory)
    if (await FS.isFile(lock)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(Text.stripJsonc(await FS.readText(lock)))
      } catch (error) {
        return Errors.throwUserInput(`The Tao project lock at ${lock} is not valid JSONC: ${String(error)}`)
      }
      const toolchain = Json.isRecord(parsed) ? parsed['toolchain'] : undefined
      const version = Json.isRecord(toolchain) ? toolchain['version'] : undefined
      return typeof version === 'string' ? version : undefined
    }
    const parent = FS.dirname(directory)
    if (parent === directory) {
      return undefined
    }
    directory = parent
  }
}

/** versionBinary is where an installed release keeps its binary, in the Tao home. */
function versionBinary(version: string, taoHome: string = TaoHome.root()): string {
  return FS.resolvePath(`versions/${version}/tao`, taoHome)
}

/**
 * delegate decides who runs this command. It returns the arguments to run here, with any `+x.y.z`
 * taken off, or the exit status of the release that ran it instead.
 */
async function delegate(args: readonly string[], options: DelegateOptions = {}): Promise<Delegation> {
  const own = options.ownVersion ?? TaoVersion.current()
  if (own === TaoVersion.DEVELOPMENT) {
    return { args: [...args] }
  }
  const env = options.env ?? Platform.runtimeProcess.env
  const request = await requestedVersion(args, env, options.cwd ?? Platform.runtimeProcess.cwd())
  if (request === undefined) {
    return { args: [...args] }
  }
  if (!VERSION_PATTERN.test(request.version)) {
    Errors.throwUserInput(`${describe(request)} names Tao ${JSON.stringify(request.version)}, which is not a version.`)
  }
  if (request.version === own) {
    return { args: request.args }
  }
  const handedOffBy = env[HANDED_OFF_ENV]
  if (handedOffBy !== undefined) {
    Errors.throwHostEnvironment(
      `Tao ${handedOffBy} handed this run to Tao ${request.version}, but that binary reports ${own}. `
        + `Reinstall Tao ${request.version}: ${installCommand(request.version)}`,
    )
  }
  const binary = versionBinary(request.version, options.taoHome)
  if (!await FS.isFile(binary)) {
    await installVersion(request, options)
  }
  const result = await CLI.run(binary, {
    args: request.args,
    env: { ...env, [HANDED_OFF_ENV]: own, [VERSION_ENV]: request.version },
    stdio: 'inherit',
  })
  return { exitCode: result.exitCode ?? 1 }
}

/**
 * installVersion downloads a release the way the install script does — its binary, checked against
 * its published SHA-256, then run once so it confirms its version and unpacks its resources — but
 * leaves `bin/tao` pointing where it was, because running one project's release should not change
 * every other project's default.
 */
async function installVersion(request: VersionRequest, options: DelegateOptions): Promise<void> {
  const releases = options.releasesUrl ?? TaoVersion.releases()
  if (releases === undefined) {
    Errors.throwHostEnvironment(`${describe(request)} names Tao ${request.version}, which is not installed.`)
  }
  const missing = `${describe(request)} names Tao ${request.version}, which is not installed.`
  if (!HCI.isInteractive(options)) {
    Errors.throwUserInput(`${missing} Install it with:\n\n  ${installCommand(request.version)}\n`)
  }
  const question = `${missing} Download it now (about 30 MB)?`
  const approved = options.confirmDownload === undefined
    ? await HCI.askConfirm({ ...options, defaultValue: true, message: question })
    : await options.confirmDownload(question)
  if (!approved) {
    Errors.throwUserInput(`${missing} Install it with:\n\n  ${installCommand(request.version)}\n`)
  }
  const download = `${releases}/download/v${request.version}`
  const fetchReleaseBytes = options.downloadBytes ?? fetchBytes
  const [archive, checksum] = await Promise.all([
    fetchReleaseBytes(`${download}/${ASSET}`),
    fetchReleaseBytes(`${download}/${ASSET}.sha256`),
  ])
  const expected = new TextDecoder().decode(checksum).trim().split(/\s+/)[0]
  if (expected === undefined || expected !== Platform.sha256Hex(archive)) {
    Errors.throwHostEnvironment(`The Tao ${request.version} download does not match its published checksum.`)
  }
  const versions = FS.resolvePath('versions', options.taoHome ?? TaoHome.root())
  const staging = FS.resolvePath(`.install-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`, versions)
  try {
    const binary = FS.resolvePath('tao', staging)
    await FS.writeFile(binary, new Uint8Array(Bun.gunzipSync(new Uint8Array(archive))))
    await FS.chmod(binary, 0o755)
    // Asked from `/` with no version named, so no pin can hand the check to some other release.
    const { [VERSION_ENV]: _version, [HANDED_OFF_ENV]: _handedOffBy, ...neutral } = options.env
      ?? Platform.runtimeProcess.env
    const reported = (await CLI.mustRun(binary, { args: ['--version'], cwd: '/', env: neutral })).stdout.trim()
    if (reported !== request.version) {
      Errors.throwHostEnvironment(`The Tao ${request.version} download reports ${reported}.`)
    }
    const destination = FS.dirname(versionBinary(request.version, options.taoHome))
    if (!await FS.exists(destination)) {
      await FS.move(staging, destination)
    }
  } finally {
    await FS.remove(staging).catch(() => undefined)
  }
}

function installCommand(version: string): string {
  const releases = TaoVersion.releases() ?? 'https://github.com/<owner>/<repository>/releases'
  return `curl -fsSL ${releases}/download/v${version}/install.sh | TAO_VERSION=${version} sh`
}

function describe(request: VersionRequest): string {
  return request.source === 'argument'
    ? `+${request.version}`
    : request.source === 'environment'
    ? VERSION_ENV
    : 'This project'
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    return Errors.throwHostEnvironment(`Downloading ${url} failed with HTTP ${response.status}.`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
