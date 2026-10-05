import { throwUserInput } from './core/Errors'
import * as FS from './FS'
import * as Platform from './Platform'

/**
 * TaoHome owns the one directory Tao keeps machine-wide state in: installed versions, the `tao`
 * executable link, downloaded hosts, and reusable caches. Every writer resolves it here, so
 * relocating with `TAO_HOME` relocates all of it. The install script (`standalone-install.sh`)
 * spells the same installed-state rule in shell because it runs before any Tao binary exists.
 *
 * Project state is not here. A project's builds, sessions, and generated hosts stay under its own
 * `.tao/` (`ProjectLocal`), so deleting a project deletes them and no project reaches into another.
 */

/** DECLARED_ROOT_ENV relocates everything Tao writes outside a project. */
const DECLARED_ROOT_ENV = 'TAO_HOME'

/** TaoHome owns the machine-wide Tao directory and how it is found. */
export const TaoHome = {
  DECLARED_ROOT_ENV,
  cacheResolve,
  cacheRoot,
  prepareAgentState,
  resolve,
  root,
} as const

/**
 * root is the Tao home: `TAO_HOME`, else `~/.tao`. A relative `TAO_HOME` is refused, since a
 * directory that moves with the current directory is not one home.
 */
function root(): string {
  const env = Platform.runtimeProcess.env
  const declared = env[DECLARED_ROOT_ENV]
  if (declared !== undefined && declared.length > 0) {
    if (!FS.isAbsolute(declared)) {
      throwUserInput(`${DECLARED_ROOT_ENV} must be an absolute path; it was ${JSON.stringify(declared)}.`)
    }
    return declared
  }
  // `$HOME` first, as the install script reads it: the runtime's own home lookup ignores a changed
  // `HOME`, and the two spellings of this rule must land in the same place.
  return FS.resolvePath('.tao', env['HOME'] ?? FS.homeDir())
}

/** resolve names a path inside the Tao home. */
function resolve(relativePath: string): string {
  return FS.resolvePath(relativePath, root())
}

/**
 * cacheRoot keeps reusable, disposable data beside installed state, under the one Tao home.
 */
function cacheRoot(): string {
  return FS.resolvePath('cache', root())
}

/** cacheResolve names one disposable path under Tao's cache root. */
function cacheResolve(relativePath: string): string {
  return FS.resolvePath(relativePath, cacheRoot())
}

/** Prepare one app's machine-wide agent service state, moving recognized older files once. */
async function prepareAgentState(appId: string, baseRoot?: string, legacyBaseRoot?: string): Promise<string> {
  if (!/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/u.test(appId)) {
    throwUserInput(`Invalid Tao agent app ID ${JSON.stringify(appId)}.`)
  }
  const agentsRoot = FS.resolvePath(baseRoot ?? resolve('agents'))
  const olderRoot = FS.resolvePath(legacyBaseRoot ?? FS.resolvePath('Library/Caches/Tao/agents', FS.homeDir()))
  const appRoot = FS.resolvePath(appId, agentsRoot)
  const previousRoot = FS.resolvePath(Platform.sha256Hex(appId).slice(0, 24), olderRoot)
  const homeRoot = FS.dirname(agentsRoot)
  const lockDirectory = FS.resolvePath('cache/agents/locks', homeRoot)
  await FS.mkdir(homeRoot)
  await FS.mkdirWithinBoundary(lockDirectory, homeRoot)
  await FS.withFileMutationLock(appRoot, homeRoot, async () => {
    await FS.mkdirWithinBoundary(appRoot, homeRoot)
    if (!await FS.isDirectory(previousRoot) || await FS.isSymbolicLink(previousRoot)) {
      return
    }
    for (const name of ['origin.json', 'session.json', 'service.log'] as const) {
      const from = FS.resolvePath(name, previousRoot)
      const to = FS.resolvePath(name, appRoot)
      if (
        await FS.isFile(from) && !await FS.exists(to)
        && !await FS.isSymbolicLink(from) && !await FS.isSymbolicLink(to)
      ) {
        await FS.move(from, to)
      }
    }
    await FS.removeEmptyDirectory(previousRoot)
  }, { lockDirectory })
  return appRoot
}
