import { Errors, FS, Platform } from '@shared'
import type * as TestCompiler from './test-compiler/TestCompiler'

/**
 * ENTRYPOINTS_ENV names the directory of generated Jest entrypoints one run is started through.
 * `jest.tao-test.config.cjs` reads it to build both its `testMatch` and its `roots`; a run that
 * sets no value there is a bare `jest --config` run, which falls back to the entrypoint that
 * declares the whole manifest.
 *
 * Being a Jest root is why this directory must hold the entrypoints and nothing else. Jest crawls
 * every root, and the run roots beside this one are trees of compiled apps that a run reads by path
 * and must never pay to crawl — which is the whole reason the config names directories rather than
 * taking its default of the package.
 */
const ENTRYPOINTS_ENV = 'TAO_TEST_RUNTIME_ENTRYPOINTS'

/**
 * DIRECTORY_NAME names where the generated entrypoints live beside the run roots, one plan per
 * subdirectory. The leading dot keeps it from reading as a run root or a category to
 * `test-run-root.ts`, which prunes it.
 */
const DIRECTORY_NAME = '.journeys'

/** FILE_SUFFIX ends every generated entrypoint, and is what the config's `testMatch` selects on. */
const FILE_SUFFIX = '.jest.tsx'

/**
 * JOURNEYS_PER_SHARD is how much work a shard must carry before it is worth the worker it occupies.
 *
 * An entrypoint is a Jest test file, and a Jest test file stands up its own module registry: React
 * Native, the testing library, and the Tao runtime are loaded again for each one. That measured at
 * about 120ms of serial cost apiece in this checkout against about 45ms for a journey, and at rather
 * more than 120ms once several workers stand their registries up at once on a machine whose cores
 * are already spoken for.
 *
 * So a split stops paying well before it runs out of files to split: 95 journeys measured fastest
 * divided about six ways here and half again slower divided eighteen, and sixteen journeys is about
 * where one more shard stopped earning the worker it took. Holding a shard to that also leaves the
 * small runs alone, which is the shape an app's own suite has — three journeys split two ways buys a
 * second module registry and no parallelism worth having.
 */
const JOURNEYS_PER_SHARD = 16

/**
 * HARNESS_MODULE is the module specifier a generated entrypoint imports its harness by.
 * `jest.tao-test.config.cjs` maps it, because a generated file sits an unknowable number of
 * directories below the package root and must not spell its way back up.
 */
const HARNESS_MODULE = '@tao-test-harness'

/** TestHarnessFiles owns the Jest entrypoints one `tao test` run is started through. */
export const TestHarnessFiles = {
  DIRECTORY_NAME,
  ENTRYPOINTS_ENV,
  FILE_SUFFIX,
  HARNESS_MODULE,
  JOURNEYS_PER_SHARD,
  write,
} as const

/** Shard is the set of Tao test files one generated Jest entrypoint declares the journeys of. */
type Shard = {
  files: TestCompiler.File[]
  journeys: number
}

/** GeneratedEntrypoints is where one run's Jest entrypoints were written, and how many there are. */
export type GeneratedEntrypoints = {
  directory: string
  shardCount: number
}

/**
 * write generates the Jest entrypoints for one run of `manifest` under `home`, the directory that
 * holds the run roots, and returns the directory holding them together with how many there are.
 *
 * Jest distributes test *files* across its worker pool, so a run that declares its whole manifest in
 * one entrypoint leaves the pool nothing to distribute and runs every journey in one worker however
 * wide its budget is. Dividing the manifest between entrypoints is what turns that budget into
 * parallelism.
 *
 * One entrypoint *per Tao test file* is the obvious division and the wrong one, because each costs
 * its own module registry: see `JOURNEYS_PER_SHARD`. `workerBudget` is therefore a ceiling on the
 * number of shards rather than a target for it, and the work in the manifest is the other ceiling.
 *
 * An entrypoint names Tao test files and nothing a compile produced — the run finds its compiled
 * apps through the manifest its environment names — so a plan is a function of the test files and
 * the width alone, and it names its own directory after exactly that: two runs wanting one plan
 * write byte-identical files into it, and two runs wanting different plans cannot see each other's
 * at all.
 *
 * That directory must not move from run to run, which is why it is not inside the run root. Jest
 * hashes its whole configuration into the key of every transform it caches, and this directory is in
 * that configuration as a root. Inside a run root it changed with every compile, so every compile
 * re-transformed all 2,135 modules a WordFlower run loads, React Native among them, and left as many
 * dead files in Jest's cache. Beside the run roots, a run whose plan is unchanged reuses them all.
 */
