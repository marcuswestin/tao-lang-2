import { Expect, Test } from '@shared/test'
import { DesignControls, type TaoStudioDesignPaddingUpdate } from '../TaoRuntime-src/TR-design'

Test('a Studio padding overlay keeps its publication and yields to an authoritative declaration', async () => {
  const designPath = '/project/StudioPadding.tao'
  const consumerPath = '/project/StudioPaddingView.tao'
  const identity = 'test.design.studio-padding'
  const metadata = { epoch: 7, path: designPath, sourceEpochs: { [consumerPath]: 7 } }
  const source = { end: 20, epoch: 7, kind: 'style' as const, member: 'storyCard', path: designPath, start: 1 }
  const original = DesignControls.Declaration(
    {
      bundles: {
        storyCard: DesignControls.Spec([['pad', 8], ['bg', 'paper']], source),
      },
      name: 'StudioPadding',
      tokens: { paper: '#ffffff' },
    },
    identity,
    metadata,
  )
  const notifications: number[] = []
  const unsubscribe = DesignControls.subscribe(original, () => {
    notifications.push(DesignControls.revision(original))
  })

  try {
    Expect(DesignControls.patchStudioPadding(paddingUpdate({
      designName: 'StudioPadding',
      oldSpecRange: { from: 1, to: 20 },
      newSpecRange: { from: 1, to: 21 },
      oldLiteralRange: { from: 10, to: 11 },
      newLiteralRange: { from: 10, to: 12 },
      padding: 14,
    }))).toBe(true)
    const overlay = DesignControls.current(original)
    Expect(DesignControls.revision(original)).toBe(2)
    Expect(overlay).not.toBe(original)
    Expect(DesignControls.current(overlay)).toBe(overlay)
    Expect(original.bundles['storyCard']!.entries).toEqual([['pad', 8], ['bg', 'paper']])
    Expect(overlay!.bundles['storyCard']!.source).toEqual({ ...source, end: 21 })
    const resolvedOverlay = DesignControls.resolve(overlay, DesignControls.Spec([['storyCard']]))
    Expect(resolvedOverlay.style).toEqual({ backgroundColor: '#ffffff' })
    Expect(resolvedOverlay.layout?.entries).toEqual([['pad', 14]])
    await Promise.resolve()
    Expect(notifications).toEqual([2])
    Expect(DesignControls.forSource(original, {
      designEpochs: { [designPath]: 7 },
      epoch: 7,
      kind: 'style',
      path: consumerPath,
    })).toBe(original)

    const futureSource = { designEpochs: { [designPath]: 8 }, epoch: 8, kind: 'style' as const, path: consumerPath }
    const futureCohort = DesignControls.Cohort(futureSource)
    let pending: unknown
    try {
      DesignControls.forSource(original, { ...futureSource, cohort: futureCohort })
    } catch (error) {
      pending = error
    }
    Expect(pending instanceof Promise).toBe(true)

    const authoritative = DesignControls.Declaration(
      {
        bundles: { storyCard: DesignControls.Spec([['pad', 18], ['bg', 'paper']], source) },
        name: 'StudioPadding',
        tokens: { paper: '#ffffff' },
      },
      identity,
      { epoch: 8, path: designPath, sourceEpochs: { [consumerPath]: 8 } },
    )
    Expect(DesignControls.current(original)).toBe(authoritative)
    Expect(DesignControls.forSource(original, { ...futureSource, cohort: futureCohort })).toBe(authoritative)
    const resolvedAuthoritative = DesignControls.resolve(authoritative, DesignControls.Spec([['storyCard']]))
    Expect(resolvedAuthoritative.style).toEqual({ backgroundColor: '#ffffff' })
    Expect(resolvedAuthoritative.layout?.entries).toEqual([['pad', 18]])
    await Promise.resolve()
    Expect(notifications).toEqual([2, 3])
  } finally {
    unsubscribe()
  }
})

