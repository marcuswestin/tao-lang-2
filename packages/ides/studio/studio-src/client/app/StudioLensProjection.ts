import type { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import type { StudioRenderInspection } from '@source-actions'
import type { StudioDeviceLensSample } from '../../device/StudioDeviceStatus'
import type { StudioLensRenderSample } from '../../StudioProtocol'

export type StudioLensSelection = Readonly<{
  path: string
  renderId: string
  sourceVersion: string
}>

/** Joins only one exact source revision with measured runtime events. */
export function projectStudioLensLines(
  selected: StudioLensSelection | undefined,
  samples: readonly StudioLensRenderSample[],
  inspection: StudioRenderInspection | undefined,
  journeys?: RuntimeTesting.JourneyObservationsArtifact,
  deviceSamples: readonly StudioDeviceLensSample[] = [],
): readonly string[] {
  if (selected === undefined) {
    return ['Select a rendered element to inspect its causal timeline.']
  }
  const matching = samples.filter(sample =>
    sample.identity.sourcePath === selected.path
    && sample.sourceVersion === selected.sourceVersion
    && `${sample.identity.sourcePath}:${sample.identity.start}:${sample.identity.end}` === selected.renderId
  )
  const matchingDevice = deviceSamples.filter(sample =>
    sample.occurrence.sourcePath === selected.path
    && sample.occurrence.sourceVersion === selected.sourceVersion
    && `${sample.occurrence.sourcePath}:${sample.occurrence.start}:${sample.occurrence.end}` === selected.renderId
  )
  const lines = [`Source: ${selected.path}`]
  if (matching.length === 0) {
    lines.push(
      'Render timing: no observation for this source revision in the focused preview.',
      'Invalidating read: not observed.',
      'Provider wait: not observed.',
      'Resolved style: not measured.',
    )
    lines.push(...deviceLensLines(matchingDevice))
    lines.push(coveringJourneyLine(selected, journeys))
    return lines
  }
  const slowest = Math.max(...matching.map(sample => sample.actualDurationMs))
  const latest = matching[matching.length - 1]!
  const ranked = new Map<string, number>()
  for (
    const sample of samples.filter(candidate =>
      candidate.identity.sourcePath === selected.path && candidate.sourceVersion === selected.sourceVersion
    )
  ) {
    const key = `${sample.identity.sourcePath}:${sample.identity.start}:${sample.identity.end}:${sample.sourceVersion}`
    ranked.set(key, Math.max(ranked.get(key) ?? 0, sample.actualDurationMs))
  }
  const rank = [...ranked.values()].filter(duration => duration > slowest).length + 1
  lines.push(
    `Render: ${matching.length} commits; latest ${milliseconds(latest.actualDurationMs)}; slowest ${
      milliseconds(slowest)
    }; rank ${rank} of ${ranked.size} observed nodes in this source revision.`,
  )
  const causedSample = matching.findLast(sample => sample.causes.length > 0)
  const causes = causedSample?.causes.map(cause =>
    cause.kind === 'state'
      ? 'view-local state changed'
      : `data subscription ${cause.schema}.${cause.entity} invalidated`
  ) ?? []
  lines.push(
    causes.length === 0
      ? 'Invalidating read: not observed.'
      : `Invalidating read: ${[...new Set(causes)].join('; ')}.`,
  )
  const wait = matching.findLast(sample =>
    sample.causes.some(cause => cause.kind === 'data' && cause.providerWaitMs !== undefined)
  )?.causes.find(cause => cause.kind === 'data' && cause.providerWaitMs !== undefined)
  lines.push(
    wait?.kind === 'data' && wait.providerWaitMs !== undefined
      ? `Provider wait: ${milliseconds(wait.providerWaitMs)} observed for ${wait.schema}.${wait.entity}.`
      : 'Provider wait: not observed.',
  )
  lines.push(
    inspection?.renderId === selected.renderId && inspection.styleEntries.length > 0
      ? `Style source: ${inspection.styleEntries.map(entry => entry.join(' ')).join('; ')}.`
      : 'Style source: not available.',
  )
  const styledSample = matching.findLast(sample => sample.resolvedStyle !== undefined)
  lines.push(
    styledSample?.resolvedStyle === undefined
      ? 'Resolved style: not measured.'
      : `Resolved style: ${
        Object.entries(styledSample.resolvedStyle).map(([key, value]) => `${key} ${value}`).join('; ')
      }.`,
  )
  lines.push(...deviceLensLines(matchingDevice))
  lines.push(coveringJourneyLine(selected, journeys))
  for (const sample of matching.slice(-8).reverse()) {
    const cause = sample.causes.map(entry =>
      entry.kind === 'state'
        ? 'state changed'
        : `data ${entry.schema}.${entry.entity}${
          entry.providerWaitMs === undefined ? '' : ` waited ${milliseconds(entry.providerWaitMs)}`
        }`
    )
    lines.push(
      `${new Date(sample.timestamp).toLocaleTimeString()} · ${sample.phase} · ${
        milliseconds(sample.actualDurationMs)
      } · ${cause.join(', ') || 'cause unknown'}`,
    )
  }
  return lines
}

function deviceLensLines(samples: readonly StudioDeviceLensSample[]): readonly string[] {
  if (samples.length === 0) {
    return ['Device render: no observation for this source revision.']
  }
  const latest = samples[samples.length - 1]!
  const slowest = Math.max(...samples.map(sample => sample.actualDurationMs))
  const caused = samples.findLast(sample => sample.causes.length > 0)
  const causes = caused?.causes.map(cause =>
    cause.kind === 'state'
      ? 'view-local state changed'
      : `data subscription ${cause.schema}.${cause.entity} invalidated`
  ) ?? []
  const wait = samples.findLast(sample =>
    sample.causes.some(cause => cause.kind === 'data' && cause.providerWaitMs !== undefined)
  )?.causes.find(cause => cause.kind === 'data' && cause.providerWaitMs !== undefined)
  return [
    `Device render (${latest.deviceName}): ${samples.length} commits; latest ${
      milliseconds(latest.actualDurationMs)
    }; slowest ${milliseconds(slowest)}.`,
    causes.length === 0
      ? 'Device invalidating read: not observed.'
      : `Device invalidating read: ${[...new Set(causes)].join('; ')}.`,
    wait?.kind === 'data' && wait.providerWaitMs !== undefined
      ? `Device provider wait: ${milliseconds(wait.providerWaitMs)} observed for ${wait.schema}.${wait.entity}.`
      : 'Device provider wait: not observed.',
    ...samples.slice(-4).reverse().map(sample =>
      `${new Date(sample.timestamp).toLocaleTimeString()} · ${sample.deviceName} · ${sample.phase} · ${
        milliseconds(sample.actualDurationMs)
      }`
    ),
  ]
}

function coveringJourneyLine(
  selected: StudioLensSelection,
  journeys: RuntimeTesting.JourneyObservationsArtifact | undefined,
): string {
  const covering = coveringJourneys(selected, journeys)
  if (covering.length === 0) {
    return 'Covering journey: no execution observation.'
  }
  const first = covering[0]!
  return `Covering journey: ${first.suiteName} / ${first.checkName} (${first.checkSource.filePath})${
    covering.length > 1 ? ` and ${covering.length - 1} more` : ''
  }.`
}

export function coveringJourneys(
  selected: StudioLensSelection | undefined,
  journeys: RuntimeTesting.JourneyObservationsArtifact | undefined,
): RuntimeTesting.JourneyObservationsArtifact['checks'] {
  if (selected === undefined) {
    return []
  }
  return journeys?.checks.filter(check =>
    check.status === 'passed' && check.renders.some(render =>
      render.renderId === selected.renderId
      && render.sourcePath === selected.path
      && render.sourceVersion === selected.sourceVersion
    )
  ) ?? []
}

function milliseconds(value: number): string {
  return `${value.toFixed(1)} ms`
}
