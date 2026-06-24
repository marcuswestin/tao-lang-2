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

  const taoFiles: string[] = []
  for await (
    const walkedPath of FS.walk(root, {
      extensions: ['.tao'],
      includeHidden: true,
      excludeDirectory: shouldIgnoreTaoDirectory,
    })
  ) {
    taoFiles.push(walkedPath)
  }
  return taoFiles.sort()
}

function shouldIgnoreTaoDirectory(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name) || name.startsWith('_gen_')
}

const IGNORED_DIRECTORY_NAMES = new Set([
  '.artifacts',
  '.devenv',
  '.direnv',
  '.expo',
  '.git',
  'Pods',
  'android',
  'ios',
  'node_modules',
  'pods',
])
