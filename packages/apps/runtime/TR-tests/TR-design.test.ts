import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { DesignControls } from '../TaoRuntime-src/TR-design'
import { LayoutControls } from '../TaoRuntime-src/TR-layout'
import { configuredStack } from './TR-navigation-test-fixtures'

Describe('TR design runtime', () => {
  Test('expands nested bundles in source order and folds through ordinary layout semantics', () => {
    const design = DesignControls.Declaration({
      name: 'WordFlowerDesign',
      tokens: { paper: '#f6f7f3' },
      bundles: {
        base: DesignControls.Spec([['fill'], ['content', 'top', 'stretch'], ['pad', 16]]),
        screen: DesignControls.Spec([['base'], ['bg', 'paper']]),
      },
    })

    const resolved = DesignControls.resolve(
      design,
      DesignControls.Spec([['screen'], ['claim', 2], ['width', 'max', 720], ['centered']]),
    )

    Expect(resolved.style).toEqual({ backgroundColor: '#f6f7f3' })
    Expect(LayoutControls.resolve({
      direction: 'column',
      entries: resolved.layout?.entries ?? [],
      parentDirection: 'row',
    })).toEqual({
      alignItems: 'stretch',
      alignSelf: 'center',
      flexDirection: 'column',
      flexGrow: 2,
      justifyContent: 'flex-start',
      maxWidth: 720,
      padding: 16,
    })
  })

  Test('maps the complete flat visual surface with later values winning', () => {
    const design = DesignControls.Declaration({
      name: 'Palette',
      tokens: { accent: '#2f6b4f', ink: '#121826', paper: '#fff' },
      bundles: {},
    })
    const resolved = DesignControls.resolve(
      design,
      DesignControls.Spec([
        ['bg', 'paper'],
        ['bg', 'accent'],
        ['fg', 'ink'],
        ['size', 16],
        ['weight', 700],
        ['line', 22],
        ['radius', 8],
        ['border', 'ink'],
      ]),
    )

    Expect(resolved.style).toEqual({
      backgroundColor: '#2f6b4f',
      borderColor: '#121826',
      borderRadius: 8,
      borderWidth: 1,
      color: '#121826',
      fontSize: 16,
      fontWeight: '700',
      lineHeight: 22,
    })
  })

  Test('applies exact Scheme conditions after bundle expansion without simulating browser CSS', () => {
    const design = DesignControls.Declaration({
      name: 'Adaptive',
      tokens: { dark: '#111', light: '#fff' },
      bundles: {
        surface: DesignControls.Spec([
          ['bg', 'light'],
          ['bg', 'dark', 'when', 'Scheme', 'is', 'Dark'],
        ]),
      },
    })
    const spec = DesignControls.Spec([['surface']])

    Expect(DesignControls.resolve(design, spec, undefined, 'light').style).toEqual({
      backgroundColor: '#fff',
    })
    Expect(DesignControls.resolve(design, spec, undefined, 'dark').style).toEqual({
      backgroundColor: '#111',
    })
    Expect(() =>
      DesignControls.resolve(
        design,
        DesignControls.Spec([['bg', 'dark', 'when', 'Viewport', 'is', 'Dark']]),
        undefined,
        'dark',
      )
    ).toThrow("Unsupported design condition 'bg dark when Viewport is Dark'.")
  })

  Test('resolves typed colors, sizes, defaults, and source-chain provenance', () => {
    const design = DesignControls.Declaration({
      bundles: {
        Text: DesignControls.Spec([['fg', 'canvas']]),
        card: DesignControls.Spec([['bg', 'ember.20'], ['radius', 'md'], ['pad', 'md']]),
      },
      sources: {
        Text: {
          end: 90,
          kind: 'style',
          member: 'Text',
          path: '/Theme.tao',
          start: 70,
        },
        card: { end: 140, kind: 'style', member: 'card', path: '/Theme.tao', start: 100 },
      },
      colors: {
        canvas: {
          environment: 'Scheme',
          expected: 'dark',
          kind: 'conditional',
          negative: '#fff',
          positive: { kind: 'reference', path: 'ember.20' },
        },
        'ember.20': '#f4d7c8',
      },
      name: 'Structured',
      screens: [{ below: 500, name: 'narrow' }, { name: 'wide' }],
      sizes: {
        md: {
          left: { kind: 'reference', path: 'sm' },
          right: { kind: 'dimension', unit: 'px', value: 4 },
        },
        sm: { left: { kind: 'dimension', unit: 'px', value: 8 } },
      },
      tokens: {},
    })

    const occurrence = { end: 230, kind: 'inline' as const, path: '/Main.tao', start: 220 }
    Expect(
      DesignControls.resolve(
        design,
        DesignControls.Source(DesignControls.Spec([['card']]), occurrence),
        'Text',
        'dark',
      ),
    ).toEqual({
      layout: { entries: [['pad', 12]] },
      provenance: [
        {
          chain: [
            { kind: 'element-default', member: 'Text' },
            { end: 90, kind: 'style', member: 'Text', path: '/Theme.tao', start: 70 },
          ],
          entry: ['fg', 'canvas'],
          property: 'foreground',
        },
        {
          chain: [occurrence, { end: 140, kind: 'style', member: 'card', path: '/Theme.tao', start: 100 }],
          entry: ['bg', 'ember.20'],
          property: 'background',
        },
        {
          chain: [occurrence, { end: 140, kind: 'style', member: 'card', path: '/Theme.tao', start: 100 }],
          entry: ['radius', 12],
          property: 'radius',
        },
        {
          chain: [occurrence, { end: 140, kind: 'style', member: 'card', path: '/Theme.tao', start: 100 }],
          entry: ['pad', 12],
          property: 'pad',
        },
      ],
      style: { backgroundColor: '#f4d7c8', borderRadius: 12, color: '#f4d7c8' },
    })
    Expect(design.screens).toEqual([{ below: 500, name: 'narrow' }, { name: 'wide' }])
  })

  // A `color` value is the design color name the argument or default wrote (`Tint: schemeInk`), and
  // the compiler puts that name in the read's place (`[background Tint]` -> ['bg', Tint's value]).
  Test('resolves a color value against the mounted design at render, following Scheme', () => {
    const colors = (inkDark: string) => ({
      'accent.20': '#cfe3d8',
      accent: '#2f6b4f',
      ink: '#111111',
      inkDark,
      schemeInk: {
        environment: 'Scheme' as const,
        expected: 'dark' as const,
        kind: 'conditional' as const,
        negative: { kind: 'reference' as const, path: 'ink' },
        positive: { kind: 'reference' as const, path: 'inkDark' },
      },
    })
    const light = DesignControls.Declaration({ bundles: {}, colors: colors('#eeeeee'), name: 'Light', tokens: {} })
    const night = DesignControls.Declaration({ bundles: {}, colors: colors('#f5f0e6'), name: 'Night', tokens: {} })
    const background = (design: typeof light, tint: string, scheme: 'dark' | 'light') =>
      DesignControls.resolve(design, DesignControls.Spec([['bg', tint]]), undefined, scheme).style

    Expect(background(light, 'schemeInk', 'light')).toEqual({ backgroundColor: '#111111' })
    Expect(background(light, 'schemeInk', 'dark')).toEqual({ backgroundColor: '#eeeeee' })
    // The same value mounted by another app reads that app's own design.
    Expect(background(night, 'schemeInk', 'dark')).toEqual({ backgroundColor: '#f5f0e6' })
    Expect(background(light, 'accent.20', 'light')).toEqual({ backgroundColor: '#cfe3d8' })
    const bare = DesignControls.Declaration({ bundles: {}, colors: { ink: '#000000' }, name: 'Bare', tokens: {} })
    Expect(() => background(bare, 'schemeInk', 'light')).toThrow("Design 'Bare' has no token 'schemeInk'.")
  })

  Test('fails a mounted layout occurrence whose selected design has no named size', () => {
    const design = DesignControls.Declaration({
      bundles: {},
      name: 'Sparse',
      sizes: {},
      tokens: {},
    })

    Expect(() => DesignControls.resolve(design, DesignControls.Spec([['gap', 'missing']]))).toThrow(
      "Design 'Sparse' has no size 'missing'.",
    )
  })

  Test('resolves nested layout clauses and direct overrides as one left-to-right list', () => {
    const design = DesignControls.Declaration({
      name: 'Composable',
      tokens: {},
      bundles: {
        base: DesignControls.Spec([
          ['claim', 1],
          ['width', 'fill'],
          ['aligned', 'left'],
          ['gap', 8],
          ['pad', 8],
        ]),
        override: DesignControls.Spec([
          ['claim', 2],
          ['width', 'max', 720],
          ['centered'],
          ['gap', 12],
          ['pad', 'left', 4],
        ]),
      },
    })

    const resolved = DesignControls.resolve(
      design,
      DesignControls.Spec([['base'], ['override'], ['gap', 16]]),
    )

    Expect(LayoutControls.resolve({
      entries: resolved.layout?.entries ?? [],
      parentDirection: 'row',
    })).toEqual({
      alignSelf: 'center',
      flexGrow: 2,
      gap: 16,
      maxWidth: 720,
      paddingBottom: 8,
      paddingLeft: 4,
      paddingRight: 8,
      paddingTop: 8,
    })
  })

  Test('clears a slot with `none` on every clause head, leaving the element unstyled', () => {
    const resolved = DesignControls.resolve(
      clearingDesign(),
      DesignControls.Spec([
        ['card'],
        ['bg', 'none'],
        ['border', 'none'],
        ['radius', 'none'],
        ['fg', 'none'],
        ['size', 'none'],
        ['weight', 'none'],
        ['line', 'none'],
        ['pad', 'none'],
        ['margin', 'none'],
        ['gap', 'none'],
        ['width', 'none'],
        ['height', 'none'],
      ]),
    )

    // Nothing lays out and nothing is painted, but each cleared visual slot is carried as an
    // explicit unset: the layer that set it may be another link's, merged in later.
    Expect(LayoutControls.resolve({ entries: resolved.layout?.entries ?? [] })).toEqual({})
    Expect(styleEntries(resolved.style)).toEqual([
      ['backgroundColor', undefined],
      ['borderColor', undefined],
      ['borderRadius', undefined],
      ['borderWidth', undefined],
      ['color', undefined],
      ['fontSize', undefined],
      ['fontWeight', undefined],
      ['lineHeight', undefined],
    ])
  })

  Test('clears one spacing side with `none` and keeps the sides the clause left alone', () => {
    const resolved = DesignControls.resolve(
      clearingDesign(),
      DesignControls.Spec([
        ['card'],
        ['pad', 'left', 'none'],
        ['margin', 'horizontal', 6],
        ['margin', 'horizontal', 'none'],
      ]),
    )

    Expect(LayoutControls.resolve({ entries: resolved.layout?.entries ?? [] })).toEqual({
      gap: 6,
      height: 40,
      marginBottom: 10,
      marginTop: 10,
      paddingBottom: 12,
      paddingRight: 12,
      paddingTop: 12,
      width: 320,
    })
  })

  Test('sets a slot again after `none` cleared it, and keeps `pad 0` as zero', () => {
    const resolved = DesignControls.resolve(
      clearingDesign(),
      DesignControls.Spec([
        ['card'],
        ['pad', 'none'],
        ['pad', 8],
        ['gap', 'none'],
        ['gap', 0],
        ['bg', 'none'],
        ['bg', 'ink'],
      ]),
    )

    Expect(resolved.style).toMatchObject({
      backgroundColor: '#121826',
    })
    Expect(LayoutControls.resolve({ entries: resolved.layout?.entries ?? [] })).toEqual({
      gap: 0,
      height: 40,
      margin: 10,
      // `pad 8` reopened each side the clear had closed, which is the side-by-side form.
      paddingBottom: 8,
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 8,
      width: 320,
    })
  })

  Test('refuses `none` after a clause head that names no slot to clear', () => {
    Expect(() => DesignControls.resolve(clearingDesign(), DesignControls.Spec([['fill', 'none']]))).toThrow(
      "Layout clause 'fill none' cannot clear a slot with 'none'.",
    )
  })

  Test('resolves a declaration header above the element default and below the caller clauses', () => {
    const design = DesignControls.Declaration({
      name: 'Header',
      tokens: { ink: '#121826', paper: '#f6f7f3' },
      bundles: { Card: DesignControls.Spec([['pad', 4], ['radius', 2], ['bg', 'ink']]) },
    })
    const occurrence = { end: 40, kind: 'inline' as const, path: '/Main.tao', start: 30 }

    const resolved = DesignControls.resolve(
      design,
      DesignControls.Source(DesignControls.Spec([['pad', 0]]), occurrence),
      'Card',
      'light',
      undefined,
      DesignControls.Spec([['pad', 12], ['bg', 'paper']]),
    )

    Expect(resolved.style).toEqual({ backgroundColor: '#f6f7f3', borderRadius: 2 })
    // Merging one `pad` over another keeps the sides it settles, so the caller's zero lands on all four.
    Expect(LayoutControls.resolve({ entries: resolved.layout?.entries ?? [] })).toEqual({
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
    })
    Expect(resolved.provenance).toEqual([
      { chain: [{ kind: 'element-default', member: 'Card' }], entry: ['pad', 4], property: 'pad' },
      { chain: [{ kind: 'element-default', member: 'Card' }], entry: ['radius', 2], property: 'radius' },
      { chain: [{ kind: 'element-default', member: 'Card' }], entry: ['bg', 'ink'], property: 'background' },
      { chain: [{ kind: 'declaration' }], entry: ['pad', 12], property: 'pad' },
      { chain: [{ kind: 'declaration' }], entry: ['bg', 'paper'], property: 'background' },
      { chain: [occurrence], entry: ['pad', 0], property: 'pad' },
    ])
  })

  Test('keeps the source a compiled declaration header carries instead of stamping its own', () => {
    const authored = { end: 22, kind: 'declaration' as const, member: 'Card', path: '/Card.tao', start: 10 }
    const resolved = DesignControls.resolve(
      DesignControls.Declaration({ name: 'Header', tokens: { paper: '#f6f7f3' }, bundles: {} }),
      undefined,
      undefined,
      'light',
      undefined,
      DesignControls.Spec([['bg', 'paper']], authored),
    )

    Expect(resolved.style).toEqual({ backgroundColor: '#f6f7f3' })
    Expect(resolved.provenance).toEqual([{ chain: [authored], entry: ['bg', 'paper'], property: 'background' }])
  })

  Test('checks effective incompatibilities against the actual mounted design occurrence', () => {
    const weighted = DesignControls.Spec([['weighted'], ['rigid']])
    const light = DesignControls.Declaration({
      name: 'Light',
      tokens: {},
      bundles: { weighted: DesignControls.Spec([['claim', 2]]) },
    })
    const dark = DesignControls.Declaration({
      name: 'Dark',
      tokens: {},
      bundles: { weighted: DesignControls.Spec([['fill']]) },
    })

    Expect(() => DesignControls.resolve(light, weighted)).toThrow(
      "Design entries 'claim' and 'rigid' cannot remain effective together.",
    )
    const darkLayout = DesignControls.resolve(dark, weighted).layout
    Expect(LayoutControls.resolve({ entries: darkLayout?.entries ?? [] })).toEqual({
      alignSelf: 'stretch',
      flexGrow: 1,
      flexShrink: 0,
    })
    Expect(() =>
      DesignControls.resolve(
        light,
        DesignControls.Spec([['weighted'], ['rigid'], ['compress']]),
      )
    ).not.toThrow()
  })

  Test('keeps bundle lookup mounted-design-local and reports dynamic failures', () => {
    const light = DesignControls.Declaration({
      name: 'Light',
      tokens: { surface: '#fff' },
      bundles: { panel: DesignControls.Spec([['bg', 'surface']]) },
    })
    const dark = DesignControls.Declaration({
      name: 'Dark',
      tokens: { surface: '#000' },
      bundles: { panel: DesignControls.Spec([['bg', 'surface']]) },
    })
    const panel = DesignControls.Spec([['panel']])

    Expect(DesignControls.resolve(light, panel).style).toEqual({ backgroundColor: '#fff' })
    Expect(DesignControls.resolve(dark, panel).style).toEqual({ backgroundColor: '#000' })
    Expect(() => DesignControls.resolve(undefined, panel)).toThrow(
      "Design bundle 'panel' requires a mounted app design.",
    )
  })

  Test('guards bundle cycles defensively at runtime', () => {
    const design = DesignControls.Declaration({
      name: 'Cyclic',
      tokens: {},
      bundles: {
        first: DesignControls.Spec([['second']]),
        second: DesignControls.Spec([['first']]),
      },
    })

    Expect(() => DesignControls.resolve(design, DesignControls.Spec([['first']]))).toThrow(
      "Design 'Cyclic' has a bundle cycle: first -> second -> first.",
    )
  })
})

