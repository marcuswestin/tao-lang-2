import { FS } from '@shared'

const EXCLUDED_DIRECTORIES = new Set(['.tao', '.tao-ts', '.git', '.artifacts', '.expo', 'node_modules'])

/** Find marked child projects so an enclosing project's TypeScript inputs stay isolated. */
export async function nestedProjectRoots(projectRoot: string): Promise<string[]> {
  const roots: string[] = []
  const queue = [FS.resolvePath(projectRoot)]
  while (queue.length > 0) {
    const directory = queue.shift()!
    for (const name of await FS.listDir(directory)) {
      if (EXCLUDED_DIRECTORIES.has(name)) {
        continue
      }
      const child = FS.resolvePath(name, directory)
      if (await FS.isSymbolicLink(child) || !await FS.isDirectory(child)) {
        continue
      }
      if (await FS.isDirectory(FS.resolvePath('.tao', child))) {
        roots.push(child)
      } else {
        queue.push(child)
      }
    }
  }
  return roots
}

export function belongsToProject(path: string, projectRoot: string, nestedRoots: readonly string[]): boolean {
  return FS.pathIsWithin(path, projectRoot) && !nestedRoots.some(root => FS.pathIsWithin(path, root))
}
