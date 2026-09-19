import { FS } from '@shared'

/** workspaceServerRoots gives every VS Code workspace its own package-resolution process. */
export function workspaceServerRoots(folders: readonly string[], cwd: string): string[] {
  const roots = [...new Set(folders.map(folder => FS.resolvePath(folder)))]
  return roots.length > 0 ? roots : [FS.resolvePath(cwd)]
}

/** workspaceServerPlan makes folder add/remove lifecycle explicit and deterministic. */
export function workspaceServerPlan(
  running: readonly string[],
  folders: readonly string[],
  cwd: string,
): { add: string[]; remove: string[]; roots: string[] } {
  const roots = workspaceServerRoots(folders, cwd)
  return {
    add: roots.filter(root => !running.includes(root)),
    remove: running.filter(root => !roots.includes(root)),
    roots,
  }
}
