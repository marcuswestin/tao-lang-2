import { Assert, Errors, FS, Json, Platform } from '@shared'
import { RuntimeToolchainPaths } from '../runtime-toolchain-paths'
import { TestHarnessFiles } from './test-harness-files'
import { TestRunId } from './test-run-id'

/** DIRECTORY_NAME names the ignored runtime-toolchain directory that holds every generated run root. */
const DIRECTORY_NAME = '_gen_tao-app-test'

/** MANIFEST_FILE_NAME names the compiled-file manifest a run writes at the top of its run root. */
const MANIFEST_FILE_NAME = 'manifest.json'

/**
 * RETAINED_RUN_ROOTS bounds how many finished run roots one category keeps.
 * A run that neither failed nor became a reusable cache entry discards its own root, so a finished
 * unreferenced root is a failed run's generated code: keep the newest one to debug against and let
 * older failures go.
 */
const RETAINED_RUN_ROOTS = 1

/**
 * ACTIVE_RUN_GRACE_MS is how long one run's root stays off-limits to every other run.
 * A run id carries the moment its owner created it, and a reused root records the moment it was
 * last handed out, so a root touched recently may still belong to a live concurrent suite that no
 * other process can observe.
 */
const ACTIVE_RUN_GRACE_MS = 60 * 60 * 1000

/** RUN_ROOT_NAME matches the `TestRunId.create()` directory names this module owns. */
const RUN_ROOT_NAME = /^run-(\d+)-[0-9a-z]+$/

/** CATEGORY_NAME matches the run-root grouping directory names this module writes. */
const CATEGORY_NAME = /^[a-z][a-z0-9-]*$/

/**
 * CACHE_DIRECTORY_NAME names the reuse index inside a category directory. The leading dot keeps it
 * out of both `RUN_ROOT_NAME` and `CATEGORY_NAME`, so pruning can never mistake it for generated
 * code of its own.
 */
const CACHE_DIRECTORY_NAME = '.cache'

/** CACHE_ENTRY_NAME matches the index files this module writes, one per fingerprint. */
const CACHE_ENTRY_NAME = /^[0-9a-f]{16,128}\.json$/

/**
 * RETAINED_CACHE_BYTES bounds the compiled output one category's index may point at, counted in the
 * content bytes each entry recorded when it was published.
 *
 * A count is the wrong bound here, and a small one was actively wrong. A lane does not run a suite
 * once: it splits it into shards, and a shard's set of test paths is part of the fingerprint, so
 * every shard publishes an entry of its own. That count is not written down anywhere — it is derived
 * per checkout from recorded durations, so it rises as the corpus grows — and a retained count of 4
 * was already smaller than an observed 4-shard plan plus the whole-corpus run a developer starts by
 * hand. The hand-run entry was evicted between one invocation and the next and recompiled every
 * time.
 *
 * Bytes are the bound that a growing shard plan cannot silently outgrow, because sharding
 * *partitions* a corpus rather than duplicating it: N shards compile N disjoint slices, so a whole
 * plan costs about what the one whole-corpus run costs, whatever N is. Re-sharding 4 ways or 40 ways
 * moves the same bytes between more entries and changes this budget's arithmetic hardly at all.
 *
 * The number is grounded in this checkout: `./tao test Apps` — 30 test files, 37 compiled apps —
 * publishes a run root of 4.2 MB across 1,431 files, occupying 8.4 MB of blocks because the files
 * are small. 256 MB therefore holds about thirty whole-corpus equivalents, where a full lane plus a
 * developer's own scopes account for two or three of them, and it would still hold several
 * generations if the corpus grew eightfold.
 */
const RETAINED_CACHE_BYTES = 256 * 1024 * 1024

/**
 * RETAINED_CACHE_AGE_MS is how long an entry survives without being asked for.
 *
 * The budget alone would hold a dormant checkout at its ceiling forever. Almost every entry here
 * dies of a changed fingerprint rather than of eviction — editing anything under `packages/` retires
 * a whole generation of them at once — and an entry no run has wanted in a week belongs to a
 * generation nothing will ask for again.
 */
