import { Errors, FS, Json, Platform, Repo } from '@shared'

/*
 * A prebuilt host is a build of the Tao Companion — an `.apk` or `.app` — that `tao run` installs
 * once and points at Metro in place of Expo Go. Whether it can run a Tao version's bundle depends
 * on one thing: it must carry every native module that version's app host requires, built from the
 * same code. A module it lacks crashes the app at require time; one built from other code fails
 * somewhere stranger. So each host carries a manifest naming its native kit, and `tao run` compares
 * that manifest — never the directory the host was cached under — with the kit it computes for
 * itself. Two Tao versions whose kits differ can share a cache path and still never launch each
 * other's host.
 */

/** HOST_MANIFEST_FILE is the manifest's name beside the host binary it describes. */
const HOST_MANIFEST_FILE = 'tao-host.json'
const HOST_MANIFEST_FORMAT = 1

/**
 * NativeKit maps each native-code package a host carries, or an app host requires, to the identity
 * of the code it was built from: the installed version, plus a hash of the native sources for a
 * private package, whose version never moves when its native code does.
 */
export type NativeKit = Readonly<Record<string, string>>

/** HostPlatform is the runtime a prebuilt host binary installs onto. */
export type HostPlatform = 'android' | 'ios-simulator'

/** HOST_BINARIES names the binary each platform's host directory carries beside its manifest. */
export const HOST_BINARIES: Readonly<Record<HostPlatform, string>> = {
  android: 'tao-companion.apk',
  'ios-simulator': 'Tao Companion.app',
}

/** HostManifest is what a prebuilt host carries beside its binary. */
export type HostManifest = {
  format: typeof HOST_MANIFEST_FORMAT
  /** The Companion's own version, for people and cache paths; never part of compatibility. */
  hostVersion: string
  nativeKit: NativeKit
  platform: HostPlatform
}

type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  name?: string
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  private?: boolean
  version?: string
}

/**
 * nativeKitOf computes the native kit of the package at `packageDirectory` from its installed
 * dependency graph: wrappers can bring native modules indirectly. Root development dependencies
 * and required peers participate in discovery; dependency packages' development dependencies do not.
 */
export async function nativeKitOf(packageDirectory: string): Promise<NativeKit> {
  const kit: Record<string, string> = {}
  const visited = new Set<string>()
  const packages = new Map<string, PackageManifest>()
  const selected = new Map<string, {
    depth: number
    pathDepth: number
    candidates: Map<string, PackageManifest>
  }>()
  const queue: Array<{ directory: string; depth: number; name?: string; originPath: string }> = [{
    directory: await FS.realPath(packageDirectory),
    depth: 0,
    originPath: packageDirectory,
  }]
  // Breadth first means a shared real directory's children are traversed from its closest edge.
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!
    let manifest = packages.get(current.directory)
    if (manifest === undefined) {
      manifest = await FS.readJson<PackageManifest>(FS.resolvePath('package.json', current.directory))
      packages.set(current.directory, manifest)
    }
    if (current.name !== undefined) {
      const name = manifest.name ?? current.name
      const pathDepth = current.originPath.split('/node_modules/').length
      const previous = selected.get(name)
      if (
        previous === undefined || current.depth < previous.depth
        || (current.depth === previous.depth && pathDepth < previous.pathDepth)
      ) {
        selected.set(name, { depth: current.depth, pathDepth, candidates: new Map([[current.directory, manifest]]) })
      } else if (current.depth === previous.depth && pathDepth === previous.pathDepth) {
        previous.candidates.set(current.directory, manifest)
      }
    }
    // An alias may improve native selection priority, but never repeats a directory's children.
    if (visited.has(current.directory)) {
      continue
    }
    visited.add(current.directory)
    const dependencies = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(current.depth === 0 ? manifest.devDependencies ?? {} : {}),
      ...Object.keys(manifest.peerDependencies ?? {}).filter(name =>
        manifest.peerDependenciesMeta?.[name]?.optional !== true
      ),
    ])
    for (const name of [...dependencies].toSorted()) {
      if (!includeAutolinkingDependency(name)) {
        continue
      }
      const dependency = await resolveInstalledDependency(name, current.directory)
      if (dependency !== undefined) {
        queue.push({ ...dependency, name, depth: current.depth + 1 })
      }
    }
  }
  for (const [name, selection] of selected) {
    // Resolve all packages before asking whether the winning version carries native code:
    // a shallower JavaScript-only version suppresses a deeper native version, as Expo does.
    const identities = [
      ...new Set(
        await Promise.all(
          [...selection.candidates.keys()].map(async directory =>
            await shipsNativeCode(directory) ? await buildIdentity(directory) : undefined
          ),
        ),
      ),
    ]
    if (identities.length === 1 && identities[0] === undefined) {
      continue
    }
    // Expo resolves remaining ties deterministically by source and origin path. This host
    // manifest deliberately refuses equal-priority candidates with different native identities
    // (including native versus JavaScript-only), because it cannot attest both builds.
    if (identities.length > 1) {
      Errors.throwHostEnvironment(
        `Installed native package '${name}' has conflicting build identities at the same resolution priority: ${
          identities.map(identity => identity ?? 'no native build').join(' and ')
        }. Resolve the conflicting dependencies before selecting a native host.`,
        { details: { name, identities, directories: [...selection.candidates.keys()] } },
      )
    }
    kit[name] = identities[0]!
  }
  return Object.fromEntries(Object.entries(kit).toSorted(([left], [right]) => left.localeCompare(right)))
}