/** Style pairs in a stable order, keeping the explicitly cleared keys a plain toEqual would hide. */
function styleEntries(style: Record<string, unknown> | undefined): (readonly [string, unknown])[] {
  return Object.entries(style ?? {}).sort(([left], [right]) => left.localeCompare(right))
}

/** One bundle setting every clearable slot, so a `none` test states only what it clears. */
Test(
  'identified designs publish isolated frozen snapshots to every subscriber and stop after unsubscribe',
  async () => {
    const declaration = (name: string, paper: string) =>
      DesignControls.Declaration({
        bundles: { Surface: DesignControls.Spec([['bg', 'paper']]) },
        name,
        tokens: { paper },
      }, `test.design.${name}`)
    const first = declaration('Alpha', '#ffffff')
    const other = declaration('Beta', '#111111')
    const revisions: number[] = []
    const otherRevisions: number[] = []
    const unsubscribeFirst = DesignControls.subscribe(first, () => revisions.push(DesignControls.revision(first)))
    const unsubscribeSecond = DesignControls.subscribe(first, () => revisions.push(DesignControls.revision(first)))
    const unsubscribeOther = DesignControls.subscribe(other, () => otherRevisions.push(DesignControls.revision(other)))
    const refreshed = declaration('Alpha', '#eeeeee')
    Expect(Object.isFrozen(first)).toBe(true)
    Expect(Object.isFrozen(refreshed)).toBe(true)
    Expect(first.tokens['paper']).toBe('#ffffff')
    Expect(DesignControls.current(first)).toBe(refreshed)
    Expect(DesignControls.current(other)).toBe(other)
    Expect(revisions).toEqual([])
    await Promise.resolve()
    Expect(revisions).toEqual([2, 2])
    Expect(otherRevisions).toEqual([])
    unsubscribeFirst()
    unsubscribeSecond()
    unsubscribeOther()
    declaration('Alpha', '#dddddd')
    Expect(revisions).toEqual([2, 2])
    const handwritten = DesignControls.Declaration({ bundles: {}, name: 'Alpha', tokens: { paper: '#000000' } })
    Expect(DesignControls.current(handwritten)).toBe(handwritten)
    Expect(DesignControls.revision(handwritten)).toBe(0)
  },
)

