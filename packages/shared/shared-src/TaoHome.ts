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
 * `.tao/`, so deleting a project deletes them and no project reaches into another.
 */

/** DECLARED_ROOT_ENV relocates everything Tao writes outside a project. */
const DECLARED_ROOT_ENV = 'TAO_HOME'

/** TaoHome owns the machine-wide Tao directory and how it is found. */
export const TaoHome = {
  DECLARED_ROOT_ENV,
  cacheResolve,
  cacheRoot,
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
