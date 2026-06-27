import { Errors, FS, Repo } from '@shared'

const TAO_FILE_DISCOVERY_EXCLUDED_DIRECTORY_NAMES = [
  'node_modules',
  'ios',
  'android',
  'pods',
  'MVP-1',
  'MVP-2',
  'MVP-3',
  'Syntax Sketches',
] as const

/** findTaoFiles finds `.tao` files at or under `path`, respecting Git ignore rules. */
export async function findTaoFiles(path: string): Promise<string[]> {
  const root = FS.resolvePath(path)
  if (!await FS.exists(root)) {
    Errors.throwUserInput(`No file or directory found at ${root}`)
  }
  return await Repo.filesUnder(root, {
    excludeDirectoryNames: TAO_FILE_DISCOVERY_EXCLUDED_DIRECTORY_NAMES,
    extensions: ['.tao'],
  })
}
