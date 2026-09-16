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
 */

export type GreenTreeRecord = {
  at: string
  logRoot: string
  treeHash: string
}

export type GreenTreeStore = {
  lanes: Record<string, GreenTreeRecord>
  version: 1
}

/** GreenTreeMatch names the record that made a run unnecessary. */
export type GreenTreeMatch = GreenTreeRecord & { lane: string }

const STORE_PATH = '.artifacts/verify/green-trees.json'
const VERSION = 1

/**
 * hashTree identifies the visible working-tree content, independent of which bytes happen to be
 * committed, staged, or unstaged. Ignored trees such as `node_modules` and `_gen_*` are derived
 * from what is hashed and are deliberately left out.
 */
async function hashTree(repositoryRoot: string, run: typeof CLI.run = CLI.run): Promise<string> {
  const entries = await visibleEntries(repositoryRoot, run)
  const hash = createHash('sha256')
  for (const [path, mode] of entries) {
    const absolutePath = FS.resolvePath(path, repositoryRoot)
    if (mode === '120000') {
      const linkTarget = await symlinkTarget(absolutePath, run)
      // Git stores the link target itself as the blob and gives every symlink mode 120000. Do not
      // follow it: two links whose destinations currently contain the same bytes are still
      // different visible trees, and a dangling link remains part of the tree.
      hash.update('link\0').update(mode).update('\0').update(path).update('\0')
        .update(linkTarget ?? '<missing>').update('\0')
      continue
    }
    if (await FS.isFile(absolutePath)) {
      const content = await FS.readFile(absolutePath)
      hash.update('file\0').update(mode).update('\0').update(path).update('\0')
        .update(String(content.byteLength)).update('\0').update(content)
    }
    // A tracked path absent from the working tree is a deletion and contributes no entry.
  }
  return hash.digest('hex')
}

/** visibleEntries resolves the worktree mode Git compares, while keeping untracked files visible. */
async function visibleEntries(
  repositoryRoot: string,
  run: typeof CLI.run,
): Promise<Array<[path: string, mode: string]>> {
  const [staged, unstaged, untracked] = await Promise.all([
    git(['ls-files', '--cached', '--stage', '-z'], repositoryRoot, run),
    git(['diff-files', '--raw', '--no-renames', '-z'], repositoryRoot, run),
    git(['ls-files', '--others', '--exclude-standard', '-z'], repositoryRoot, run),
  ])
  const modes = stagedModes(staged)
  for (const [path, mode] of worktreeModes(unstaged)) {
    if (mode === '000000') {
      modes.delete(path)
    } else {
      modes.set(path, mode)
    }
  }
  for (const path of untracked.split('\0').filter(Boolean)) {
    const absolutePath = FS.resolvePath(path, repositoryRoot)
    const linkTarget = await symlinkTarget(absolutePath, run)
    modes.set(
      path,
      linkTarget === undefined
        ? (await FS.fileMode(absolutePath)) & 0o111 ? '100755' : '100644'
        : '120000',
    )
  }
  return [...modes].sort(([left], [right]) => left.localeCompare(right))
}

function stagedModes(output: string): Map<string, string> {
  const modes = new Map<string, string>()
  for (const entry of output.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t')
    const metadata = entry.slice(0, tab).split(' ')
    if (tab > 0 && metadata[2] === '0') {
      modes.set(entry.slice(tab + 1), metadata[0]!)
    }
  }
  return modes
}

function worktreeModes(output: string): Map<string, string> {
  const fields = output.split('\0').filter(Boolean)
  const modes = new Map<string, string>()
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index]!
    const path = fields[index + 1]
    const mode = header.match(/^:\d+ (\d+) [0-9a-f]+ [0-9a-f]+ [A-Z]\d*$/)?.[1]
    if (path !== undefined && mode !== undefined) {
      modes.set(path, mode)
    }
  }
  return modes
}

/** symlinkTarget reads link text without following it; readlink's one output newline is framing. */
async function symlinkTarget(
  path: string,
  run: typeof CLI.run,
): Promise<string | undefined> {
  const result = await run('readlink', { args: [path], stdio: 'pipe' })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  return result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout
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
    return { lanes: {}, version: VERSION }
  }
  const store = await FS.readJson<Partial<GreenTreeStore>>(path)
  return store.version === VERSION && typeof store.lanes === 'object' && store.lanes !== null
    ? { lanes: store.lanes, version: VERSION }
    : { lanes: {}, version: VERSION }
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

/** record stores a green run's tree under its lane, replacing the lane's previous record. */
async function record(
  repositoryRoot: string,
  lane: string,
  entry: GreenTreeRecord,
): Promise<void> {
  const store = await load(repositoryRoot)
  store.lanes[lane] = entry
  await FS.writeJson(FS.resolvePath(STORE_PATH, repositoryRoot), store)
}

/** describe is the one line a skipped lane prints in place of its run. */
function describe(lane: string, match: GreenTreeMatch): string {
  const same = match.lane === lane ? '' : ` (${match.lane}, a superset of ${lane})`
  return `${lane}: tree unchanged since the green run at ${match.at}${same}; nothing to re-verify.`
    + `\nEvidence: ${FS.displayPath(match.logRoot)}`
}

/** GreenTree owns the per-checkout record of trees each verification lane has already proved. */
export const GreenTree = { STORE_PATH, describe, find, hashTree, load, record } as const