async function write(
  home: string,
  manifest: TestCompiler.Manifest,
  workerBudget: number,
): Promise<GeneratedEntrypoints> {
  const shards = planShards(manifest, workerBudget)
  const directory = FS.resolvePath(`${DIRECTORY_NAME}/${planName(shards)}`, home)
  for (const [index, shard] of shards.entries()) {
    await writeAtomically(
      FS.resolvePath(entrypointName(index, shards.length), directory),
      entrypointSource(shard),
    )
  }
  return { directory, shardCount: shards.length }
}

/** planName reads as its own width, and identifies the division behind it so two plans cannot collide. */
function planName(shards: readonly Shard[]): string {
  const identity = FS.contentIdentity(
    shards.flatMap((shard, index) => shard.files.map(file => `${index} ${file.sourcePath}`)),
  )
  return `${shards.length}-${identity.slice(0, 16)}`
}

/**
 * planShards divides the manifest's Tao test files into groups of comparable size, heaviest file
 * first so that the placements with the least room left to unbalance the plan are the lightest ones.
 * The division is a function of the manifest and the width alone, so two runs of one plan agree on
 * it without having to compare notes.
 *
 * A file declaring no journey is left out. Jest fails a test file that contains no case, and such a
 * file contributed nothing to the one whole-manifest entrypoint this replaced either.
 */
function planShards(manifest: TestCompiler.Manifest, workerBudget: number): readonly Shard[] {
  const placeable = manifest.files
    .map((file, index) => ({ file, index, journeys: journeyCount(file) }))
    .filter(candidate => candidate.journeys > 0)
  if (placeable.length === 0) {
    return []
  }
  const shards: Shard[] = Array.from(
    { length: shardCount(placeable, workerBudget) },
    () => ({ files: [], journeys: 0 }),
  )
  const heaviestFirst = placeable.toSorted((left, right) => right.journeys - left.journeys || left.index - right.index)
  for (const candidate of heaviestFirst) {
    // `reduce` keeps the first of equally light shards, which is what makes one manifest always
    // produce one plan rather than one that depends on how the runtime happens to order a sort.
    const lightest = shards.reduce((found, shard) => shard.journeys < found.journeys ? shard : found)
    lightest.files.push(candidate.file)
    lightest.journeys += candidate.journeys
  }
  return shards
}

/**
 * shardCount is the narrowest of the three ceilings on a division: the workers the run was granted,
 * the files there are to divide, and the journeys there are to make the division worth its cost.
 */
function shardCount(
  placeable: readonly { journeys: number }[],
  workerBudget: number,
): number {
  const journeys = placeable.reduce((total, candidate) => total + candidate.journeys, 0)
  return Math.max(
    1,
    Math.min(
      Math.trunc(workerBudget),
      placeable.length,
      Math.floor(journeys / JOURNEYS_PER_SHARD),
    ),
  )
}

function journeyCount(file: TestCompiler.File): number {
  return file.suites.reduce((total, suite) => total + suite.checks.length, 0)
}

/** entrypointName reads as its own plan: which shard of how many this Jest file is. */
function entrypointName(index: number, shards: number): string {
  return `shard-${String(index + 1).padStart(String(shards).length, '0')}-of-${shards}${FILE_SUFFIX}`
}

function entrypointSource(shard: Shard): string {
  return [
    '// Generated by `tao test`: one Jest entrypoint per worker this run may use, so Jest has files',
    '// to distribute. The harness owns the case names that `tao test --name` matches.',
    `import { declareTaoJourneys } from '${HARNESS_MODULE}'`,
    '',
    'declareTaoJourneys([',
    ...shard.files.map(file => `  ${JSON.stringify(file.sourcePath)},`),
    '])',
    '',
  ].join('\n')
}

/**
 * writeAtomically publishes one entrypoint by rename, so a run reusing a root that another run is at
 * that moment writing the same plan into can never read a half-written file.
 */
async function writeAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
  try {
    await FS.writeText(temporaryPath, content)
    await FS.move(temporaryPath, path)
  } catch (error) {
    await FS.remove(temporaryPath).catch(() => undefined)
    Errors.throwHostEnvironment(
      `Could not write the Tao test entrypoint ${FS.displayPath(path)}: ${Errors.messageOf(error)}`,
    )
  }
}
