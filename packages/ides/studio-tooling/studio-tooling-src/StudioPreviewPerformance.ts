import { Assert, FS } from '@shared'

/** Ceilings come from a quiet real-preview run and remain specific to each interaction. */
type PreviewCeiling = { p50Ms: number; p95Ms: number }
type PreviewSummary = { p50Ms: number; p95Ms: number }
type PreviewBreach = { caseName: string; percentile: 'p50Ms' | 'p95Ms'; measuredMs: number; ceilingMs: number }
type ArtifactPreviewBreach = PreviewBreach & { stage: 'total' | 'sourceToPublished' | 'sourceToDelivery' }

const cases = [
  'one-file app publication-on',
  'one-file app publication-off',
  'HNReader publication-on',
  'HNReader publication-off',
  'HNReader editor padding publication-on',
  'HNReader editor padding publication-off',
] as const
type PreviewCase = typeof cases[number]
type PreviewCeilings = Readonly<Record<PreviewCase, PreviewCeiling>>

// Calibrated on 2026-10-05 from seven warm saves per case at load 4.43–8.47 on 18 CPUs.
// Rounded headroom covers ordinary variation; independent source ceilings protect compiler work
// when Metro delivery improves. The continuation roadmap records the samples and host conditions.
const calibratedCeilings: PreviewCeilings = {
  'one-file app publication-on': { p50Ms: 500, p95Ms: 650 },
  'one-file app publication-off': { p50Ms: 500, p95Ms: 600 },
  'HNReader publication-on': { p50Ms: 1800, p95Ms: 1975 },
  'HNReader publication-off': { p50Ms: 1100, p95Ms: 1250 },
  'HNReader editor padding publication-on': { p50Ms: 950, p95Ms: 1150 },
  'HNReader editor padding publication-off': { p50Ms: 950, p95Ms: 1125 },
}
const calibratedSourceCeilings: PreviewCeilings = {
  'one-file app publication-on': { p50Ms: 175, p95Ms: 200 },
  'one-file app publication-off': { p50Ms: 175, p95Ms: 200 },
  'HNReader publication-on': { p50Ms: 625, p95Ms: 675 },
  'HNReader publication-off': { p50Ms: 700, p95Ms: 825 },
  'HNReader editor padding publication-on': { p50Ms: 600, p95Ms: 775 },
  'HNReader editor padding publication-off': { p50Ms: 600, p95Ms: 800 },
}
const directPaddingCeilings = {
  total: { p50Ms: 950, p95Ms: 1125 },
  sourceToDelivery: { p50Ms: 600, p95Ms: 800 },
} as const

/** StudioPreviewPerformance evaluates preserved real-preview samples against supplied ceilings. */
export const StudioPreviewPerformance = {
  cases,
  ceilings: calibratedCeilings,
  sourceCeilings: calibratedSourceCeilings,
  directPaddingCeilings,
  evaluate,
  evaluateArtifacts,
  evaluateDirectArtifacts,
} as const

async function evaluateArtifacts(
  artifactRoot: string,
  ceilings: PreviewCeilings | undefined,
  sourceCeilings: PreviewCeilings | undefined,
): Promise<ArtifactPreviewBreach[]> {
  const samples: Record<string, readonly number[]> = {}
  const sourceSamples: Record<string, readonly number[]> = {}
  const paths: Record<string, string> = {}
  for (const label of cases) {
    const slug = label.replaceAll(/[^a-z0-9]+/giu, '-').toLowerCase()
    const path = FS.resolvePath(`${slug}.json`, artifactRoot)
    const report = await FS.readJson<unknown>(path)
    Assert.input(isRecord(report) && report['label'] === label, `Studio preview report ${path} must identify ${label}.`)
    const rows = report['rows']
    Assert.input(
      Array.isArray(rows) && rows.length === 8 && rows.every(isRecord),
      `Studio preview report ${path} must contain exactly eight timing rows.`,
    )
    const warm = rows.slice(1).map(row => row['total'])
    Assert.input(
      warm.every((total): total is number => typeof total === 'number' && Number.isFinite(total) && total >= 0),
      `Studio preview report ${path} must contain seven finite, nonnegative warm total durations.`,
    )
    const warmSources = rows.slice(1).map(row => row['sourceToPublished'])
    Assert.input(
      warmSources.every((source): source is number =>
        typeof source === 'number' && Number.isFinite(source) && source >= 0
      ),
      `Studio preview report ${path} must contain seven finite, nonnegative warm source-to-publication durations.`,
    )
    Assert.input(
      warmSources.every((source, index) => source <= warm[index]!),
      `Studio preview report ${path} source-to-publication durations must not exceed total durations.`,
    )
    samples[label] = warm
    sourceSamples[label] = warmSources
    paths[label] = path
  }
  Assert.input(ceilings !== undefined, 'Studio preview performance requires quiet-machine calibrated ceilings.')
  Assert.input(
    sourceCeilings !== undefined,
    'Studio preview performance requires quiet-machine calibrated source ceilings.',
  )
  Assert.input(
    Object.keys(ceilings).length === cases.length && cases.every(label => Object.hasOwn(ceilings, label)),
    'Studio preview performance ceilings must cover all six canonical cases.',
  )
  Assert.input(
    Object.keys(sourceCeilings).length === cases.length && cases.every(label => Object.hasOwn(sourceCeilings, label)),
    'Studio preview source ceilings must cover all six canonical cases.',
  )
  const result = evaluate<string>(samples, ceilings)
  const sourceResult = evaluate<string>(sourceSamples, sourceCeilings)
  const totalBreaches = result.breaches.map(breach => ({ ...breach, stage: 'total' as const }))
  const sourceBreaches = sourceResult.breaches.map(breach => ({ ...breach, stage: 'sourceToPublished' as const }))
  const breaches = [...totalBreaches, ...sourceBreaches]
  await FS.writeJson(FS.resolvePath('preview-budget.json', artifactRoot), {
    cases: paths,
    ceilings,
    samples,
    summaries: result.summaries,
    sourceSamples,
    sourceSummaries: sourceResult.summaries,
    sourceCeilings,
    breaches,
  })
  return breaches
}

