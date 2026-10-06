import { DesktopHost } from '@expo-host'
import { generateMaintainedNativeBindings, stageNativeBindingResources } from '@native-bindings'
import { CLI, Errors, FS, HCI, Platform, ReleaseCapabilities, Repo, TaoResources } from '@shared'
import { AgentClientBuild } from './agent-client-build'
import { TaoAppModules } from './app-modules'
import { StandaloneResources } from './standalone-resources'

/**
 * standalone-build compiles the distributable Tao binary for this host, with the resource payload it
 * unpacks on first run embedded inside it. `just standalone-cli-build` runs it after generating the
 * parser, which the binary bundles and a fresh worktree does not yet have.
 *
 *   standalone-build.ts [outfile]                         a development binary, no version stamped
 *   standalone-build.ts --release <version> [--releases <url>]
 *                                                         the files one GitHub release publishes
 *
 * The payload is staged as a real tree before it is packed, in the layout `TaoResources` reads, so a
 * failure can be inspected on disk and the staged tree can stand in for an installed one through
 * `TAO_RESOURCES`.
 */

const BUILD_ROOT = '.artifacts/build'
const RELEASE_ROOT = '.artifacts/release'
const ENTRY_POINT = 'packages/cli/tao-cli/cli-src/tao-standalone.ts'
const INSTALL_SCRIPT = 'packages/cli/tao-cli/cli-src/standalone-install.sh'
const PORTABLE_BUN_SCRIPT = 'packages/cli/tao-cli/cli-src/standalone-bun.sh'

/** RELEASES_PLACEHOLDER is the token in the install script that a release replaces with its URL. */
const RELEASES_PLACEHOLDER = '@TAO_RELEASES@'

/** A release version is plain semver, because the install script puts it in a download URL. */
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * KNOWN_GAPS is what a release's notes say the standalone binary cannot do yet. Each slice of the
 * standalone plan removes its line when it lands, so a release cannot overstate the binary.
 */
const KNOWN_GAPS = [
  '`tao run` serves the web target from the standalone binary; the iOS Simulator and Android do not open from it yet.',
  '`tao ship` cannot prebuild an iCloud-backed app from the standalone binary because its host lacks the tao-icloud config plugin.',
  '`tao review` is not in the standalone binary.',
  'The binary is not signed or notarized yet.',
] as const

/** Package paths the payload copies, each package to its place in the resource layout. */
const COPIED_TREES = [
  // The identity is authored; generated `.tao` state and TypeScript contracts are refreshed after install.
  {
    source: 'packages/apps/stdlib',
    within: ['@tao', 'Package.tao', '.tao/store/project.json'],
    target: TaoResources.STDLIB_DIRECTORY,
  },
  { source: 'packages/apps/expo-host', within: ['.'], target: TaoResources.HOST_DIRECTORY },
  // The stdlib's data-provider sidecars import `@shared/core`, which Metro resolves by path, and the
  // journey harness `tao test` runs under Jest imports the rest of `@shared`.
  { source: 'packages/shared/shared-src', within: ['.'], target: TaoResources.SHARED_SOURCE_DIRECTORY },
] as const

/** HOST_MANIFEST is the host's own manifest, which names workspace packages an install cannot reach. */
const HOST_MANIFEST = 'packages/apps/expo-host/package.json'

/** HOST_DEPENDENCY_ROOTS are where the repository's install puts the host's resolved dependencies. */
const HOST_DEPENDENCY_ROOTS = ['packages/apps/expo-host/node_modules', 'node_modules'] as const

/**
 * DEV_SERVER_TOOLING is what `expo start` refuses to run without once a project has TypeScript
 * files. Inside the repository it resolves from the root install; an installed host carries it.
 */
const DEV_SERVER_TOOLING = ['typescript', '@types/react'] as const

/** NODE_DOWNLOADS is where Node's official release tarballs and their checksum lists are published. */
const NODE_DOWNLOADS = 'https://nodejs.org/dist'

/** BASE_TSCONFIG is the repository-wide compiler configuration the host's tsconfig extends. */
const BASE_TSCONFIG = 'packages/tsconfig.base.json'

