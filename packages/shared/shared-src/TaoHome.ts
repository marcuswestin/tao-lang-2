import { throwUserInput } from './core/Errors'
import * as FS from './FS'
import * as Platform from './Platform'

/**
 * TaoHome owns the one directory Tao keeps machine-wide state in: installed versions, the `tao` link
 * on `PATH`, downloaded hosts, and caches. Every writer resolves it here, so relocating it with
 * `TAO_HOME` relocates all of it rather than whichever pieces happened to read the variable. The
 * install script (`standalone-install.sh`) spells the same rule in shell, because it runs before
 * any Tao binary exists; the two must agree.
 *
 * Project state is not here. A project's builds, sessions, and generated hosts stay under its own
 * `.tao/`, so deleting a project deletes them and no project reaches into another.
 */

/** DECLARED_ROOT_ENV relocates everything Tao writes outside a project. */
const DECLARED_ROOT_ENV = 'TAO_HOME'

/** XDG_DATA_HOME_ENV is the base-directory variable the default honours. */
const XDG_DATA_HOME_ENV = 'XDG_DATA_HOME'

/** TaoHome owns the machine-wide Tao directory and how it is found. */
export const TaoHome = {
  DECLARED_ROOT_ENV,
  resolve,
  root,
} as const

/**
 * root is the Tao home: `TAO_HOME`, else `$XDG_DATA_HOME/tao`, else `~/.local/share/tao`. A relative
 * `TAO_HOME` is refused, since a directory that moves with the current directory is not one home. A
 * relative `XDG_DATA_HOME` is ignored rather than refused, which is what the XDG specification asks
 * of a program that finds one.
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
  const dataHome = env[XDG_DATA_HOME_ENV]
  // `$HOME` first, as the install script reads it: the runtime's own home lookup ignores a changed
  // `HOME`, and the two spellings of this rule must land in the same place.
  const base = dataHome !== undefined && FS.isAbsolute(dataHome)
    ? dataHome
    : FS.resolvePath('.local/share', env['HOME'] ?? FS.homeDir())
  return FS.resolvePath('tao', base)
}

/** resolve names a path inside the Tao home. */
function resolve(relativePath: string): string {
  return FS.resolvePath(relativePath, root())
}
