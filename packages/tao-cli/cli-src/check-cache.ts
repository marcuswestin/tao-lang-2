import { FS, Platform, Repo, TaoFiles, TaoStdlib } from '@shared'

/**
 * `tao check` re-reads every `.tao` file of every workspace to learn about the one that moved. The
 * canonical-source pass costs about what `tao fix` costs; the rest is `Workspace.validateFiles`,
 * which parses each entry's whole graph once per entry and dominates the run. Changing one file in
 * one app pays that for all of them.
 *
 * This module is the per-workspace answer to that, and it is the same content stamp
 * `packages/dev/dev-src/repository-tests/ParserGenerate.ts` puts in front of Langium and
 * `CompileApp.ts` puts in front of `tao compile`: hash what the work reads, remember what it
 * concluded, and skip the work while the hash still agrees. A workspace whose inputs are byte-identical
 * to the ones behind its last clean check cannot produce a different verdict, so its verdict is
 * replayed instead of recomputed.
 *
 * ## Where the stamp lives
 *
 * `tao check` is the published product CLI. A user checking their own project must not find this
 * repository's build state scattered through their tree, and a packaged CLI cannot honestly say
 * which toolchain it is in the first place. So the stamp lives in the `.artifacts` of *this CLI's own
 * Git worktree*, found from `import.meta.dir`, and only workspaces inside that worktree are ever
 * stamped. Outside a worktree — a packaged build — and for any project outside it, there is no cache
 * at all and `tao check` behaves exactly as it did before. That is `test-cache.ts`'s rule, for the
 * same reason: failing closed costs a re-check, failing open costs a green check that proves nothing.
 *
 * A linked worktree finds its own root, so parallel agents never share one stamp.
 *
 * ## What is hashed
 *
 * Getting the input set right is the whole correctness question, and the rule applied here is to hash
 * more rather than reason narrowly. Every entry is bound to:
 *
 * - the **toolchain**: every Git-visible file under `packages/`, which is the formatter, the source
 *   actions, the validator, the parser, `@ast-utils`, `@shared` and the Tao stdlib at once; the
 *   generated parser tree, which Git ignores and that traversal therefore cannot see; the root
 *   `bun.lock` and `package.json`; and the declared `TAO_STDLIB_ROOT`, which is refused outright when
 *   it names a stdlib the `packages/` hash does not cover.
 * - the **workspace tree**: every Git-visible file under the workspace root, discovered exactly the
 *   way `tao check` discovers the files it checks, so the two can never disagree about what is there.
 *   Package resolution is bounded by the project root, so this is the whole of what one workspace's
 *   parse can reach inside itself.
 * - the **ancestors that decide the root**: `Packages.containingProjectRoot` walks upward reading
 *   every `.tao` file directly in each ancestor directory, looking for a `project` declaration. A
 *   file appearing there moves the workspace root, so each of those directories' own `.tao` files are
 *   hashed too.
 * - the **entry set**: which files of the workspace this run was asked to check. A check of one
 *   subdirectory validates a different graph than a check of the whole workspace and gets its own entry.
 */

/**
 * Where the stamp is kept. `.artifacts` is the repository's ignored scratch root, so a reclaimed
 * `.artifacts` or a fresh checkout simply has no stamp and re-checks. Being ignored also keeps it out
 * of every hash above by construction: `Repo.filesUnder` lists neither ignored nor hidden paths.
 */
const STAMP_PATH = '.artifacts/tao-check-stamp.json'

/** The stamp layout and the composition above. An older or unreadable stamp is no stamp. */
const STAMP_VERSION = 2

/**
 * The opt-outs. `TAO_CHECK_NO_CACHE` is this command's own, spelled the way `TAO_TEST_NO_CACHE` is
 * spelled for `tao test`. `TAO_TEST_NO_CACHE` is honoured as well because `GateRunner` already sets
 * it on every child of a `--no-cache` lane: a lane that exists to refuse memoized verdicts must
 * refuse this one too, and reading the variable it already sets is what makes that true without the
 * gate having to know this cache exists.
 */
