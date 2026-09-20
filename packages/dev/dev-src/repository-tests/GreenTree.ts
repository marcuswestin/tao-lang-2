import { Assert, CLI, Errors, FS, Json } from '@shared'
import { createHash, randomUUID } from 'node:crypto'
import {
  GeneratedEvidence,
  type GeneratedEvidence as GeneratedEvidenceRecord,
  type GeneratedEvidenceCapture,
  type GeneratedOutput,
} from './GeneratedEvidence'

/**
 * A verification lane proves a tree, not a moment. When the tree is byte-identical to one a lane
 * already proved green, and the tools that read it are the same ones, running the lane again can
 * only reproduce that verdict, so the lane says so and stops. This is what lets an agent run
 * `verify` freely after a documentation edit, a re-read, or a no-op without spending a machine on
 * it.
 *
 * A record is keyed by the whole visible tree of one checkout, never by a test file, a package, or
 * any declared visible-tree input set. Whole-lane records that cover generator nodes additionally
 * carry versioned hashes of the ignored outputs and their inputs. That coarseness is the design: it
 * makes it impossible to reuse a verdict after state the run depended on changed. There is no
 * time-to-live, because time is not what makes a verdict stale.
 *
 * The key has a second component, because a tree hash does not describe the tools that read it: the
 * resolved `.devenv/profile` symlink target, which pins bun, node, just, and dprint at once.
 * `bun.lock` is tracked and therefore already inside the tree hash. The toolchain is a readable
 * field of its own rather than a hash folded into the tree hash, so a reader diagnosing a surprise
 * re-run can see which component changed. A record written before the field existed never matches.
 *
 * The records are per checkout, under `.artifacts/verify/green`, one small file each: several agents
 * run lanes in one checkout at the same time, and one file per record with an atomic rename means
 * concurrent writers never collide. Every read is best effort — an unreadable, truncated, or
 * unparsable record file loses its own skip and nothing else, and never fails a lane.
 *
 * A lane accepts its own record and the records of lanes whose gate membership is a superset of its
 * own: a green `verify-full` at this tree is also a green `verify`. It never accepts a subset, and
 * `--no-cache` ignores every record.
 *
 * The same run also records each gate it proved, under its own name. A lane that no whole-lane
 * record covers still skips the gates another lane already proved at this exact tree, which is what
 * keeps `verify-full` from running the package gates a `verify --complete` has just run over the
 * same bytes. Two kinds of gate are never recorded, and this module does not decide which gates
 * those are — the caller declares them, because the gate table owns that fact:
 *
 * - A gate that rewrites the visible tree is not described by its starting key. A gate that fills
 *   an ignored generated directory is not recorded per-gate either; a whole lane may represent it
 *   only with explicit generated evidence whose current inputs and outputs still match.
 * - A gate whose verdict depends on the host — Chrome, Electrobun, the iOS simulator, the macOS
 *   window server — is not described by any tree hash at all. Recording one is the only way this
 *   design can produce a false green, so `record` refuses a gate the caller listed in
 *   `neverRecord` rather than writing it.
 *
 * `findGates` likewise matches only among the names it is handed, and takes an `excluded` set of
 * gates to treat as never matching. That is the seam for evidence the tree cannot carry either: a
 * gate covering a test whose outcome has flipped without its file changing must run rather than
 * skip. Computing that set belongs to the caller; this module knows nothing about tests.
 */

export type GreenTreeRecord = {
  at: string
  /** Ignored generated inputs and outputs, present only on whole-lane records that require them. */
  generated?: GeneratedEvidenceRecord
  logRoot: string
  /** Resolved `.devenv/profile` symlink target; a toolchain change invalidates every record. */
  toolchain: string
  treeHash: string
}

/** GreenTreeKey is the whole identity a record is keyed by: this tree, read by these tools. */
export type GreenTreeKey = Pick<GreenTreeRecord, 'toolchain' | 'treeHash'>

/** TreeFingerprint is a tree hash plus the per-path content hashes it was computed from. */
export type TreeFingerprint = {
  hash: string
  /** Repository-relative path to a hash of that path's visible content (or its symlink text). */
  paths: ReadonlyMap<string, string>
}

export type GreenTreeStore = {
  /** Per-gate records, keyed by gate name; a lane reads them when no whole-lane record matches. */
  gates: Record<string, GreenTreeRecord>
  lanes: Record<string, GreenTreeRecord>
}

/** GreenTreeMatch names the record that made a run unnecessary. */
export type GreenTreeMatch = GreenTreeRecord & { lane: string }