const RETAINED_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * COMPILED_STORE_DIRECTORY_NAME names the content-addressed store of compiled apps beside a
 * category's run roots. The leading dot keeps it out of `RUN_ROOT_NAME` and `CATEGORY_NAME`.
 *
 * A compiled app used to live inside its run root, at a path that changed with every compile. Jest
 * keys its transform cache by path, so every compile re-transformed every compiled module — about
 * three hundred for WordFlower's eight test apps — although most of them had not changed and five of
 * the eight apps shared one module tree byte for byte. Here a module tree is stored once under the
 * hash of its contents, and an app is stored under the hash of its own files plus that tree, with
 * `modules` a relative symlink to the tree. A path in this store names immutable bytes: a compile
 * that produces the same output lands at the same path and is reused by Jest's cache, one that
 * produces different output lands at a different path, and a manifest that names a path can never
 * come to describe newer output than it was fingerprinted for.
 */
const COMPILED_STORE_DIRECTORY_NAME = '.compiled'

/** MODULES_DIRECTORY_NAME is what the compiler names the module tree beside a generated `App.tsx`. */
const MODULES_DIRECTORY_NAME = 'modules'

/** COMPILED_ENTRY_NAME matches the store's directory names, which are content hashes. */
const COMPILED_ENTRY_NAME = /^[0-9a-f]{64}$/

/** LAST_USED_FILE_NAME records when a run root was last handed to a run, reused roots included. */
const LAST_USED_FILE_NAME = 'last-used'

/** TestRunRootOptions locates the runtime package whose generated run roots are in play. */
type TestRunRootOptions = {
  runtimePackageRoot?: string
}

/** CachedRun names compiled output a previous passing run left behind for an identical run to use. */
type CachedRun = {
  manifestPath: string
  runRoot: string
}

/** TestRunRoot owns the lifecycle of the directories runtime test runs compile into. */
export const TestRunRoot = {
  COMPILED_STORE_DIRECTORY_NAME,
  create,
  DIRECTORY_NAME,
  discard,
  intern,
  lookup,
  MANIFEST_FILE_NAME,
  prune,
  publish,
  RETAINED_CACHE_AGE_MS,
  RETAINED_CACHE_BYTES,
} as const

type FoundRunRoot = {
  /** The newer of the moment the root was created and the moment it was last handed to a run. */
  activeMs: number
  createdMs: number
  path: string
}

/** CacheEntry points one fingerprint at the run root a passing run compiled it into. */
type CacheEntry = {
  at: string
  /**
   * The content bytes the run root held when it was published, which is what the retention budget
   * spends. Recording it is what keeps pruning off the disk: the alternative is walking every
   * retained tree on every process start, and a whole-corpus root is over a thousand files.
   *
   * It is measured once and never revised. A published root is never compiled into again — a reused
   * root is read, not written — so the only thing that grows it afterwards is the run log, which is
   * a kilobyte against megabytes.
   */
  bytes: number
  /** Relative to the category directory, so the index survives a moved or renamed checkout. */
  runRoot: string
  usedAt: string
}

const startupPrunes = new Map<string, Promise<void>>()

/** create makes a fresh run root for one harness run, pruning stale roots once per process first. */
async function create(category: string, options: TestRunRootOptions = {}): Promise<string> {
  const generatedRoot = resolveGeneratedRoot(options)
  await pruneAtStartup(generatedRoot)
  const runRoot = FS.resolvePath(`${requireCategory(category)}/${TestRunId.create()}`, generatedRoot)
  await FS.mkdir(runRoot)
  return runRoot
}