const NO_CACHE_ENV_KEYS: readonly string[] = ['TAO_CHECK_NO_CACHE', 'TAO_TEST_NO_CACHE']

/**
 * How many entries one stamp keeps. One per workspace per checked path; the repository's own check
 * writes nineteen. The cap bounds a file that would otherwise grow for every subdirectory anyone ever
 * checked, and the oldest entries are the ones dropped.
 */
const MAX_ENTRIES = 512

/** How an absent declared input is recorded, so that its appearance or removal changes the hash. */
const ABSENT = '<absent>'

/** Where Langium's generated parser is written; Git ignores it, so it is walked rather than listed. */
const GENERATED_PARSER_ROOT = 'packages/parser/parser-src/_gen_tao-parser'

/**
 * CheckCacheDiagnostic is one recorded warning, reduced to what survives a replay. The path is
 * relative to the workspace root and the position is stored raw, because the sentence `tao check`
 * prints is built against the current working directory and a run from elsewhere must print its own.
 * The whole span is recorded, not just where it starts, because the printed diagnostic underlines it
 * and a replay that kept only the start would underline one character where a check underlined ten.
 */
export type CheckCacheDiagnostic = {
  character?: number
  code?: string
  endCharacter?: number
  endLine?: number
  line?: number
  message: string
  nodeType?: string
  path: string
}

/** CheckCacheRecord is one workspace's clean verdict, offered for stamping. */
type CheckCacheRecord = {
  diagnostics: readonly CheckCacheDiagnostic[]
  workspaceRoot: string
}

/** CheckCacheOptions configures the stamp; `tao check` uses the defaults and tests pass a root. */
export type CheckCacheOptions = {
  /** The worktree whose `.artifacts` holds the stamp and which bounds what may be stamped. */
  repositoryRoot?: string
}

/** CheckCacheSession is one `tao check` run's view of the stamp. */
type CheckCacheSession = {
  /** commit stamps every offered workspace whose inputs are still the ones its verdict was read from. */
  commit(records: readonly CheckCacheRecord[]): Promise<void>
  /** reuse returns a workspace's recorded warnings when its inputs are unchanged, else undefined. */
  reuse(workspaceRoot: string, entryFiles: readonly string[]): Promise<readonly CheckCacheDiagnostic[] | undefined>
}

/** CheckCache owns when one `tao check` run may hand its per-workspace verdict to the next. */
export const CheckCache = {
  disabled,
  NO_CACHE_ENV_KEYS,
  open,
  toolchainIdentity,
} as const

type CheckStampEntry = {
  diagnostics: readonly CheckCacheDiagnostic[]
  inputs: string
}

type CheckStamp = {
  entries: Record<string, CheckStampEntry>
  version: number
}

type PendingWorkspace = {
  entryKey: string
  inputs: string
}

/** disabled reports whether this run was told to check everything from source. */
function disabled(): boolean {
  return NO_CACHE_ENV_KEYS.some(key => Platform.runtimeProcess.env[key] === 'true')
}

/**
 * open starts a session, or returns undefined when this run must not reuse anything: told not to,
 * running from outside a Git worktree, or parsing against a stdlib the toolchain hash cannot see.
 */
async function open(options: CheckCacheOptions = {}): Promise<CheckCacheSession | undefined> {
  if (disabled()) {
    return undefined
  }
  const repositoryRoot = options.repositoryRoot ?? Repo.tryGetRoot(import.meta.dir)
  if (repositoryRoot === undefined) {
    return undefined
  }
  const toolchain = await toolchainIdentity(repositoryRoot)
  if (toolchain === undefined) {
    return undefined
  }
  return createSession(FS.resolvePath(repositoryRoot), toolchain)
}