/** GreenTreeGates separates the gates a tree has proved from the ones the caller refused to reuse. */
export type GreenTreeGates = {
  /** Gates whose record matched this key and which `excluded` nonetheless sent back to the machine. */
  excluded: readonly string[]
  proved: Map<string, GreenTreeRecord>
}

export type FindGatesOptions = {
  /** Gate names to treat as never matching, however green their record is. */
  excluded?: ReadonlySet<string>
}

export type RecordOptions = {
  /** Ignored-state evidence attached to the whole-lane record, never to its per-gate records. */
  laneGenerated?: GeneratedEvidenceRecord
  /** Gate names it is a defect to record; `record` fails rather than writing one. */
  neverRecord?: ReadonlySet<string>
}

export type FindOptions = {
  /** Test seam; production reads the generator-owned inputs and outputs through GeneratedEvidence. */
  captureGenerated?: GeneratedEvidenceCapture
  /** Ignored outputs a matching whole-lane record must describe exactly. */
  generatedOutputs?: readonly GeneratedOutput[]
}

export type KeyOptions = {
  /** Replaces `hashTree`, for a caller that has already hashed the tree or injects its own. */
  hashTree?: (repositoryRoot: string) => Promise<string>
}

/** RecordKind keeps a lane record and a gate record of the same name in separate files. */
type RecordKind = 'gate' | 'lane'

/** StoredRecord is the on-disk envelope; it repeats its own identity so a file can be verified. */
type StoredRecord = GreenTreeRecord & { kind: RecordKind; name: string }

const STORE_DIR = '.artifacts/verify/green'
/** The single-file store this directory replaced. It is deleted on write and never read. */
const LEGACY_STORE_PATH = '.artifacts/verify/green-trees.json'
const TOOLCHAIN_LINK = '.devenv/profile'
/** The toolchain of a checkout with no pinned profile: a distinct value that never matches one. */
const NO_TOOLCHAIN = '<none>'

/**
 * hashTree identifies the visible working-tree content, independent of which bytes happen to be
 * committed, staged, or unstaged. Ignored trees such as `node_modules` and `_gen_*` are derived
 * from what is hashed and are deliberately left out. It is the hash half of `fingerprint`, so the
 * two can never disagree about what the tree is.
 */
async function hashTree(repositoryRoot: string, run: typeof CLI.run = CLI.run): Promise<string> {
  return (await fingerprint(repositoryRoot, run)).hash
}

/**
 * fingerprint hashes the visible tree and keeps the per-path hashes it was computed from, so two
 * runs of one lane can say which paths moved under them rather than only that something did. One
 * traversal, one entry framing: the tree hash is a hash over the per-path hashes in path order.
 */
async function fingerprint(repositoryRoot: string, run: typeof CLI.run = CLI.run): Promise<TreeFingerprint> {
  const entries = await visibleEntries(repositoryRoot, run)
  const paths = new Map<string, string>()
  for (const [path, mode] of entries) {
    const entryHash = await hashEntry(FS.resolvePath(path, repositoryRoot), mode, run)
    // A tracked path absent from the working tree is a deletion and contributes no entry.
    if (entryHash !== undefined) {
      paths.set(path, entryHash)
    }
  }
  const hash = createHash('sha256')
  for (const [path, entryHash] of paths) {
    hash.update(path).update('\0').update(entryHash).update('\0')
  }
  return { hash: hash.digest('hex'), paths }
}

/** hashEntry is the identity of one visible path: its mode and its content, or its link text. */
async function hashEntry(
  absolutePath: string,
  mode: string,
  run: typeof CLI.run,
): Promise<string | undefined> {
  const hash = createHash('sha256')
  if (mode === '120000') {
    const linkTarget = await symlinkTarget(absolutePath, run)
    // Git stores the link target itself as the blob and gives every symlink mode 120000. Do not
    // follow it: two links whose destinations currently contain the same bytes are still
    // different visible trees, and a dangling link remains part of the tree.
    hash.update('link\0').update(mode).update('\0').update(linkTarget ?? '<missing>').update('\0')
    return hash.digest('hex')
  }
  if (!await FS.isFile(absolutePath)) {
    return undefined
  }
  const content = await FS.readFile(absolutePath)
  hash.update('file\0').update(mode).update('\0').update(String(content.byteLength)).update('\0').update(content)
  return hash.digest('hex')
}

/**
 * changedPaths names every path two fingerprints disagree about — rewritten, added, or removed —
 * sorted. It is what a run prints when the tree moved under it while it was proving that tree.
 */