/**
 * intern moves one compiled app out of its run root into the content-addressed store and returns
 * the stable path of its `App.tsx`. `generatedRoot` is the directory the compiler wrote, holding
 * `App.tsx` beside a `modules` tree, somewhere inside `runRoot`; afterwards it is gone and the
 * caller's compiled-app directory under the run root is removed with it.
 *
 * The module tree is stored first, then the app around a symlink to it. Both land by rename, so a
 * reader sees a whole entry or none; an entry that already exists is kept and the newly compiled
 * copy discarded, since equal hashes are equal bytes.
 */
async function intern(runRoot: string, generatedRoot: string): Promise<string> {
  const runRootPath = FS.resolvePath(runRoot)
  const categoryRoot = FS.dirname(runRootPath)
  Assert.input(
    RUN_ROOT_NAME.test(FS.basename(runRootPath)) && CATEGORY_NAME.test(FS.basename(categoryRoot)),
    `Compiled apps are interned beside a categorized run root; '${runRoot}' is not one.`,
  )
  const generatedPath = FS.resolvePath(generatedRoot)
  Assert.input(
    FS.pathIsWithin(generatedPath, runRootPath) && generatedPath !== runRootPath,
    `A compiled app is interned from inside its run root; '${generatedRoot}' is not inside '${runRoot}'.`,
  )
  const storeRoot = FS.resolvePath(COMPILED_STORE_DIRECTORY_NAME, categoryRoot)
  await FS.mkdir(storeRoot)

  // An app that reaches no module — one built of inline TSX alone, as test fixtures often are — has
  // no tree to share and is stored whole.
  const modulesPath = FS.resolvePath(MODULES_DIRECTORY_NAME, generatedPath)
  const treeHash = await FS.isDirectory(modulesPath)
    ? await FS.filesIdentity((await walkedFiles(modulesPath)).map(path => [FS.relativePath(modulesPath, path), path]))
    : undefined
  if (treeHash !== undefined) {
    await moveIntoStore(modulesPath, FS.resolvePath(treeHash, storeRoot))
  }

  const ownFiles = (await FS.listDir(generatedPath)).filter(name => name !== MODULES_DIRECTORY_NAME)
  const appHash = FS.contentIdentity([
    await FS.filesIdentity(ownFiles.map(name => [name, FS.resolvePath(name, generatedPath)])),
    `${MODULES_DIRECTORY_NAME}\n${treeHash ?? 'none'}`,
  ])
  if (treeHash !== undefined) {
    // Relative, so the store survives a moved or renamed checkout.
    await FS.symlink(`../${treeHash}`, modulesPath)
  }
  await moveIntoStore(generatedPath, FS.resolvePath(appHash, storeRoot))

  // What the compiler was given as its package root is now empty of anything but that directory.
  await removeEmptyDirectoriesUpTo(FS.dirname(generatedPath), runRootPath)
  return FS.resolvePath('App.tsx', FS.resolvePath(appHash, storeRoot))
}

/**
 * moveIntoStore renames a finished directory to its content-addressed place, or removes it when an
 * equal entry is already there. Two compiles that produced the same bytes at once therefore leave
 * exactly one entry, and the rename fails closed: a directory that cannot be moved onto an existing
 * one is the loser of that race, not a defect.
 *
 * An entry found already there is touched, because its age is what decides whether pruning may
 * take it once nothing names it: an entry every run keeps producing is one the next run wants.
 */
async function moveIntoStore(fromPath: string, storePath: string): Promise<void> {
  if (!await FS.isDirectory(storePath)) {
    try {
      await FS.move(fromPath, storePath)
      return
    } catch (error) {
      if (!await FS.isDirectory(storePath)) {
        throw error
      }
    }
  }
  await FS.remove(fromPath)
  await FS.setModifiedTimeMs(storePath, Date.now()).catch(() => undefined)
}

/** removeEmptyDirectoriesUpTo removes `path` and each empty ancestor below `stopAt`, stopping at the first that is not empty. */
async function removeEmptyDirectoriesUpTo(path: string, stopAt: string): Promise<void> {
  let current = path
  while (FS.pathIsWithin(current, stopAt) && current !== stopAt) {
    if ((await listDirectory(current)).length > 0) {
      return
    }
    await removeQuietly(current)
    current = FS.dirname(current)
  }
}

