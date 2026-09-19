import { FS, TaoStdlib } from '@shared'

/**
 * Stdlib owns the source root for Tao's built-in packages. The redirect itself belongs to
 * `TaoStdlib`, which also owns what hashing that redirected tree means, so the variable that
 * relocates the stdlib is spelled in one place rather than once per scheme that has to cover it.
 */
export const Stdlib = {
  rootPath: TaoStdlib.declaredRoot() ?? FS.resolvePath('..', import.meta.dirname),
} as const
