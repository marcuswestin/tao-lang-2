import { CLI, FS, Repo } from '@shared'

/**
 * The half of `doctor` that is meant to leave this machine. A person who hit something in Tao and
 * is writing it up needs to say which machine they were on, and we need to be able to reproduce it;
 * the fingerprint is the smallest thing that answers both without asking them to review a diagnosis
 * line by line for their own name first.
 *
 * Nothing here is filtered after the fact. Every value is *parsed out* of what a tool printed and
 * kept only when it matches a shape a report can carry — a version, a hash, a plain word. Anything
 * else is dropped, so a tool that prints a home directory, an Apple ID, a hostname, or a repository
 * path cannot get a value past `safeToken` no matter what it prints. `environment-fingerprint.test.ts`
 * proves that on hostile probe output and again on the real host.
 */

/** A version string, a hash, or a plain word: no separators a path or an address could hide in. */
const SAFE_TOKEN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/

/** The first field of a tool's version line that actually reads as a version. */
const VERSION_FIELD = /^v?[0-9][0-9A-Za-z._+-]*$/

/** A Nix store path, whose leading name component is the hash identifying the built toolchain. */
const NIX_STORE_PREFIX = '/nix/store/'
const NIX_STORE_HASH = /^[0-9a-z]{32}$/

/** A Git object name, as `rev-parse` and `hash-object` print it. */
const GIT_OBJECT = /^[0-9a-f]{40}$/

/** How much of a commit a person pastes and we can still resolve. */
const SHORT_COMMIT_LENGTH = 12

/** The pinned profile, whose store hash identifies every tool in it at once. */
const DEVENV_PROFILE_PATH = '.devenv/profile'

/** What that profile is called in the fingerprint, where no value is ever shaped like a path. */
const DEVENV_PROFILE_COMPONENT = 'devenv-profile'

/** Lockfiles whose content hash says exactly which dependency set a report was made against. */
const LOCKFILES = ['bun.lock', 'devenv.lock'] as const

/** Tools whose own version a reproduction depends on, each asked how to print it. */
const TOOL_PROBES = [
  { args: ['--version'], command: 'bun', name: 'bun' },
  { args: ['--version'], command: 'node', name: 'node' },
  { args: ['--version'], command: 'git', name: 'git' },
  { args: ['--version'], command: 'just', name: 'just' },
  { args: ['--version'], command: 'dprint', name: 'dprint' },
  { args: ['--version'], command: 'watchman', name: 'watchman' },
] as const

/**
 * FingerprintComponent is one piece of the toolchain. An absent tool keeps its row rather than
 * disappearing: "watchman is not installed" is the answer to a whole class of reports.
 */
type FingerprintComponent = {
  hash?: string
  name: string
  present: boolean
  version?: string
}

/** EnvironmentFingerprint is the pasteable block: which machine, which Tao, which toolchain. */
export type EnvironmentFingerprint = {
  architecture?: string
  kernel: { name?: string; version?: string }
  os: { build?: string; name?: string; version?: string }
  tao: { commit?: string; describe?: string; modified?: boolean }
  toolchain: readonly FingerprintComponent[]
  version: 1
  xcode?: { build?: string; version?: string }
}

/** FingerprintFacts is the raw, unfiltered output of every probe, gathered once so the shaping stays pure. */
export type FingerprintFacts = {
  architecture?: string
  /** The resolved target of `.devenv/profile`, which is a Nix store path on a pinned checkout. */
  devenvProfilePath?: string
  gitCommit?: string
  gitDescribe?: string
  gitModified?: boolean
  kernelName?: string
  kernelVersion?: string
  lockDigests: readonly { digest?: string; name: string }[]
  osBuild?: string
  osName?: string
  osVersion?: string
  /** Each tool's version line exactly as it printed, or undefined when the tool is not reachable. */
  toolVersions: readonly { name: string; versionLine?: string }[]
  xcodeVersionOutput?: string
}

/**
 * safeToken is the one gate every string in the fingerprint passes through. It never edits a value
 * into shape — a value either already reads as a version, a hash, or a bare word, or it is dropped.
 * That way the guarantee holds against output nobody anticipated, rather than against the specific
 * personal strings somebody thought to strip.
 */
export function safeToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (trimmed === undefined || !SAFE_TOKEN.test(trimmed)) {
    return undefined
  }
  return trimmed
}