async function walkedFiles(root: string): Promise<string[]> {
  const files: string[] = []
  if (!await FS.isDirectory(root)) {
    return files
  }
  for await (const path of FS.walk(root, { includeHidden: true })) {
    files.push(path)
  }
  return files
}

/**
 * lookup returns the compiled output a passing run published under `fingerprint`, or undefined.
 *
 * Every reason to doubt the entry — an unreadable or unparsable index file, a run root that is no
 * longer one this module could have generated here, a root without its manifest — returns undefined
 * rather than failing. A miss costs a recompile; a bad hit is a false green, so this fails closed.
 *
 * A hit records the moment it happened inside the run root, which is what keeps pruning off a root
 * a live run is reading: the grace window covers roots recently *used*, not only recently created.
 */
async function lookup(
  category: string,
  fingerprint: string,
  options: TestRunRootOptions = {},
): Promise<CachedRun | undefined> {
  const generatedRoot = resolveGeneratedRoot(options)
  const categoryRoot = FS.resolvePath(requireCategory(category), generatedRoot)
  const entry = await readCacheEntry(cacheEntryPath(categoryRoot, fingerprint))
  if (entry === undefined) {
    return undefined
  }
  const runRoot = FS.resolvePath(entry.runRoot, categoryRoot)
  const manifestPath = FS.resolvePath(MANIFEST_FILE_NAME, runRoot)
  if (!isRunRoot(runRoot, generatedRoot) || !await FS.isFile(manifestPath)) {
    return undefined
  }
  // The compiled apps the manifest names live in the store beside the run root; one that is gone,
  // however it went, makes this a run that cannot be replayed rather than one that fails to load.
  for (const modulePath of await manifestModulePaths(runRoot)) {
    if (!await FS.isFile(modulePath)) {
      return undefined
    }
  }
  await markUsed(runRoot)
  await writeCacheEntry(cacheEntryPath(categoryRoot, fingerprint), { ...entry, usedAt: new Date().toISOString() })
  return { manifestPath, runRoot }
}

/**
 * publish offers one passing run's root as the compiled output for `fingerprint`, and reports
 * whether the cache now owns it. An owned root is the caller's to keep; anything else stays the
 * caller's to discard.
 *
 * An entry that already names a usable root is left alone rather than replaced. Two runs that
 * missed the same fingerprint at once therefore leave one cached root and one ordinary finished
 * root, instead of orphaning a root a third run may at that moment be running tests out of.
 */
async function publish(
  category: string,
  fingerprint: string,
  runRoot: string,
  options: TestRunRootOptions = {},
): Promise<boolean> {
  const generatedRoot = resolveGeneratedRoot(options)
  const categoryRoot = FS.resolvePath(requireCategory(category), generatedRoot)
  const path = FS.resolvePath(runRoot)
  // The index names its roots relative to the category it lives in, so a root belonging to another
  // category — or to none — has no name here and is refused rather than published unreadably.
  if (FS.dirname(path) !== categoryRoot || !isRunRoot(path, generatedRoot)) {
    return false
  }
  if (!await FS.isFile(FS.resolvePath(MANIFEST_FILE_NAME, path))) {
    return false
  }
  if (await lookup(category, fingerprint, options) !== undefined) {
    return false
  }
  const at = new Date().toISOString()
  const bytes = await contentBytes(path)
  await markUsed(path)
  return await writeCacheEntry(cacheEntryPath(categoryRoot, fingerprint), {
    at,
    bytes,
    runRoot: FS.relativePath(categoryRoot, path),
    usedAt: at,
  })
}

/**
 * contentBytes sums the bytes of everything under one run root and of every compiled app its
 * manifest names, following each app's symlink to its module tree, skipping whatever it cannot read.
 *
 * A module tree several apps share is counted once per app, and one several run roots share once
 * per run root, so the budget spends more than the disk does; it is a bound on retained output, not
 * an account of it. An undercount costs the budget nothing it cannot recover on the next prune, so a
 * file that vanishes under a concurrent cleanup is simply not counted rather than failing a publish.
 */
