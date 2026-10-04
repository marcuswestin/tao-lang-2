import { FS } from '@shared'

const EXCLUDED_DIRECTORIES = new Set(['.tao-ts', 'node_modules', '.git', '.artifacts', '.expo'])
const SOURCE_EXTENSIONS = new Set([
  '.tao',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.jsonc',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
])
const MARKER_INPUTS = new Set(['.gitkeep'])
const STORE_INPUTS = new Set(['lock.jsonc', 'project.json'])

/** Ignore generated and installed trees, while allowing explicitly selected dependency roots. */
export function ignoredProjectWatchPath(
  path: string,
  projectRoot: string,
  dependencyRoots: ReadonlySet<string>,
  configInputPaths: ReadonlySet<string> = new Set(),
  externalSidecarInputPaths: ReadonlySet<string> = new Set(),
  sidecarOwnershipInputPaths: ReadonlySet<string> = new Set(),
): boolean {
  const absolute = FS.resolvePath(path)
  if (isGeneratedWatchPath(absolute)) {
    return true
  }
  const explicitInputs = [...configInputPaths, ...externalSidecarInputPaths, ...sidecarOwnershipInputPaths]
  if (explicitInputs.includes(absolute) || explicitInputs.some(input => FS.pathIsWithin(input, absolute))) {
    return false
  }
  const dependencyRoot = [...dependencyRoots].find(root => FS.pathIsWithin(absolute, root))
  const watchRoot = dependencyRoot ?? projectRoot
  if (!FS.pathIsWithin(absolute, watchRoot)) {
    return true
  }
  const parts = FS.relativePath(watchRoot, absolute).split('/')
  if (parts.some(part => EXCLUDED_DIRECTORIES.has(part))) {
    return true
  }
  const markerIndex = parts.indexOf('.tao')
  if (markerIndex < 0) {
    return false
  }
  const belowMarker = parts.slice(markerIndex + 1)
  if (belowMarker[0] === 'store') {
    return belowMarker.length > 2 || belowMarker.length === 2 && !STORE_INPUTS.has(belowMarker[1]!)
  }
  return belowMarker.length > 1 || belowMarker.length === 1 && !MARKER_INPUTS.has(belowMarker[0]!)
}

/** Events allowed to trigger a refresh after the watcher applies the same path policy. */
export function isProjectWatchInput(
  event: string,
  path: string,
  projectRoot: string,
  dependencyRoots: ReadonlySet<string>,
  configInputPaths: ReadonlySet<string> = new Set(),
  externalSidecarInputPaths: ReadonlySet<string> = new Set(),
  sidecarOwnershipInputPaths: ReadonlySet<string> = new Set(),
): boolean {
  if (
    ignoredProjectWatchPath(
      path,
      projectRoot,
      dependencyRoots,
      configInputPaths,
      externalSidecarInputPaths,
      sidecarOwnershipInputPaths,
    )
  ) {
    return false
  }
  if (event === 'addDir' || event === 'unlinkDir') {
    const absolute = FS.resolvePath(path)
    return sidecarOwnershipInputPaths.has(absolute)
      || FS.pathIsWithin(absolute, projectRoot)
      || [...dependencyRoots].some(root => FS.pathIsWithin(absolute, root))
  }
  if (event !== 'add' && event !== 'change' && event !== 'unlink') {
    return false
  }
  if (configInputPaths.has(FS.resolvePath(path)) || externalSidecarInputPaths.has(FS.resolvePath(path))) {
    return true
  }
  return SOURCE_EXTENSIONS.has(FS.extname(path))
    || STORE_INPUTS.has(FS.basename(path)) && FS.basename(FS.dirname(path)) === 'store'
    || FS.basename(path) === '.gitkeep' && FS.basename(FS.dirname(path)) === '.tao'
}

/** Exact config inputs that the project and dependency directory watches do not already cover. */
export function explicitProjectConfigWatchPaths(
  configInputPaths: ReadonlySet<string>,
  projectRoot: string,
  dependencyRoots: ReadonlySet<string>,
): readonly string[] {
  return [...configInputPaths].filter(path =>
    !isGeneratedWatchPath(path) && ignoredProjectWatchPath(path, projectRoot, dependencyRoots)
  )
}

/** Exact external sidecar files and unresolved candidates outside directory watches. */
export function explicitProjectSidecarWatchPaths(
  externalSidecarInputPaths: ReadonlySet<string>,
  projectRoot: string,
  dependencyRoots: ReadonlySet<string>,
): readonly string[] {
  return [...externalSidecarInputPaths].filter(path =>
    !isGeneratedWatchPath(path) && ignoredProjectWatchPath(path, projectRoot, dependencyRoots)
  )
}

/** Exact nested or external ownership-marker directories that can change sidecar reachability. */
export function explicitProjectOwnershipWatchPaths(
  sidecarOwnershipInputPaths: ReadonlySet<string>,
  projectRoot: string,
): readonly string[] {
  return [...sidecarOwnershipInputPaths].filter(path =>
    !isGeneratedWatchPath(path) && path !== FS.resolvePath('.tao', projectRoot)
  )
}

function isGeneratedWatchPath(path: string): boolean {
  const parts = FS.resolvePath(path).split('/')
  return parts.includes('.tao-ts')
    || parts.some((part, index) => part === '.tao' && parts[index + 1] === 'cache')
}