Test('a retained app reads the latest design and resolves its bundle after a late publication', async () => {
  const identity = 'test.design.retained'
  const original = DesignControls.Declaration({
    bundles: { Surface: DesignControls.Spec([['bg', 'paper']]) },
    name: 'Retained',
    tokens: { paper: '#ffffff' },
  }, identity)
  const updated = DesignControls.Declaration({
    bundles: { Surface: DesignControls.Spec([['bg', 'paper']]) },
    name: 'Retained',
    tokens: { paper: '#224466' },
  }, identity)
  const home = TR.Navigation.View({ name: 'Design home', render: () => null })
  const app = TR.Navigation.App({
    id: 'test.design.retained-app',
    name: 'Design app',
    version: '1.0.0',
    navigator: () => configuredStack('Design stack', home),
    auxiliaries: () => ({}),
    design: () => original,
  })
  const notifications: number[] = []
  const unsubscribe = app.subscribeDesign(() => notifications.push(app.designSnapshot()))
  try {
    Expect(app.design).toBe(updated)
    Expect(DesignControls.resolve(app.design, DesignControls.Spec([['Surface']])).style)
      .toEqual({ backgroundColor: '#224466' })
    Expect(app.designSnapshot()).toBe(2)
    DesignControls.Declaration({
      bundles: { Surface: DesignControls.Spec([['bg', 'paper']]) },
      name: 'Retained',
      tokens: { paper: '#335577' },
    }, identity)
    Expect(notifications).toEqual([])
    await Promise.resolve()
    Expect(notifications).toEqual([3])
    Expect(DesignControls.resolve(app.design, DesignControls.Spec([['Surface']])).style)
      .toEqual({ backgroundColor: '#335577' })
  } finally {
    unsubscribe()
    app.dispose()
  }
  const withoutDesign = TR.Navigation.App({
    id: 'test.design.no-design',
    name: 'No design',
    version: '1.0.0',
    navigator: () => configuredStack('None stack', home),
    auxiliaries: () => ({}),
  })
  try {
    Expect(withoutDesign.design).toBeUndefined()
    Expect(withoutDesign.designSnapshot()).toBe(0)
    const stop = withoutDesign.subscribeDesign(() => notifications.push(-1))
    stop()
    Expect(notifications).toEqual([3])
  } finally {
    withoutDesign.dispose()
  }
})

