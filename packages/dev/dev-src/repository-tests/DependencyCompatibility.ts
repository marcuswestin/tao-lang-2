import { FS, HCI, Platform, Repo } from '@shared'

/**
 * A React copy reaching a bundle it does not own produces a Studio that starts and renders
 * nothing, with no error to read. Nothing else in the repository checks for it, so these rules
 * do: the versions Expo pins are the contract, and every package whose code is bundled into
 * Studio or a Tao app must resolve exactly those.
 */

/** Packages whose code is bundled into Tao Studio or a compiled Tao app. */
const BUNDLED_PACKAGES = ['@tao/code-editor', 'tao-runtime', 'tao-runtime-toolchain', 'tao-studio'] as const

/** The package the Studio browser bundle resolves React through (its singleton anchor). */
const REACT_SINGLETON_ANCHOR = 'tao-runtime-toolchain'

/**
 * Packages allowed their own React because they never reach a bundle. `tao-dev` renders the
 * repository's terminal UI with Ink, whose peer range starts above the React that Expo pins,
 * so unifying the two would break one of them. Its React must stay out of every bundle, which
 * `taoStudioReactSingletonPlugin` enforces by resolving React through the anchor instead.
 */
const HOST_TOOL_REACT_PACKAGES: Record<string, string> = {
  'tao-dev': "renders the repository terminal UI with Ink, whose React peer range starts above Expo's pin",
}

/** The dependencies whose versions Expo's SDK dictates for a Tao app to run at all. */
const REACT_PACKAGES = ['react', 'react-dom'] as const

/** PackageManifest is one workspace package manifest, as the checks read it. */
export type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  name: string
  path: string
  peerDependencies?: Record<string, string>
}

/** DependencyFacts is everything the checks need, gathered once so they stay pure. */
export type DependencyFacts = {
  /** `expo/bundledNativeModules.json`: the versions the installed Expo SDK is built against. */
  expoBundledVersions: Record<string, string>
  manifests: readonly PackageManifest[]
  /** `@types/react` range the installed React Native declares, or undefined when unavailable. */
  reactNativeTypesPeer?: string
  /** Versions each package actually resolves, keyed by package name then dependency name. */
  resolvedByPackage: Record<string, Record<string, string | undefined>>
  satisfies: (version: string, range: string) => boolean
}

/** dependencyCompatibilityIssues reports every runtime dependency mismatch, most severe first. */
export function dependencyCompatibilityIssues(facts: DependencyFacts): string[] {
  return [
    ...reactSingletonIssues(facts),
    ...bundledReactIssues(facts),
    ...hostToolReactIssues(facts),
    ...reactTypesIssues(facts),
    ...expoNativeModuleIssues(facts),
    ...unresolvedDependencyIssues(facts),
  ]
}

/** The anchor decides what every bundle gets, so it must match Expo's pins exactly. */
function reactSingletonIssues(facts: DependencyFacts): string[] {
  const issues: string[] = []
  const anchor = facts.resolvedByPackage[REACT_SINGLETON_ANCHOR]
  if (anchor === undefined) {
    return [`${REACT_SINGLETON_ANCHOR} is missing, so Tao Studio has no React singleton to resolve through.`]
  }
  // Every rule below compares against Expo's own pins. Without them there is nothing to compare,
  // and silently skipping would report agreement that was never checked.
  if (REACT_PACKAGES.some(name => facts.expoBundledVersions[name] === undefined)) {
    return [
      "The installed Expo SDK's bundled versions could not be read from "
      + 'expo/bundledNativeModules.json, so no runtime version could be checked at all. '
      + 'Install dependencies with: just deps',
    ]
  }
  for (const name of REACT_PACKAGES) {
    const expected = facts.expoBundledVersions[name]
    const resolved = anchor[name]
    if (expected === undefined || resolved === undefined || resolved === expected) {
      continue
    }
    issues.push(
      `${REACT_SINGLETON_ANCHOR} resolves ${name} ${resolved}, but the installed Expo SDK is built against `
        + `${name} ${expected}. Tao Studio and every compiled app bundle React through `
        + `${REACT_SINGLETON_ANCHOR}, so this ships a React the runtime was not built for. `
        + `Pin "${name}": "${expected}" in ${manifestPath(facts, REACT_SINGLETON_ANCHOR)}.`,
    )
  }
  const react = anchor['react']
  const testRenderer = anchor['react-test-renderer']
  if (react !== undefined && testRenderer !== undefined && react !== testRenderer) {
    issues.push(
      `react-test-renderer ${testRenderer} does not match react ${react} in `
        + `${manifestPath(facts, REACT_SINGLETON_ANCHOR)}. The runtime test renderer must be the exact `
        + `version of the React it renders. Pin "react-test-renderer": "${react}".`,
    )
  }
  return issues
}

