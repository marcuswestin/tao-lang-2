import type { StudioCellIdentity, StudioPreviewCell, StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import { projectRelativePath } from '../StudioEditor'
import type { StudioPreviewConnection } from './StudioPreviewConnection'

export type StudioReviewCellMetadata = Readonly<{
  environment: string
  group: string
  key: string
  label: string
  renderInputs: string
}>

function canonicalReviewJson(value: unknown): string {
  const normalize = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(normalize)
      : input !== null && typeof input === 'object'
      ? Object.fromEntries(
        Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(
          ([key, entry]) => [key, normalize(entry)],
        ),
      )
      : input
  return JSON.stringify(normalize(value))
}

/** Stable browser markers let review tooling capture cells without understanding Studio internals. */
export const StudioReviewDom = {
  appliedReady(journeyReplayStatus: StudioPreviewConnection['journeyReplayStatus']): boolean {
    return journeyReplayStatus === undefined || journeyReplayStatus === 'settled'
  },
  cell(
    manifest: StudioPreviewManifestV2,
    cell: StudioPreviewCell,
  ): StudioReviewCellMetadata | undefined {
    const scenario = manifest.scenarios.find(candidate => candidate.scenarioId === cell.scenarioId)
    if (scenario === undefined) {
      return undefined
    }
    const sourcePath = projectRelativePath(manifest.project.root, scenario.source.path)
    if (sourcePath === undefined) {
      return undefined
    }
    const environment = canonicalReviewJson({
      network: cell.environment.network,
      scheme: cell.environment.scheme,
      viewport: cell.environment.viewport,
    })
    const renderInputs = canonicalReviewJson({
      arguments: cell.args,
      fixtureId: scenario.fixtureId ?? null,
      prepare: scenario.prepare,
      stateLayers: cell.stateLayers,
      steps: scenario.steps ?? [],
    })
    return {
      environment,
      group: scenario.group,
      key: JSON.stringify([sourcePath, scenario.group, scenario.label, renderInputs, environment]),
      label: scenario.label,
      renderInputs,
    }
  },
  /**
   * The revision a cell frame replays its scenario journey for, spelled as the frame's own replay gate
   * spells it: the frame replays each revision once, so an outcome it reported still holds for as long
   * as this is unchanged, and no second report will arrive for it.
   */
  journeyRevision(
    identity: Pick<StudioCellIdentity, 'cellRevision' | 'compileRevision' | 'manifestRevision'>,
    previewInstanceId: string,
  ): string {
    return [identity.compileRevision, identity.cellRevision, identity.manifestRevision, previewInstanceId].join(':')
  },
  manifest(manifest: StudioPreviewManifestV2): string {
    const sourceVersions = Object.fromEntries(
      Object.entries(manifest.sourceVersions)
        .flatMap(([path, version]) => {
          const relative = projectRelativePath(manifest.project.root, path)
          return relative === undefined ? [] : [[relative, version] as const]
        })
        .sort(([left], [right]) => left.localeCompare(right)),
    )
    return JSON.stringify({
      appName: manifest.project.appName,
      compileRevision: manifest.compileRevision,
      entryPath: projectRelativePath(manifest.project.root, manifest.project.entryPath)
        ?? manifest.project.entryPath,
      manifestRevision: manifest.manifestRevision,
      sourceVersions,
    })
  },
  /**
   * The replay outcome that still describes a cell's frame when the cell is rendered again, if any.
   * Rendering a cell again for the revision its frame has already replayed must keep that outcome: the
   * frame will not report it a second time, so resetting to pending would leave the cell pending for
   * good. The identity must also be the manifest's, so a newer manifest reads as pending until the
   * frame has it.
   */
  retainedJourneyReplay(
    connection: Pick<StudioPreviewConnection, 'cellIdentity' | 'journeyReplayResult' | 'previewInstanceId'>,
    manifest: Pick<StudioPreviewManifestV2, 'compileRevision' | 'manifestRevision'>,
  ): StudioPreviewConnection['journeyReplayResult'] {
    const identity = connection.cellIdentity
    const result = connection.journeyReplayResult
    if (
      identity === undefined
      || result === undefined
      || identity.compileRevision !== manifest.compileRevision
      || identity.manifestRevision !== manifest.manifestRevision
      || result.revision !== StudioReviewDom.journeyRevision(identity, connection.previewInstanceId)
    ) {
      return undefined
    }
    return result
  },
  status(frame: HTMLElement, status: 'failed' | 'pending' | 'ready', error?: string): void {
    frame.dataset['taoReviewStatus'] = status
    if (error === undefined) {
      delete frame.dataset['taoReviewError']
    } else {
      frame.dataset['taoReviewError'] = error
    }
  },
} as const