Test('design publications coalesce after a consumer finishes replacing its bundle reference', async () => {
  const identity = 'test.design.coordinated-bundle'
  const original = DesignControls.Declaration({
    bundles: { title: DesignControls.Spec([['bg', 'paper']]) },
    name: 'Coordinated',
    tokens: { paper: '#ffffff' },
  }, identity)
  let consumerBundle = 'title'
  const observed: Array<{ revision: number; style: unknown }> = []
  const unsubscribe = DesignControls.subscribe(original, () => {
    observed.push({
      revision: DesignControls.revision(original),
      style: DesignControls.resolve(DesignControls.current(original), DesignControls.Spec([[consumerBundle]])).style,
    })
  })
  try {
    const replacement = DesignControls.Declaration({
      bundles: { headline: DesignControls.Spec([['bg', 'paper']]) },
      name: 'Coordinated',
      tokens: { paper: '#224466' },
    }, identity)
    consumerBundle = 'headline'
    DesignControls.Declaration({
      bundles: { headline: DesignControls.Spec([['bg', 'paper']]) },
      name: 'Coordinated',
      tokens: { paper: '#335577' },
    }, identity)
    Expect(DesignControls.current(original)).not.toBe(replacement)
    Expect(DesignControls.revision(original)).toBe(3)
    Expect(observed).toEqual([])
    await Promise.resolve()
    Expect(observed).toEqual([{ revision: 3, style: { backgroundColor: '#335577' } }])
  } finally {
    unsubscribe()
  }
})