Test('Studio padding rejects stale, ambiguous, and missing pad matches without publishing', () => {
  const cases = [
    { name: 'StalePadding', entries: [['pad', 8]] as const, expectedPadding: 6 },
    { name: 'MissingPadding', entries: [['bg', '#fff']] as const, expectedPadding: 8 },
    { name: 'WrongIndexPadding', entries: [['bg', '#fff'], ['pad', 8]] as const, expectedPadding: 8, entryIndex: 0 },
  ]
  for (const [index, item] of cases.entries()) {
    const sourcePath = `/project/${item.name}.tao`
    const source = { end: 20, kind: 'style' as const, member: 'storyCard', path: sourcePath, start: 1 }
    const original = DesignControls.Declaration(
      {
        bundles: { storyCard: DesignControls.Spec(item.entries, source) },
        name: item.name,
        tokens: {},
      },
      `test.design.studio-padding.reject-${index}`,
      { epoch: 1, path: sourcePath, sourceEpochs: {} },
    )
    const request = paddingUpdate({
      designName: item.name,
      sourcePath,
      expectedPadding: item.expectedPadding,
      entryIndex: item.entryIndex ?? 0,
      oldSpecRange: { from: 1, to: 20 },
      newSpecRange: { from: 1, to: 20 },
      oldLiteralRange: { from: 10, to: 11 },
      newLiteralRange: { from: 10, to: 11 },
    })
    Expect(DesignControls.patchStudioPadding(request)).toBe(false)
    Expect(DesignControls.current(original)).toBe(original)
    Expect(DesignControls.revision(original)).toBe(1)
  }
})

Test('Studio padding shifts source provenance immutably and accepts a later edit', () => {
  const sourcePath = '/project/PaddingWidths.tao'
  const source = (member: string, start: number, end: number) => ({
    end,
    kind: 'style' as const,
    member,
    path: sourcePath,
    start,
  })
  const original = DesignControls.Declaration(
    {
      bundles: {
        beforeCard: DesignControls.Spec([['bg', '#fff']], source('beforeCard', 0, 10)),
        laterCard: DesignControls.Spec([['gap', 4]], source('laterCard', 30, 40)),
        storyCard: DesignControls.Spec([['pad', 8]], source('storyCard', 1, 20)),
      },
      name: 'PaddingWidths',
      sources: {
        beforeCard: source('beforeCard', 0, 10),
        laterCard: source('laterCard', 30, 40),
        storyCard: source('storyCard', 1, 20),
      },
      tokens: {},
    },
    'test.design.studio-padding.widths',
    { epoch: 1, path: sourcePath, sourceEpochs: {} },
  )

  const first = DesignControls.patchStudioPadding(paddingUpdate({
    designName: 'PaddingWidths',
    sourcePath,
    expectedPadding: 8,
    padding: 120,
    oldSpecRange: { from: 1, to: 20 },
    newSpecRange: { from: 1, to: 22 },
    oldLiteralRange: { from: 10, to: 11 },
    newLiteralRange: { from: 10, to: 13 },
  }))
  Expect(first).toBe(true)
  const overlay = DesignControls.current(original)!
  Expect(original.bundles['storyCard']!.entries).toEqual([['pad', 8]])
  Expect(original.sources?.['laterCard']).toEqual(source('laterCard', 30, 40))
  Expect(overlay.bundles['storyCard']!.entries).toEqual([['pad', 120]])
  Expect(overlay.bundles['storyCard']!.source).toEqual(source('storyCard', 1, 22))
  Expect(overlay.sources?.['beforeCard']).toEqual(source('beforeCard', 0, 10))
  Expect(overlay.sources?.['laterCard']).toEqual(source('laterCard', 32, 42))

  Expect(DesignControls.patchStudioPadding(paddingUpdate({
    designName: 'PaddingWidths',
    sourcePath,
    expectedPadding: 120,
    padding: 4,
    oldSpecRange: { from: 1, to: 22 },
    newSpecRange: { from: 1, to: 20 },
    oldLiteralRange: { from: 10, to: 13 },
    newLiteralRange: { from: 10, to: 11 },
  }))).toBe(true)
  const secondOverlay = DesignControls.current(original)!
  Expect(secondOverlay.bundles['storyCard']!.entries).toEqual([['pad', 4]])
  Expect(secondOverlay.sources?.['laterCard']).toEqual(source('laterCard', 30, 40))
  Expect(overlay.bundles['storyCard']!.entries).toEqual([['pad', 120]])
})

