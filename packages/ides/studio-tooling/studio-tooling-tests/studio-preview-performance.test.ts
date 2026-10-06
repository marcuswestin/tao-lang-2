import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { StudioPreviewPerformance } from '../studio-tooling-src/StudioPreviewPerformance'

const artifactCases = [
  ['one-file app publication-on', 'one-file-app-publication-on.json'],
  ['one-file app publication-off', 'one-file-app-publication-off.json'],
  ['HNReader publication-on', 'hnreader-publication-on.json'],
  ['HNReader publication-off', 'hnreader-publication-off.json'],
  ['HNReader editor padding publication-on', 'hnreader-editor-padding-publication-on.json'],
  ['HNReader editor padding publication-off', 'hnreader-editor-padding-publication-off.json'],
] as const
const artifactCeilings = {
  'one-file app publication-on': { p50Ms: 40, p95Ms: 70 },
  'one-file app publication-off': { p50Ms: 40, p95Ms: 70 },
  'HNReader publication-on': { p50Ms: 40, p95Ms: 70 },
  'HNReader publication-off': { p50Ms: 40, p95Ms: 70 },
  'HNReader editor padding publication-on': { p50Ms: 40, p95Ms: 70 },
  'HNReader editor padding publication-off': { p50Ms: 40, p95Ms: 70 },
}
const artifactSourceCeilings = {
  'one-file app publication-on': { p50Ms: 4, p95Ms: 7 },
  'one-file app publication-off': { p50Ms: 4, p95Ms: 7 },
  'HNReader publication-on': { p50Ms: 4, p95Ms: 7 },
  'HNReader publication-off': { p50Ms: 4, p95Ms: 7 },
  'HNReader editor padding publication-on': { p50Ms: 4, p95Ms: 7 },
  'HNReader editor padding publication-off': { p50Ms: 4, p95Ms: 7 },
}

async function artifacts() {
  const root = await mkTestDir('preview-performance-artifacts')
  for (const [label, file] of artifactCases) {
    await FS.writeJson(FS.resolvePath(file, root), {
      label,
      rows: [99_999, 10, 20, 30, 40, 50, 60, 70].map((total, index) => ({
        total,
        sourceToPublished: Math.min(index, total),
      })),
    })
  }
  return root
}

async function directPaddingArtifact() {
  const root = await mkTestDir('direct-padding-performance-artifacts')
  await FS.writeJson(FS.resolvePath('hnreader-editor-padding-publication-off.json', root), {
    label: 'HNReader editor padding publication-off',
    rows: [
      { total: 99_999, sourceToDelivery: 99_000, deliveryToDom: 500, sourceToPaint: 2_000 },
      ...[800, 850, 900, 910, 920, 930, 940].map((total, index) => ({
        total,
        deliveryRevision: index + 1,
        sourceToDelivery: [400, 450, 500, 550, 560, 570, 580][index],
        deliveryToDom: 100,
        sourceToPaint: [500, 550, 600, 650, 660, 670, 680][index],
      })),
    ],
    evidence: {
      authoritativeCompletion: { status: 'compiled', compileRevision: 12, publishedRevision: 10 },
      authoritativeManifest: {
        compileRevision: 9,
        sourceVersions: { '/repo/Apps/HNReader/Design.tao': 'source-v12' },
      },
      finalSource: { path: '/repo/Apps/HNReader/Design.tao', version: 'source-v12' },
    },
  })
  return root
}