/** Every bundled package must resolve the anchor's React, or two copies reach one bundle. */
function bundledReactIssues(facts: DependencyFacts): string[] {
  const anchorReact = facts.resolvedByPackage[REACT_SINGLETON_ANCHOR]?.['react']
  if (anchorReact === undefined) {
    return []
  }
  // Every React package, not just `react`: a second react-dom in one bundle is the same blank
  // Studio, and packages/studio declares react-dom in its own right.
  return BUNDLED_PACKAGES.flatMap(name =>
    REACT_PACKAGES.flatMap(reactPackage => {
      const anchorVersion = facts.resolvedByPackage[REACT_SINGLETON_ANCHOR]?.[reactPackage]
      const resolved = facts.resolvedByPackage[name]?.[reactPackage]
      if (anchorVersion === undefined || resolved === undefined || resolved === anchorVersion) {
        return []
      }
      return [
        `${name} resolves ${reactPackage} ${resolved} while ${REACT_SINGLETON_ANCHOR} resolves `
        + `${anchorVersion}. Both are bundled into Tao Studio, and two React copies in one bundle `
        + `render nothing at all. Pin "${reactPackage}": "${anchorVersion}" in ${manifestPath(facts, name)}.`,
      ]
    })
  )
}

/** A second React is legitimate only for a host tool that is documented and never bundled. */
function hostToolReactIssues(facts: DependencyFacts): string[] {
  const anchorReact = facts.resolvedByPackage[REACT_SINGLETON_ANCHOR]?.['react']
  const issues: string[] = []
  for (const [name, resolved] of Object.entries(facts.resolvedByPackage)) {
    const react = resolved['react']
    if (react === undefined || anchorReact === undefined || react === anchorReact) {
      continue
    }
    if (BUNDLED_PACKAGES.includes(name as typeof BUNDLED_PACKAGES[number])) {
      continue
    }
    if (HOST_TOOL_REACT_PACKAGES[name] !== undefined) {
      continue
    }
    issues.push(
      `${name} resolves react ${react} while ${REACT_SINGLETON_ANCHOR} resolves ${anchorReact}, and it is `
        + `listed neither as bundled nor as a host tool allowed its own React. Pin "react": "${anchorReact}" `
        + `in ${manifestPath(facts, name)}, or record why it needs its own copy in `
        + 'packages/dev/dev-src/repository-tests/DependencyCompatibility.ts.',
    )
  }
  for (const name of Object.keys(HOST_TOOL_REACT_PACKAGES)) {
    if (BUNDLED_PACKAGES.includes(name as typeof BUNDLED_PACKAGES[number])) {
      issues.push(
        `${name} is recorded as a host tool with its own React, but it is also listed as bundled. `
          + 'A package cannot be both: its React would reach a bundle it does not own.',
      )
    }
  }
  return issues
}

/** Types that disagree with the runtime React type-check against an API that is not there. */
function reactTypesIssues(facts: DependencyFacts): string[] {
  const peer = facts.reactNativeTypesPeer
  if (peer === undefined) {
    return []
  }
  return BUNDLED_PACKAGES.flatMap(name => {
    const resolved = facts.resolvedByPackage[name]?.['@types/react']
    if (resolved === undefined || facts.satisfies(resolved, peer)) {
      return []
    }
    return [
      `${name} resolves @types/react ${resolved}, outside the ${peer} that the installed React Native `
      + `declares. Align "@types/react" in ${manifestPath(facts, name)} with ${peer}.`,
    ]
  })
}