function createSession(repositoryRoot: string, toolchain: string): CheckCacheSession {
  const stampPath = FS.resolvePath(STAMP_PATH, repositoryRoot)
  const pending = new Map<string, PendingWorkspace>()
  return {
    async commit(records: readonly CheckCacheRecord[]): Promise<void> {
      const stampable = records.filter(record => pending.has(FS.resolvePath(record.workspaceRoot)))
      if (stampable.length === 0) {
        return
      }
      await FS.withFileMutationLock(stampPath, repositoryRoot, async () => {
        // Another `tao check` may have stamped its own workspaces while this one ran, so the entries
        // are merged into whatever is on disk now rather than written over it.
        const stamp = await readStamp(stampPath) ?? { entries: {}, version: STAMP_VERSION }
        const entries = { ...stamp.entries }
        for (const record of stampable) {
          const workspaceRoot = FS.resolvePath(record.workspaceRoot)
          const held = pending.get(workspaceRoot)!
          // The check just read these files. If any of them moved while it ran, the verdict does not
          // correspond to any single input state and must not be stamped as if it did.
          if (
            await workspaceInputIdentity(repositoryRoot, toolchain, workspaceRoot) !== held.inputs
          ) {
            continue
          }
          delete entries[held.entryKey]
          entries[held.entryKey] = { diagnostics: record.diagnostics, inputs: held.inputs }
        }
        await writeStamp(stampPath, repositoryRoot, { entries: capEntries(entries), version: STAMP_VERSION })
      })
    },

    async reuse(
      workspaceRoot: string,
      entryFiles: readonly string[],
    ): Promise<readonly CheckCacheDiagnostic[] | undefined> {
      const resolvedRoot = FS.resolvePath(workspaceRoot)
      if (!FS.pathIsWithin(resolvedRoot, repositoryRoot)) {
        return undefined
      }
      const entryKey = workspaceEntryKey(repositoryRoot, resolvedRoot, entryFiles)
      const held: PendingWorkspace = {
        entryKey,
        inputs: await workspaceInputIdentity(repositoryRoot, toolchain, resolvedRoot),
      }
      pending.set(resolvedRoot, held)
      const entry = (await readStamp(stampPath))?.entries[entryKey]
      return entry?.inputs === held.inputs ? entry.diagnostics : undefined
    },
  }
}

/**
 * workspaceEntryKey names one workspace as checked through one set of entry files. A check of a
 * subdirectory validates a different graph than a check of the whole workspace, so the two are
 * different questions and hold different entries rather than overwriting each other.
 */
function workspaceEntryKey(
  repositoryRoot: string,
  workspaceRoot: string,
  entryFiles: readonly string[],
): string {
  const entries = entryFiles.map(path => FS.relativePath(workspaceRoot, FS.resolvePath(path))).toSorted()
  return `${FS.relativePath(repositoryRoot, workspaceRoot)}\n${FS.contentIdentity(entries)}`
}

/**
 * workspaceInputIdentity is everything that decides one workspace's check verdict: the composition
 * itself, the toolchain, the whole tree the checked files sit in, and the ancestor directories whose
 * `.tao` files decide where that tree starts.
 *
 * Which files were asked about is not in here, because it is already the key this identity is stored
 * under: a stamp entry is looked up by `workspaceEntryKey` and only then compared on inputs, so a
 * check through a different set of entry files reads a different entry rather than a matching one.
 * Repeating it inside the identity read as a second, independent guard and was neither — deleting
 * the term changed no behaviour and no test.
 */
async function workspaceInputIdentity(
  repositoryRoot: string,
  toolchain: string,
  workspaceRoot: string,
): Promise<string> {
  return FS.contentIdentity([
    `version\n${String(STAMP_VERSION)}`,
    `toolchain\n${toolchain}`,
    `tree\n${await treeIdentity(workspaceRoot)}`,
    `ancestors\n${await ancestorDeclarationIdentity(repositoryRoot, workspaceRoot)}`,
  ])
}

