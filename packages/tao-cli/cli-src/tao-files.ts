import { Packages } from '@ast-utils'
import { Errors, FS } from '@shared'

/** findTaoFiles finds `.tao` files at or under `path`, skipping common generated and vendored directories. */
export async function findTaoFiles(path: string): Promise<string[]> {
  const root = FS.resolvePath(path)
  if (!await FS.exists(root)) {
    Errors.throwUserInput(`No file or directory found at ${root}`)
  }
  if (await FS.isFile(root)) {
    return FS.extname(root) === '.tao' ? [root] : []
  }
  if (Packages.shouldSkipTaoDirectory(FS.basename(root))) {
    return []
  }

  const taoFiles: string[] = []
  for await (
    const walkedPath of FS.walk(root, {
      extensions: ['.tao'],
      includeHidden: false,
      excludeDirectory: Packages.shouldSkipTaoDirectory,
    })
  ) {
    taoFiles.push(walkedPath)
  }
  return taoFiles.sort()
}
