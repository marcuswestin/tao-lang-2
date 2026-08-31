import { FS } from '@shared'

/** Stdlib owns the source root for Tao's built-in packages. */
export const Stdlib = {
  rootPath: process.env['TAO_STDLIB_ROOT'] ?? FS.resolvePath('..', import.meta.dirname),
} as const

export default Stdlib