/** Expo ships against exact native module versions; a drifting one fails only on device. */
function expoNativeModuleIssues(facts: DependencyFacts): string[] {
  const issues: string[] = []
  for (const manifest of facts.manifests) {
    for (const [name, declared] of Object.entries(declaredDependencies(manifest))) {
      const expected = facts.expoBundledVersions[name]
      if (expected === undefined || REACT_PACKAGES.includes(name as typeof REACT_PACKAGES[number])) {
        continue
      }
      const resolved = facts.resolvedByPackage[manifest.name]?.[name]
      if (resolved === undefined || facts.satisfies(resolved, expected)) {
        continue
      }
      issues.push(
        `${manifest.name} declares ${name} ${declared} and resolves ${resolved}, but the installed Expo SDK `
          + `bundles ${name} ${expected}. Set "${name}": "${expected}" in ${manifest.path}.`,
      )
    }
  }
  return issues
}

/** A declared dependency that resolves to nothing means the lockfile and manifests disagree. */
function unresolvedDependencyIssues(facts: DependencyFacts): string[] {
  const issues: string[] = []
  for (const manifest of facts.manifests) {
    for (const [name, declared] of Object.entries(declaredDependencies(manifest))) {
      if (declared.startsWith('workspace:')) {
        continue
      }
      const resolved = facts.resolvedByPackage[manifest.name]?.[name]
      if (resolved !== undefined) {
        continue
      }
      issues.push(
        `${manifest.name} declares ${name} ${declared}, which is not installed. The lockfile and `
          + `${manifest.path} disagree; run: just deps`,
      )
    }
  }
  return issues
}

function declaredDependencies(manifest: PackageManifest): Record<string, string> {
  return { ...manifest.dependencies, ...manifest.devDependencies }
}

function manifestPath(facts: DependencyFacts, name: string): string {
  return facts.manifests.find(manifest => manifest.name === name)?.path ?? `${name}/package.json`
}

/** readDependencyFacts gathers manifests, Expo's pins, and what each package actually resolves. */
export async function readDependencyFacts(repoRoot = Repo.getRoot()): Promise<DependencyFacts> {
  const manifests = await readWorkspaceManifests(repoRoot)
  const resolvedByPackage: Record<string, Record<string, string | undefined>> = {}
  for (const manifest of manifests) {
    const base = FS.resolvePath(FS.dirname(manifest.path), repoRoot)
    const resolved: Record<string, string | undefined> = {}
    for (const name of Object.keys(declaredDependencies(manifest))) {
      resolved[name] = await resolveVersion(name, base)
    }
    resolvedByPackage[manifest.name] = resolved
  }
  const anchorBase = FS.resolvePath('packages/runtime-toolchain', repoRoot)
  return {
    expoBundledVersions: await readJsonOrEmpty(anchorBase, 'expo/bundledNativeModules.json'),
    manifests,
    reactNativeTypesPeer:
      (await readJsonOrEmpty<{ peerDependencies?: Record<string, string> }>(anchorBase, 'react-native/package.json'))
        .peerDependencies?.['@types/react'],
    resolvedByPackage,
    satisfies: (version, range) => Bun.semver.satisfies(version, range),
  }
}

async function readWorkspaceManifests(repoRoot: string): Promise<PackageManifest[]> {
  const packagesRoot = FS.resolvePath('packages', repoRoot)
  const manifests: PackageManifest[] = []
  for (const name of (await FS.listDir(packagesRoot)).sort()) {
    const path = `packages/${name}/package.json`
    const absolutePath = FS.resolvePath(path, repoRoot)
    if (!await FS.isFile(absolutePath)) {
      continue
    }
    manifests.push({ ...await FS.readJson<Omit<PackageManifest, 'path'>>(absolutePath), path })
  }
  return manifests
}

async function resolveVersion(name: string, base: string): Promise<string | undefined> {
  try {
    return (await FS.readJson<{ version?: string }>(Bun.resolveSync(`${name}/package.json`, base))).version
  } catch {
    return undefined
  }
}

async function readJsonOrEmpty<ValueT extends object = Record<string, string>>(
  base: string,
  specifier: string,
): Promise<ValueT> {
  try {
    return await FS.readJson<ValueT>(Bun.resolveSync(specifier, base))
  } catch {
    return {} as ValueT
  }
}

if (import.meta.main) {
  const issues = dependencyCompatibilityIssues(await readDependencyFacts())
  for (const issue of issues) {
    HCI.writeErrorLine(`dependency compatibility: ${issue}`)
  }
  Platform.runtimeProcess.setExitCode(issues.length === 0 ? 0 : 1)
}