/** toolVersion picks the version out of a `--version` line, whatever else the tool decorated it with. */
export function toolVersion(versionLine: string | undefined): string | undefined {
  const field = versionLine?.split('\n')[0]?.trim().split(/\s+/).find(candidate => VERSION_FIELD.test(candidate))
  return safeToken(field?.replace(/^v/, ''))
}

/** environmentFingerprint shapes gathered facts into the block a person can paste unedited. */
export function environmentFingerprint(facts: FingerprintFacts): EnvironmentFingerprint {
  const toolchain: FingerprintComponent[] = facts.toolVersions.map(tool => ({
    name: tool.name,
    present: tool.versionLine !== undefined,
    version: toolVersion(tool.versionLine),
  }))
  const profileHash = devenvProfileHash(facts.devenvProfilePath)
  toolchain.push({
    hash: profileHash,
    name: DEVENV_PROFILE_COMPONENT,
    present: facts.devenvProfilePath !== undefined,
  })
  for (const lock of facts.lockDigests) {
    const digest = gitObject(lock.digest)
    toolchain.push({ hash: digest, name: lock.name, present: digest !== undefined })
  }
  return {
    architecture: safeToken(facts.architecture),
    kernel: { name: safeToken(facts.kernelName), version: safeToken(facts.kernelVersion) },
    os: { build: safeToken(facts.osBuild), name: safeToken(facts.osName), version: safeToken(facts.osVersion) },
    tao: {
      commit: gitObject(facts.gitCommit)?.slice(0, SHORT_COMMIT_LENGTH),
      describe: safeToken(facts.gitDescribe),
      modified: facts.gitModified,
    },
    toolchain,
    version: 1,
    ...xcodeFingerprint(facts.xcodeVersionOutput),
  }
}

/**
 * formatFingerprint renders the fingerprint as the two lines the terminal shows, so somebody reading
 * `doctor` already sees what they would be pasting.
 */
export function formatFingerprint(fingerprint: EnvironmentFingerprint): string[] {
  const osBuild = fingerprint.os.build === undefined ? '' : ` (${fingerprint.os.build})`
  const host = [
    `${fingerprint.os.name ?? 'unknown OS'} ${fingerprint.os.version ?? ''}${osBuild}`.trim(),
    `${fingerprint.kernel.name ?? 'unknown kernel'} ${fingerprint.kernel.version ?? ''}`.trim(),
    fingerprint.architecture ?? 'unknown architecture',
  ]
  const tao = fingerprint.tao.commit === undefined
    ? 'Tao at an unknown commit'
    : `Tao ${fingerprint.tao.commit}${fingerprint.tao.modified === true ? ' (modified)' : ''}`
  const tools = fingerprint.toolchain
    .filter(component => component.version !== undefined)
    .map(component => `${component.name} ${component.version}`)
  const xcode = fingerprint.xcode?.version === undefined ? [] : [`Xcode ${fingerprint.xcode.version}`]
  return [host.join(' · '), [tao, ...tools, ...xcode].join(' · ')]
}

function devenvProfileHash(profilePath: string | undefined): string | undefined {
  if (profilePath === undefined || !profilePath.startsWith(NIX_STORE_PREFIX)) {
    return undefined
  }
  const hash = profilePath.slice(NIX_STORE_PREFIX.length).split('-')[0]
  return hash !== undefined && NIX_STORE_HASH.test(hash) ? hash : undefined
}

function gitObject(value: string | undefined): string | undefined {
  const token = safeToken(value)
  return token !== undefined && GIT_OBJECT.test(token) ? token : undefined
}

/** Xcode prints its version and build on two lines; a machine without it contributes no key at all. */
function xcodeFingerprint(versionOutput: string | undefined): { xcode?: { build?: string; version?: string } } {
  if (versionOutput === undefined) {
    return {}
  }
  const [versionLine, buildLine] = versionOutput.split('\n')
  const version = toolVersion(versionLine)
  const build = safeToken(buildLine?.trim().split(/\s+/).at(-1))
  return version === undefined && build === undefined ? {} : { xcode: { build, version } }
}

