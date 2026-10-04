import { Describe, Expect, Test } from '@shared/test'
import { DesignControls } from '../TaoRuntime-src/TR-design'
import { LayoutControls } from '../TaoRuntime-src/TR-layout'

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
