import { Describe, Expect, MockModule, Test } from '@shared/test'
import { mock } from 'bun:test'
import React from 'react'
import type { Evaluable } from '../TaoRuntime-src/TR-action-values'

const reactNativeRuntime = {
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  Platform: { OS: 'ios' },
}
mock.module('react-native', () => reactNativeRuntime)
MockModule('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}))

const { default: TR } = await import('@runtime/TR')
const { AppSurfaceFrame } = await import('../TaoRuntime-src/TR-app-shell')
const { SelectableRow } = await import('../TaoRuntime-src/TR-selectable-row')
const { InteractionControls } = await import('../TaoRuntime-src/TR-interaction-catalog')
const { InteractionLayersHost } = await import('../TaoRuntime-src/TR-interaction-layers')
const { InteractionScrollContext } = await import('../TaoRuntime-src/TR-interaction-scroll')

type RuntimeElement = React.ReactElement<Record<string, unknown>>

Describe('TR.ForEach selectable rows', () => {
  Test('long-press and right-click open mounted row verbs without selecting the row', async () => {
    const unregisterRegion = InteractionControls.Outline.register({
      identity: 'documents',
      kind: 'region',
      label: () => 'Documents',
      live: { primary: true },
      provenance: {},
    })
    const unregisterRow = InteractionControls.Outline.register({
      identity: 'draft',
      kind: 'item',
      label: () => 'Draft',
      live: {},
      parent: 'documents',
      provenance: {},
    })
    const command = TR.Interaction.Command({
      action: () => TR.Action(() => undefined),
      members: { Title: () => TR.Value('Archive') },
      name: 'Archive',
    })
    const unregisterSurface = InteractionControls.Catalog.registerSurface({
      commands: [command],
      hidden: [],
      identity: 'Draft actions',
    }, 'draft')
    const useContext = React.useContext
    const useEffect = React.useEffect
    const useRef = React.useRef
    const useSyncExternalStore = React.useSyncExternalStore
    React.useContext = (() => undefined) as typeof React.useContext
    React.useEffect = (() => undefined) as typeof React.useEffect
    React.useRef = (value => ({ current: value })) as typeof React.useRef
    React.useSyncExternalStore = (() => 0) as typeof React.useSyncExternalStore
    let selections = 0
    try {
      InteractionControls.Attention.revalidateOutline()
      const native = SelectableRow({
        identity: 'draft',
        onSelect: () => {
          selections += 1
        },
      }) as RuntimeElement
      ;(native.props['onPressIn'] as () => void)()
      ;(native.props['onLongPress'] as () => void)()
      ;(native.props['onPress'] as () => void)()
      Expect(InteractionControls.Attention.read().mode).toBe('verbs')
      Expect(selections).toBe(0)

      reactNativeRuntime.Platform.OS = 'web'
      const web = SelectableRow({
        identity: 'draft',
        onSelect: () => {
          selections += 1
        },
      }) as RuntimeElement
      let prevented = false
      ;(web.props['onContextMenu'] as (event: { preventDefault(): void }) => void)({
        preventDefault: () => {
          prevented = true
        },
      })
      Expect(prevented).toBe(true)
      Expect(InteractionControls.Attention.read().mode).toBe('verbs')
      Expect(selections).toBe(0)
      ;(web.props['onClick'] as (event: { button: number }) => void)({ button: 2 })
      Expect(selections).toBe(0)

      InteractionControls.PressKey('Escape')
      ;(web.props['onPointerDown'] as (event: { button: number; clientX: number; clientY: number }) => void)({
        button: 0,
        clientX: 10,
        clientY: 10,
      })
      await new Promise(resolve => setTimeout(resolve, 550))
      Expect(InteractionControls.Attention.read().mode).toBe('verbs')
      ;(web.props['onPointerLeave'] as () => void)()
      ;(web.props['onPointerUp'] as () => void)()
      ;(web.props['onClick'] as (event: { button: number }) => void)({ button: 0 })
      Expect(selections).toBe(0)

      InteractionControls.PressKey('Escape')
      InteractionControls.PressKey('d')
      const narrowingLayer = InteractionLayersHost({})
      const help = findByTestID(narrowingLayer, 'tao-contextual-help')
      Expect(help).toBeDefined()
      Expect(help!.props['style']).toMatchObject({ marginLeft: 8 })
      const helpRow = parentOfTestID(narrowingLayer, 'tao-contextual-help')
      Expect(findByTestID(helpRow, 'tao-interaction-row:draft')).toBeDefined()
      InteractionControls.PressKey('Escape')
      Expect(findByTestID(InteractionLayersHost({}), 'tao-contextual-help')).toBeUndefined()
      ;(web.props['onPointerDown'] as (event: { button: number; clientX: number; clientY: number }) => void)({
        button: 0,
        clientX: 10,
        clientY: 10,
      })
      ;(web.props['onPointerUp'] as () => void)()
      ;(web.props['onClick'] as (event: { button: number }) => void)({ button: 0 })
      Expect(selections).toBe(1)
    } finally {
      reactNativeRuntime.Platform.OS = 'ios'
      React.useContext = useContext
      React.useEffect = useEffect
      React.useRef = useRef
      React.useSyncExternalStore = useSyncExternalStore
      unregisterSurface()
      unregisterRow()
      unregisterRegion()
      InteractionControls.Attention.revalidateOutline()
    }
  })

  Test('hands every row to one item element with its selection callback and stable key', () => {
    const selections: string[] = []
    const content = React.createElement('RowRoot', { testID: 'rows' }, 'One')
    const select = (value: { jsValue: string }) => selections.push(value.jsValue)
    const collection = TR.ForEach(TR.Value(['One']), () => content, select) as RuntimeElement

    const rows = collection.props['items'] as RuntimeElement[]
    Expect(rows).toHaveLength(1)
    const item = rows[0]!.props['children'] as RuntimeElement
    const itemProps = item.props as { itemKey: unknown; runtimeValue: { jsValue: unknown }; select?: unknown }

    Expect(rows[0]!.key).toBe('0')
    Expect(itemProps.itemKey).toBe(0)
    Expect(itemProps.runtimeValue.jsValue).toBe('One')
    Expect(itemProps.select).toBe(select)
    // The row's press surface and its accessible name are proved where the row actually mounts:
    // the selectable-loop and interaction-outline runtime suites render it.
    Expect(selections).toEqual([])
  })

  Test('leaves a non-selectable row without a selection callback', () => {
    const content = React.createElement('RowRoot', { testID: 'rows' }, 'Static')
    const collection = TR.ForEach(TR.Value(['Static']), () => content) as RuntimeElement

    const rows = collection.props['items'] as RuntimeElement[]
    const item = rows[0]!.props['children'] as RuntimeElement

    Expect((item.props as { select?: unknown }).select).toBeUndefined()
    Expect((item.props as { render: unknown }).render).toBeDefined()
  })

  Test('does not capture healthy list-item arguments before a failure', () => {
    let capturedReads = 0
    const value = Object.defineProperty({}, 'Title', {
      enumerable: true,
      get: () => {
        capturedReads += 1
        return 'Draft'
      },
    })

    TR.ForEach(TR.Value([value]), () => null)

    Expect(capturedReads).toBe(0)
  })

  Test('does not evaluate healthy screen arguments only for diagnostics', () => {
    let evaluations = 0
    const screen = TR.Navigation.View({
      name: 'LazyDiagnosticsScreen',
      render: () => null,
    })

    const value: Evaluable & { jsValue: unknown } = {
      evaluate: () => {
        evaluations += 1
        return value
      },
      jsValue: 'Draft',
    }
    screen.render({ Value: value })

    Expect(evaluations).toBe(0)
  })
})

Describe('TR.AppSurfaceFrame scroll reveal', () => {
  Test('provides the default scene scroller to mounted rows and uses its current offset', () => {
    const useCallback = React.useCallback
    const useContext = React.useContext
    const useMemo = React.useMemo
    const useRef = React.useRef
    const useSyncExternalStore = React.useSyncExternalStore
    React.useCallback = (callback => callback) as typeof React.useCallback
    React.useContext = (() => ({ resolved: 'light' })) as typeof React.useContext
    React.useMemo = (create => create()) as typeof React.useMemo
    React.useRef = (value => ({ current: value })) as typeof React.useRef
    React.useSyncExternalStore = (() => 'light') as typeof React.useSyncExternalStore
    try {
      const frame = AppSurfaceFrame({ children: 'Draft' }) as RuntimeElement
      Expect(frame.type).toBe('ScrollView')
      const provider = frame.props['children'] as RuntimeElement
      Expect(provider.type).toBe(InteractionScrollContext.Provider)

      const destinations: unknown[] = []
      const scrollHost = frame.props['ref'] as { current: unknown }
      scrollHost.current = {
        measureInWindow: (receive: (x: number, y: number, width: number, height: number) => void) =>
          receive(0, 20, 200, 100),
        scrollTo: (destination: unknown) => destinations.push(destination),
      }
      ;(frame.props['onScroll'] as (event: unknown) => void)({ nativeEvent: { contentOffset: { x: 0, y: 30 } } })
      const reveal = provider.props['value'] as (target: unknown) => void
      reveal({
        measureInWindow: (receive: (x: number, y: number, width: number, height: number) => void) =>
          receive(0, 180, 100, 20),
      })

      Expect(destinations).toEqual([{ animated: false, x: 0, y: 110 }])
    } finally {
      React.useCallback = useCallback
      React.useContext = useContext
      React.useMemo = useMemo
      React.useRef = useRef
      React.useSyncExternalStore = useSyncExternalStore
    }
  })
})

function findByTestID(node: React.ReactNode, testID: string): RuntimeElement | undefined {
  if (!React.isValidElement(node)) {
    return undefined
  }
  const element = node as RuntimeElement
  if (element.props['testID'] === testID) {
    return element
  }
  let found: RuntimeElement | undefined
  React.Children.forEach(element.props['children'] as React.ReactNode, child => {
    found ??= findByTestID(child, testID)
  })
  return found
}

function parentOfTestID(node: React.ReactNode, testID: string): RuntimeElement | undefined {
  if (!React.isValidElement(node)) {
    return undefined
  }
  const element = node as RuntimeElement
  let parent: RuntimeElement | undefined
  React.Children.forEach(element.props['children'] as React.ReactNode, child => {
    if (React.isValidElement(child) && (child as RuntimeElement).props['testID'] === testID) {
      parent = element
    } else {
      parent ??= parentOfTestID(child, testID)
    }
  })
  return parent
}
