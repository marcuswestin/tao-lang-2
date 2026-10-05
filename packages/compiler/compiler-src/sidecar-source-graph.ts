import { Packages } from '@ast-utils'
import { type Diagnostic, FS } from '@shared'
import { sidecarModuleSpecifiers } from './sidecar-module-specifiers'

const sidecarModuleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json'] as const

export type SidecarSourceOwnership = {
  projectRoot: string
  index: Packages.Index
  allowUnmarkedOutside: boolean
}

export type SidecarSourceGraphInspection = {
  /** Exact texts consumed by this inspection, for callers auditing a saved graph. */
  sourceTexts: ReadonlyMap<string, string>
  sourcePaths: readonly string[]
  unresolvedCandidatePaths: readonly string[]
  ownershipInputPaths: readonly string[]
  diagnostics: readonly Diagnostic[]
}

/** Inspect authored relative sidecar imports without crossing a marked Tao project boundary. */
export function inspectSidecarSourceGraph(
  rootPath: string,
  ownership?: SidecarSourceOwnership,
): SidecarSourceGraphInspection {
  const sourceTexts = new Map<string, string>()
  const sourcePaths: string[] = []
  const unresolvedCandidatePaths = new Set<string>()
  const ownershipInputPaths = new Set<string>()
  const diagnostics: Diagnostic[] = []
  const belongsToProject = (path: string): boolean =>
    ownership === undefined || sidecarSourceBelongsToProject(path, ownership, marker => ownershipInputPaths.add(marker))
  if (!belongsToProject(rootPath)) {
    diagnostics.push({
      filePath: rootPath,
      message: `Sidecar implementation '${rootPath}' crosses a Tao project boundary.`,
      severity: 'error',
      source: 'compiler',
    })
    return {
      sourceTexts,
      sourcePaths,
      unresolvedCandidatePaths: [],
      ownershipInputPaths: [...ownershipInputPaths],
      diagnostics,
    }
  }
  if (!FS.existsSync(rootPath)) {
    return {
      sourceTexts,
      sourcePaths: [rootPath],
      unresolvedCandidatePaths: [rootPath],
      ownershipInputPaths: [...ownershipInputPaths],
      diagnostics,
    }
  }

  const visited = new Set<string>()
  const visit = (sourcePath: string): void => {
    if (visited.has(sourcePath)) {
      return
    }
    visited.add(sourcePath)
    sourcePaths.push(sourcePath)
    const source = FS.readTextSync(sourcePath)
    sourceTexts.set(sourcePath, source)
    for (const specifier of relativeModuleSpecifiers(source)) {
      if (specifier.value.endsWith('.tao')) {
        continue
      }
      const candidates = relativeSidecarCandidates(sourcePath, specifier.value)
      const dependency = candidates.find(FS.existsSync)
      if (dependency === undefined) {
        candidates.forEach(path => unresolvedCandidatePaths.add(path))
        diagnostics.push({
          filePath: sourcePath,
          message: `Sidecar relative import '${specifier.value}' could not be resolved.`,
          range: sidecarSourceRange(source, specifier.start, specifier.end),
          severity: 'error',
          source: 'compiler',
        })
        continue
      }
      if (!belongsToProject(dependency)) {
        diagnostics.push({
          filePath: sourcePath,
          message: `Sidecar relative import '${specifier.value}' crosses a Tao project boundary.`,
          range: sidecarSourceRange(source, specifier.start, specifier.end),
          severity: 'error',
          source: 'compiler',
        })
        continue
      }
      visit(dependency)
    }
  }
  visit(rootPath)
  return {
    sourceTexts,
    sourcePaths,
    unresolvedCandidatePaths: [...unresolvedCandidatePaths],
    ownershipInputPaths: [...ownershipInputPaths],
    diagnostics,
  }
}

