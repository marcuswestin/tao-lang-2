import type { StudioPreviewCell, StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
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
  status(frame: HTMLElement, status: 'failed' | 'pending' | 'ready', error?: string): void {
    frame.dataset['taoReviewStatus'] = status
    if (error === undefined) {
      delete frame.dataset['taoReviewError']
    } else {
      frame.dataset['taoReviewError'] = error
    }
  },
} as const
