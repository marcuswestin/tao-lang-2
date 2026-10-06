import { Describe, Expect, Test } from '@shared/test'
import { computeStudioDesignPaddingDelta } from '../compiler-src/studio-design-delta'

Describe('compiler: Studio design padding delta', () => {
  Test('finds one scalar pad edit in an arbitrarily named legacy design', () => {
    const before = `design Palette { card [bg paper, pad 8, radius 4] }`
    const after = `design Palette { card [bg paper, pad 120, radius 4] }`
    const delta = computeStudioDesignPaddingDelta(before, after)

    Expect(delta).toMatchObject({
      designName: 'Palette',
      bundleName: 'card',
      expectedPadding: 8,
      padding: 120,
      entryIndex: 1,
      ownerKind: 'legacy',
      oldLiteralRange: { from: before.indexOf('8, radius'), to: before.indexOf('8, radius') + 1 },
      newLiteralRange: { from: after.indexOf('120, radius'), to: after.indexOf('120, radius') + 3 },
      oldSpecRange: { from: before.indexOf('['), to: before.indexOf(']') + 1 },
      newSpecRange: { from: after.indexOf('['), to: after.indexOf(']') + 1 },
    })
    Expect(Object.isFrozen(delta)).toBe(true)
    Expect(Object.isFrozen(delta?.oldLiteralRange)).toBe(true)
  })

  Test('finds structured styles and text owners while retaining shifted source spans', () => {
    const stylesBefore = `project design Theme { styles { compact [pad 9] } }`
    const stylesAfter = `project design Theme { styles { compact [pad 144] } }`
    const stylesDelta = computeStudioDesignPaddingDelta(stylesBefore, stylesAfter)
    Expect(stylesDelta).toMatchObject({
      designName: 'Theme',
      bundleName: 'compact',
      expectedPadding: 9,
      padding: 144,
      ownerKind: 'styles',
      oldLiteralRange: { from: stylesBefore.indexOf('9]'), to: stylesBefore.indexOf('9]') + 1 },
      newLiteralRange: { from: stylesAfter.indexOf('144]'), to: stylesAfter.indexOf('144]') + 3 },
      newSpecRange: { from: stylesAfter.indexOf('['), to: stylesAfter.indexOf(']') + 1 },
    })

    const textBefore = `design Copy { text { Caption [pad 10] } }`
    const textAfter = `design Copy { text { Caption [pad 11] } }`
    Expect(computeStudioDesignPaddingDelta(textBefore, textAfter)).toMatchObject({
      designName: 'Copy',
      bundleName: 'Caption',
      ownerKind: 'text',
    })
  })

  Test('rejects modifier, condition, value-reference, and non-finite padding candidates', () => {
    for (
      const [before, after] of [
        [`design D { card [pad left 8] }`, `design D { card [pad left 12] }`],
        [`design D { card [pad 8 when Scheme is Dark] }`, `design D { card [pad 12 when Scheme is Dark] }`],
        [`design D { card [pad spacing] }`, `design D { card [pad 12] }`],
        [`design D { card [pad 8] }`, `design D { card [pad 1e999] }`],
        [`design D { card [pad 8] }`, `design D { card [pad -1] }`],
      ] as const
    ) {
      Expect(computeStudioDesignPaddingDelta(before, after)).toBeUndefined()
    }
  })

  Test('rejects duplicate design or bundle names and multiple edits', () => {
    Expect(computeStudioDesignPaddingDelta(
      `design D { card [pad 8] } design D { other [pad 4] }`,
      `design D { card [pad 9] } design D { other [pad 4] }`,
    )).toBeUndefined()
    Expect(computeStudioDesignPaddingDelta(
      `design D { card [pad 8] styles { card [pad 3] } }`,
      `design D { card [pad 9] styles { card [pad 3] } }`,
    )).toBeUndefined()
    Expect(computeStudioDesignPaddingDelta(
      `design D { card [pad 8] row [pad 4] }`,
      `design D { card [pad 9] row [pad 5] }`,
    )).toBeUndefined()
  })

  Test('rejects edits to comments, imports, or malformed Tao syntax', () => {
    Expect(computeStudioDesignPaddingDelta(
      `// before\ndesign D { card [pad 8] }`,
      `// changed\ndesign D { card [pad 9] }`,
    )).toBeUndefined()
    Expect(computeStudioDesignPaddingDelta(
      `use A from ./A\ndesign D { card [pad 8] }`,
      `use B from ./A\ndesign D { card [pad 9] }`,
    )).toBeUndefined()
    Expect(computeStudioDesignPaddingDelta(
      `design D { card [pad 8] }`,
      `design D { card [pad 9 `,
    )).toBeUndefined()
  })
})