async function evaluateDirectArtifacts(
  artifactRoot: string,
  ceilings = directPaddingCeilings,
): Promise<ArtifactPreviewBreach[]> {
  const label = 'HNReader editor padding publication-off'
  const slug = label.replaceAll(/[^a-z0-9]+/giu, '-').toLowerCase()
  const path = FS.resolvePath(`${slug}.json`, artifactRoot)
  const report = await FS.readJson<unknown>(path)
  Assert.input(isRecord(report) && report['label'] === label, `Studio preview report ${path} must identify ${label}.`)
  const rows = report['rows']
  Assert.input(
    Array.isArray(rows) && rows.length === 8 && rows.every(isRecord),
    `Studio preview report ${path} must contain exactly eight timing rows.`,
  )
  const evidence = report['evidence']
  Assert.input(isRecord(evidence), `Studio preview report ${path} must contain qualification evidence.`)
  const completion = evidence['authoritativeCompletion']
  Assert.input(
    isRecord(completion) && completion['status'] === 'compiled',
    `Studio preview report ${path} must contain a compiled authoritative completion receipt.`,
  )
  const completionRevision = positiveRevision(
    completion['compileRevision'],
    `Studio preview report ${path} must contain a positive authoritative compile revision.`,
  )
  const publishedRevision = completion['publishedRevision'] === undefined
    ? undefined
    : positiveRevision(
      completion['publishedRevision'],
      `Studio preview report ${path} must contain a positive published revision when present.`,
    )
  const manifest = evidence['authoritativeManifest']
  Assert.input(isRecord(manifest), `Studio preview report ${path} must contain an authoritative manifest receipt.`)
  const manifestRevision = positiveRevision(
    manifest['compileRevision'],
    `Studio preview report ${path} must contain a positive authoritative manifest revision.`,
  )
  Assert.input(
    isRecord(manifest['sourceVersions']),
    `Studio preview report ${path} authoritative manifest must contain source versions.`,
  )
  const sourceVersions = manifest['sourceVersions']
  const finalSource = evidence['finalSource']
  Assert.input(
    isRecord(finalSource) && typeof finalSource['path'] === 'string' && FS.isAbsolute(finalSource['path'])
      && typeof finalSource['version'] === 'string' && finalSource['version'].length > 0,
    `Studio preview report ${path} must identify an absolute final source path and version.`,
  )
  Assert.input(
    sourceVersions[finalSource['path']] === finalSource['version'],
    `Studio preview report ${path} authoritative manifest must include the final source version.`,
  )
  const warmRows = rows.slice(1)
  const deliveryRevisions = warmRows.map(row =>
    positiveRevision(
      row['deliveryRevision'],
      `Studio preview report ${path} must contain positive delivery revisions for all warm rows.`,
    )
  )
  Assert.input(
    deliveryRevisions.every((revision, index) => index === 0 || revision > deliveryRevisions[index - 1]!),
    `Studio preview report ${path} must contain distinct, increasing warm delivery revisions.`,
  )
  const maxDeliveryRevision = Math.max(...deliveryRevisions)
  Assert.input(
    completionRevision > maxDeliveryRevision,
    `Studio preview report ${path} authoritative completion must follow every measured delivery.`,
  )
  Assert.input(
    manifestRevision > maxDeliveryRevision && manifestRevision <= completionRevision,
    `Studio preview report ${path} authoritative manifest must follow every measured delivery and not exceed completion.`,
  )
  Assert.input(
    publishedRevision === undefined || publishedRevision >= manifestRevision,
    `Studio preview report ${path} published revision must include the authoritative manifest revision.`,
  )
  const samples = collectDirectSamples(warmRows, 'total', path)
  const deliverySamples = collectDirectSamples(warmRows, 'sourceToDelivery', path)
  const domSamples = collectDirectSamples(warmRows, 'deliveryToDom', path)
  const paintSamples = collectDirectSamples(warmRows, 'sourceToPaint', path)
  Assert.input(
    warmRows.every(row => row['sourceToPublished'] === undefined),
    `Studio preview report ${path} must omit source-to-publication timings for publication-off delivery.`,
  )
  Assert.input(
    [deliverySamples, domSamples, paintSamples].every(stageSamples =>
      stageSamples.every((duration, index) => duration <= samples[index]!)
    ),
    `Studio preview report ${path} direct delivery and paint timings must not exceed total durations.`,
  )
  Assert.input(
    paintSamples.every((paint, index) => paint + 1 >= deliverySamples[index]! + domSamples[index]!),
    `Studio preview report ${path} direct paint timings must follow delivery and DOM timing within rounding tolerance.`,
  )
  Assert.input(
    Number.isFinite(ceilings.total.p50Ms) && ceilings.total.p50Ms > 0
      && Number.isFinite(ceilings.total.p95Ms) && ceilings.total.p95Ms >= ceilings.total.p50Ms
      && Number.isFinite(ceilings.sourceToDelivery.p50Ms) && ceilings.sourceToDelivery.p50Ms > 0
      && Number.isFinite(ceilings.sourceToDelivery.p95Ms)
      && ceilings.sourceToDelivery.p95Ms >= ceilings.sourceToDelivery.p50Ms,
    'Studio direct-padding performance ceilings must be positive and ordered.',
  )
  const totalResult = evaluate({ [label]: samples }, { [label]: ceilings.total })
  const deliveryResult = evaluate({ [label]: deliverySamples }, { [label]: ceilings.sourceToDelivery })
  const totalBreaches = totalResult.breaches.map(breach => ({ ...breach, stage: 'total' as const }))
  const deliveryBreaches = deliveryResult.breaches.map(breach => ({ ...breach, stage: 'sourceToDelivery' as const }))
  const breaches = [...totalBreaches, ...deliveryBreaches]
  await FS.writeJson(FS.resolvePath('direct-padding-budget.json', artifactRoot), {
    label,
    artifact: path,
    ceilings,
    samples: {
      total: samples,
      sourceToDelivery: deliverySamples,
      deliveryToDom: domSamples,
      sourceToPaint: paintSamples,
    },
    summaries: {
      total: totalResult.summaries[label],
      sourceToDelivery: deliveryResult.summaries[label],
    },
    maxDeliveryRevision,
    authoritativeCompletion: completion,
    authoritativeManifest: manifest,
    finalSource,
    breaches,
  })
  return breaches
}

