import { FS, Platform, ReleaseCapabilities, Repo, TaoFiles, TaoStdlib } from '@shared'
import { inPlace } from './in-place-files'
import { verdictPackageFiles } from './toolchain-packages'

/**
 * `tao test` spends most of a run validating and compiling Tao apps into TypeScript that the last
 * run already produced. This module decides when that output may be handed to the next run intact.
 *
 * It answers with a fingerprint and nothing else: one hash of everything that could make an
 * identical command produce different compiled output or different validation verdicts. The run
 * root that the fingerprint names is `TestRunRoot`'s concern; whether the fingerprint is honest is
 * this module's, and it is the only thing standing between a fast suite and a false green.
 *
 * The composition is deliberately coarse. Every component below is hashed whole rather than reduced
 * to the part a given run happens to read, because a per-file key that has to know which file
 * reaches which other file is a key that can be wrong. The dominant saving is the iteration where
 * nothing changed at all, and coarseness costs that case nothing.
 *
 * - The run's own shape: the format version of this scheme, the runtime package root the output is
 *   compiled into, and the sorted set of test files. The manifest describes one whole run, so a run
 *   over a different set of files is a different run.
 * - The toolchain that compiles: every file under the repository's `packages/`, plus the root
 *   `bun.lock` and `package.json`, plus the resolved `.devenv/profile` link. That covers the
 *   compiler, the validator, the parser grammar, the generation and runtime packages, the Tao
 *   stdlib sources, and the pinned tools, without anyone having to declare which of them matter.
 * - The declared stdlib, which is the one input that need not be a path inside this repository at
 *   all: `TAO_STDLIB_ROOT` relocates it, and the packaged Studio runner points it at a payload tree
 *   the traversal above cannot see. `TaoStdlib` owns what hashing that means, because the repository
 *   build's compile-app stamp has to answer for exactly the same input.
 * - The generated parser tree, which is ignored by Git and therefore invisible to the tracked
 *   traversal above. A grammar regenerated into it changes what compiles.
 * - The authored sources: every visible file under each path the command was given and under each
 *   test file's owning project root — which is what carries the `@` package directories and the
 *   TypeScript sidecars beside them — plus each owning `.tao` marker, root configuration, and lock.
 *   Generated trees are excluded: they are this run's
 *   output, not its input.
 *
 * Anything that cannot be read, and any checkout whose toolchain cannot be located at all, yields
 * no fingerprint and therefore no reuse. Failing closed costs a recompile; failing open costs a
 * green suite that proves nothing.
 */

/** NO_CACHE_ENV forces the uncached path: every run validates and compiles from source. */
const NO_CACHE_ENV = 'TAO_TEST_NO_CACHE'

/** CATEGORY names the run-root category `tao test` compiles into and reuses within. */
const CATEGORY = 'tao-test-command'

/**
 * VERSION is the identity of this composition. Changing what is hashed, or how, changes it, so the
 * entries a previous scheme published can never be mistaken for entries of this one. It also covers
 * the *shape* of what a published run root holds: version 2 added the generated Jest entrypoints a
 * run is now started through, and a version 1 root carries none of them. Version 3 folds the
 * declared stdlib into the key, which version 2 answered for by refusing to produce a key at all.
 * Version 4 refuses reuse when authored Tao declares dependencies outside the hashed source roots.
 */
const VERSION = '4'

/**
 * SOURCE_EXCLUDED_DIRECTORIES are the directories Tao source discovery never descends. Reusing that
 * list keeps the fingerprint over exactly the tree the command itself considers authored, so a
 * native build directory cannot make every run a miss.
 */
const SOURCE_EXCLUDED_DIRECTORIES = TaoFiles.discoveryExcludeDirectoryNames

/** FingerprintRequest declares everything about one run that its compiled output depends on. */
export type FingerprintRequest = {
  /** The paths the command was asked to test, as the user gave them. */
  roots: readonly string[]
  /** The runtime package root this run compiles into. */
  runtimeRoot: string
  /** The discovered test files, sorted. */
  testPaths: readonly string[]
  /**
   * The checkout whose compiler this is, defaulting to the one this module was loaded from. It is
   * a field rather than a constant so a test can vary the toolchain term at all: every other term
   * is reachable from a fixture, and this one would otherwise be assertable only by editing the
   * running repository.
   */
  toolchainRoot?: string
}

/** TestCache owns the identity under which one `tao test` run may reuse another's compiled output. */
export const TestCache = {
  CATEGORY,
  disabled,
  fingerprint,
  NO_CACHE_ENV,
} as const