/** Check authored and physical paths so a symlink cannot hide a marked Tao project. */
export function sidecarSourceBelongsToProject(
  path: string,
  ownership: SidecarSourceOwnership,
  observeMarker?: (markerPath: string) => void,
): boolean {
  const { projectRoot, index, allowUnmarkedOutside } = ownership
  if (!sidecarPathBelongsToRoot(path, projectRoot, allowUnmarkedOutside, observeMarker, index)) {
    return false
  }
  const physicalPath = physicalSidecarPath(path)
  const physicalRoot = physicalSidecarPath(projectRoot)
  return (physicalPath === path && physicalRoot === projectRoot)
    || sidecarPathBelongsToRoot(physicalPath, physicalRoot, allowUnmarkedOutside, observeMarker)
}

function sidecarPathBelongsToRoot(
  path: string,
  projectRoot: string,
  allowUnmarkedOutside: boolean,
  observeMarker?: (markerPath: string) => void,
  index?: Packages.Index,
): boolean {
  if (!FS.pathIsWithin(path, projectRoot)) {
    for (let directory = FS.dirname(path);; directory = FS.dirname(directory)) {
      const markerPath = FS.resolvePath('.tao', directory)
      observeMarker?.(markerPath)
      if (FS.existsSync(markerPath)) {
        return false
      }
      if (FS.existsSync(FS.resolvePath('.git', directory)) || FS.dirname(directory) === directory) {
        return allowUnmarkedOutside
      }
    }
  }
  // The Tao index discovers nested projects through Tao files. A TS-only nested project still
  // owns its sidecars by its .tao marker, so inspect those directories along the import path.
  for (let directory = FS.dirname(path); FS.pathIsWithin(directory, projectRoot);) {
    const markerPath = FS.resolvePath('.tao', directory)
    observeMarker?.(markerPath)
    if (directory !== projectRoot && FS.existsSync(markerPath)) {
      return false
    }
    if (directory === projectRoot) {
      break
    }
    directory = FS.dirname(directory)
  }
  return index === undefined || Packages.projectRootForPath(index, path) === projectRoot
}

/** Resolve the nearest existing ancestor so missing sidecars retain their synthetic-file behavior. */
function physicalSidecarPath(path: string): string {
  let ancestor = path
  while (!FS.existsSync(ancestor)) {
    const parent = FS.dirname(ancestor)
    if (parent === ancestor) {
      return path
    }
    ancestor = parent
  }
  return FS.resolvePath(FS.relativePath(ancestor, path), FS.realPathSync(ancestor))
}

function relativeModuleSpecifiers(source: string) {
  const firstByValue = new Map<string, ReturnType<typeof sidecarModuleSpecifiers>[number]>()
  for (const specifier of sidecarModuleSpecifiers(source)) {
    if (
      (specifier.value.startsWith('./') || specifier.value.startsWith('../'))
      && !firstByValue.has(specifier.value)
    ) {
      firstByValue.set(specifier.value, specifier)
    }
  }
  return [...firstByValue.values()]
}

function sidecarSourceRange(source: string, start: number, end: number): NonNullable<Diagnostic['range']> {
  const position = (offset: number) => {
    const prefix = source.slice(0, offset)
    const lines = prefix.split('\n')
    return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 }
  }
  return { start: position(start), end: position(end) }
}

function relativeSidecarCandidates(sourcePath: string, specifier: string): readonly string[] {
  const requested = FS.resolvePath(specifier, FS.dirname(sourcePath))
  const extension = FS.extname(requested)
  return extension === ''
    ? [
      ...sidecarModuleExtensions.map(extension => `${requested}${extension}`),
      ...sidecarModuleExtensions.map(extension => FS.resolvePath(`index${extension}`, requested)),
    ]
    : [
      requested,
      ...(extension === '.js' || extension === '.jsx'
        ? ['.ts', '.tsx'].map(authoredExtension => `${requested.slice(0, -extension.length)}${authoredExtension}`)
        : []),
    ]
}