if (import.meta.main) {
  try {
    await main(Platform.runtimeProcess.argv.slice(2))
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

async function main(args: readonly string[]): Promise<void> {
  const version = optionValue(args, '--release')
  const phaseValue = optionValue(args, '--phase')
  if (version === undefined && phaseValue !== undefined) {
    Errors.throwUserInput('A public standalone profile requires --release <version>.')
  }
  const phase = phaseValue === undefined
    ? (version === undefined ? 'development' : undefined)
    : Number(phaseValue)
  if (phase === undefined || (phase !== 'development' && ![1, 2, 3, 4, 5].includes(phase))) {
    Errors.throwUserInput('A public release requires --phase 1, 2, 3, 4, or 5 at build time.')
  }
  const profile = ReleaseCapabilities.profile(phase as 1 | 2 | 3 | 4 | 5 | 'development')
  if (version === undefined) {
    await buildBinary(args[0] ?? `${BUILD_ROOT}/tao`, undefined, profile)
  } else {
    await buildRelease(version, optionValue(args, '--releases'), profile)
  }
}

/**
 * buildRelease writes the files one release publishes into `.artifacts/release/v<version>/`: the
 * gzipped binary under a name without its version, addressed through its release tag; its
 * SHA-256; the install script pointed at these releases; a release index; and draft notes. It prints
 * the `gh release create` command rather than running it, because publishing is the Developer's step.
 */
async function buildRelease(
  version: string,
  releasesOption: string | undefined,
  profile: ReturnType<typeof ReleaseCapabilities.profile>,
): Promise<void> {
  if (!RELEASE_VERSION.test(version)) {
    Errors.throwUserInput(`A release version is semver like 0.4.0; ${JSON.stringify(version)} is not.`)
  }
  const repoRoot = Repo.getRoot()
  const releases = releasesOption ?? await originReleases(repoRoot)
  const target = hostTarget()
  const directory = FS.resolvePath(`${RELEASE_ROOT}/v${version}`, repoRoot)
  const binary = FS.resolvePath(`${BUILD_ROOT}/standalone/tao-${version}`, repoRoot)
  await buildBinary(binary, { releases, version }, profile)

  await FS.remove(directory)
  const asset = `tao-${target}.gz`
  const compressed = Bun.gzipSync(new Uint8Array(await FS.readFile(binary)), { level: 9 })
  const sha256 = Platform.sha256Hex(compressed)
  await FS.writeFile(FS.resolvePath(asset, directory), compressed)
  await FS.writeText(FS.resolvePath(`${asset}.sha256`, directory), `${sha256}  ${asset}\n`)

  const installScript = await FS.readText(FS.resolvePath(INSTALL_SCRIPT, repoRoot))
  await FS.writeText(
    FS.resolvePath('install.sh', directory),
    installScript.replaceAll(RELEASES_PLACEHOLDER, releases).replaceAll('@TAO_VERSION@', version),
  )
  const commit = (await CLI.mustRun('git', { args: ['rev-parse', 'HEAD'], cwd: repoRoot })).stdout.trim()
  await FS.writeJson(FS.resolvePath('release.json', directory), {
    schemaVersion: 1,
    version,
    commit,
    targets: { [target]: { asset, sha256 } },
    releaseProfile: { ...profile, fingerprint: ReleaseCapabilities.fingerprint(profile) },
  })
  await FS.writeText(FS.resolvePath('notes.md', directory), releaseNotes(version, releases))

  const relative = FS.relativePath(repoRoot, directory)
  const files = [asset, `${asset}.sha256`, 'install.sh', 'release.json'].map(name => `${relative}/${name}`)
  HCI.logProcessInfo('standalone', `Wrote the Tao ${version} release to ${relative}.`)
  HCI.writeLine(
    `Publish it from the repository root, after reading notes.md:\n\n  gh release create v${version} `
      + `${files.join(' ')} --title "Tao ${version}" --notes-file ${relative}/notes.md --latest=false\n`,
  )
}

/**
 * buildBinary stages and packs the resource payload, then compiles the binary around it. A release
 * build also stamps in its version and where its releases are published.
 */
async function buildBinary(
  outfile: string,
  release: { releases: string; version: string } | undefined,
  profile: ReturnType<typeof ReleaseCapabilities.profile>,
): Promise<void> {
  const repoRoot = Repo.getRoot()
  HCI.logProcessInfo('standalone', 'Generating maintained native bindings...')
  await generateMaintainedNativeBindings({ mode: 'write' })
  const portableBun = (await CLI.mustRun('bash', { args: [PORTABLE_BUN_SCRIPT], cwd: repoRoot })).stdout.trim()
  const staging = FS.resolvePath(`${BUILD_ROOT}/standalone/${TaoResources.INSTALLED_DIRECTORY}`, repoRoot)
  const archive = FS.resolvePath(`${BUILD_ROOT}/standalone/${StandaloneResources.PAYLOAD_FILE_NAME}`, repoRoot)

  await FS.remove(staging)
  for (const tree of COPIED_TREES) {
    for (const within of tree.within) {
      await copyVisibleFiles(FS.resolvePath(tree.source, repoRoot), within, FS.resolvePath(tree.target, staging))
    }
  }
  HCI.logProcessInfo('standalone', 'Staging native binding implementations and pinned compiler inputs...')
  await stageNativeBindingResources({ outputRoot: staging })
  await TaoAppModules.packageRuntime(staging, FS.resolvePath('packages/apps/runtime', repoRoot))
  for (const name of StandaloneResources.LICENSE_FILES) {
    await FS.copyFile(FS.resolvePath(name, repoRoot), FS.resolvePath(name, staging))
  }
  await FS.writeText(
    FS.resolvePath(`${TaoResources.HOST_DIRECTORY}/expo-host-src/desktop-agent-host.js`, staging),
    await DesktopHost.agentHostSource(),
  )
  await FS.writeText(
    FS.resolvePath(`${TaoResources.HOST_DIRECTORY}/expo-host-src/agent-client.js`, staging),
    await AgentClientBuild.source(),
  )
  await makeHostInstallable(repoRoot, FS.resolvePath(TaoResources.HOST_DIRECTORY, staging), portableBun)
  await recordManagedNode(repoRoot, staging)
  await FS.writeJson(FS.resolvePath('release-profile.json', staging), {
    version: release?.version ?? 'development',
    ...profile,
    fingerprint: ReleaseCapabilities.fingerprint(profile),
  })
  const fileCount = await packTree(staging, archive)
  HCI.logProcessInfo('standalone', `Packed ${fileCount} resource files into ${FS.relativePath(repoRoot, archive)}.`)

  // `tao-version.ts` and `tao-cli.ts` declare these globals and nothing else defines them.
  const stamp = release === undefined ? [] : [
    '--define',
    `TAO_RELEASE_VERSION=${JSON.stringify(release.version)}`,
    '--define',
    `TAO_RELEASES_URL=${JSON.stringify(release.releases)}`,
  ]
  const defines = [
    '--define',
    'TAO_STANDALONE=true',
    '--define',
    `TAO_RELEASE_PHASE=${JSON.stringify(profile.phase)}`,
    ...stamp,
  ]
  await CLI.mustRun(portableBun, {
    args: ['build', '--compile', ...defines, '--outfile', FS.resolvePath(outfile, repoRoot), ENTRY_POINT, archive],
    cwd: repoRoot,
    stdio: 'inherit',
  })
  await assertSystemLibraryDependencies(FS.resolvePath(outfile, repoRoot))
}

/** A release must not retain the build host's Nix store or other private dylib paths. */
async function assertSystemLibraryDependencies(binary: string): Promise<void> {
  const dependencies = (await CLI.mustRun('otool', { args: ['-L', binary] })).stdout
    .split('\n')
    .slice(1)
    .map(line => line.trim().split(' ')[0] ?? '')
    .filter(Boolean)
  const privateDependencies = dependencies.filter(path =>
    !path.startsWith('/usr/lib/') && !path.startsWith('/System/Library/')
  )
  if (privateDependencies.length > 0) {
    Errors.throwHostEnvironment(
      `The standalone binary links to build-host libraries: ${privateDependencies.join(', ')}.`,
    )
  }
}

/**
 * makeHostInstallable rewrites the staged host so an installed Tao can resolve it on a machine with no
 * repository. Its manifest loses the five `workspace:*` packages, none of which the host reaches by
 * name — two it never reaches, two Metro and Jest reach by path, and one is a config plugin only an
 * iCloud release build names — and pins every other dependency to the version this repository has
 * installed, so a release starts from what the repository tested. Its lockfile is resolved here,
 * once per release, and embedded; transitive versions are resolved now rather than copied from the
 * repository's lock, so they can drift from it. Its tsconfig stops extending the repository's base,
 * which Expo's TypeScript resolver cannot follow outside the repository.
 */
async function makeHostInstallable(repoRoot: string, stagedHost: string, portableBun: string): Promise<void> {
  const manifest = await FS.readJson<HostManifest>(FS.resolvePath(HOST_MANIFEST, repoRoot))
  const rootManifest = await FS.readJson<{ patchedDependencies?: Record<string, string> }>(
    FS.resolvePath('package.json', repoRoot),
  )
  const dependencies: Record<string, string> = {}
  const patchedDependencies: Record<string, string> = {}
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!range.startsWith('workspace:')) {
      dependencies[name] = await installedVersion(repoRoot, name)
    }
  }
  for (const name of DEV_SERVER_TOOLING) {
    dependencies[name] = await installedVersion(repoRoot, name)
  }
  for (const [key, patchPath] of Object.entries(rootManifest.patchedDependencies ?? {})) {
    const separator = key.lastIndexOf('@')
    const name = key.slice(0, separator)
    if (separator <= 0 || !isMetroPatchPackage(name)) {
      continue
    }
    const version = key.slice(separator + 1)
    if (!version || !isSafePatchPath(patchPath)) {
      Errors.throwHostEnvironment(`The standalone Expo host has an invalid Metro patch registration: ${key}.`)
    }
    const patchesRoot = FS.resolvePath('patches', repoRoot)
    const source = FS.resolvePath(patchPath, repoRoot)
    const pathFromPatches = FS.relativePath(patchesRoot, source)
    if (pathFromPatches === '..' || pathFromPatches.startsWith('../') || !await FS.isFile(source)) {
      Errors.throwHostEnvironment(`The standalone Expo host patch is missing or outside patches/: ${patchPath}.`)
    }
    await FS.copyFile(source, FS.resolvePath(patchPath, stagedHost))
    patchedDependencies[key] = patchPath
    // The patched package key owns the version; this must not drift to a newer installed range.
    dependencies[name] = version
  }
  await FS.writeJson(FS.resolvePath('package.json', stagedHost), {
    name: manifest.name,
    private: true,
    version: manifest.version,
    main: manifest.main,
    dependencies,
    ...(Object.keys(patchedDependencies).length > 0 ? { patchedDependencies } : {}),
  })

  const tsconfigPath = FS.resolvePath('tsconfig.json', stagedHost)
  const tsconfig = await FS.readJson<Tsconfig>(tsconfigPath)
  const base = await FS.readJson<Tsconfig>(FS.resolvePath(BASE_TSCONFIG, repoRoot))
  // The base's `paths` map repository packages the installed host does not carry.
  const { baseUrl: _baseUrl, paths: _paths, ...baseOptions } = base.compilerOptions ?? {}
  const { extends: _extends, ...ownSettings } = tsconfig
  await FS.writeJson(tsconfigPath, {
    ...ownSettings,
    compilerOptions: { ...baseOptions, ...tsconfig.compilerOptions },
  })

  HCI.logProcessInfo('standalone', 'Resolving the portable host dependency lock...')
  await CLI.mustRun(portableBun, {
    args: ['install', '--lockfile-only', '--cwd', stagedHost],
    cwd: repoRoot,
    stdio: 'inherit',
  })
}