/** disabled reports whether this run was told to ignore compiled output entirely. */
function disabled(): boolean {
  return Platform.runtimeProcess.env[NO_CACHE_ENV] === 'true'
}

/**
 * fingerprint identifies one run's compiled output, or returns undefined when it cannot be
 * identified honestly and the run must therefore compile for itself.
 */
async function fingerprint(request: FingerprintRequest): Promise<string | undefined> {
  const toolchainRoot = request.toolchainRoot ?? Repo.tryGetRoot(import.meta.dir)
  if (toolchainRoot === undefined) {
    // A CLI running from outside its own source tree — a packaged build — cannot say which compiler
    // it is. Without that half of the key, no amount of source hashing makes reuse safe.
    return undefined
  }
  try {
    if (!await cacheableRootConfigs(request.testPaths)) {
      return undefined
    }
    const sources = await sourceIdentity(request)
    if (sources === undefined) {
      return undefined
    }
    return FS.contentIdentity([
      `release-profile\n${ReleaseCapabilities.fingerprint()}`,
      `version\n${VERSION}`,
      `runtime-root\n${FS.resolvePath(request.runtimeRoot)}`,
      `test-paths\n${request.testPaths.map(path => FS.resolvePath(path)).toSorted().join('\n')}`,
      `profile\n${await profileIdentity(toolchainRoot)}`,
      `toolchain\n${await toolchainIdentity(toolchainRoot)}`,
      `stdlib\n${await TaoStdlib.declaredRootIdentity(toolchainRoot)}`,
      `parser\n${await generatedParserIdentity(toolchainRoot)}`,
      `sources\n${sources}`,
    ])
  } catch {
    return undefined
  }
}

/** The normal generated root config has no external extends; custom chains need service input tracking. */
async function cacheableRootConfigs(testPaths: readonly string[]): Promise<boolean> {
  const roots = new Set(await Promise.all(testPaths.map(path => inPlace.workspaceRootForPath(path))))
  for (const root of roots) {
    const configPath = FS.resolvePath('tsconfig.json', root)
    if (!await FS.isFile(configPath)) {
      continue
    }
    const config = await FS.readJson<unknown>(configPath)
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      return false
    }
    const entries = Object.entries(config)
    const [entry] = entries
    if (
      entries.length !== 1 || entry?.[0] !== 'extends'
      || entry[1] !== './.tao/typescript/tsconfig.json'
    ) {
      return false
    }
  }
  return true
}

/** profileIdentity resolves the pinned devenv profile, which is what fixes bun, node, and dprint. */
async function profileIdentity(toolchainRoot: string): Promise<string> {
  return await FS.realPath(FS.resolvePath('.devenv/profile', toolchainRoot)).catch(() => '<none>')
}

/**
 * toolchainIdentity hashes every package file a compiled app can depend on, plus the root
 * dependency pins. `toolchain-packages.ts` owns which groups are left out and why a verdict cannot
 * depend on them.
 */
async function toolchainIdentity(toolchainRoot: string): Promise<string> {
  const packageFiles = await verdictPackageFiles(FS.resolvePath('packages', toolchainRoot))
  const rootFiles = []
  for (const name of ['bun.lock', 'package.json']) {
    const path = FS.resolvePath(name, toolchainRoot)
    if (await FS.isFile(path)) {
      rootFiles.push(path)
    }
  }
  return await identityOf(toolchainRoot, [...packageFiles, ...rootFiles])
}

/**
 * generatedParserIdentity hashes the generated parser tree by walking it directly. It is a `_gen_`
 * directory, so Git ignores it and the tracked traversal above does not see it at all.
 */
async function generatedParserIdentity(toolchainRoot: string): Promise<string> {
  const generatedRoot = FS.resolvePath('packages/language/parser/parser-src/_gen_tao-parser', toolchainRoot)
  const files: string[] = []
  if (await FS.isDirectory(generatedRoot)) {
    for await (const path of FS.walk(generatedRoot, { includeHidden: true })) {
      files.push(path)
    }
  }
  return await identityOf(generatedRoot, files)
}

/**
 * sourceIdentity hashes every authored file a run of this shape can reach, not only the `.tao`
 * ones. A Tao project may carry TypeScript sidecars beside its declarations — `@ui/Shell.ts` in
 * WordFlower is one, and the compiler copies it and everything it imports into the compiled app.
 * Hashing the whole visible directory is what makes the answer independent of which kinds of file
 * the compiler happens to read today.
 */