Test('a deferred design publication skips canceled subscribers and subscribers added afterward', async () => {
  const identity = 'test.design.deferred-membership'
  const original = DesignControls.Declaration({ bundles: {}, name: 'Membership', tokens: {} }, identity)
  const observed: string[] = []
  const unsubscribeCanceled = DesignControls.subscribe(original, () => observed.push('canceled'))
  const unsubscribeRetained = DesignControls.subscribe(original, () => observed.push('retained'))
  DesignControls.Declaration({ bundles: {}, name: 'Membership', tokens: {} }, identity)
  unsubscribeCanceled()
  const unsubscribeLate = DesignControls.subscribe(original, () => observed.push('late'))
  try {
    await Promise.resolve()
    Expect(observed).toEqual(['retained'])
    DesignControls.Declaration({ bundles: {}, name: 'Membership', tokens: {} }, identity)
    await Promise.resolve()
    Expect(observed).toEqual(['retained', 'retained', 'late'])
  } finally {
    unsubscribeRetained()
    unsubscribeLate()
  }
})

Test('an old render site keeps its last resolved design through a coordinated bundle rename', () => {
  const designPath = '/project/Theme.tao'
  const consumerPath = '/project/Counter.tao'
  const identity = 'test.design.source-cohorts'
  const publish = (epoch: number, bundle: string, paper: string, consumerEpoch: number) =>
    DesignControls.Declaration(
      {
        bundles: { [bundle]: DesignControls.Spec([['bg', 'paper']]) },
        name: 'Theme',
        tokens: { paper },
      },
      identity,
      { epoch, path: designPath, sourceEpochs: { [consumerPath]: consumerEpoch } },
    )
  const first = publish(1, 'title', '#111111', 1)
  const oldSource = {
    cohort: {},
    kind: 'style' as const,
    path: consumerPath,
    epoch: 1,
    designEpochs: { [designPath]: 1 },
  }
  const oldSpec = () => DesignControls.Spec([['title']], oldSource)
  Expect(DesignControls.resolve(first, oldSpec()).style).toEqual({ backgroundColor: '#111111' })
  publish(2, 'title', '#224466', 1)
  Expect(DesignControls.resolve(first, oldSpec()).style).toEqual({ backgroundColor: '#224466' })
  publish(3, 'headline', '#335577', 3)
  Expect(DesignControls.resolve(first, oldSpec()).style).toEqual({ backgroundColor: '#224466' })
  const currentSource = {
    cohort: {},
    kind: 'style' as const,
    path: consumerPath,
    epoch: 3,
    designEpochs: { [designPath]: 3 },
  }
  Expect(DesignControls.resolve(first, DesignControls.Spec([['headline']], currentSource)).style)
    .toEqual({ backgroundColor: '#335577' })
  // A new evaluation of the same file must not evict a still-mounted old evaluation.
  Expect(DesignControls.resolve(first, oldSpec()).style).toEqual({ backgroundColor: '#224466' })
  Expect(() => DesignControls.resolve(first, DesignControls.Spec([['title']], currentSource)))
    .toThrow("Design 'Theme' has no bundle 'title'.")
})

