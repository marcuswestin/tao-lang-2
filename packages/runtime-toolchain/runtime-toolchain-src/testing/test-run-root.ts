import { Assert, Errors, FS } from '@shared'
import { RuntimeToolchainPaths } from '../runtime-toolchain-paths'
import { TestRunId } from './test-run-id'

/** DIRECTORY_NAME names the ignored runtime-toolchain directory that holds every generated run root. */
const DIRECTORY_NAME = '_gen_tao-app-test'

/**
 * RETAINED_RUN_ROOTS bounds how many finished run roots one category keeps.
 * A successful run discards its own root, so a finished root is a failed run's generated
 * code: keep the newest one to debug against and let older failures go.
 */
const RETAINED_RUN_ROOTS = 1

/**
 * ACTIVE_RUN_GRACE_MS is how long one run's root stays off-limits to every other run.
 * A run id carries the moment its owner created it, so a younger root may still belong to a
 * live concurrent suite that no other process can observe.
 */
const ACTIVE_RUN_GRACE_MS = 60 * 60 * 1000

/** RUN_ROOT_NAME matches the `TestRunId.create()` directory names this module owns. */
const RUN_ROOT_NAME = /^run-(\d+)-[0-9a-z]+$/

/** CATEGORY_NAME matches the run-root grouping directory names this module writes. */
const CATEGORY_NAME = /^[a-z][a-z0-9-]*$/

/** TestRunRootOptions locates the runtime package whose generated run roots are in play. */
type TestRunRootOptions = {
  runtimePackageRoot?: string
}

/** TestRunRoot owns the lifecycle of the directories runtime test runs compile into. */
export const TestRunRoot = {
  create,
  DIRECTORY_NAME,
  discard,
  prune,
} as const

type FoundRunRoot = {
  createdMs: number
  path: string
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
  for (const runRoots of (await findRunRootsByCategory(generatedRoot)).values()) {
    for (const runRoot of staleRunRoots(runRoots, now)) {
      await removeQuietly(runRoot.path)
    }
  }
}

/** staleRunRoots keeps every root a concurrent run may own, then the newest finished roots. */
function staleRunRoots(runRoots: readonly FoundRunRoot[], now: number): readonly FoundRunRoot[] {
  return runRoots
    .filter(runRoot => now - runRoot.createdMs >= ACTIVE_RUN_GRACE_MS)
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
    const uncategorized = readRunRoot(path)
    if (uncategorized !== undefined) {
      addRunRoot(byCategory, '', uncategorized)
      continue
    }
    if (!CATEGORY_NAME.test(name)) {
      continue
    }
    for (const childName of await listDirectory(path)) {
      const runRoot = readRunRoot(FS.resolvePath(childName, path))
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

function readRunRoot(path: string): FoundRunRoot | undefined {
  const match = RUN_ROOT_NAME.exec(FS.basename(path))
  return match === null ? undefined : { createdMs: Number(match[1]), path }
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