async function sourceIdentity(request: FingerprintRequest): Promise<string | undefined> {
  const searchRoots = new Set<string>()
  for (const root of request.roots) {
    searchRoots.add(FS.resolvePath(root))
  }
  const sources = new Set<string>()
  const markers = new Set<string>()
  for (const testPath of request.testPaths) {
    // The named file goes in whatever the walk below finds. It is the one file this run is
    // certainly about, and `minimalRoots` drops it as a search root as soon as its project root
    // joins the set — so without this an explicitly named file under a directory the walk cannot
    // see contributes nothing but its path.
    const resolved = FS.resolvePath(testPath)
    if (await FS.isFile(resolved)) {
      sources.add(resolved)
    }
    const projectRoot = await inPlace.workspaceRootForPath(testPath)
    searchRoots.add(projectRoot)
    markers.add(projectRoot)
    for (const name of ['tsconfig.json', '.tao/lock.jsonc', '.tao/project.json']) {
      const path = FS.resolvePath(name, projectRoot)
      if (await FS.isFile(path)) {
        sources.add(path)
      }
    }
  }
  const runtimeRoot = FS.resolvePath(request.runtimeRoot)
  for (const searchRoot of minimalRoots(searchRoots)) {
    for (const path of await visibleFilesUnder(searchRoot)) {
      if (isAuthored(FS.relativePath(searchRoot, path), path, runtimeRoot)) {
        sources.add(path)
      }
    }
  }
  // A project requirement can publish source from a sibling outside every hashed root. Until the
  // selected dependency closure is part of this key, recompiling is the only honest answer.
  for (const path of sources) {
    if (path.endsWith('.tao') && /\brequires\b/.test(await FS.readText(path))) {
      return undefined
    }
  }
  return FS.contentIdentity([
    await identityOf('/', [...sources]),
    ...await Promise.all(
      [...markers].toSorted().map(async root => `${root}:${await FS.isDirectory(FS.resolvePath('.tao', root))}`),
    ),
  ])
}

/**
 * visibleFilesUnder lists a search root's files the way the compiler will read them, which is not
 * always the way Git lists them. `Repo.filesUnder` answers with Git's tracked-and-unignored view
 * inside a worktree, and a project living under an ignored path — a scratch app under
 * `.artifacts/tmp/`, which is a documented way to try something out — has no such files at all.
 * Hashing that answer produces a fingerprint covering none of the sources, so every later run of an
 * edited scratch app matches it and replays the first run's green.
 *
 * An empty Git answer over a directory that does hold files is the whole of that case, and the
 * filesystem walk is the honest reading of it. A root Git answers for is left alone, so the ordinary
 * path costs nothing and `_gen_` trees inside a tracked project stay excluded by their ignore rules
 * rather than by this walk — `isAuthored` is what excludes them once the walk is the one listing.
 */
async function visibleFilesUnder(searchRoot: string): Promise<readonly string[]> {
  const listed = await Repo.filesUnder(searchRoot, { excludeDirectoryNames: SOURCE_EXCLUDED_DIRECTORIES })
  if (listed.length > 0 || !await FS.isDirectory(searchRoot)) {
    return listed
  }
  const walked: string[] = []
  const excluded: ReadonlySet<string> = new Set<string>(SOURCE_EXCLUDED_DIRECTORIES)
  for await (const path of FS.walk(searchRoot, { excludeDirectory: name => excluded.has(name) })) {
    walked.push(path)
  }
  return walked
}

/**
 * isAuthored keeps generated trees out of the source identity. A project may sit above the very
 * directory this run compiles into, and `tao compile` leaves `_gen_` trees inside projects; hashing
 * either would make the fingerprint depend on the run's own output and so never repeat. Git already
 * hides both inside a worktree, and this is what stands in for that outside one. The `_gen_` test
 * reads the path below the searched root, so a checkout that happens to live under such a directory
 * does not silently hash nothing.
 */
function isAuthored(relativePath: string, path: string, runtimeRoot: string): boolean {
  return !FS.pathIsWithin(path, runtimeRoot)
    && !relativePath.split('/').some(segment => segment.startsWith('_gen_'))
}

/**
 * minimalRoots drops any root contained in another. Searching a directory and then its parent finds
 * the same files twice, which costs a traversal and changes nothing about the identity.
 */
function minimalRoots(roots: ReadonlySet<string>): readonly string[] {
  const sorted = [...roots].toSorted()
  return sorted.filter(root => !sorted.some(other => other !== root && FS.pathIsWithin(root, other)))
}

/** identityOf labels each file by its path below `root`, so a file that moves changes the identity. */
async function identityOf(root: string, paths: readonly string[]): Promise<string> {
  return await FS.filesIdentity(paths.map(path => [FS.relativePath(root, path), path]))
}