function changedPaths(before: TreeFingerprint, after: TreeFingerprint): readonly string[] {
  const changed = new Set<string>()
  for (const [path, entryHash] of before.paths) {
    if (after.paths.get(path) !== entryHash) {
      changed.add(path)
    }
  }
  for (const [path, entryHash] of after.paths) {
    if (before.paths.get(path) !== entryHash) {
      changed.add(path)
    }
  }
  return [...changed].sort((left, right) => left.localeCompare(right))
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

/**
 * toolchain reads the `.devenv/profile` link text without following it, exactly as `hashTree` reads
 * a symlink: the link target is the identity of the pinned profile, and its contents are derived
 * from it. A checkout with no pinned profile, or a profile whose link cannot be read, resolves to
 * `NO_TOOLCHAIN` rather than failing — such a checkout must still be able to run a lane; it simply
 * never earns a record that a profiled checkout would match.
 */
async function toolchain(repositoryRoot: string, run: typeof CLI.run = CLI.run): Promise<string> {
  const target = await symlinkTarget(FS.resolvePath(TOOLCHAIN_LINK, repositoryRoot), run)
  return target === undefined || target === '' ? NO_TOOLCHAIN : target
}

/** key is both components of a record's identity, hashed and read in one pass. */
async function key(repositoryRoot: string, options: KeyOptions = {}): Promise<GreenTreeKey> {
  const [treeHash, resolvedToolchain] = await Promise.all([
    (options.hashTree ?? hashTree)(repositoryRoot),
    toolchain(repositoryRoot),
  ])
  return { toolchain: resolvedToolchain, treeHash }
}

function storeDir(repositoryRoot: string): string {
  return FS.resolvePath(STORE_DIR, repositoryRoot)
}

/**
 * fileName keeps the directory readable by a human while staying a legal filename. Sanitizing is
 * lossy, so the record repeats its own kind and name and a read rejects a file that does not match
 * what it was asked for; two names that sanitize alike therefore lose a skip rather than trade
 * verdicts.
 */
function fileName(kind: RecordKind, name: string): string {
  return `${kind}-${name.replace(/[^\w.-]/g, '_')}.json`
}

function recordPath(repositoryRoot: string, kind: RecordKind, name: string): string {
  return FS.resolvePath(fileName(kind, name), storeDir(repositoryRoot))
}

function plainRecord(stored: StoredRecord): GreenTreeRecord {
  return {
    at: stored.at,
    ...(stored.generated === undefined ? {} : { generated: stored.generated }),
    logRoot: stored.logRoot,
    toolchain: stored.toolchain,
    treeHash: stored.treeHash,
  }
}

function isStoredRecord(value: unknown): value is StoredRecord {
  return Json.isRecord(value)
    && (value['kind'] === 'gate' || value['kind'] === 'lane')
    && typeof value['name'] === 'string'
    && typeof value['at'] === 'string'
    && typeof value['logRoot'] === 'string'
    && (value['generated'] === undefined || GeneratedEvidence.is(value['generated']))
    // A record written before the toolchain field existed fails here, and so never matches.
    && typeof value['toolchain'] === 'string'
    && typeof value['treeHash'] === 'string'
}

/** readRecord treats every damaged, missing, or mislabelled file as the absence of a record. */
async function readRecord(
  repositoryRoot: string,
  kind: RecordKind,
  name: string,
): Promise<GreenTreeRecord | undefined> {
  try {
    const value = await FS.readJson<unknown>(recordPath(repositoryRoot, kind, name))
    return isStoredRecord(value) && value.kind === kind && value.name === name ? plainRecord(value) : undefined
  } catch {
    return undefined
  }
}

/**
 * writeRecord publishes one record by atomic rename, so a concurrent writer of another record never
 * collides and a reader never sees a half-written file. A uniquely named temporary file in the same
 * directory keeps the rename within one filesystem.
 */
async function writeRecord(
  repositoryRoot: string,
  kind: RecordKind,
  name: string,
  entry: GreenTreeRecord,
): Promise<void> {
  const path = recordPath(repositoryRoot, kind, name)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const stored: StoredRecord = {
    at: entry.at,
    ...(entry.generated === undefined ? {} : { generated: entry.generated }),
    kind,
    logRoot: entry.logRoot,
    name,
    toolchain: entry.toolchain,
    treeHash: entry.treeHash,
  }
  await FS.writeJson(temporaryPath, stored)
  try {
    await FS.move(temporaryPath, path)
  } catch (error) {
    await FS.remove(temporaryPath).catch(() => {})
    throw error
  }
}

function matches(candidate: GreenTreeRecord, wanted: GreenTreeKey): boolean {
  return candidate.treeHash === wanted.treeHash && candidate.toolchain === wanted.toolchain
}

/** load reads every readable record in the directory, for a test or a diagnostic report. */
async function load(repositoryRoot: string): Promise<GreenTreeStore> {
  const store: GreenTreeStore = { gates: {}, lanes: {} }
  let names: readonly string[]
  try {
    names = await FS.listDir(storeDir(repositoryRoot))
  } catch {
    return store
  }
  for (const name of names.filter(candidate => candidate.endsWith('.json'))) {
    let value: unknown
    try {
      value = await FS.readJson<unknown>(FS.resolvePath(name, storeDir(repositoryRoot)))
    } catch {
      continue
    }
    if (isStoredRecord(value) && fileName(value.kind, value.name) === name) {
      store[value.kind === 'gate' ? 'gates' : 'lanes'][value.name] = plainRecord(value)
    }
  }
  return store
}

/** find returns the first accepted lane whose record is this tree, read by this toolchain. */
async function find(
  repositoryRoot: string,
  wanted: GreenTreeKey,
  acceptedLanes: readonly string[],
  options: FindOptions = {},
): Promise<GreenTreeMatch | undefined> {
  const generatedOutputs = options.generatedOutputs ?? []
  const currentGenerated = generatedOutputs.length === 0
    ? undefined
    : await (options.captureGenerated ?? GeneratedEvidence.capture)(repositoryRoot, generatedOutputs)
  if (generatedOutputs.length > 0 && currentGenerated === undefined) {
    return undefined
  }
  for (const lane of acceptedLanes) {
    const found = await readRecord(repositoryRoot, 'lane', lane)
    if (
      found !== undefined
      && matches(found, wanted)
      && GeneratedEvidence.covers(found.generated, generatedOutputs)
      && GeneratedEvidence.equals(found.generated, currentGenerated)
    ) {
      return { ...found, lane }
    }
  }
  return undefined
}

/**
 * findGates returns the gates among `gates` this exact tree and toolchain have already proved. It
 * considers no other gate: the caller hands it the recordable ones, and `excluded` names those
 * whose record must not be reused however green it is.
 */
async function findGates(
  repositoryRoot: string,
  wanted: GreenTreeKey,
  gates: readonly string[],
  options: FindGatesOptions = {},
): Promise<GreenTreeGates> {
  const found = await Promise.all(
    gates.map(async gate => [gate, await readRecord(repositoryRoot, 'gate', gate)] as const),
  )
  const excluded: string[] = []
  const proved = new Map<string, GreenTreeRecord>()
  for (const [gate, candidate] of found) {
    if (candidate === undefined || !matches(candidate, wanted)) {
      continue
    }
    if (options.excluded?.has(gate) === true) {
      excluded.push(gate)
    } else {
      proved.set(gate, candidate)
    }
  }
  return { excluded, proved }
}

/**
 * record stores a green run's tree under its lane, and under each gate the run proved, replacing
 * the previous record of each. It records exactly the gate names it is handed and infers none: a
 * name in `neverRecord` is a caller defect, not something to silently drop, because a recorded
 * host-dependent gate is the one way this design can produce a false green.
 */
async function record(
  repositoryRoot: string,
  /**
   * The lane to record, or `undefined` to record only the gates. A caller whose lane membership the
   * key does not fully describe — one holding a host-dependent gate — records its gates and not
   * itself, because a whole-lane record would assert something about the host that no tree says.
   */
  lane: string | undefined,
  entry: GreenTreeRecord,
  gates: readonly string[] = [],
  options: RecordOptions = {},
): Promise<void> {
  const refused = gates.filter(gate => options.neverRecord?.has(gate) === true)
  Assert(
    refused.length === 0,
    'every recorded gate to be one this tree fully describes; a host-dependent gate is never recorded',
    { lane, refused },
  )
  // The single-file store this directory replaced is removed rather than migrated: its records
  // predate the toolchain field, so none of them could ever match.
  await FS.remove(FS.resolvePath(LEGACY_STORE_PATH, repositoryRoot)).catch(() => {})
  await Promise.all([
    ...(lane === undefined
      ? []
      : [writeRecord(repositoryRoot, 'lane', lane, {
        ...entry,
        ...(options.laneGenerated === undefined ? {} : { generated: options.laneGenerated }),
      })]),
    ...gates.map(async gate => writeRecord(repositoryRoot, 'gate', gate, entry)),
  ])
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

/** describeExclusion is the one line a gate prints when a green record for it was refused. */
function describeExclusion(gate: string): string {
  return `${gate}: proved green at this tree by an earlier run, but that record was excluded; running it again.`
}

/** GreenTree owns the per-checkout record of trees each verification lane has already proved. */
export const GreenTree = {
  NO_TOOLCHAIN,
  STORE_DIR,
  changedPaths,
  describe,
  describeExclusion,
  describeGate,
  find,
  findGates,
  fingerprint,
  hashTree,
  key,
  load,
  record,
  toolchain,
} as const
