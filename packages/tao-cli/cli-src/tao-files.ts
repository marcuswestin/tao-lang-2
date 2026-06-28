import { Errors, FS, Repo, TaoFiles } from '@shared'

/** findTaoFiles finds `.tao` files at or under `path`, respecting Git ignore rules. */
export async function findTaoFiles(path: string): Promise<string[]> {
  const root = FS.resolvePath(path)
  if (!await FS.exists(root)) {
    Errors.throwUserInput(`No file or directory found at ${root}`)
  }
  return await Repo.filesUnder(root, {
    excludeDirectoryNames: TaoFiles.discoveryExcludeDirectoryNames,
    extensions: ['.tao'],
  })
}