/** readFingerprintFacts asks the host about itself without changing anything on it. */
export async function readFingerprintFacts(repositoryRoot = Repo.getRoot()): Promise<FingerprintFacts> {
  const [uname, macOs, xcodeVersionOutput, toolVersions, git, lockDigests] = await Promise.all([
    readUname(),
    readMacOsRelease(),
    commandOutput('xcodebuild', ['-version']),
    Promise.all(TOOL_PROBES.map(async probe => ({
      name: probe.name,
      versionLine: await commandOutput(probe.command, probe.args),
    }))),
    readGitFacts(repositoryRoot),
    readLockDigests(repositoryRoot),
  ])
  return {
    ...uname,
    devenvProfilePath: await readDevenvProfilePath(repositoryRoot),
    ...git,
    lockDigests,
    ...macOs,
    toolVersions,
    xcodeVersionOutput,
  }
}

/**
 * Every probe below asks one process for everything it knows rather than one process per field.
 * A fingerprint is a dozen tiny reads, and on a machine where several worktrees are verifying at
 * once the spawn is most of what each one costs.
 */
async function readUname(): Promise<{ architecture?: string; kernelName?: string; kernelVersion?: string }> {
  const [kernelName, kernelVersion, architecture] = (await commandOutput('uname', ['-srm']) ?? '').split(/\s+/)
  return { architecture, kernelName, kernelVersion }
}

/** environmentFingerprintOf gathers and shapes in one step, for callers that only want the block. */
export async function environmentFingerprintOf(repositoryRoot = Repo.getRoot()): Promise<EnvironmentFingerprint> {
  return environmentFingerprint(await readFingerprintFacts(repositoryRoot))
}

async function commandOutput(
  command: string,
  args: readonly string[] = [],
  cwd?: string,
): Promise<string | undefined> {
  const result = await CLI.run(command, { args: [...args], ...(cwd === undefined ? {} : { cwd }) })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  const output = result.stdout.trim()
  return output.length === 0 ? undefined : output
}

async function readMacOsRelease(): Promise<{ osBuild?: string; osName?: string; osVersion?: string }> {
  const labelled = new Map(
    (await commandOutput('sw_vers') ?? '')
      .split('\n')
      .map(line => line.split(/:\s+/, 2))
      .map(([label, value]) => [label?.trim() ?? '', value?.trim()]),
  )
  return {
    osBuild: labelled.get('BuildVersion'),
    osName: labelled.get('ProductName'),
    osVersion: labelled.get('ProductVersion'),
  }
}

async function readGitFacts(
  repositoryRoot: string,
): Promise<{ gitCommit?: string; gitDescribe?: string; gitModified?: boolean }> {
  const [gitCommit, gitDescribe, status] = await Promise.all([
    commandOutput('git', ['rev-parse', 'HEAD'], repositoryRoot),
    commandOutput('git', ['describe', '--tags', '--always'], repositoryRoot),
    CLI.run('git', { args: ['status', '--porcelain', '--untracked-files=no'], cwd: repositoryRoot }),
  ])
  const readable = status.error === undefined && status.exitCode === 0
  return { gitCommit, gitDescribe, gitModified: readable ? status.stdout.trim().length > 0 : undefined }
}

/**
 * Git already content-hashes files, so the lockfile digests come from `hash-object` rather than from
 * a hash this repository would have to implement and keep honest itself.
 */
async function readLockDigests(repositoryRoot: string): Promise<{ digest?: string; name: string }[]> {
  const present = await Promise.all(
    LOCKFILES.map(async name => await FS.isFile(FS.resolvePath(name, repositoryRoot)) ? name : undefined),
  )
  const hashed = present.filter((name): name is typeof LOCKFILES[number] => name !== undefined)
  // One `hash-object` for every lockfile at once; it answers in the order it was asked.
  const digests = hashed.length === 0
    ? []
    : (await commandOutput('git', ['hash-object', '--', ...hashed], repositoryRoot) ?? '').split('\n')
  return LOCKFILES.map(name => ({ digest: digests[hashed.indexOf(name)]?.trim(), name }))
}

/**
 * A linked worktree's profile symlink points at the primary checkout's, which is a path under
 * somebody's home directory. Resolving it all the way reaches the Nix store path both share, and
 * that is the only form of it this fingerprint will accept.
 */
async function readDevenvProfilePath(repositoryRoot: string): Promise<string | undefined> {
  const profilePath = FS.resolvePath(DEVENV_PROFILE_PATH, repositoryRoot)
  if (!await FS.exists(profilePath)) {
    return undefined
  }
  return await FS.realPath(profilePath).catch(() => undefined)
}