Test('Studio padding refuses mismatched source identity and malformed source ranges', () => {
  const sourcePath = '/project/PaddingIdentity.tao'
  const source = { end: 20, kind: 'style' as const, member: 'storyCard', path: sourcePath, start: 1 }
  const original = DesignControls.Declaration(
    {
      bundles: { storyCard: DesignControls.Spec([['pad', 8]], source) },
      name: 'PaddingIdentity',
      sources: { storyCard: source },
      tokens: {},
    },
    'test.design.studio-padding.identity',
    { epoch: 1, path: sourcePath, sourceEpochs: {} },
  )
  const valid = paddingUpdate({
    designName: 'PaddingIdentity',
    sourcePath,
    oldSpecRange: { from: 1, to: 20 },
    newSpecRange: { from: 1, to: 20 },
    oldLiteralRange: { from: 10, to: 11 },
    newLiteralRange: { from: 10, to: 11 },
  })
  for (
    const invalid of [
      { ...valid, sourcePath: '/project/Other.tao' },
      { ...valid, ownerKind: 'text' as const },
      { ...valid, oldSpecRange: { from: 2, to: 20 } },
      { ...valid, newSpecRange: { from: 1, to: 21 } },
      { ...valid, oldLiteralRange: { from: 9, to: 11 } },
      { ...valid, padding: -1 },
    ]
  ) {
    Expect(DesignControls.patchStudioPadding(invalid)).toBe(false)
    Expect(DesignControls.current(original)).toBe(original)
  }
  const wrongMember = DesignControls.Declaration(
    {
      bundles: {
        storyCard: DesignControls.Spec([['pad', 8]], { ...source, member: 'otherCard' }),
      },
      name: 'PaddingWrongMember',
      tokens: {},
    },
    'test.design.studio-padding.wrong-member',
    { epoch: 1, path: sourcePath, sourceEpochs: {} },
  )
  Expect(DesignControls.patchStudioPadding({ ...valid, designName: 'PaddingWrongMember' })).toBe(false)
  Expect(DesignControls.current(wrongMember)).toBe(wrongMember)

  const duplicateDefinition = {
    bundles: { storyCard: DesignControls.Spec([['pad', 8]], source) },
    name: 'PaddingDuplicateIdentity',
    tokens: {},
  }
  const duplicateA = DesignControls.Declaration(
    duplicateDefinition,
    'test.design.studio-padding.duplicate-a',
    { epoch: 1, path: sourcePath, sourceEpochs: {} },
  )
  const duplicateB = DesignControls.Declaration(
    duplicateDefinition,
    'test.design.studio-padding.duplicate-b',
    { epoch: 1, path: sourcePath, sourceEpochs: {} },
  )
  Expect(DesignControls.patchStudioPadding({ ...valid, designName: 'PaddingDuplicateIdentity' })).toBe(false)
  Expect(DesignControls.current(duplicateA)).toBe(duplicateA)
  Expect(DesignControls.current(duplicateB)).toBe(duplicateB)
})

Test('Studio padding rejects forged spans and ambiguous owner membership before notification', async () => {
  const sourcePath = '/project/PaddingGuards.tao'
  const owner = { end: 20, kind: 'style' as const, member: 'storyCard', path: sourcePath, start: 1 }
  const original = DesignControls.Declaration(
    {
      bundles: { storyCard: DesignControls.Spec([['pad', 12]], owner) },
      name: 'PaddingGuards',
      sources: { storyCard: owner },
      tokens: {},
    },
    'test.design.studio-padding.guards',
    { epoch: 1, path: sourcePath, sourceEpochs: {} },
  )
  const notifications: number[] = []
  const unsubscribe = DesignControls.subscribe(original, () => notifications.push(DesignControls.revision(original)))
  try {
    const valid = paddingUpdate({
      designName: 'PaddingGuards',
      sourcePath,
      expectedPadding: 12,
      oldLiteralRange: { from: 10, to: 12 },
      newLiteralRange: { from: 10, to: 13 },
      oldSpecRange: { from: 1, to: 20 },
      newSpecRange: { from: 1, to: 21 },
      padding: 100,
    })
    Expect(DesignControls.patchStudioPadding({
      ...valid,
      oldLiteralRange: { from: 0, to: 2 },
      newLiteralRange: { from: 0, to: 3 },
    })).toBe(false)
    Expect(DesignControls.patchStudioPadding({
      ...valid,
      newSpecRange: { from: 1, to: 22 },
    })).toBe(false)

    Expect(DesignControls.revision(original)).toBe(1)
    await Promise.resolve()
    Expect(notifications).toEqual([])

    const ambiguousName = 'PaddingAmbiguousMembership'
    const ambiguous = DesignControls.Declaration(
      {
        bundles: { storyCard: DesignControls.Spec([['pad', 12]], owner) },
        name: ambiguousName,
        sources: { storyCard: owner, alias: owner },
        tokens: {},
      },
      'test.design.studio-padding.ambiguous-membership',
      { epoch: 1, path: sourcePath, sourceEpochs: {} },
    )
    Expect(DesignControls.patchStudioPadding({ ...valid, designName: ambiguousName })).toBe(false)
    Expect(DesignControls.current(ambiguous)).toBe(ambiguous)
    Expect(DesignControls.patchStudioPadding(valid)).toBe(true)
    Expect(DesignControls.revision(original)).toBe(2)
    await Promise.resolve()
    Expect(notifications).toEqual([2])
  } finally {
    unsubscribe()
  }
})