Test('an unvisited old source sees its last compatible design after a coordinated rename', () => {
  const designPath = '/project/LazyTheme.tao'
  const consumerPath = '/project/LazyView.tao'
  const identity = 'test.design.lazy-source-cohort'
  const source = { designEpochs: { [designPath]: 1 }, epoch: 1, path: consumerPath }
  // A generated module creates its cohort before the imported design evaluates.
  const cohort = DesignControls.Cohort(source)
  const publish = (epoch: number, bundle: string, paper: string, consumerEpoch: number) =>
    DesignControls.Declaration(
      {
        bundles: { [bundle]: DesignControls.Spec([['bg', 'paper']]) },
        name: 'LazyTheme',
        tokens: { paper },
      },
      identity,
      { epoch, path: designPath, sourceEpochs: { [consumerPath]: consumerEpoch } },
    )
  const first = publish(1, 'title', '#111111', 1)
  publish(2, 'title', '#224466', 1)
  publish(3, 'headline', '#335577', 3)
  const oldSpec = DesignControls.Spec([['title']], { ...source, cohort, kind: 'style' })
  // No resolve happened before the rename; the module cohort still captured D2.
  Expect(DesignControls.resolve(DesignControls.current(first), oldSpec).style)
    .toEqual({ backgroundColor: '#224466' })
  const currentSource = { designEpochs: { [designPath]: 3 }, epoch: 3, path: consumerPath }
  const currentCohort = DesignControls.Cohort(currentSource)
  Expect(
    DesignControls.resolve(
      DesignControls.current(first),
      DesignControls.Spec([['headline']], {
        ...currentSource,
        cohort: currentCohort,
        kind: 'style',
      }),
    ).style,
  ).toEqual({ backgroundColor: '#335577' })
})

Test('an unvisited cohort survives a rapid rename and revert while a consumer ahead waits', async () => {
  const designPath = '/project/LazyRevertTheme.tao'
  const consumerPath = '/project/LazyRevertView.tao'
  const identity = 'test.design.lazy-revert-cohort'
  const oldSource = { designEpochs: { [designPath]: 1 }, epoch: 1, path: consumerPath }
  const oldCohort = DesignControls.Cohort(oldSource)
  const publish = (epoch: number, bundle: string, paper: string, consumerEpoch: number) =>
    DesignControls.Declaration(
      {
        bundles: { [bundle]: DesignControls.Spec([['bg', 'paper']]) },
        name: 'LazyRevertTheme',
        tokens: { paper },
      },
      identity,
      { epoch, path: designPath, sourceEpochs: { [consumerPath]: consumerEpoch } },
    )
  const first = publish(1, 'title', '#111111', 1)
  const futureSource = { designEpochs: { [designPath]: 4 }, epoch: 4, path: consumerPath }
  const futureCohort = DesignControls.Cohort(futureSource)
  const futureSpec = DesignControls.Spec([['title']], {
    ...futureSource,
    cohort: futureCohort,
    kind: 'style',
  })
  let pending: unknown
  try {
    DesignControls.resolve(DesignControls.current(first), futureSpec)
  } catch (error) {
    pending = error
  }
  Expect(pending instanceof Promise).toBe(true)
  publish(2, 'title', '#224466', 1)
  publish(3, 'headline', '#335577', 3)
  publish(4, 'title', '#445566', 4)
  await pending as Promise<void>
  Expect(
    DesignControls.resolve(
      DesignControls.current(first),
      DesignControls.Spec([['title']], {
        ...oldSource,
        cohort: oldCohort,
        kind: 'style',
      }),
    ).style,
  ).toEqual({ backgroundColor: '#224466' })
  Expect(DesignControls.resolve(DesignControls.current(first), futureSpec).style)
    .toEqual({ backgroundColor: '#445566' })
})