async function contentBytes(runRoot: string): Promise<number> {
  let total = 0
  const roots = [runRoot, ...new Set((await manifestModulePaths(runRoot)).map(path => FS.dirname(path)))]
  for (const root of roots) {
    try {
      for await (const path of FS.walk(root, { followSymlinks: true, includeHidden: true })) {
        total += await FS.byteSize(path).catch(() => 0)
      }
    } catch {
      continue
    }
  }
  return total
}

/**
 * manifestModulePaths lists the compiled `App.tsx` paths one run root's manifest names, each once.
 * A manifest that cannot be read, or is not shaped as one, names nothing.
 */
async function manifestModulePaths(runRoot: string): Promise<readonly string[]> {
  let manifest: unknown
  try {
    manifest = await FS.readJson<unknown>(FS.resolvePath(MANIFEST_FILE_NAME, runRoot))
  } catch {
    return []
  }
  const paths = new Set<string>()
  const files = Json.isRecord(manifest) && Array.isArray(manifest['files']) ? manifest['files'] : []
  for (const file of files) {
    const suites = Json.isRecord(file) && Array.isArray(file['suites']) ? file['suites'] : []
    for (const suite of suites) {
      const checks = Json.isRecord(suite) && Array.isArray(suite['checks']) ? suite['checks'] : []
      for (const check of checks) {
        const app = Json.isRecord(check) ? check['app'] : undefined
        const modulePath = Json.isRecord(app) ? app['modulePath'] : undefined
        if (typeof modulePath === 'string') {
          paths.add(modulePath)
        }
      }
    }
  }
  return [...paths]
}

/**
 * discard removes the run root a finished suite created.
 *
 * `options` must name the same runtime package root the run root was created under: a recursive
 * removal happens only for a path this module could have generated *there*, so a same-shaped
 * directory somewhere else on disk is refused rather than deleted.
 */
async function discard(runRoot: string, options: TestRunRootOptions = {}): Promise<void> {
  const generatedRoot = resolveGeneratedRoot(options)
  const path = FS.resolvePath(runRoot)
  if (!isRunRoot(path, generatedRoot)) {
    Errors.throwUnexpected(
      `Refusing to remove '${runRoot}': not a ${DIRECTORY_NAME} run root under ${FS.displayPath(generatedRoot)}.`,
    )
  }
  await removeQuietly(path)
}

/** prune removes stale run roots, keeping possibly-live ones and the newest finished root per category. */
async function prune(options: TestRunRootOptions = {}): Promise<void> {
  await pruneGeneratedRoot(resolveGeneratedRoot(options))
}

async function pruneAtStartup(generatedRoot: string): Promise<void> {
  const pending = startupPrunes.get(generatedRoot) ?? pruneGeneratedRoot(generatedRoot)
  startupPrunes.set(generatedRoot, pending)
  await pending
}

async function pruneGeneratedRoot(generatedRoot: string): Promise<void> {
  const now = Date.now()
  for (const [category, runRoots] of await findRunRootsByCategory(generatedRoot)) {
    const categoryRoot = FS.resolvePath(category, generatedRoot)
    await pruneEntrypointPlans(categoryRoot, now)
    const cached = await pruneCacheEntries(generatedRoot, category, now)
    const unreferenced = runRoots.filter(runRoot => !cached.has(runRoot.path))
    const stale = new Set(staleRunRoots(unreferenced, now).map(runRoot => runRoot.path))
    for (const path of stale) {
      await removeQuietly(path)
    }
    if (category !== '') {
      await pruneCompiledStore(
        categoryRoot,
        runRoots.filter(runRoot => !stale.has(runRoot.path)).map(runRoot => runRoot.path),
        now,
      )
    }
  }
}

