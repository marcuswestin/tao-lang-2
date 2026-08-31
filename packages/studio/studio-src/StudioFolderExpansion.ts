/** StudioFolderIsExpanded preserves the Files panel's expanded-by-default behavior. */
export function StudioFolderIsExpanded(
  collapsedFolders: readonly string[],
  folderPath: string,
): boolean {
  return !collapsedFolders.includes(folderPath)
}

/** StudioToggleFolder returns one canonical persisted collapsed-path set. */
export function StudioToggleFolder(
  collapsedFolders: readonly string[],
  folderPath: string,
): string[] {
  const next = new Set(collapsedFolders)
  if (next.has(folderPath)) {
    next.delete(folderPath)
  } else {
    next.add(folderPath)
  }
  return [...next].sort()
}
