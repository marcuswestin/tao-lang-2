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
}): Record<string, boolean> {
  const { request, requestedPath, sourceVersions, consumedSources } = input
  const changed = Object.keys(sourceVersions).filter(path =>
    consumedSources.get(path)?.version !== sourceVersions[path]
  )
  const removed = [...consumedSources.keys()].some(path => !(path in sourceVersions))
  return {
    enabled: input.enabled,
    interactive: !request.causes.includes('initial'),
    singleTaoFile: request.changes.length === 1 && request.changes[0]!.path.endsWith('.tao'),
    knownSource: requestedPath !== undefined && consumedSources.has(requestedPath),
    freshTooling: input.freshTooling,
    unchangedToolingInputs: input.currentToolingInputs,
    isolatedSource: !removed && changed.length === 1 && changed[0] === requestedPath,
    currentRequest: requestedPath !== undefined && request.changes[0]?.sourceVersion !== undefined
      && request.changes[0].sourceVersion === sourceVersions[requestedPath],
  }
}
