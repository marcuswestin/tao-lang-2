import { throwUserInput } from './core/Errors'
import * as FS from './FS'
import * as Platform from './Platform'
import { TaoResources } from './TaoResources'

/**
 * TaoStdlib owns the declared Tao stdlib root: the one input to a Tao compile that is not a path
 * anybody hashing this repository can see. `TAO_STDLIB_ROOT` points the compiler at a stdlib payload
 * tree, and the packaged Studio runner ships that tree outside `packages/`, so a scheme that hashes
 * the repository alone covers none of it — and a stdlib nothing hashes is a stdlib that can change
 * under a reused compile.
 *
 * Two memoizing schemes have to answer for that and cannot reach each other: `tao test`'s
 * compiled-output fingerprint in `tao-cli`, and the repository build's compile-app stamp in `dev`.
 * Neither package depends on the other, and neither depends on `tao-stdlib`, which is why the one
 * honest answer lives here rather than in the module that reads the variable for its own root.
 *
 * The answer is to hash the declared tree. The alternative — refusing to memoize at all whenever the
 * variable is set — is equally honest and strictly worse: it is correct by switching the cache off
 * for the one configuration that ships. Hashing costs one directory walk and keeps that
 * configuration caching. It is also the stronger key of the two, because the declared value itself
 * becomes part of the identity: pointing the variable at a different tree that a repository-wide
 * hash happens to cover already is a different stdlib, and a refusal keyed on containment alone
 * cannot tell those two runs apart.
 */

/** DECLARED_ROOT_ENV is the one spelling of the variable that redirects the Tao stdlib. */
const DECLARED_ROOT_ENV = 'TAO_STDLIB_ROOT'

/** ABSENT is how an unset variable and a tree that is not there are recorded, so both still differ. */
const ABSENT = '<absent>'

/** Directories no stdlib walk descends: installed dependencies and Git's own store. */
const EXCLUDED_DIRECTORY_NAMES = new Set(['node_modules', '.git', '.tao', '.tao-ts'])

/**
 * TypeScript's incremental build state is rewritten by every typecheck without any source changing,
 * and it sits inside the repository's own stdlib package. Hashing it would make a variable pointed
 * at that package invalidate every memo after each typecheck — a stale input in the other direction.
 */
const EXCLUDED_SUFFIX = '.tsbuildinfo'

/** TaoStdlib owns the declared Tao stdlib root and the identity of the tree it names. */
export const TaoStdlib = {
  ABSENT,
  DECLARED_ROOT_ENV,
  declaredRoot,
  declaredRootIdentity,
} as const

/**
 * declaredRoot returns the stdlib root in front of this process, or undefined for the built-in one.
 * Two things can put one there: the environment variable, and an installed Tao's unpacked resource
 * tree, which `TaoResources` finds beside the running binary. The variable wins, so a test or a
 * packaged Studio can still redirect a real binary.
 *
 * Both answers go through this one function so that `declaredRootIdentity` covers both. An
 * installed root that moved the stdlib without reaching the identity would be the exact failure
 * this module exists to prevent, one layout later: a compile silently reused against a different
 * stdlib. Inside a checkout neither source answers, the result is undefined, and every caller
 * resolves as it always has.
 *
 * A relative value is refused rather than resolved, because the two halves of this variable's job
 * could not agree on what to resolve it against. `declaredRootIdentity` resolves it against the
 * root its caller's other components are relative to — the repository — while `Stdlib.rootPath`
 * hands the raw value to whatever reads it, which resolves against the process's current directory.
 * A relative value therefore hashed one tree and compiled against another, and only silently: every
 * setter in this repository passes an absolute path, so nothing has ever exercised the divergence.
 * Refusing it keeps that true, and says so where the mistake is made.
 */
function declaredRoot(): string | undefined {
  const declared = Platform.runtimeProcess.env[DECLARED_ROOT_ENV]
  if (declared !== undefined && declared.length > 0 && !declared.startsWith('/')) {
    throwUserInput(
      `${DECLARED_ROOT_ENV} must be an absolute path; it was ${JSON.stringify(declared)}. `
        + 'A relative value is hashed against the repository root and read against the current '
        + 'directory, which are not the same tree.',
    )
  }
  return declared ?? TaoResources.resolve(TaoResources.STDLIB_DIRECTORY)
}

/**
 * declaredRootIdentity is the identity of the declared stdlib: the value the environment names and
 * the content of the tree it names, so that redirecting the stdlib and editing the stdlib it was
 * redirected to both change it. The declared value is absolute — `declaredRoot` refuses anything
 * else — so `baseDirectory` only names the root a caller's other components are relative to and
 * never changes which tree is hashed.
 *
 * A tree that cannot be read throws rather than resolving to a value, because a stdlib that cannot
 * be hashed must not be memoized over. Callers that can carry on without memoizing catch it; callers
 * that cannot are better off failing where the unreadable input is than compiling against it.
 */
async function declaredRootIdentity(baseDirectory?: string): Promise<string> {
  const declared = declaredRoot()
  if (declared === undefined) {
    return FS.contentIdentity([`${DECLARED_ROOT_ENV}\n${ABSENT}`])
  }
  const root = FS.resolvePath(declared, baseDirectory)
  return FS.contentIdentity([
    `${DECLARED_ROOT_ENV}\n${declared}`,
    `tree\n${await treeIdentity(await FS.realPath(root).catch(() => root))}`,
  ])
}

/** treeIdentity is the content identity of every visible file the declared tree holds. */
async function treeIdentity(root: string): Promise<string> {
  if (!await FS.isDirectory(root)) {
    return ABSENT
  }
  const entries: (readonly [string, string])[] = []
  for await (
    const path of FS.walk(root, {
      excludeDirectory: name => EXCLUDED_DIRECTORY_NAMES.has(name),
      includeHidden: true,
    })
  ) {
    if (
      !EXCLUDED_DIRECTORY_NAMES.has(FS.basename(path)) && !path.endsWith(EXCLUDED_SUFFIX)
      && !FS.isFileMutationAuxiliaryPath(path)
    ) {
      entries.push([FS.relativePath(root, path), path])
    }
  }
  // Native bindings own this subtree; ordinary project contracts remain excluded.
  const nativeRoot = FS.resolvePath('.tao-ts/native-bindings', root)
  if (await FS.isDirectory(nativeRoot)) {
    for await (const path of FS.walk(nativeRoot, { includeHidden: true })) {
      if (!path.endsWith(EXCLUDED_SUFFIX) && !FS.isFileMutationAuxiliaryPath(path)) {
        entries.push([FS.relativePath(root, path), path])
      }
    }
  }
  return await FS.filesIdentity(entries)
}