/**
 * pruneCompiledStore removes the store entries no surviving run root of the category names, once
 * nothing has produced them for the grace period either. An entry a surviving manifest names is
 * kept however old it is, and so is the module tree that entry's symlink points at; a surviving run
 * root is exactly one that may still be replayed or read, so what it names must stay. An entry
 * nothing names is a passing run's output that was discarded rather than published, kept while runs
 * keep producing it so that Jest's transform cache keeps hitting it between one run and the next.
 */
async function pruneCompiledStore(
  categoryRoot: string,
  survivingRunRoots: readonly string[],
  now: number,
): Promise<void> {
  const storeRoot = FS.resolvePath(COMPILED_STORE_DIRECTORY_NAME, categoryRoot)
  const referenced = new Set<string>()
  for (const runRoot of survivingRunRoots) {
    for (const modulePath of await manifestModulePaths(runRoot)) {
      const appRoot = FS.dirname(modulePath)
      if (FS.dirname(appRoot) !== storeRoot) {
        continue
      }
      referenced.add(FS.basename(appRoot))
      const modulesPath = FS.resolvePath(MODULES_DIRECTORY_NAME, appRoot)
      const target = await FS.realPath(modulesPath).catch(() => undefined)
      if (target !== undefined && FS.dirname(target) === storeRoot) {
        referenced.add(FS.basename(target))
      }
    }
  }
  for (const name of await listDirectory(storeRoot)) {
    if (!COMPILED_ENTRY_NAME.test(name) || referenced.has(name)) {
      continue
    }
    const path = FS.resolvePath(name, storeRoot)
    const writtenMs = await FS.modifiedTimeMs(path).catch(() => now)
    if (now - writtenMs >= ACTIVE_RUN_GRACE_MS) {
      await removeQuietly(path)
    }
  }
}

/**
 * pruneCacheEntries drops index entries whose run root is gone and evicts the least recently used
 * entries beyond what the retention budget affords, then returns the run roots the surviving entries
 * still name. Those are the roots pruning must leave alone however old they are, because a later
 * identical run is meant to find them.
 */
async function pruneCacheEntries(
  generatedRoot: string,
  category: string,
  now: number,
): Promise<ReadonlySet<string>> {
  if (category === '') {
    return new Set()
  }
  const categoryRoot = FS.resolvePath(category, generatedRoot)
  const cacheRoot = FS.resolvePath(CACHE_DIRECTORY_NAME, categoryRoot)
  const live: Array<{ entry: CacheEntry; path: string; runRoot: string }> = []
  for (const name of await listDirectory(cacheRoot)) {
    const path = FS.resolvePath(name, cacheRoot)
    const entry = CACHE_ENTRY_NAME.test(name) ? await readCacheEntry(path) : undefined
    if (entry === undefined) {
      if (CACHE_ENTRY_NAME.test(name)) {
        await removeQuietly(path)
      }
      continue
    }
    const runRoot = FS.resolvePath(entry.runRoot, categoryRoot)
    if (!isRunRoot(runRoot, generatedRoot) || !await FS.isFile(FS.resolvePath(MANIFEST_FILE_NAME, runRoot))) {
      await removeQuietly(path)
      continue
    }
    live.push({ entry, path, runRoot })
  }
  // Most recently used first: eviction drops the fingerprints no run has asked for in longest,
  // which is what keeps a hot fingerprint cached however many one-off ones pass through.
  const ordered = live.toSorted((left, right) => right.entry.usedAt.localeCompare(left.entry.usedAt))
  const kept = new Set<string>()
  let keptCount = 0
  let spent = 0
  for (const candidate of ordered) {
    // An unreadable or future-dated stamp yields NaN, and every comparison against it is false, so a
    // damaged entry ages out rather than living forever on a timestamp nothing can interpret.
    const fresh = now - Date.parse(candidate.entry.usedAt) < RETAINED_CACHE_AGE_MS
    // The most recently used entry is kept whatever it costs: a corpus that on its own outgrew the
    // budget would otherwise publish an entry the very next prune evicts, and nothing would ever be
    // reused again. Past that, an entry too large for what is left is skipped rather than ending the
    // scan, so one outsized root costs itself and not every cheaper entry behind it.
    const affordable = keptCount === 0 || spent + candidate.entry.bytes <= RETAINED_CACHE_BYTES
    if (!fresh || !affordable) {
      await removeQuietly(candidate.path)
      continue
    }
    keptCount += 1
    spent += candidate.entry.bytes
    kept.add(candidate.runRoot)
  }
  return kept
}

