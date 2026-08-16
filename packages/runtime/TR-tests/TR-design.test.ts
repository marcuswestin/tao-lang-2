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
