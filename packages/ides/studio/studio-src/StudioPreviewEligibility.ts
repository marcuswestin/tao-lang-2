import type { StudioCompileRequest } from './StudioCompileCoordinator'

/** Cached tooling may serve only one versioned change in an otherwise consumed source graph. */
export function studioPreviewFastGate(input: {
  enabled: boolean
  request: StudioCompileRequest
  requestedPath: string | undefined
  sourceVersions: Readonly<Record<string, string>>
  consumedSources: ReadonlyMap<string, { version: string }>
  freshTooling: boolean
  currentToolingInputs: boolean
  auditedToolingInputs: boolean
}): Record<string, boolean> {
  const { request, requestedPath, sourceVersions, consumedSources } = input
  const own = (record: Readonly<Record<string, string>>, path: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, path)
  const versionPaths = Object.keys(sourceVersions)
  const completeVersions =
    versionPaths.every(path => typeof sourceVersions[path] === 'string' && sourceVersions[path]!.length > 0)
    && [...consumedSources].every(([path, source]) => source.version.length > 0 && own(sourceVersions, path))
    && consumedSources.size === versionPaths.length
  const changed = versionPaths.filter(path => consumedSources.get(path)?.version !== sourceVersions[path])
  const sourceChange = request.changes.length === 1 ? request.changes[0] : undefined
  const requestedVersion = requestedPath !== undefined && own(sourceVersions, requestedPath)
    ? sourceVersions[requestedPath]
    : undefined
  return {
    enabled: input.enabled,
    interactive: !request.causes.includes('initial'),
    singleTaoFile: request.causes.length === 1 && request.causes[0] === 'studio-write'
      && sourceChange !== undefined && sourceChange.path === requestedPath
      && requestedPath !== undefined && requestedPath.endsWith('.tao'),
    knownSource: requestedPath !== undefined && requestedPath.length > 0 && consumedSources.has(requestedPath),
    freshTooling: input.freshTooling,
    unchangedToolingInputs: input.currentToolingInputs,
    auditedToolingInputs: input.auditedToolingInputs,
    completeConsumedGraph: completeVersions,
    isolatedSource: completeVersions && changed.length === 1 && changed[0] === requestedPath,
    currentRequest: requestedPath !== undefined && requestedVersion !== undefined && requestedVersion.length > 0
      && sourceChange !== undefined && sourceChange.path === requestedPath && sourceChange.sourceVersion !== undefined
      && sourceChange.sourceVersion.length > 0 && sourceChange.sourceVersion === requestedVersion,
  }
}