/**
 * pruneEntrypointPlans removes the Jest entrypoint plans beside one home's run roots that no run has
 * written in a week. `test-harness-files.ts` writes them and owns why they live outside any run
 * root; a plan is a few hundred bytes and every run rewrites the one it uses, so its modification
 * time is when it was last wanted.
 */
async function pruneEntrypointPlans(home: string, now: number): Promise<void> {
  const plansRoot = FS.resolvePath(TestHarnessFiles.DIRECTORY_NAME, home)
  for (const name of await listDirectory(plansRoot)) {
    const plan = FS.resolvePath(name, plansRoot)
    const writtenMs = await FS.modifiedTimeMs(plan).catch(() => now)
    if (now - writtenMs >= RETAINED_CACHE_AGE_MS) {
      await removeQuietly(plan)
    }
  }
}

/** staleRunRoots keeps every root a concurrent run may own, then the newest finished roots. */
function staleRunRoots(runRoots: readonly FoundRunRoot[], now: number): readonly FoundRunRoot[] {
  return runRoots
    .filter(runRoot => now - runRoot.activeMs >= ACTIVE_RUN_GRACE_MS)
    .sort((left, right) => right.createdMs - left.createdMs)
    .slice(RETAINED_RUN_ROOTS)
}

/**
 * findRunRootsByCategory groups the run roots directly under the generated directory and under
 * each of its category directories. Nothing deeper, and nothing outside those two shapes, is a
 * run root, so pruning can never reach a parent directory or an unrelated path.
 */
async function findRunRootsByCategory(generatedRoot: string): Promise<Map<string, FoundRunRoot[]>> {
  const byCategory = new Map<string, FoundRunRoot[]>()
  for (const name of await listDirectory(generatedRoot)) {
    const path = FS.resolvePath(name, generatedRoot)
    if (!await FS.isDirectory(path)) {
      continue
    }
    const uncategorized = await readRunRoot(path)
    if (uncategorized !== undefined) {
      addRunRoot(byCategory, '', uncategorized)
      continue
    }
    if (!CATEGORY_NAME.test(name)) {
      continue
    }
    // Registered before its children are read: a category whose every run root is gone still owns
    // an index that has to be visited, or entries would outlive the roots they name.
    byCategory.set(name, byCategory.get(name) ?? [])
    for (const childName of await listDirectory(path)) {
      const runRoot = await readRunRoot(FS.resolvePath(childName, path))
      if (runRoot !== undefined) {
        addRunRoot(byCategory, name, runRoot)
      }
    }
  }
  return byCategory
}

function addRunRoot(byCategory: Map<string, FoundRunRoot[]>, category: string, runRoot: FoundRunRoot): void {
  const runRoots = byCategory.get(category) ?? []
  runRoots.push(runRoot)
  byCategory.set(category, runRoots)
}

async function readRunRoot(path: string): Promise<FoundRunRoot | undefined> {
  const match = RUN_ROOT_NAME.exec(FS.basename(path))
  if (match === null) {
    return undefined
  }
  const createdMs = Number(match[1])
  return { activeMs: Math.max(createdMs, await readLastUsed(path)), createdMs, path }
}

/**
 * markUsed stamps a run root with the moment it was handed to a run. A root that is compiled once
 * and reused for a week would otherwise look abandoned to pruning after its first hour.
 */
async function markUsed(runRoot: string): Promise<void> {
  try {
    await FS.writeText(FS.resolvePath(LAST_USED_FILE_NAME, runRoot), `${Date.now()}\n`)
  } catch {
    return
  }
}