Test('an unseen superseded cohort waits for its matching declaration without replacing the latest design', async () => {
  const designPath = '/project/SupersededTheme.tao'
  const consumerPath = '/project/SupersededView.tao'
  const identity = 'test.design.superseded-unseen-cohort'
  const publish = (epoch: number, bundle: string, paper: string, consumerEpoch: number) =>
    DesignControls.Declaration(
      {
        bundles: { [bundle]: DesignControls.Spec([['bg', 'paper']]) },
        name: 'SupersededTheme',
        tokens: { paper },
      },
      identity,
      { epoch, path: designPath, sourceEpochs: { [consumerPath]: consumerEpoch } },
    )
  const first = publish(1, 'title', '#111111', 1)
  const middleSource = { designEpochs: { [designPath]: 2 }, epoch: 2, path: consumerPath }
  const middleCohort = DesignControls.Cohort(middleSource)
  const middleSpec = DesignControls.Spec([['title']], {
    ...middleSource,
    cohort: middleCohort,
    kind: 'style',
  })
  publish(3, 'headline', '#335577', 3)
  const currentSource = { designEpochs: { [designPath]: 3 }, epoch: 3, path: consumerPath }
  const currentCohort = DesignControls.Cohort(currentSource)
  const currentSpec = DesignControls.Spec([['headline']], {
    ...currentSource,
    cohort: currentCohort,
    kind: 'style',
  })
  Expect(DesignControls.resolve(DesignControls.current(first), currentSpec).style)
    .toEqual({ backgroundColor: '#335577' })
  let pending: unknown
  try {
    DesignControls.resolve(DesignControls.current(first), middleSpec)
  } catch (error) {
    pending = error
  }
  Expect(pending instanceof Promise).toBe(true)
  publish(2, 'title', '#224466', 2)
  await pending as Promise<void>
  Expect(DesignControls.resolve(DesignControls.current(first), middleSpec).style)
    .toEqual({ backgroundColor: '#224466' })
  Expect(DesignControls.resolve(DesignControls.current(first), currentSpec).style)
    .toEqual({ backgroundColor: '#335577' })
  Expect(() =>
    DesignControls.resolve(
      DesignControls.current(first),
      DesignControls.Spec([['title']], {
        ...currentSource,
        cohort: currentCohort,
        kind: 'style',
      }),
    )
  ).toThrow("Design 'SupersededTheme' has no bundle 'title'.")
})

Test('a deleted source path keeps an already mounted design cohort until that render disappears', () => {
  const designPath = '/project/DeletedTheme.tao'
  const consumerPath = '/project/DeletedView.tao'
  const identity = 'test.design.deleted-consumer'
  const first = DesignControls.Declaration(
    {
      bundles: { title: DesignControls.Spec([['bg', 'paper']]) },
      name: 'DeletedTheme',
      tokens: { paper: '#111111' },
    },
    identity,
    { epoch: 1, path: designPath, sourceEpochs: { [consumerPath]: 1 } },
  )
  const source = { cohort: {}, designEpochs: { [designPath]: 1 }, epoch: 1, kind: 'style' as const, path: consumerPath }
  const spec = DesignControls.Spec([['title']], source)
  Expect(DesignControls.resolve(first, spec).style).toEqual({ backgroundColor: '#111111' })
  DesignControls.Declaration(
    {
      bundles: { title: DesignControls.Spec([['bg', 'paper']]) },
      name: 'DeletedTheme',
      tokens: { paper: '#224466' },
    },
    identity,
    { epoch: 2, path: designPath, sourceEpochs: { [consumerPath]: 1 } },
  )
  Expect(DesignControls.resolve(first, spec).style).toEqual({ backgroundColor: '#224466' })
  DesignControls.Declaration(
    {
      bundles: { headline: DesignControls.Spec([['bg', 'paper']]) },
      name: 'DeletedTheme',
      tokens: { paper: '#335577' },
    },
    identity,
    { epoch: 3, path: designPath, sourceEpochs: {} },
  )
  Expect(DesignControls.resolve(first, spec).style).toEqual({ backgroundColor: '#224466' })
})

Test('older source metadata without a cohort can still resolve its original declaration', () => {
  const designPath = '/project/LegacyTheme.tao'
  const consumerPath = '/project/LegacyView.tao'
  const identity = 'test.design.legacy-source'
  const first = DesignControls.Declaration(
    {
      bundles: { title: DesignControls.Spec([['bg', 'paper']]) },
      name: 'LegacyTheme',
      tokens: { paper: '#111111' },
    },
    identity,
    { epoch: 1, path: designPath, sourceEpochs: { [consumerPath]: 1 } },
  )
  DesignControls.Declaration(
    {
      bundles: { headline: DesignControls.Spec([['bg', 'paper']]) },
      name: 'LegacyTheme',
      tokens: { paper: '#224466' },
    },
    identity,
    { epoch: 2, path: designPath, sourceEpochs: { [consumerPath]: 2 } },
  )
  Expect(
    DesignControls.resolve(
      first,
      DesignControls.Spec([['title']], {
        designEpochs: { [designPath]: 1 },
        epoch: 1,
        kind: 'style',
        path: consumerPath,
      }),
    ).style,
  ).toEqual({ backgroundColor: '#111111' })
  Expect(
    DesignControls.resolve(
      first,
      DesignControls.Spec([['headline']], {
        designEpochs: { [designPath]: 2 },
        epoch: 2,
        kind: 'style',
        path: consumerPath,
      }),
    ).style,
  ).toEqual({ backgroundColor: '#224466' })
})

