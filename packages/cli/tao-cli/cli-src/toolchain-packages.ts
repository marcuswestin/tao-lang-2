import { inspectMaintainedNativeBindings, type MaintainedBindingOptions } from '@native-bindings'
import { FS, Repo } from '@shared'

/** A stale or unreadable maintained payload can never identify reusable output. */
export async function maintainedNativeBindingIdentity(options?: MaintainedBindingOptions): Promise<string | undefined> {
  try {
    const inspection = await inspectMaintainedNativeBindings(options)
    return inspection.status === 'fresh' ? inspection.identity : undefined
  } catch {
    return undefined
  }
}

/**
 * The package groups whose sources cannot change what `tao check` reports or what a Tao app
 * compiles to, and which are therefore left out of the toolchain identity the check and test caches
 * key themselves on.
 *
 * Both caches used to hash every file under `packages/`. That is correct and far too broad: a
 * verdict genuinely depends on the parser, validator, formatter, compiler, stdlib and runtime, so
 * hashing all of them is right, but it also meant one comment added to the test harness invalidated
 * every checked workspace and every compiled app for everyone in the checkout. Measured 2026-09-21,
 * that cost 34.4s of whole-repository rechecking against 0.5s warm, on an edit no Tao verdict could
 * possibly depend on.
 *
 * This is a denylist and must stay one. A group that is not named here is hashed, so a new group,
 * a renamed one, or one nobody thought about is included by default and the cache merely misses
 * more often. The opposite shape — naming the groups that *are* relevant — would silently exclude
 * anything new, and an excluded input that a verdict depends on is a stale green: a validation
 * error that passes. `toolchain-packages.test.ts` proves each name here is unreachable from the
 * packages a verdict depends on, and fails the moment a dependency edge into one of them appears.
 *
 * What the test cannot see is a reach that is not a dependency edge at all — a path built at
 * runtime, a computed require. None is known into these entries, and none should exist:
 * a developer tool, an IDE, and a test driver are all consumers of the language, never inputs to
 * it. A change that makes one of them an input belongs on the other side of this list.
 *
 * An entry names either a whole top-level group (`ides`, `testing`) or, when a group also holds a
 * verdict-relevant package, one `group/package` pair instead: `cli` holds `cli/tao-cli` and
 * `cli/cli-kit`, which a verdict depends on, alongside the developer and agent CLIs, which it does
 * not, so `cli` itself cannot be denylisted whole and `cli/dev-cli` and `cli/agent-cli` are named
 * individually.
 */
export const VERDICT_IRRELEVANT_GROUPS: readonly string[] = ['ides', 'testing', 'cli/dev-cli', 'cli/agent-cli']

/**
 * verdictPackageFiles lists the package sources a Tao verdict can depend on: every visible file
 * under `packages/`, less the groups above. Paths come back absolute, as `Repo.filesUnder` gives
 * them.
 */
export async function verdictPackageFiles(packagesRoot: string): Promise<string[]> {
  const root = FS.resolvePath(packagesRoot)
  const excluded = new Set(VERDICT_IRRELEVANT_GROUPS)
  const files = await Repo.filesUnder(root)
  return files.filter(path => !isVerdictIrrelevant(root, path, excluded))
}

/**
 * isVerdictIrrelevant matches a file against the denylist at whichever granularity an entry
 * names: the top-level folder a package file sits under, which is the group after the
 * restructure, or that group's own package when the denylist names one specifically. A file
 * directly under `packages/` belongs to no group and is never excluded.
 */
function isVerdictIrrelevant(packagesRoot: string, path: string, excluded: ReadonlySet<string>): boolean {
  const relative = FS.relativePath(packagesRoot, path)
  const [group, groupPackage] = relative.split('/')
  if (group === undefined) {
    return false
  }
  return excluded.has(group) || (groupPackage !== undefined && excluded.has(`${group}/${groupPackage}`))
}
