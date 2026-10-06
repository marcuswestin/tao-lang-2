import { CLI, FS } from '@shared'
import { createHash } from 'node:crypto'

/**
 * The editor build's input identity, and the record that lets a later build prove its published
 * outputs still match it. The build reads far more than its own sources: the parser, validator,
 * formatter, and runtime it bundles, the standard library, native bindings, and installed
 * packages. All of them are tracked under `packages/` or decided by `bun.lock` and `devenv.lock`,
 * and every generated tree among them derives from those, so their content is the identity. That
 * is broader than the build strictly reads, and the cost of broad is only a rebuild.
 *
 * The record lives inside the published output root, so it travels with the outputs: a tree
 * restored from a CI cache brings its own record, and a skipped build trusts it only after hashing
 * every output it lists. A missing, foreign, or edited tree therefore always rebuilds.
 */

const RECORD_VERSION = 1
export const BUILD_RECORD_NAME = '.build-identity.json'
const IDENTITY_PATHS = ['packages', 'bun.lock', 'devenv.lock']

export type BuildOptionsIdentity = {
  minify: boolean
  releaseVersion: string
  phase: string | number
}

export type BuildRecord = {
  version: number
  inputs: string
  /** Output files relative to the package root, with their content hashes. */
  outputs: Record<string, string>
  /** The TextMate grammar the parser generator writes, before the build merges its overlay in. */
  baseGrammar: string
}

export type BuildFreshness =
  | { status: 'fresh' }
  /** Every output matches except the grammar, which the parser generator rewrote unmerged. */
  | { status: 'grammar-unmerged' }
  | { status: 'stale'; reason: string }

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function hashFile(path: string): Promise<string> {
  return sha256(await Bun.file(path).bytes())
}

/** buildInputIdentity hashes every tracked or unignored file the build may read, plus its options. */
export async function buildInputIdentity(repositoryRoot: string, options: BuildOptionsIdentity): Promise<string> {
  const listed = await CLI.mustRun('git', {
    args: ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...IDENTITY_PATHS],
    cwd: repositoryRoot,
  })
  const paths = [...new Set(listed.stdout.split('\0').filter(path => path !== ''))].sort()
  const hash = createHash('sha256')
  hash.update(JSON.stringify({ version: RECORD_VERSION, options }))
  for (const path of paths) {
    const absolute = FS.resolvePath(path, repositoryRoot)
    // A file deleted from the worktree but still in the index hashes as absent.
    const content = await FS.exists(absolute) ? await hashFile(absolute) : 'absent'
    hash.update(`${path}\0${content}\0`)
  }
  return hash.digest('hex')
}

/** hashOutputs hashes every file under the given roots, keyed relative to `baseRoot`. */
export async function hashOutputs(baseRoot: string, roots: readonly string[]): Promise<Record<string, string>> {
  const outputs: Record<string, string> = {}
  for (const root of roots) {
    const absoluteRoot = FS.resolvePath(root, baseRoot)
    if (!await FS.exists(absoluteRoot)) {
      continue
    }
    for await (const entry of new Bun.Glob('**/*').scan({ cwd: absoluteRoot, dot: true, onlyFiles: true })) {
      const file = FS.resolvePath(entry, absoluteRoot)
      const relative = FS.relativePath(baseRoot, file)
      if (FS.basename(relative) === BUILD_RECORD_NAME) {
        continue
      }
      outputs[relative] = await hashFile(file)
    }
  }
  return Object.fromEntries(Object.entries(outputs).sort(([left], [right]) => left.localeCompare(right)))
}

export function makeBuildRecord(
  inputs: string,
  outputs: Record<string, string>,
  baseGrammar: string,
): BuildRecord {
  return { version: RECORD_VERSION, inputs, outputs, baseGrammar }
}

async function readBuildRecord(path: string): Promise<BuildRecord | undefined> {
  try {
    const record = await FS.readJson<Partial<BuildRecord>>(path)
    if (
      record.version !== RECORD_VERSION || typeof record.inputs !== 'string'
      || typeof record.baseGrammar !== 'string' || typeof record.outputs !== 'object' || record.outputs === null
    ) {
      return undefined
    }
    return record as BuildRecord
  } catch {
    return undefined
  }
}

/**
 * checkBuildFreshness compares the published outputs with their record. The grammar is the one
 * output another step writes: the parser generator publishes it unmerged on every run without its
 * own stamp, as on a fresh CI checkout. When it alone differs and matches the recorded unmerged
 * grammar, only the merge needs repeating.
 */
export async function checkBuildFreshness(input: {
  packageRoot: string
  recordPath: string
  outputRoots: readonly string[]
  grammarPath: string
  inputs: string
}): Promise<BuildFreshness> {
  const record = await readBuildRecord(input.recordPath)
  if (record === undefined) {
    return { status: 'stale', reason: 'no build record' }
  }
  if (record.inputs !== input.inputs) {
    return { status: 'stale', reason: 'inputs changed' }
  }
  const actual = await hashOutputs(input.packageRoot, input.outputRoots)
  const grammarKey = FS.relativePath(input.packageRoot, input.grammarPath)
  let grammarUnmerged = false
  for (const key of new Set([...Object.keys(record.outputs), ...Object.keys(actual)])) {
    if (record.outputs[key] === actual[key]) {
      continue
    }
    if (key === grammarKey && actual[key] === record.baseGrammar) {
      grammarUnmerged = true
      continue
    }
    return { status: 'stale', reason: `output ${key} differs` }
  }
  return grammarUnmerged ? { status: 'grammar-unmerged' } : { status: 'fresh' }
}