/**
 * toolchainIdentity is everything outside a workspace that decides its verdict, or undefined when
 * the run parses against a stdlib this hash does not cover. `TAO_STDLIB_ROOT` can point the parse at
 * a payload tree outside `packages/` — the packaged Studio runner does exactly that — and stdlib
 * sources nothing hashes are sources that can change underneath a skip.
 */
async function toolchainIdentity(repositoryRoot: string): Promise<string | undefined> {
  const root = FS.resolvePath(repositoryRoot)
  const packagesRoot = FS.resolvePath('packages', root)
  // Read through the owner rather than the environment, so this scheme refuses a relative value on
  // the same terms as the one that hashes the declared tree instead of containing it.
  const declaredStdlibRoot = TaoStdlib.declaredRoot()
  if (declaredStdlibRoot !== undefined && !await stdlibIsHashed(declaredStdlibRoot, packagesRoot)) {
    return undefined
  }
  const packageFiles = await Repo.filesUnder(packagesRoot)
  return FS.contentIdentity([
    `packages\n${await FS.filesIdentity(packageFiles.map(path => [FS.relativePath(root, path), path]))}`,
    `generated-parser\n${await generatedParserIdentity(root)}`,
    await fileEntry(root, FS.resolvePath('bun.lock', root)),
    await fileEntry(root, FS.resolvePath('package.json', root)),
    `${TaoStdlib.DECLARED_ROOT_ENV}\n${declaredStdlibRoot ?? ABSENT}`,
  ])
}

/** stdlibIsHashed reports whether a declared stdlib root sits inside the tree `packages` hashes. */
async function stdlibIsHashed(declaredRoot: string, packagesRoot: string): Promise<boolean> {
  const resolved = await FS.realPath(declaredRoot).catch(() => FS.resolvePath(declaredRoot))
  return FS.pathIsWithin(resolved, packagesRoot)
}

/**
 * generatedParserIdentity hashes the generated parser tree by walking it directly. It is a `_gen_`
 * directory, so Git ignores it and the tracked traversal above does not see it at all.
 */
async function generatedParserIdentity(repositoryRoot: string): Promise<string> {
  const generatedRoot = FS.resolvePath(GENERATED_PARSER_ROOT, repositoryRoot)
  if (!await FS.isDirectory(generatedRoot)) {
    return ABSENT
  }
  const paths: string[] = []
  for await (const path of FS.walk(generatedRoot, { includeHidden: true })) {
    paths.push(path)
  }
  return await FS.filesIdentity(paths.map(path => [FS.relativePath(generatedRoot, path), path]))
}

/**
 * treeIdentity is the identity of a whole workspace. Discovery is `Repo.filesUnder` with the same
 * exclusions `tao check`'s own file discovery uses, so the set hashed and the set checked cannot
 * drift apart; no extension filter is applied, because a TypeScript sidecar beside a declaration is
 * as much an input as the declaration.
 */
async function treeIdentity(root: string): Promise<string> {
  if (!await FS.isDirectory(root)) {
    return ABSENT
  }
  const paths = await Repo.filesUnder(root, { excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames })
  return await FS.filesIdentity(paths.map(path => [FS.relativePath(root, path), path]))
}

/**
 * ancestorDeclarationIdentity hashes what decides where a workspace starts. `containingProjectRoot`
 * walks upward from a file reading every `.tao` file lying directly in each ancestor directory and
 * stops at the first that declares a project, so those files — not only `Project.tao` — are the
 * input. Directories are walked to the repository root, which is where that search stops.
 */
async function ancestorDeclarationIdentity(repositoryRoot: string, workspaceRoot: string): Promise<string> {
  const entries: (readonly [string, string])[] = []
  let directory = FS.dirname(workspaceRoot)
  while (FS.pathIsWithin(directory, repositoryRoot)) {
    for (const name of (await FS.listDir(directory).catch(() => [])).toSorted()) {
      const path = FS.resolvePath(name, directory)
      if (FS.extname(path) === '.tao' && await FS.isFile(path)) {
        entries.push([FS.relativePath(repositoryRoot, path), path])
      }
    }
    const parent = FS.dirname(directory)
    if (parent === directory) {
      break
    }
    directory = parent
  }
  return await FS.filesIdentity(entries)
}

