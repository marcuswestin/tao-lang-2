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

  Test('resolves typed colors, families, sizes, defaults, and source-chain provenance', () => {
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
    Expect(() => DesignControls.resolve(light, DesignControls.Spec([['bg', 'missing']]))).toThrow(
      "Design 'Light' has no token 'missing'.",
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
