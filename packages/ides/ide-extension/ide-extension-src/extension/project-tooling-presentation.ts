import type { ProjectToolingSourceMapping } from '@project-tooling'
import { type DiagnosticRange, FS } from '@shared'

/** Explorer patterns are relative to one workspace folder, never user-wide settings. */
export function toolingExplorerPatterns(folder: string, projectRoot: string): string[] {
  if (!FS.pathIsWithin(projectRoot, folder)) {
    return []
  }
  const prefix = FS.relativePath(folder, projectRoot)
  return ['tsconfig.json', 'node_modules'].map(name => prefix === '' ? name : `${prefix}/${name}`)
}

/** Existing folder overrides, including explicit false values, always win. */
export function hideToolingPatterns(
  existing: Readonly<Record<string, boolean>>,
  patterns: readonly string[],
): Record<string, boolean> {
  const next = { ...existing }
  for (const pattern of patterns) {
    if (!Object.hasOwn(next, pattern)) {
      next[pattern] = true
    }
  }
  return next
}

/** Show tooling makes only this project's two Explorer entries visible. */
export function showToolingPatterns(
  existing: Readonly<Record<string, boolean>>,
  patterns: readonly string[],
): Record<string, boolean> {
  const next = { ...existing }
  for (const pattern of patterns) {
    next[pattern] = false
  }
  return next
}

/** Keep only the exact spans emitted for this generated contract. */
export function originMappingsForPath(
  generatedPath: string,
  mappings: readonly ProjectToolingSourceMapping[],
): ProjectToolingSourceMapping[] {
  const resolved = FS.resolvePath(generatedPath)
  return mappings.filter(mapping => FS.resolvePath(mapping.generatedPath) === resolved)
}

/** A document link passes the emitted Tao span unchanged to its navigation command. */
export function originCommandUri(sourcePath: string, sourceRange: DiagnosticRange): string {
  return `command:tao.openSourceOrigin?${encodeURIComponent(JSON.stringify([sourcePath, sourceRange]))}`
}