Describe('Studio preview timing ceilings', () => {
  Test('accepts exact ceilings and reports both percentiles independently', () => {
    const ceilings = { editor: { p50Ms: 10, p95Ms: 20 }, undo: { p50Ms: 5, p95Ms: 10 } }
    Expect(StudioPreviewPerformance.evaluate({ editor: [20, 10, 5], undo: [5, 5] }, ceilings)).toEqual({
      summaries: { editor: { p50Ms: 10, p95Ms: 20 }, undo: { p50Ms: 5, p95Ms: 5 } },
      breaches: [],
    })
    Expect(StudioPreviewPerformance.evaluate({ editor: [10, 11, 21], undo: [6, 6] }, ceilings).breaches).toEqual([
      { caseName: 'editor', percentile: 'p50Ms', measuredMs: 11, ceilingMs: 10 },
      { caseName: 'editor', percentile: 'p95Ms', measuredMs: 21, ceilingMs: 20 },
      { caseName: 'undo', percentile: 'p50Ms', measuredMs: 6, ceilingMs: 5 },
    ])
  })

  Test('uses the middle pair for an even sample and nearest rank for p95', () => {
    const result = StudioPreviewPerformance.evaluate({ editor: [40, 10, 30, 20] }, {
      editor: { p50Ms: 25, p95Ms: 40 },
    })
    Expect(result.summaries['editor']).toEqual({ p50Ms: 25, p95Ms: 40 })
    Expect(result.breaches).toEqual([])
  })

  Test('refuses incomplete cases and invalid measurement data', () => {
    const ceilings = { editor: { p50Ms: 10, p95Ms: 20 } }
    Expect(() => StudioPreviewPerformance.evaluate<string>({}, ceilings)).toThrow('exactly the calibrated cases')
    Expect(() => StudioPreviewPerformance.evaluate<string>({ other: [1] }, ceilings)).toThrow(
      'exactly the calibrated cases',
    )
    for (const values of [[], [NaN], [Infinity], [-1]]) {
      Expect(() => StudioPreviewPerformance.evaluate({ editor: values }, ceilings)).toThrow('nonempty, finite')
    }
    Expect(() => StudioPreviewPerformance.evaluate({}, {})).toThrow('calibrated case ceilings')
    Expect(() => StudioPreviewPerformance.evaluate({ editor: [1] }, { editor: { p50Ms: 0, p95Ms: 20 } }))
      .toThrow('positive and ordered')
    Expect(() => StudioPreviewPerformance.evaluate({ editor: [1] }, { editor: { p50Ms: 20, p95Ms: 10 } }))
      .toThrow('positive and ordered')
  })

  Test(
    'qualifies six canonical artifacts using warm total and source timings, preserving the budget report',
    async () => {
      const root = await artifacts()
      Expect(StudioPreviewPerformance.cases).toEqual([
        'one-file app publication-on',
        'one-file app publication-off',
        'HNReader publication-on',
        'HNReader publication-off',
        'HNReader editor padding publication-on',
        'HNReader editor padding publication-off',
      ])
      Expect(await StudioPreviewPerformance.evaluateArtifacts(root, artifactCeilings, artifactSourceCeilings)).toEqual(
        [],
      )
      const report = await FS.readJson<{
        cases: Record<string, string>
        ceilings: Record<string, { p50Ms: number; p95Ms: number }>
        samples: Record<string, number[]>
        summaries: Record<string, { p50Ms: number; p95Ms: number }>
        sourceSamples: Record<string, number[]>
        sourceSummaries: Record<string, { p50Ms: number; p95Ms: number }>
        sourceCeilings: Record<string, { p50Ms: number; p95Ms: number }>
        breaches: unknown[]
      }>(FS.resolvePath('preview-budget.json', root))
      Expect(Object.keys(report.cases)).toHaveLength(6)
      Expect(report.ceilings).toEqual(artifactCeilings)
      Expect(report.samples['HNReader editor padding publication-off']).toEqual([10, 20, 30, 40, 50, 60, 70])
      Expect(report.summaries['HNReader editor padding publication-off']).toEqual({ p50Ms: 40, p95Ms: 70 })
      Expect(report.sourceSamples['HNReader editor padding publication-off']).toEqual([1, 2, 3, 4, 5, 6, 7])
      Expect(report.sourceSummaries['HNReader editor padding publication-off']).toEqual({ p50Ms: 4, p95Ms: 7 })
      Expect(report.sourceCeilings).toEqual(artifactSourceCeilings)
      Expect(report.breaches).toEqual([])
    },
  )

  Test('writes breach evidence before returning a failing qualification', async () => {
    const root = await artifacts()
    const breaches = await StudioPreviewPerformance.evaluateArtifacts(root, {
      ...artifactCeilings,
      'HNReader publication-on': { p50Ms: 39, p95Ms: 69 },
    }, artifactSourceCeilings)
    Expect(breaches).toEqual([
      { caseName: 'HNReader publication-on', percentile: 'p50Ms', measuredMs: 40, ceilingMs: 39, stage: 'total' },
      { caseName: 'HNReader publication-on', percentile: 'p95Ms', measuredMs: 70, ceilingMs: 69, stage: 'total' },
    ])
    const report = await FS.readJson<{ breaches: unknown[] }>(FS.resolvePath('preview-budget.json', root))
    Expect(report.breaches).toEqual(breaches)
  })

  Test('fails and records source breaches when total latency remains within its ceilings', async () => {
    const root = await artifacts()
    const path = FS.resolvePath('hnreader-publication-on.json', root)
    const artifact = await FS.readJson<{ rows: Array<{ total: number; sourceToPublished: number }> }>(path)
    artifact.rows = artifact.rows.map((row, index) => ({
      ...row,
      sourceToPublished: index === 0 ? 0 : row.total - 1,
    }))
    await FS.writeJson(path, artifact)
    const sourceCeilings = {
      ...artifactSourceCeilings,
      'HNReader publication-on': { p50Ms: 30, p95Ms: 60 },
    }
    const breaches = await StudioPreviewPerformance.evaluateArtifacts(root, artifactCeilings, sourceCeilings)
    Expect(breaches).toEqual([
      {
        caseName: 'HNReader publication-on',
        percentile: 'p50Ms',
        measuredMs: 39,
        ceilingMs: 30,
        stage: 'sourceToPublished',
      },
      {
        caseName: 'HNReader publication-on',
        percentile: 'p95Ms',
        measuredMs: 69,
        ceilingMs: 60,
        stage: 'sourceToPublished',
      },
    ])
    const report = await FS.readJson<{
      summaries: Record<string, { p50Ms: number; p95Ms: number }>
      sourceSummaries: Record<string, { p50Ms: number; p95Ms: number }>
      breaches: unknown[]
    }>(FS.resolvePath('preview-budget.json', root))
    Expect(report.summaries['HNReader publication-on']).toEqual({ p50Ms: 40, p95Ms: 70 })
    Expect(report.sourceSummaries['HNReader publication-on']).toEqual({ p50Ms: 39, p95Ms: 69 })
    Expect(report.breaches).toEqual(breaches)
  })

  Test('refuses missing, mislabeled, incomplete, and invalid timing artifacts', async () => {
    const missing = await artifacts()
    await FS.remove(FS.resolvePath('hnreader-editor-padding-publication-off.json', missing))
    await Expect(StudioPreviewPerformance.evaluateArtifacts(missing, artifactCeilings, artifactSourceCeilings))
      .rejects.toThrow()
    for (
      const invalid of [
        { label: 'wrong label', rows: Array.from({ length: 8 }, () => ({ total: 1, sourceToPublished: 1 })) },
        {
          label: 'one-file app publication-on',
          rows: Array.from({ length: 7 }, () => ({ total: 1, sourceToPublished: 1 })),
        },
        {
          label: 'one-file app publication-on',
          rows: [{ total: 1, sourceToPublished: 1 }, ...Array.from({ length: 7 }, () => ({}))],
        },
        {
          label: 'one-file app publication-on',
          rows: Array.from({ length: 8 }, () => ({ total: -1, sourceToPublished: 0 })),
        },
        {
          label: 'one-file app publication-on',
          rows: Array.from({ length: 8 }, () => ({ total: '1', sourceToPublished: 0 })),
        },
        { label: 'one-file app publication-on', rows: Array.from({ length: 8 }, () => ({ total: 1 })) },
        {
          label: 'one-file app publication-on',
          rows: Array.from({ length: 8 }, () => ({ total: 1, sourceToPublished: -1 })),
        },
        {
          label: 'one-file app publication-on',
          rows: Array.from({ length: 8 }, () => ({ total: 1, sourceToPublished: 2 })),
        },
      ]
    ) {
      const root = await artifacts()
      await FS.writeJson(FS.resolvePath('one-file-app-publication-on.json', root), invalid)
      await Expect(StudioPreviewPerformance.evaluateArtifacts(root, artifactCeilings, artifactSourceCeilings))
        .rejects.toThrow()
      Expect(await FS.exists(FS.resolvePath('preview-budget.json', root))).toBe(false)
    }
  })

  Test('refuses to qualify without quiet-machine calibration or all six ceilings', async () => {
    const root = await artifacts()
    await Expect(StudioPreviewPerformance.evaluateArtifacts(root, undefined, artifactSourceCeilings)).rejects.toThrow(
      'quiet-machine calibrated ceilings',
    )
    await Expect(StudioPreviewPerformance.evaluateArtifacts(root, artifactCeilings, undefined)).rejects.toThrow(
      'quiet-machine calibrated source ceilings',
    )
    const incomplete = { ...artifactCeilings }
    delete (incomplete as Partial<typeof artifactCeilings>)['HNReader publication-off']
    await Expect(StudioPreviewPerformance.evaluateArtifacts(root, incomplete, artifactSourceCeilings)).rejects.toThrow(
      'all six canonical cases',
    )
    const incompleteSources = { ...artifactSourceCeilings }
    delete (incompleteSources as Partial<typeof artifactSourceCeilings>)['HNReader publication-off']
    await Expect(StudioPreviewPerformance.evaluateArtifacts(root, artifactCeilings, incompleteSources)).rejects.toThrow(
      'all six canonical cases',
    )
    Expect(await FS.exists(FS.resolvePath('preview-budget.json', root))).toBe(false)
  })

  Test('qualifies actual direct padding stages and writes a stage-specific budget', async () => {
    const root = await directPaddingArtifact()
    Expect(await StudioPreviewPerformance.evaluateDirectArtifacts(root)).toEqual([])
    const report = await FS.readJson<{
      label: string
      ceilings: typeof StudioPreviewPerformance.directPaddingCeilings
      samples: Record<string, number[]>
      summaries: Record<string, { p50Ms: number; p95Ms: number }>
      maxDeliveryRevision: number
      authoritativeCompletion: { status: string; compileRevision: number }
      authoritativeManifest: { compileRevision: number; sourceVersions: Record<string, string> }
      finalSource: { path: string; version: string }
      breaches: unknown[]
    }>(FS.resolvePath('direct-padding-budget.json', root))
    Expect(report.label).toBe('HNReader editor padding publication-off')
    Expect(report.ceilings).toEqual({
      total: { p50Ms: 950, p95Ms: 1125 },
      sourceToDelivery: { p50Ms: 600, p95Ms: 800 },
    })
    Expect(report.samples['sourceToDelivery']).toEqual([400, 450, 500, 550, 560, 570, 580])
    Expect(report.summaries['total']).toEqual({ p50Ms: 910, p95Ms: 940 })
    Expect(report.summaries['sourceToDelivery']).toEqual({ p50Ms: 550, p95Ms: 580 })
    Expect(report.authoritativeCompletion).toEqual({
      status: 'compiled',
      compileRevision: 12,
      publishedRevision: 10,
    })
    Expect(report.maxDeliveryRevision).toBe(7)
    Expect(report.authoritativeManifest.compileRevision).toBe(9)
    Expect(report.finalSource).toEqual({ path: '/repo/Apps/HNReader/Design.tao', version: 'source-v12' })
    Expect(report.breaches).toEqual([])
  })

  Test('writes independent total and source-to-delivery breaches', async () => {
    const totalRoot = await directPaddingArtifact()
    const totalPath = FS.resolvePath('hnreader-editor-padding-publication-off.json', totalRoot)
    const totalArtifact = await FS.readJson<{ rows: Array<Record<string, unknown>> }>(totalPath)
    totalArtifact.rows = totalArtifact.rows.map((row, index) =>
      index === 0 ? row : {
        ...row,
        total: 1_200,
        sourceToDelivery: 500,
        deliveryToDom: 100,
        sourceToPaint: 600,
      }
    )
    await FS.writeJson(totalPath, totalArtifact)
    const totalBreaches = await StudioPreviewPerformance.evaluateDirectArtifacts(totalRoot)
    Expect(totalBreaches).toEqual([
      {
        caseName: 'HNReader editor padding publication-off',
        percentile: 'p50Ms',
        measuredMs: 1200,
        ceilingMs: 950,
        stage: 'total',
      },
      {
        caseName: 'HNReader editor padding publication-off',
        percentile: 'p95Ms',
        measuredMs: 1200,
        ceilingMs: 1125,
        stage: 'total',
      },
    ])

    const deliveryRoot = await directPaddingArtifact()
    const deliveryPath = FS.resolvePath('hnreader-editor-padding-publication-off.json', deliveryRoot)
    const deliveryArtifact = await FS.readJson<{ rows: Array<Record<string, unknown>> }>(deliveryPath)
    deliveryArtifact.rows = deliveryArtifact.rows.map((row, index) =>
      index === 0 ? row : {
        ...row,
        total: 900,
        sourceToDelivery: 850,
        deliveryToDom: 25,
        sourceToPaint: 890,
      }
    )
    await FS.writeJson(deliveryPath, deliveryArtifact)
    const deliveryBreaches = await StudioPreviewPerformance.evaluateDirectArtifacts(deliveryRoot)
    Expect(deliveryBreaches).toEqual([
      {
        caseName: 'HNReader editor padding publication-off',
        percentile: 'p50Ms',
        measuredMs: 850,
        ceilingMs: 600,
        stage: 'sourceToDelivery',
      },
      {
        caseName: 'HNReader editor padding publication-off',
        percentile: 'p95Ms',
        measuredMs: 850,
        ceilingMs: 800,
        stage: 'sourceToDelivery',
      },
    ])
    const budget = await FS.readJson<{ breaches: unknown[] }>(
      FS.resolvePath('direct-padding-budget.json', deliveryRoot),
    )
    Expect(budget.breaches).toEqual(deliveryBreaches)
  })

  Test('accepts cold publication fallback while requiring direct publication-off warm rows', async () => {
    const root = await directPaddingArtifact()
    const path = FS.resolvePath('hnreader-editor-padding-publication-off.json', root)
    const artifact = await FS.readJson<{ rows: Array<Record<string, unknown>> }>(path)
    artifact.rows[0] = { ...artifact.rows[0], sourceToPublished: 99_999 }
    await FS.writeJson(path, artifact)
    Expect(await StudioPreviewPerformance.evaluateDirectArtifacts(root)).toEqual([])

    artifact.rows[1] = { ...artifact.rows[1], sourceToPublished: 800 }
    await FS.writeJson(path, artifact)
    await Expect(StudioPreviewPerformance.evaluateDirectArtifacts(root)).rejects.toThrow(
      'omit source-to-publication timings',
    )
  })

  Test('refuses missing, fallback, incomplete, and unauthoritative direct padding evidence', async () => {
    const missing = await directPaddingArtifact()
    await FS.remove(FS.resolvePath('hnreader-editor-padding-publication-off.json', missing))
    await Expect(StudioPreviewPerformance.evaluateDirectArtifacts(missing)).rejects.toThrow()

    const base = await directPaddingArtifact()
    const path = FS.resolvePath('hnreader-editor-padding-publication-off.json', base)
    const original = await FS.readJson<Record<string, unknown>>(path)
    const cases = [
      { ...original, label: 'HNReader editor padding publication-on' },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map(row => ({
          ...row,
          sourceToPublished: row['total'],
        })),
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 2
            ? { ...row, sourceToDelivery: undefined }
            : row
        ),
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 3
            ? { ...row, sourceToDelivery: -1 }
            : row
        ),
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 3
            ? { ...row, sourceToPaint: undefined }
            : row
        ),
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 4
            ? { ...row, deliveryToDom: row['total'] as number + 1 }
            : row
        ),
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 4
            ? {
              ...row,
              sourceToPaint: (row['sourceToDelivery'] as number) + (row['deliveryToDom'] as number) - 2,
            }
            : row
        ),
      },
      { ...original, evidence: {} },
      {
        ...original,
        evidence: { authoritativeCompletion: { status: 'pending', compileRevision: 8 } },
      },
      {
        ...original,
        evidence: { authoritativeCompletion: { status: 'compiled', compileRevision: 0 } },
      },
      {
        ...original,
        evidence: {
          authoritativeCompletion: { status: 'compiled', compileRevision: 12, publishedRevision: 'invalid' },
        },
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 2
            ? { ...row, deliveryRevision: 0 }
            : row
        ),
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 3
            ? { ...row, deliveryRevision: 'stale' }
            : row
        ),
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 3
            ? { ...row, deliveryRevision: 2 }
            : row
        ),
      },
      {
        ...original,
        rows: (original['rows'] as Array<Record<string, unknown>>).map((row, index) =>
          index === 3
            ? { ...row, deliveryRevision: 1 }
            : row
        ),
      },
      {
        ...original,
        evidence: {
          ...(original['evidence'] as Record<string, unknown>),
          authoritativeCompletion: { status: 'compiled', compileRevision: 8 },
        },
      },
      {
        ...original,
        evidence: {
          ...(original['evidence'] as Record<string, unknown>),
          authoritativeManifest: {
            compileRevision: 7,
            sourceVersions: { '/repo/Apps/HNReader/Design.tao': 'source-v12' },
          },
        },
      },
      {
        ...original,
        evidence: {
          ...(original['evidence'] as Record<string, unknown>),
          authoritativeManifest: {
            compileRevision: 13,
            sourceVersions: { '/repo/Apps/HNReader/Design.tao': 'source-v12' },
          },
        },
      },
      {
        ...original,
        evidence: {
          ...(original['evidence'] as Record<string, unknown>),
          authoritativeManifest: {
            compileRevision: 9,
            sourceVersions: { '/repo/Apps/HNReader/Design.tao': 'newer-source' },
          },
        },
      },
      {
        ...original,
        evidence: {
          ...(original['evidence'] as Record<string, unknown>),
          finalSource: { path: 'Apps/HNReader/Design.tao', version: 'source-v12' },
        },
      },
      {
        ...original,
        evidence: {
          ...(original['evidence'] as Record<string, unknown>),
          authoritativeCompletion: { status: 'compiled', compileRevision: 12, publishedRevision: 8 },
        },
      },
    ]
    for (const invalid of cases) {
      const root = await directPaddingArtifact()
      await FS.writeJson(FS.resolvePath('hnreader-editor-padding-publication-off.json', root), invalid)
      await Expect(StudioPreviewPerformance.evaluateDirectArtifacts(root)).rejects.toThrow()
      Expect(await FS.exists(FS.resolvePath('direct-padding-budget.json', root))).toBe(false)
    }
  })
})
