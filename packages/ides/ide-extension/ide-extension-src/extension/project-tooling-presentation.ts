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

/** Link physical native origins only when both files belong to the inspected publication. */
export function nativeOriginMappings(
  generatedPath: string,
  text: string,
  inspectedPaths: readonly string[],
): ProjectToolingSourceMapping[] {
  const allowed = new Set(inspectedPaths.map(path => FS.resolvePath(path)))
  if (!allowed.has(FS.resolvePath(generatedPath))) {
    return []
  }
  const mappings: ProjectToolingSourceMapping[] = []
  for (const [line, content] of text.split('\n').entries()) {
    const match = /^\s*\/\/ Native origin: (\.{1,2}\/[^\r\n]+):([1-9][0-9]*):([1-9][0-9]*)\s*$/u.exec(content)
    if (match === null) {
      continue
    }
    const sourcePath = FS.resolvePath(match[1]!, FS.dirname(generatedPath))
    const sourceLine = Number(match[2]) - 1
    const sourceColumn = Number(match[3]) - 1
    if (!allowed.has(sourcePath) || !Number.isSafeInteger(sourceLine) || !Number.isSafeInteger(sourceColumn)) {
      continue
    }
    const character = content.indexOf(match[1]!)
    mappings.push({
      generatedPath,
      generatedRange: { start: { line, character }, end: { line, character: character + match[1]!.length } },
      sourcePath,
      sourceRange: {
        start: { line: sourceLine, character: sourceColumn },
        end: { line: sourceLine, character: sourceColumn },
      },
    })
  }
  return mappings
}

/** A document link passes the emitted Tao span unchanged to its navigation command. */
export function originCommandUri(sourcePath: string, sourceRange: DiagnosticRange): string {
  return `command:tao.openSourceOrigin?${encodeURIComponent(JSON.stringify([sourcePath, sourceRange]))}`
}
