import { CLI, Errors, FS } from '@shared'
import { createHash } from 'node:crypto'

/**
 * A verification lane proves a tree, not a moment. When the tree is byte-identical to one a lane
 * already proved green, running the lane again can only reproduce that verdict, so the lane says
 * so and stops. This is what lets an agent run `verify` freely after a documentation edit, a
 * re-read, or a no-op without spending a machine on it.
 *
 * The record is per checkout, under `.artifacts/verify`, and keyed by lane. A lane accepts its own
 * record and the records of lanes whose gate membership is a superset of its own: a green
 * `full-verify` at this tree is also a green `verify`. It never accepts a subset, and `--fresh`
 * ignores every record.
 *
 * The same run also records each gate it proved, under its own name. A lane that no whole-lane
 * record covers still skips the gates another lane already proved at this exact tree, which is what
 * keeps `full-verify` from running the package gates a `verify --complete` has just run over the
 * same bytes. Gates that rewrite the tree or a generated directory are deliberately never recorded:
 * their output is derived state the tree hash does not describe, so proving them again is the only
 * way to know it is present.
 */

export type GreenTreeRecord = {
  at: string
  logRoot: string
  treeHash: string
}

export type GreenTreeStore = {
  /** Per-gate records, keyed by gate name; a lane reads them when no whole-lane record matches. */
  gates: Record<string, GreenTreeRecord>
  lanes: Record<string, GreenTreeRecord>
  version: 1
}

/** GreenTreeMatch names the record that made a run unnecessary. */
export type GreenTreeMatch = GreenTreeRecord & { lane: string }

const STORE_PATH = '.artifacts/verify/green-trees.json'
const VERSION = 1

/**
 * hashTree identifies the working tree: the committed tree, every staged and unstaged change to
 * it, and the content of every untracked, unignored file. Ignored trees such as `node_modules`
 * and `_gen_*` are derived from what is hashed and are deliberately left out.
 */
async function hashTree(repositoryRoot: string, run: typeof CLI.run = CLI.run): Promise<string> {
  const [headTree, diff, untracked] = await Promise.all([
    git(['rev-parse', 'HEAD^{tree}'], repositoryRoot, run),
    git(['diff', 'HEAD', '--no-ext-diff', '--no-color', '--binary'], repositoryRoot, run),
    git(['ls-files', '--others', '--exclude-standard', '-z'], repositoryRoot, run),
  ])
  const untrackedPaths = untracked.split('\0').filter(Boolean).sort()
  const untrackedHashes = untrackedPaths.length === 0
    ? ''
    : await git(['hash-object', '--stdin-paths'], repositoryRoot, run, `${untrackedPaths.join('\n')}\n`)
  return createHash('sha256')
    .update(headTree.trim())
    .update('\0')
    .update(diff)
    .update('\0')
    .update(untrackedPaths.join('\n'))
    .update('\0')
    .update(untrackedHashes)
    .digest('hex')
}

async function git(args: readonly string[], cwd: string, run: typeof CLI.run, stdin?: string): Promise<string> {
  const result = await run('git', { args, cwd, stdin, stdio: 'pipe' })
  if (result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
  return result.stdout
}

async function load(repositoryRoot: string): Promise<GreenTreeStore> {
  const path = FS.resolvePath(STORE_PATH, repositoryRoot)
  if (!await FS.isFile(path)) {
    return { gates: {}, lanes: {}, version: VERSION }
  }
  const store = await FS.readJson<Partial<GreenTreeStore>>(path)
  return store.version === VERSION && typeof store.lanes === 'object' && store.lanes !== null
    // A store written before gates were recorded is read as a store with no gate records.
    ? {
      gates: typeof store.gates === 'object' && store.gates !== null ? store.gates : {},
      lanes: store.lanes,
      version: VERSION,
    }
    : { gates: {}, lanes: {}, version: VERSION }
}

/** find returns the first accepted lane whose recorded green tree is this tree. */
async function find(
  repositoryRoot: string,
  treeHash: string,
  acceptedLanes: readonly string[],
): Promise<GreenTreeMatch | undefined> {
  const store = await load(repositoryRoot)
  for (const lane of acceptedLanes) {
    const record = store.lanes[lane]
    if (record !== undefined && record.treeHash === treeHash) {
      return { ...record, lane }
    }
  }
  return undefined
}

/** findGates returns the gates among `gates` this exact tree has already proved. */
async function findGates(
  repositoryRoot: string,
  treeHash: string,
  gates: readonly string[],
): Promise<Map<string, GreenTreeRecord>> {
  const store = await load(repositoryRoot)
  const proved = new Map<string, GreenTreeRecord>()
  for (const gate of gates) {
    const record = store.gates[gate]
    if (record !== undefined && record.treeHash === treeHash) {
      proved.set(gate, record)
    }
  }
  return proved
}

/**
 * record stores a green run's tree under its lane, and under each gate the run proved, replacing
 * the previous record of each. One write, because the store is one file.
 */
async function record(
  repositoryRoot: string,
  lane: string,
  entry: GreenTreeRecord,
  gates: readonly string[] = [],
): Promise<void> {
  const store = await load(repositoryRoot)
  store.lanes[lane] = entry
  for (const gate of gates) {
    store.gates[gate] = entry
  }
  await FS.writeJson(FS.resolvePath(STORE_PATH, repositoryRoot), store)
}

/** describe is the one line a skipped lane prints in place of its run. */
function describe(lane: string, match: GreenTreeMatch): string {
  const same = match.lane === lane ? '' : ` (${match.lane}, a superset of ${lane})`
  return `${lane}: tree unchanged since the green run at ${match.at}${same}; nothing to re-verify.`
    + `\nEvidence: ${FS.displayPath(match.logRoot)}`
}

/** describeGate is the one line a gate skipped on an earlier proof prints in place of its run. */
function describeGate(record: GreenTreeRecord): string {
  return `proved green at this tree by the run at ${record.at}; evidence: ${FS.displayPath(record.logRoot)}`
}

/** GreenTree owns the per-checkout record of trees each verification lane has already proved. */
export const GreenTree = { STORE_PATH, describe, describeGate, find, findGates, hashTree, load, record } as const