function positiveRevision(value: unknown, message: string): number {
  Assert.input(typeof value === 'number' && Number.isSafeInteger(value) && value > 0, message)
  return value
}

function collectDirectSamples(
  rows: readonly Record<string, unknown>[],
  stage: string,
  path: string,
): number[] {
  const samples = rows.map(row => row[stage])
  Assert.input(
    samples.every((duration): duration is number =>
      typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
    ),
    `Studio preview report ${path} must contain seven finite, nonnegative warm ${stage} durations.`,
  )
  return samples
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function evaluate<CaseT extends string>(
  samples: Readonly<Record<CaseT, readonly number[]>>,
  ceilings: Readonly<Record<CaseT, PreviewCeiling>>,
): { summaries: Record<string, PreviewSummary>; breaches: PreviewBreach[] } {
  const names = Object.keys(ceilings) as CaseT[]
  Assert.input(names.length > 0, 'Studio preview performance requires calibrated case ceilings.')
  Assert.input(
    Object.keys(samples).length === names.length && Object.keys(samples).every(name => Object.hasOwn(ceilings, name)),
    'Studio preview performance samples must cover exactly the calibrated cases.',
  )
  const summaries: Record<string, PreviewSummary> = {}
  const breaches: PreviewBreach[] = []
  for (const caseName of names) {
    const ceiling = ceilings[caseName]
    Assert.input(
      Number.isFinite(ceiling.p50Ms) && ceiling.p50Ms > 0 && Number.isFinite(ceiling.p95Ms)
        && ceiling.p95Ms >= ceiling.p50Ms,
      `Studio preview performance ceilings for ${caseName} must be positive and ordered.`,
    )
    const values = samples[caseName]
    Assert.input(
      Array.isArray(values) && values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0),
      `Studio preview performance samples for ${caseName} must be nonempty, finite, and nonnegative.`,
    )
    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    const summary = {
      p50Ms: sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1]!,
    }
    summaries[caseName] = summary
    for (const percentile of ['p50Ms', 'p95Ms'] as const) {
      if (summary[percentile] > ceiling[percentile]) {
        breaches.push({ caseName, percentile, measuredMs: summary[percentile], ceilingMs: ceiling[percentile] })
      }
    }
  }
  return { summaries, breaches }
}