/** Preserve the origin path as well as the real path for Expo's shallow node_modules precedence. */
async function resolveInstalledDependency(
  name: string,
  fromDirectory: string,
): Promise<{ directory: string; originPath: string } | undefined> {
  let directory = FS.resolvePath(fromDirectory)
  for (;;) {
    const originPath = FS.resolvePath(`node_modules/${name}`, directory)
    if (await FS.isFile(FS.resolvePath('package.json', originPath))) {
      return { directory: await FS.realPath(originPath), originPath }
    }
    const parent = FS.dirname(directory)
    if (parent === directory) {
      return undefined
    }
    directory = parent
  }
}

// Focused mirror of expo-modules-autolinking 57.0.13:
// src/dependencies/resolution.ts (root dev dependencies and required peers), and
// src/dependencies/utils.ts (defaultShouldIncludeDependency and mergeWithDuplicate).
// Tooling/test subgraphs do not lead to autolinked modules. Keep these exclusions aligned
// with the installed Expo version when upgrading it; do not extend them for individual apps.
const autolinkingExcludedScopes = new Set([
  'babel',
  'types',
  'eslint',
  'typescript-eslint',
  'testing-library',
  'aws-crypto',
  'aws-sdk',
])
const autolinkingExcludedPackages = new Set([
  '@expo/cli',
  '@expo/config',
  '@expo/metro-config',
  '@expo/package-manager',
  '@expo/prebuild-config',
  '@expo/webpack-config',
  '@expo/env',
  '@react-native/codegen',
  '@react-native/community-cli-plugin',
  'eslint',
  'eslint-config-expo',
  'eslint-plugin-expo',
  'eslint-plugin-import',
  'jest-expo',
  'jest',
  'metro',
  'ts-node',
  'typescript',
  'webpack',
])

function includeAutolinkingDependency(name: string): boolean {
  const scope = name.startsWith('@') ? name.slice(1, name.indexOf('/')) : undefined
  return !autolinkingExcludedPackages.has(name) && (scope === undefined || !autolinkingExcludedScopes.has(scope))
}

/**
 * shipsNativeCode reports whether a resolved package directory carries a native build file. An
 * `ios/` or `android/` directory alone is not a safe signal: `jest-expo` carries both, holding
 * nothing but a `jest-preset.js` each. The real signal is a native build file inside: a `.podspec`
 * (at the package root or under `ios/`), an `android/build.gradle`, or the Expo autolinking marker
 * `expo-module.config.json`.
 */
export async function shipsNativeCode(packageDirectory: string): Promise<boolean> {
  return await FS.isFile(FS.resolvePath('expo-module.config.json', packageDirectory))
    || await FS.isFile(FS.resolvePath('android/build.gradle', packageDirectory))
    || await hasPodspec(packageDirectory)
    || await hasPodspec(FS.resolvePath('ios', packageDirectory))
}

async function hasPodspec(directory: string): Promise<boolean> {
  if (!await FS.isDirectory(directory)) {
    return false
  }
  return (await FS.listDir(directory)).some(name => name.toLowerCase().endsWith('.podspec'))
}

