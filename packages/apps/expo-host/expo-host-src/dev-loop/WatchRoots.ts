import { FS } from '@shared'

/**
 * minimalWatchRoots reduces a set of directories to the smallest set a file watcher needs to cover
 * all of them: duplicates collapse, and a root already contained inside another root in the set is
 * dropped, since watching a directory and its own ancestor both watch the same files twice for no
 * benefit.
 */
export function minimalWatchRoots(roots: readonly string[]): string[] {
  const resolved = [...new Set(roots.map(root => FS.resolvePath(root)))].toSorted()
  return resolved.filter(root => !resolved.some(other => other !== root && FS.pathIsWithin(root, other)))
}