Test('Studio padding applies the resolved value, preserves cold parity, and reverts shifted provenance', () => {
  const sourcePath = '/project/PaddingSequence.tao'
  const source = (member: string, start: number, end: number) => ({
    end,
    kind: 'style' as const,
    member,
    path: sourcePath,
    start,
  })
  const owner = source('storyCard', 1, 20)
  const later = source('laterCard', 30, 40)
  const original = DesignControls.Declaration(
    {
      bundles: {
        laterCard: DesignControls.Spec([['gap', 4]], later),
        storyCard: DesignControls.Spec([['pad', 12], ['bg', '#fff']], owner),
      },
      name: 'PaddingSequence',
      sources: { laterCard: later, storyCard: owner },
      tokens: {},
    },
    'test.design.studio-padding.sequence',
    { epoch: 1, path: sourcePath, sourceEpochs: {} },
  )

  Expect(DesignControls.patchStudioPadding(paddingUpdate({
    designName: 'PaddingSequence',
    sourcePath,
    expectedPadding: 12,
    padding: 100,
    oldSpecRange: { from: 1, to: 20 },
    newSpecRange: { from: 1, to: 21 },
    oldLiteralRange: { from: 10, to: 12 },
    newLiteralRange: { from: 10, to: 13 },
  }))).toBe(true)
  const overlay = DesignControls.current(original)!
  const resolved = DesignControls.resolve(overlay, DesignControls.Spec([['storyCard']]))
  const cold = DesignControls.Declaration({
    bundles: {
      laterCard: DesignControls.Spec([['gap', 4]], source('laterCard', 31, 41)),
      storyCard: DesignControls.Spec([['pad', 100], ['bg', '#fff']], source('storyCard', 1, 21)),
    },
    name: 'PaddingSequence',
    sources: { laterCard: source('laterCard', 31, 41), storyCard: source('storyCard', 1, 21) },
    tokens: {},
  })
  Expect(resolved).toMatchObject(DesignControls.resolve(cold, DesignControls.Spec([['storyCard']])))
  Expect(resolved.layout?.entries).toEqual([['pad', 100]])
  Expect(original.bundles['storyCard']!.entries).toEqual([['pad', 12], ['bg', '#fff']])
  Expect(original.sources?.['laterCard']).toEqual(later)
  Expect(overlay.sources?.['laterCard']).toEqual(source('laterCard', 31, 41))

  Expect(DesignControls.patchStudioPadding(paddingUpdate({
    designName: 'PaddingSequence',
    sourcePath,
    expectedPadding: 100,
    padding: 12,
    oldSpecRange: { from: 1, to: 21 },
    newSpecRange: { from: 1, to: 20 },
    oldLiteralRange: { from: 10, to: 13 },
    newLiteralRange: { from: 10, to: 12 },
  }))).toBe(true)
  const reverted = DesignControls.current(original)!
  Expect(DesignControls.resolve(reverted, DesignControls.Spec([['storyCard']])).layout?.entries).toEqual([['pad', 12]])
  Expect(reverted.sources?.['laterCard']).toEqual(later)
  Expect(overlay.sources?.['laterCard']).toEqual(source('laterCard', 31, 41))
})

function paddingUpdate(
  overrides: Partial<TaoStudioDesignPaddingUpdate> = {},
): TaoStudioDesignPaddingUpdate {
  return {
    bundleName: 'storyCard',
    designName: 'StudioPadding',
    entryIndex: 0,
    expectedPadding: 8,
    newLiteralRange: { from: 10, to: 11 },
    newSpecRange: { from: 1, to: 20 },
    oldLiteralRange: { from: 10, to: 11 },
    oldSpecRange: { from: 1, to: 20 },
    ownerKind: 'styles',
    padding: 14,
    sourcePath: '/project/StudioPadding.tao',
    ...overrides,
  }
}