/**
 * A published package's version names its code exactly. A private one is Tao's own and never
 * published, so its version stays put while its native sources change underneath it; its identity
 * adds a hash of every file that reaches the native build — the platform directories, the config
 * plugin, and the autolinking marker.
 */
async function buildIdentity(packageDirectory: string): Promise<string> {
  const manifest = await FS.readJson<PackageManifest>(FS.resolvePath('package.json', packageDirectory))
  const version = manifest.version ?? '0.0.0'
  if (manifest.private !== true) {
    return version
  }
  const sources = (await Repo.filesUnder(packageDirectory))
    .map(path => FS.relativePath(packageDirectory, path))
    .filter(isNativeBuildInput)
    .toSorted()
  const content: string[] = []
  for (const source of sources) {
    content.push(source, '\0', await FS.readText(FS.resolvePath(source, packageDirectory)), '\0')
  }
  return `${version}+${Platform.sha256Hex(content).slice(0, 16)}`
}

function isNativeBuildInput(relativePath: string): boolean {
  if (relativePath.split('/').includes('node_modules')) {
    return false
  }
  return ['android/', 'ios/', 'plugins/'].some(prefix => relativePath.startsWith(prefix))
    || relativePath === 'app.plugin.js'
    || relativePath === 'expo-module.config.json'
    || relativePath.endsWith('.podspec')
}

/**
 * hostKitProblems lists, one sentence each, the native modules `required` needs that `carried`
 * lacks or carries from other code. A host may carry more than an app needs (the Companion has
 * `expo-dev-client`), so the comparison runs one way. An empty list means the host can run it.
 */
export function hostKitProblems(carried: NativeKit, required: NativeKit): string[] {
  const problems: string[] = []
  for (const [name, identity] of Object.entries(required)) {
    const hostIdentity = carried[name]
    if (hostIdentity === undefined) {
      problems.push(`it lacks ${name} ${identity}`)
    } else if (hostIdentity !== identity) {
      problems.push(`it carries ${name} ${hostIdentity} where this Tao needs ${identity}`)
    }
  }
  return problems
}

/**
 * hostKey names a host build wherever it is cached or published: the Companion's version, which
 * rarely moves, and a digest of the native kit it carries, which moves with every native change.
 * Two builds of one version with different kits therefore never share a directory or a release.
 */
export function hostKey(manifest: HostManifest): string {
  const kit = Object.entries(manifest.nativeKit).toSorted(([left], [right]) => left.localeCompare(right))
  return `${manifest.hostVersion}-${Platform.sha256Hex(JSON.stringify(kit)).slice(0, 12)}`
}

/** writeHostManifest records a host's manifest beside its binary in `hostDirectory`. */
export async function writeHostManifest(hostDirectory: string, manifest: HostManifest): Promise<void> {
  await FS.writeJson(FS.resolvePath(HOST_MANIFEST_FILE, hostDirectory), manifest)
}

/**
 * readHostManifest reads the manifest beside a host binary, or undefined when there is none. A
 * manifest that is present but unreadable came from a download or a build that went wrong, so it
 * is reported as the host environment's failure rather than read as an older format.
 */
export async function readHostManifest(hostDirectory: string): Promise<HostManifest | undefined> {
  const path = FS.resolvePath(HOST_MANIFEST_FILE, hostDirectory)
  if (!await FS.isFile(path)) {
    return undefined
  }
  return parseHostManifest(await FS.readJson<unknown>(path), path, ' Remove that host directory and run again.')
}

/**
 * parseHostManifest accepts a manifest this Tao can read, whether it came from disk or a release,
 * and names `source` and the caller's remedy in the failure otherwise.
 */
export function parseHostManifest(manifest: unknown, source: string, remedy = ''): HostManifest {
  if (
    !Json.isRecord(manifest)
    || manifest['format'] !== HOST_MANIFEST_FORMAT
    || typeof manifest['hostVersion'] !== 'string'
    || (manifest['platform'] !== 'android' && manifest['platform'] !== 'ios-simulator')
    || !Json.isRecord(manifest['nativeKit'])
    || !Object.values(manifest['nativeKit']).every(identity => typeof identity === 'string')
  ) {
    return Errors.throwHostEnvironment(`The prebuilt host manifest at ${source} is not one this Tao can read.${remedy}`)
  }
  return manifest as HostManifest
}
