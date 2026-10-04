import { Packages } from '@ast-utils'
import { Errors, FS } from '@shared'

export type TaoProjectSource = {
  root: string
}

/** Find the nearest marked Tao project above a file or directory. */
export async function findTaoProjectSource(targetPath: string): Promise<TaoProjectSource> {
  const target = FS.resolvePath(targetPath)
  if (!await FS.exists(target)) {
    Errors.throwUserInput(`No file or directory found at ${target}`)
  }
  const directory = await FS.isFile(target) ? FS.dirname(target) : target
  const root = await Packages.containingProjectRoot(directory)
  if (root === undefined) {
    Errors.throwUserInput(`No Tao project root was found from ${target}. Add a .tao directory to the project root.`)
  }
  return { root: await FS.realPath(root) }
}