/** readLastUsed treats a missing or damaged stamp as no stamp: the root's own name then decides. */
async function readLastUsed(runRoot: string): Promise<number> {
  try {
    const stamped = Number((await FS.readText(FS.resolvePath(LAST_USED_FILE_NAME, runRoot))).trim())
    return Number.isFinite(stamped) ? stamped : 0
  } catch {
    return 0
  }
}

function cacheEntryPath(categoryRoot: string, fingerprint: string): string {
  Assert.input(
    /^[0-9a-f]{16,128}$/.test(fingerprint),
    `Test run cache fingerprint '${fingerprint}' must be 16 to 128 lowercase hexadecimal digits.`,
  )
  return FS.resolvePath(`${CACHE_DIRECTORY_NAME}/${fingerprint}.json`, categoryRoot)
}

/**
 * isCacheEntry rejects anything that is not this scheme's entry, an entry a previous scheme wrote
 * included. Retention spends a recorded size, and an entry that declares none cannot be budgeted;
 * treating it as absent costs one recompile and leaves the index consistent with itself.
 */
function isCacheEntry(value: unknown): value is CacheEntry {
  return Json.isRecord(value)
    && typeof value['at'] === 'string'
    && typeof value['bytes'] === 'number'
    && Number.isFinite(value['bytes'])
    && value['bytes'] >= 0
    && typeof value['runRoot'] === 'string'
    && typeof value['usedAt'] === 'string'
}

/** readCacheEntry treats every damaged, missing, or escaping entry as the absence of one. */
async function readCacheEntry(path: string): Promise<CacheEntry | undefined> {
  try {
    const value = await FS.readJson<unknown>(path)
    // A relative path is what makes the index portable; an absolute or escaping one is not this
    // module's, and following it would aim `discard` and pruning outside the generated tree.
    return isCacheEntry(value) && !value.runRoot.startsWith('.') && !value.runRoot.startsWith('/')
      ? { at: value.at, bytes: value.bytes, runRoot: value.runRoot, usedAt: value.usedAt }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * writeCacheEntry publishes one entry by atomic rename, so a concurrent writer never collides and a
 * reader never sees a half-written file. Failing to write loses a reuse and nothing else.
 */
async function writeCacheEntry(path: string, entry: CacheEntry): Promise<boolean> {
  const temporaryPath = `${path}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporaryPath, entry)
    await FS.move(temporaryPath, path)
    return true
  } catch {
    await removeQuietly(temporaryPath)
    return false
  }
}

/**
 * isRunRoot recognizes the two places `create` writes a run root: directly under the generated
 * directory, or one category directory below it. Comparing the parent against the resolved
 * generated root — rather than matching directory names — is what keeps the check anchored to the
 * configured runtime root instead of to any directory that happens to be shaped like one.
 */
function isRunRoot(path: string, generatedRoot: string): boolean {
  if (!RUN_ROOT_NAME.test(FS.basename(path))) {
    return false
  }
  const parent = FS.dirname(path)
  return parent === generatedRoot
    || (FS.dirname(parent) === generatedRoot && CATEGORY_NAME.test(FS.basename(parent)))
}

function resolveGeneratedRoot(options: TestRunRootOptions): string {
  return FS.resolvePath(DIRECTORY_NAME, options.runtimePackageRoot ?? RuntimeToolchainPaths.packageRoot)
}

function requireCategory(category: string): string {
  Assert.input(
    CATEGORY_NAME.test(category),
    `Test run root category '${category}' must match ${CATEGORY_NAME.source}.`,
  )
  return category
}

async function listDirectory(path: string): Promise<readonly string[]> {
  return await FS.isDirectory(path) ? await FS.listDir(path) : []
}

/** Generated scratch is disposable: losing a cleanup race must never turn a passing suite red. */
async function removeQuietly(path: string): Promise<void> {
  try {
    await FS.remove(path)
  } catch {
    return
  }
}