/** fileEntry is the identity of one declared file, which may legitimately not exist. */
async function fileEntry(repositoryRoot: string, path: string): Promise<string> {
  const relative = FS.relativePath(repositoryRoot, path)
  if (!await FS.isFile(path)) {
    return `${relative}\n${ABSENT}`
  }
  return `${relative}\n${await FS.filesIdentity([[relative, path]])}`
}

/** capEntries keeps the most recently stamped entries, so one stamp file cannot grow without bound. */
function capEntries(entries: Record<string, CheckStampEntry>): Record<string, CheckStampEntry> {
  const keys = Object.keys(entries)
  if (keys.length <= MAX_ENTRIES) {
    return entries
  }
  return Object.fromEntries(keys.slice(keys.length - MAX_ENTRIES).map(key => [key, entries[key]!]))
}

/** readStamp reads the stamp, treating a missing, malformed, or older one as no stamp. */
async function readStamp(stampPath: string): Promise<CheckStamp | undefined> {
  try {
    const value = await FS.readJson<Partial<CheckStamp>>(stampPath)
    if (value?.version !== STAMP_VERSION || value.entries === null || typeof value.entries !== 'object') {
      return undefined
    }
    const entries: Record<string, CheckStampEntry> = {}
    for (const [key, entry] of Object.entries(value.entries)) {
      const parsed = parseStampEntry(entry)
      if (parsed !== undefined) {
        entries[key] = parsed
      }
    }
    return { entries, version: STAMP_VERSION }
  } catch {
    return undefined
  }
}

/** parseStampEntry accepts only a fully-formed entry; a partial one is dropped rather than trusted. */
function parseStampEntry(entry: unknown): CheckStampEntry | undefined {
  if (entry === null || typeof entry !== 'object') {
    return undefined
  }
  const candidate = entry as Partial<CheckStampEntry>
  if (typeof candidate.inputs !== 'string' || !Array.isArray(candidate.diagnostics)) {
    return undefined
  }
  const diagnostics: CheckCacheDiagnostic[] = []
  for (const value of candidate.diagnostics) {
    if (value === null || typeof value !== 'object') {
      return undefined
    }
    const diagnostic = value as Partial<CheckCacheDiagnostic>
    if (typeof diagnostic.message !== 'string' || typeof diagnostic.path !== 'string') {
      return undefined
    }
    diagnostics.push({
      ...(typeof diagnostic.character === 'number' ? { character: diagnostic.character } : {}),
      ...(typeof diagnostic.code === 'string' ? { code: diagnostic.code } : {}),
      ...(typeof diagnostic.endCharacter === 'number' ? { endCharacter: diagnostic.endCharacter } : {}),
      ...(typeof diagnostic.endLine === 'number' ? { endLine: diagnostic.endLine } : {}),
      ...(typeof diagnostic.line === 'number' ? { line: diagnostic.line } : {}),
      ...(typeof diagnostic.nodeType === 'string' ? { nodeType: diagnostic.nodeType } : {}),
      message: diagnostic.message,
      path: diagnostic.path,
    })
  }
  return { diagnostics, inputs: candidate.inputs }
}

/**
 * writeStamp publishes the stamp with a rename, so a concurrent reader never sees a half-written
 * file. It runs only under the mutation lock and only after a clean check.
 */
async function writeStamp(stampPath: string, repositoryRoot: string, stamp: CheckStamp): Promise<void> {
  const temporaryPath = `${stampPath}.${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporaryPath, stamp)
    await FS.moveFileWithinBoundary(temporaryPath, stampPath, repositoryRoot)
  } finally {
    if (await FS.isFile(temporaryPath)) {
      await FS.removeFileWithinBoundary(temporaryPath, repositoryRoot)
    }
  }
}