/** StandaloneBuild exposes the production host-staging operation for packaging callers. */
export const StandaloneBuild = { makeHostInstallable } as const

function isMetroPatchPackage(name: string): boolean {
  return name === 'metro' || name === '@expo/metro-file-map'
}

function isSafePatchPath(path: string): boolean {
  return !FS.isAbsolute(path)
    && !path.includes('\\')
    && path.startsWith('patches/')
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

/**
 * recordManagedNode names the Node an installed Tao downloads for `tao test`: the version the
 * repository's own devenv profile runs its tests under, and that tarball's SHA-256 as nodejs.org
 * publishes it. Recording the hash here rather than trusting the list at install time means a
 * download is checked against what the release was built with.
 */
async function recordManagedNode(repoRoot: string, staging: string): Promise<void> {
  const devenvNode = FS.resolvePath('.devenv/profile/bin/node', repoRoot)
  const node = await FS.isFile(devenvNode) ? devenvNode : 'node'
  const version = (await CLI.mustRun(node, { args: ['--version'] })).stdout.trim().replace(/^v/, '')
  const file = `node-v${version}-${hostTarget()}.tar.gz`
  const release = `${NODE_DOWNLOADS}/v${version}`
  const response = await fetch(`${release}/SHASUMS256.txt`)
  if (!response.ok) {
    Errors.throwHostEnvironment(`Could not read ${release}/SHASUMS256.txt (HTTP ${response.status}).`)
  }
  const line = (await response.text()).split('\n').find(entry => entry.endsWith(`  ${file}`))
  const sha256 = line?.split(/\s+/)[0]
  if (sha256 === undefined || !/^[0-9a-f]{64}$/.test(sha256)) {
    return Errors.throwHostEnvironment(`${release}/SHASUMS256.txt lists no SHA-256 for ${file}.`)
  }
  await FS.writeJson(FS.resolvePath(TaoResources.MANAGED_NODE_MANIFEST, staging), {
    sha256,
    url: `${release}/${file}`,
    version,
  })
}

/** installedVersion is the exact version of `name` this repository's install resolved for the host. */
async function installedVersion(repoRoot: string, name: string): Promise<string> {
  for (const root of HOST_DEPENDENCY_ROOTS) {
    const packageJson = FS.resolvePath(`${root}/${name}/package.json`, repoRoot)
    if (await FS.isFile(packageJson)) {
      return (await FS.readJson<{ version: string }>(packageJson)).version
    }
  }
  return Errors.throwHostEnvironment(`The host depends on ${name}, which this repository has not installed.`)
}

type HostManifest = {
  dependencies?: Record<string, string>
  main?: string
  name: string
  patchedDependencies?: Record<string, string>
  version: string
}

type Tsconfig = {
  compilerOptions?: Record<string, unknown> & { baseUrl?: unknown; paths?: unknown }
  extends?: string
}

/**
 * copyVisibleFiles copies the files Git does not ignore at or under `within`, keeping their paths relative
 * to `packageRoot`. Ignored files are exactly the ones that must not ship: installed dependencies,
 * generated trees, and build state.
 */
async function copyVisibleFiles(packageRoot: string, within: string, target: string): Promise<void> {
  for (const file of await Repo.filesUnder(FS.resolvePath(within, packageRoot))) {
    await FS.copyFile(file, FS.resolvePath(FS.relativePath(packageRoot, file), target))
  }
}

/** packTree writes every file under `root` into one gzipped archive and returns how many it holds. */
async function packTree(root: string, archive: string): Promise<number> {
  const files: Record<string, Uint8Array> = {}
  for await (const path of FS.walk(root, { includeHidden: true })) {
    files[FS.relativePath(root, path)] = await FS.readFile(path)
  }
  await FS.mkdir(FS.dirname(archive))
  await Bun.Archive.write(archive, files, { compress: 'gzip' })
  return Object.keys(files).length
}

/** originReleases is the Releases page of the GitHub repository `origin` names. */
async function originReleases(repoRoot: string): Promise<string> {
  const origin = (await CLI.mustRun('git', { args: ['remote', 'get-url', 'origin'], cwd: repoRoot })).stdout.trim()
  const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(origin)
  if (match === null) {
    return Errors.throwUserInput(`origin is ${origin}, not a GitHub repository; pass --releases <url>.`)
  }
  return `https://github.com/${match[1]}/${match[2]}/releases`
}

/**
 * hostTarget names this machine the way the install script does. The binary is built for the host,
 * and the first release is macOS on Apple silicon only.
 */
function hostTarget(): string {
  const target = `${Platform.hostPlatform}-${Platform.hostArch}`
  if (target !== 'darwin-arm64') {
    Errors.throwUserInput(`Releases are built on macOS on Apple silicon so far; this host is ${target}.`)
  }
  return target
}

function releaseNotes(version: string, releases: string): string {
  return [
    `Tao ${version} for macOS on Apple silicon.`,
    '',
    '```sh',
    `curl -fsSL ${releases}/download/v${version}/install.sh | sh`,
    '```',
    '',
    'Not yet in this release:',
    '',
    ...KNOWN_GAPS.map(gap => `- ${gap}`),
    '',
  ].join('\n')
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