Test('a consumer ahead of its design suspends through superseded publications', async () => {
  const designPath = '/project/AheadTheme.tao'
  const consumerPath = '/project/AheadView.tao'
  const identity = 'test.design.consumer-ahead'
  const publish = (epoch: number, paper: string) =>
    DesignControls.Declaration(
      {
        bundles: { headline: DesignControls.Spec([['bg', 'paper']]) },
        name: 'AheadTheme',
        tokens: { paper },
      },
      identity,
      { epoch, path: designPath, sourceEpochs: { [consumerPath]: 3 } },
    )
  const first = publish(1, '#111111')
  const spec = DesignControls.Spec([['headline']], {
    cohort: {},
    designEpochs: { [designPath]: 3 },
    epoch: 3,
    kind: 'style',
    path: consumerPath,
  })
  let pending: unknown
  try {
    DesignControls.resolve(first, spec)
  } catch (error) {
    pending = error
  }
  Expect(pending instanceof Promise).toBe(true)
  let available = false
  void (pending as Promise<void>).then(() => {
    available = true
  })
  publish(2, '#224466')
  await Promise.resolve()
  Expect(available).toBe(false)
  publish(3, '#335577')
  await pending as Promise<void>
  Expect(available).toBe(true)
  Expect(DesignControls.resolve(first, spec).style).toEqual({ backgroundColor: '#335577' })
})

Test('render clauses, declaration headers, and element defaults select their own design cohorts', () => {
  const designPath = '/project/LayerTheme.tao'
  const oldPath = '/project/OldView.tao'
  const newPath = '/project/NewView.tao'
  const identity = 'test.design.layer-cohorts'
  const publish = (epoch: number, oldColor: string, includeOld: boolean) =>
    DesignControls.Declaration(
      {
        bundles: {
          ...(includeOld
            ? {
              button: DesignControls.Spec([['fg', 'ink']]),
              header: DesignControls.Spec([['size', 18]]),
            }
            : {}),
          headline: DesignControls.Spec([['bg', 'paper']]),
        },
        name: 'LayerTheme',
        tokens: { ink: oldColor, paper: '#335577' },
      },
      identity,
      { epoch, path: designPath, sourceEpochs: { [oldPath]: epoch < 3 ? 1 : 3, [newPath]: 3 } },
    )
  const first = publish(1, '#111111', true)
  const oldSource = { cohort: {}, designEpochs: { [designPath]: 1 }, epoch: 1, kind: 'style' as const, path: oldPath }
  const header = DesignControls.Spec([['header']], oldSource)
  DesignControls.resolve(first, undefined, 'button', 'light', undefined, header, oldSource)
  publish(2, '#224466', true)
  DesignControls.resolve(first, undefined, 'button', 'light', undefined, header, oldSource)
  publish(3, '#000000', false)
  const newSource = { cohort: {}, designEpochs: { [designPath]: 3 }, epoch: 3, kind: 'style' as const, path: newPath }
  const resolved = DesignControls.resolve(
    first,
    DesignControls.Spec([['headline']], newSource),
    'button',
    'light',
    undefined,
    header,
    oldSource,
  )
  Expect(resolved.style).toEqual({ color: '#224466', fontSize: 18, backgroundColor: '#335577' })
})

Test('a rapid bundle rename and revert keeps the old consumer on its last valid design', () => {
  const designPath = '/project/RevertTheme.tao'
  const consumerPath = '/project/RevertView.tao'
  const identity = 'test.design.revert-cohort'
  const publish = (epoch: number, bundle: string, color: string, consumerEpoch: number) =>
    DesignControls.Declaration(
      {
        bundles: { [bundle]: DesignControls.Spec([['bg', 'paper']]) },
        name: 'RevertTheme',
        tokens: { paper: color },
      },
      identity,
      { epoch, path: designPath, sourceEpochs: { [consumerPath]: consumerEpoch } },
    )
  const first = publish(1, 'title', '#111111', 1)
  const oldSpec = DesignControls.Spec([['title']], {
    cohort: {},
    designEpochs: { [designPath]: 1 },
    epoch: 1,
    kind: 'style',
    path: consumerPath,
  })
  DesignControls.resolve(first, oldSpec)
  publish(2, 'title', '#224466', 1)
  DesignControls.resolve(first, oldSpec)
  publish(3, 'headline', '#335577', 3)
  publish(4, 'title', '#445566', 4)
  Expect(DesignControls.resolve(first, oldSpec).style).toEqual({ backgroundColor: '#224466' })
  const revertedSpec = DesignControls.Spec([['title']], {
    cohort: {},
    designEpochs: { [designPath]: 4 },
    epoch: 4,
    kind: 'style',
    path: consumerPath,
  })
  Expect(DesignControls.resolve(first, revertedSpec).style).toEqual({ backgroundColor: '#445566' })
})

function clearingDesign(): ReturnType<typeof DesignControls.Declaration> {
  return DesignControls.Declaration({
    name: 'Clearing',
    tokens: { ink: '#121826', paper: '#f6f7f3' },
    bundles: {
      card: DesignControls.Spec([
        ['bg', 'paper'],
        ['border', 'ink'],
        ['fg', 'ink'],
        ['line', 20],
        ['radius', 8],
        ['size', 14],
        ['weight', 700],
        ['gap', 6],
        ['height', 40],
        ['margin', 10],
        ['pad', 12],
        ['width', 320],
      ]),
    },
  })
}
