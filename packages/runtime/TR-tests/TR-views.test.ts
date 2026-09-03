import type TRType from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { mock } from 'bun:test'
import React from 'react'
import { UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'

const reactNativeRuntime = {
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}

mock.module('react-native', () => reactNativeRuntime)

const { default: TR } = await import('@runtime/TR')
const { NavigationSurface } = await import('../TaoRuntime-src/TR-navigation-surfaces')

type RuntimeElement = React.ReactElement<Record<string, unknown>>

Describe('TR.Views explicit visual props', () => {
  Test('carries Studio identity privately through the injected visual layout boundary', () => {
    const occurrence = {
      end: 91,
      kind: 'render',
      ownerName: 'StoryRow',
      sourcePath: '/project/HNReader.tao',
      start: 42,
    } as const
    const useContext = React.useContext
    React.useContext = (() => undefined) as typeof React.useContext
    let layout: ReturnType<typeof TR.VisualLayout>
    try {
      layout = TR.VisualLayout({ studio: occurrence })
    } finally {
      React.useContext = useContext
    }

    const view = renderRuntimeElement(TR.Views.View({ children: 'Story', layout }))

    Expect(view.props['dataSet']).toEqual({ taoStudio: JSON.stringify(occurrence) })
  })

  Test('lowers Studio identity and the existing test tag onto an injected native root', () => {
    const occurrence = {
      end: 91,
      kind: 'render',
      ownerName: 'Form',
      sourcePath: '/project/Form.tao',
      start: 42,
    } as const
    const useContext = React.useContext
    React.useContext = (() => undefined) as typeof React.useContext
    let layout: ReturnType<typeof TR.VisualLayout>
    try {
      layout = TR.VisualLayout({ studio: occurrence })
    } finally {
      React.useContext = useContext
    }

    Expect(TR.VisualNativeProps(layout, 'submit')).toEqual({
      dataSet: { taoStudio: JSON.stringify(occurrence) },
      testID: 'submit',
    })
    const button = React.createElement('Button', { testID: 'submit' })
    const root = TR.VisualNativeRoot(layout, button) as RuntimeElement
    Expect(root.type).toBe('View')
    Expect(root.props['dataSet']).toEqual({ taoStudio: JSON.stringify(occurrence) })
    Expect(root.props['children']).toBe(button)
    Expect(TR.VisualNativeRoot(undefined, button)).toBe(button)
    Expect(TR.VisualNativeRoot({ layout: TR.Layout.create([['gap', 8]]) }, button)).toBe(button)
  })

  Test('applies an injected layout snapshot and tag to the concrete root', () => {
    const view = renderRuntimeElement(TR.Views.View(
      {
        children: 'Explicit content',
        layout: { layout: TR.Layout.create([['gap', 7]]) },
        tag: 'explicit-root',
      },
      { direction: 'column' },
    ))

    Expect(view.props['testID']).toBe('explicit-root')
    Expect(view.props['style']).toEqual({ flexDirection: 'column', gap: 7 })
    const content = view.props['children'] as RuntimeElement
    Expect(content.props['children']).toBe('Explicit content')
  })

  Test('resolves private bundles through the mounted app with deterministic precedence', () => {
    let designReads = 0
    const design = TR.Design.Declaration({
      name: 'Theme',
      tokens: { accent: '#2f6b4f', ink: '#121826' },
      bundles: {
        title: TR.Design.Spec([['size', 16], ['fg', 'ink']]),
      },
    })
    const app = TR.Navigation.App({
      name: 'Styled',
      auxiliaries: () => ({}),
      design: () => {
        designReads += 1
        return design
      },
      navigator: () => {
        throw new UnexpectedBehaviorError('design resolution must not mount navigation')
      },
    })

    const text = renderRuntimeElement(TR.Views.Text(
      {
        __tao: {
          app,
          designSpec: TR.Design.Spec([['title']]),
          callerProps: { designSpec: TR.Design.Spec([['size', 20], ['fg', 'accent']]) },
        },
        children: 'Title',
      },
      {
        nativeProps: { style: { color: '#ff00ff' } },
        style: { color: '#000000', fontSize: 12, fontWeight: '400' },
      },
    ))

    Expect(flattenStyle(text.props['style'])).toEqual({
      color: '#ff00ff',
      fontSize: 20,
      fontWeight: '400',
    })
    // The same mounted app owns one lazy design value even when another primitive resolves it.
    renderRuntimeElement(TR.Views.Text({
      __tao: { app, designSpec: TR.Design.Spec([['title']]) },
      children: 'Again',
    }))
    Expect(designReads).toBe(1)
  })

  Test('applies Capitalized element defaults before explicit clauses and accepts raw colors', () => {
    const design = TR.Design.Declaration({
      name: 'Theme',
      tokens: {},
      bundles: {
        Text: TR.Design.Spec([['size', 16], ['fg', '#123456']]),
      },
    })

    Expect(TR.Design.resolve(design, TR.Design.Spec([['size', 20]]), 'Text')).toEqual({
      style: { color: '#123456', fontSize: 20 },
    })
  })

  Test('carries a themed pressable foreground onto its native title', () => {
    const app = styledElementApp('Dark', {
      FormButton: TR.Design.Spec([
        ['bg', 'surface'],
        ['fg', 'ink'],
        ['radius', 12],
        ['weight', 700],
      ]),
    }, { ink: '#edf3ee', surface: '#202a22' })
    const button = renderRuntimeElement(TR.Views.Pressable({
      __tao: { app, designDefault: 'FormButton' },
      action: { invoke: () => undefined },
      title: 'Add workspace',
    }))
    const title = button.props['children'] as RuntimeElement

    Expect(flattenStyle(button.props['style'])).toEqual({
      backgroundColor: '#202a22',
      borderRadius: 12,
      color: '#edf3ee',
      fontWeight: '700',
    })
    Expect(flattenStyle(title.props['style'])).toEqual({
      color: '#edf3ee',
      fontWeight: '700',
    })
  })

  Test('keeps usable pressable defaults below mounted design overrides', () => {
    const defaults = renderRuntimeElement(TR.Views.Pressable({
      action: { invoke: () => undefined },
      defaultStyle: { backgroundColor: '#2f6b4f', borderRadius: 8, color: '#ffffff' },
      title: 'Save',
    }))
    const app = styledElementApp('Buttons', {
      FormButton: TR.Design.Spec([['bg', 'accent'], ['radius', 12]]),
    }, { accent: '#1f4f8f' })
    const button = renderRuntimeElement(TR.Views.Pressable({
      __tao: { app, designDefault: 'FormButton' },
      action: { invoke: () => undefined },
      defaultStyle: { backgroundColor: '#2f6b4f', borderRadius: 8, color: '#ffffff' },
      title: 'Save',
    }))
    const defaultTitle = defaults.props['children'] as RuntimeElement
    const themedTitle = button.props['children'] as RuntimeElement

    Expect(defaults.props['accessible']).toBe(true)
    Expect(defaults.props['accessibilityLabel']).toBe('Save')
    Expect(defaults.props['accessibilityRole']).toBe('button')
    Expect(defaults.props['accessibilityState']).toEqual({ disabled: false })
    Expect(flattenStyle(defaults.props['style'])).toMatchObject({
      backgroundColor: '#2f6b4f',
      borderRadius: 8,
      color: '#ffffff',
    })
    Expect(flattenStyle(defaultTitle.props['style'])).toMatchObject({ color: '#ffffff' })
    Expect(flattenStyle(button.props['style'])).toMatchObject({
      backgroundColor: '#1f4f8f',
      borderRadius: 12,
      color: '#ffffff',
    })
    Expect(flattenStyle(themedTitle.props['style'])).toMatchObject({ color: '#ffffff' })
  })

  Test('applies mounted input colors to the field instead of painting its layout wrapper', () => {
    const app = styledElementApp('Dark', {
      TextInput: TR.Design.Spec([
        ['bg', 'surface'],
        ['border', 'line'],
        ['fg', 'ink'],
        ['radius', 12],
      ]),
    }, { ink: '#edf3ee', line: '#34453a', surface: '#202a22' })
    const wrapper = renderRuntimeElement(TR.Views.TextInput({
      __tao: { app, designDefault: 'TextInput' },
      label: 'Workspace name',
      placeholder: 'Home',
      value: '',
    }))
    const [label, input] = fragmentChildren(wrapper)

    Expect(label!.props['accessible']).toBe(false)
    Expect(input!.props['accessibilityLabel']).toBe('Workspace name')
    Expect(flattenStyle(wrapper.props['style'])['backgroundColor']).toBe(undefined)
    Expect(flattenStyle(label!.props['style'])['color']).toBe('#edf3ee')
    Expect(flattenStyle(input!.props['style'])).toMatchObject({
      backgroundColor: '#202a22',
      borderColor: '#34453a',
      borderRadius: 12,
      color: '#edf3ee',
    })
    Expect(input!.props['placeholderTextColor']).toBe('#edf3ee8c')
  })

  Test('keeps identical bundle names local to each mounted app', () => {
    const light = styledApp('Light', '#ffffff')
    const dark = styledApp('Dark', '#000000')
    const panel = TR.Design.Spec([['panel']])

    const lightView = renderRuntimeElement(TR.Views.View({ __tao: { app: light, designSpec: panel } }))
    const darkView = renderRuntimeElement(TR.Views.View({ __tao: { app: dark, designSpec: panel } }))

    Expect(flattenStyle(lightView.props['style'])['backgroundColor']).toBe('#ffffff')
    Expect(flattenStyle(darkView.props['style'])['backgroundColor']).toBe('#000000')
  })

  Test('marks the concrete root with the inherited Studio occurrence without disturbing native props', () => {
    const implementation: TRType.TaoStudioIdentity = {
      end: 145,
      kind: 'render',
      ownerName: 'Card',
      sourcePath: '/project/Card.tao',
      start: 120,
    }
    const occurrence: TRType.TaoStudioIdentity = {
      end: 72,
      kind: 'render',
      ownerName: 'Dashboard',
      sourcePath: '/project/Dashboard.tao',
      start: 58,
    }

    const view = renderRuntimeElement(TR.Views.View(
      {
        __tao: {
          callerProps: { studio: occurrence },
          studio: implementation,
        },
        tag: 'studio-card',
      },
      {
        direction: 'column',
        nativeProps: {
          accessibilityLabel: 'Card',
          dataSet: { existingMarker: 'preserved' },
          style: { opacity: 0.75 },
        },
        style: { backgroundColor: '#ffffff' },
      },
    ))

    Expect(view.props['accessibilityLabel']).toBe('Card')
    Expect(view.props['dataSet']).toEqual({
      existingMarker: 'preserved',
      taoStudio: JSON.stringify(occurrence),
    })
    Expect(flattenStyle(view.props['style'])).toEqual({
      backgroundColor: '#ffffff',
      flexDirection: 'column',
      opacity: 0.75,
    })
    Expect(view.props['testID']).toBe('studio-card')
  })

  Test('does not add Studio host metadata when an occurrence is absent', () => {
    const view = renderRuntimeElement(TR.Views.View(
      {},
      { nativeProps: { dataSet: { existingMarker: 'preserved' } } },
    ))

    Expect(view.props['dataSet']).toEqual({ existingMarker: 'preserved' })
  })
})

Describe('TR.Views image', () => {
  Test('renders informative images with an accessible label and Tao test tag', () => {
    const image = renderRuntimeElement(TR.Views.Image(
      { label: 'Empty workspace', source: './images/empty-workspaces.png' },
      { testTag: 'empty-workspace' },
    ))

    Expect(image.type).toBe('Image')
    Expect(image.props['source']).toEqual({ uri: './images/empty-workspaces.png' })
    Expect(image.props['accessible']).toBe(true)
    Expect(image.props['accessibilityRole']).toBe('image')
    Expect(image.props['accessibilityLabel']).toBe('Empty workspace')
    Expect(image.props['testID']).toBe('empty-workspace')
  })

  Test('removes decorative images from the accessibility tree', () => {
    const image = renderRuntimeElement(TR.Views.Image({
      decorative: true,
      label: 'Ignored label',
      source: './images/divider.png',
    }))

    Expect(image.props['accessible']).toBe(false)
    Expect(image.props['accessibilityRole']).toBe(undefined)
    Expect(image.props['accessibilityLabel']).toBe(undefined)
  })

  Test('rejects informative images without a usable accessibility label', () => {
    Expect(() => TR.Views.Image({ source: './images/unnamed.png' })).toThrow(
      'Informative Image requires a nonempty accessibility label.',
    )
    Expect(() => TR.Views.Image({ label: '   ', source: './images/unnamed.png' })).toThrow(
      'Informative Image requires a nonempty accessibility label.',
    )
  })
})

Describe('TR.Views checkbox', () => {
  Test('presses the tagged accessible root to toggle checked state', () => {
    const changes: boolean[] = []
    const wrapper = renderRuntimeElement(TR.Views.Checkbox(
      { label: 'Final', onChange: value => changes.push(value), value: true },
      { testTag: 'final-checkbox' },
    ))
    const [checkbox, label] = fragmentChildren(wrapper)

    Expect(wrapper.type).toBe('Pressable')
    Expect(wrapper.props['testID']).toBe('final-checkbox')
    Expect(wrapper.props['accessibilityRole']).toBe('checkbox')
    Expect(wrapper.props['accessibilityLabel']).toBe('Final')
    Expect(wrapper.props['accessibilityState']).toEqual({ checked: true, disabled: false })
    Expect(checkbox!.type).toBe('Switch')
    Expect(checkbox!.props['accessible']).toBe(false)
    Expect(checkbox!.props['accessibilityRole']).toBe(undefined)
    Expect(checkbox!.props['accessibilityState']).toBe(undefined)
    Expect(checkbox!.props['pointerEvents']).toBe(undefined)
    Expect(flattenStyle(checkbox!.props['style'])['pointerEvents']).toBe('none')
    Expect(checkbox!.props['value']).toBe(true)
    Expect(label!.props['children']).toBe('Final')

    const onPress = wrapper.props['onPress'] as () => void
    onPress()
    Expect(changes).toEqual([false])
  })

  Test('disables native changes and exposes the disabled state', () => {
    const wrapper = renderRuntimeElement(TR.Views.Checkbox({
      disabled: true,
      label: 'Final',
      onChange: () => {
        throw new UnexpectedBehaviorError('disabled checkbox changed')
      },
      value: false,
    }))
    const [checkbox] = fragmentChildren(wrapper)

    Expect(wrapper.props['accessibilityState']).toEqual({ checked: false, disabled: true })
    Expect(wrapper.props['disabled']).toBe(true)
    Expect(wrapper.props['onPress']).toBe(undefined)
    Expect(checkbox!.props['accessible']).toBe(false)
  })
})

Describe('TR.Views scroll view', () => {
  Test('applies Tao child layout to the scroll content container', () => {
    const scrollView = renderRuntimeElement(TR.Views.ScrollView(
      { children: 'Documents' },
      {
        direction: 'column',
        layout: TR.Layout.create([['gap', 8], ['pad', 4]]),
        nativeProps: { contentContainerStyle: { minHeight: 12 }, horizontal: false },
        testTag: 'documents',
      },
    ))

    Expect(scrollView.type).toBe('ScrollView')
    Expect(scrollView.props['horizontal']).toBe(false)
    Expect(scrollView.props['testID']).toBe('documents')
    Expect(scrollView.props['style']).toEqual({ alignSelf: 'stretch' })
    Expect(scrollView.props['contentContainerStyle']).toEqual([
      { flexGrow: 1 },
      { flexDirection: 'column', gap: 8, padding: 4 },
      { minHeight: 12 },
    ])
    const content = scrollView.props['children'] as RuntimeElement
    Expect(content.props['direction']).toBe('column')
    Expect(content.props['children']).toBe('Documents')
  })
})

Describe('TR.Views indicators', () => {
  Test('renders a busy, labeled activity indicator by default', () => {
    const spinner = renderRuntimeElement(TR.Views.Spinner({}, { testTag: 'loading' }))

    Expect(spinner.type).toBe('ActivityIndicator')
    Expect(spinner.props['accessibilityRole']).toBe('progressbar')
    Expect(spinner.props['accessibilityLabel']).toBe('Loading')
    Expect(spinner.props['accessibilityState']).toEqual({ busy: true })
    Expect(spinner.props['animating']).toBe(true)
    Expect(spinner.props['testID']).toBe('loading')
  })

  Test('clamps progress for accessibility and visual width', () => {
    const progress = renderRuntimeElement(TR.Views.Progress(
      { label: 'Draft goal', value: 1.25 },
      { testTag: 'draft-goal' },
    ))
    const fill = progress.props['children'] as RuntimeElement

    Expect(progress.type).toBe('View')
    Expect(progress.props['accessibilityRole']).toBe('progressbar')
    Expect(progress.props['accessibilityLabel']).toBe('Draft goal')
    Expect(progress.props['accessibilityValue']).toEqual({ max: 1, min: 0, now: 1 })
    Expect(progress.props['testID']).toBe('draft-goal')
    Expect((fill.props['style'] as Record<string, unknown>)['width']).toBe('100%')
  })

  Test('normalizes non-finite progress to zero', () => {
    const progress = renderRuntimeElement(TR.Views.Progress({ value: Number.NaN }))
    const fill = progress.props['children'] as RuntimeElement

    Expect(progress.props['accessibilityValue']).toEqual({ max: 1, min: 0, now: 0 })
    Expect((fill.props['style'] as Record<string, unknown>)['width']).toBe('0%')
  })
})

Describe('TR navigation pointer events', () => {
  Test('keeps host and overlay surfaces pointer-transparent through native styles', () => {
    const surface = NavigationSurface({
      content: 'Content',
      navigation: {} as Parameters<typeof NavigationSurface>[0]['navigation'],
      overlays: [
        {
          arguments: {},
          instanceId: 1,
          presentable: { render: () => 'Overlay' },
        } as unknown as Parameters<typeof NavigationSurface>[0]['overlays'][number],
      ],
    }) as RuntimeElement
    const children = React.Children.toArray(surface.props['children'] as React.ReactNode)
    const overlayLayer = children[1] as RuntimeElement

    Expect(surface.props['pointerEvents']).toBe(undefined)
    Expect(flattenStyle(surface.props['style'])['pointerEvents']).toBe('box-none')
    Expect(overlayLayer.props['pointerEvents']).toBe(undefined)
    Expect(flattenStyle(overlayLayer.props['style'])['pointerEvents']).toBe('box-none')
  })
})

function renderRuntimeElement(element: React.ReactElement): RuntimeElement {
  const useContext = React.useContext
  React.useContext = (() => undefined) as typeof React.useContext
  try {
    return (element.type as (props: Record<string, unknown>) => RuntimeElement)(
      element.props as Record<string, unknown>,
    )
  } finally {
    React.useContext = useContext
  }
}

function fragmentChildren(element: RuntimeElement): RuntimeElement[] {
  const fragment = element.props['children'] as RuntimeElement
  return React.Children.toArray(fragment.props['children'] as React.ReactNode) as RuntimeElement[]
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flattenStyle)) as Record<string, unknown>
  }
  return typeof style === 'object' && style !== null ? style as Record<string, unknown> : {}
}

function styledApp(name: string, surface: string): ReturnType<typeof TR.Navigation.App> {
  const design = TR.Design.Declaration({
    name,
    tokens: { surface },
    bundles: { panel: TR.Design.Spec([['bg', 'surface']]) },
  })
  return TR.Navigation.App({
    name,
    auxiliaries: () => ({}),
    design: () => design,
    navigator: () => {
      throw new UnexpectedBehaviorError('design resolution must not mount navigation')
    },
  })
}

function styledElementApp(
  name: string,
  bundles: Parameters<typeof TR.Design.Declaration>[0]['bundles'],
  tokens: Parameters<typeof TR.Design.Declaration>[0]['tokens'],
): ReturnType<typeof TR.Navigation.App> {
  const design = TR.Design.Declaration({ bundles, name, tokens })
  return TR.Navigation.App({
    name,
    auxiliaries: () => ({}),
    design: () => design,
    navigator: () => {
      throw new UnexpectedBehaviorError('design resolution must not mount navigation')
    },
  })
}
