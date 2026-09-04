import TR from '@runtime/TR'
import {
  commandCatalog,
  resetInteractionRuntime,
} from '@runtime/TR-interaction-catalog'
import { InteractionLayersHost } from '@runtime/TR-interaction-layers'
import {
  interactionMeasurements,
  interactionOutline,
  type TaoOutlineEntry,
} from '@runtime/TR-interaction-outline'
import type { TaoProps } from '@runtime/TR-TaoProps'
import { Describe, Expect, Test } from '@shared/test'
import { act, render, within } from '@testing-library/react-native'
import React from 'react'

function region(identity: string, label: string, primary = false): TaoOutlineEntry {
  return {
    identity,
    kind: 'region',
    label: () => label,
    live: { active: () => true, primary },
    provenance: {},
  }
}

function item(identity: string, parent: string, label: string): TaoOutlineEntry {
  return {
    corpus: () => [label],
    identity,
    kind: 'item',
    label: () => label,
    live: { measure: () => ({ height: 24, width: 100, x: identity === 'home' ? 8 : 120, y: 40 }) },
    parent,
    provenance: {},
  }
}

function command(identity: string, title: string, key?: string): ReturnType<typeof TR.Interaction.Command> {
  return TR.Interaction.Command({
    action: () => TR.Action(() => undefined),
    members: {
      ...(key === undefined ? {} : { Key: () => TR.Value(key) }),
      Title: () => TR.Value(title),
    },
    name: identity,
    slots: [],
  })
}

function registerCommand(identity: string, title: string, key?: string): () => void {
  const value = command(identity, title, key)
  return commandCatalog.register({
    commands: [{
      command: () => value,
      identity,
      name: identity,
      scope: { kind: 'module' },
      slots: [],
      static: { ...(key === undefined ? {} : { key }), title },
    }],
    module: `@test/${identity}`,
  })
}

Describe('TR.Interaction generated layers', () => {
  Test('keeps hints absent before keyboard use, anchors allocated rows, and toggles them', async () => {
    resetInteractionRuntime()
    const withdraw = [
      interactionOutline.register(region('main', 'WordFlower', true)),
      interactionOutline.register(item('home', 'main', 'Home')),
      interactionOutline.register(item('projects', 'main', 'Projects')),
    ]
    TR.Interaction.Attention.revalidateOutline()
    const screen = render(React.createElement(InteractionLayersHost))
    await act(async () => undefined)
    Expect(screen.queryByText('Interaction hints')).toBeNull()
    const layerHost = screen.UNSAFE_getByProps({ testID: 'tao-interaction-layers' })
    Expect(layerHost.props.accessibilityElementsHidden).toBe(true)
    Expect(layerHost.props.accessible).toBe(false)

    await act(async () => {
      TR.Interaction.PressKey('?')
    })
    Expect(screen.getByText('Interaction hints')).toBeDefined()
    Expect(layerHost.props.importantForAccessibility).toBe('no')
    Expect(layerHost.props.style.pointerEvents).toBe('none')
    Expect(screen.getByText('H — Home')).toBeDefined()
    Expect(screen.getByText('P — Projects')).toBeDefined()
    const projectRow = screen.getByTestId('tao-interaction-row:projects')
    Expect(projectRow.props.accessibilityLabel).toBe('P — Projects')
    Expect(projectRow.props.accessibilityRole).toBe('text')
    Expect(projectRow.props.accessible).toBe(true)
    Expect(projectRow.props.style.flat().find((style: { left?: number }) => style?.left === 120)).toBeDefined()
    const headingPanel = screen.UNSAFE_getByProps({ accessibilityLabel: 'Interaction hints' })
    Expect(headingPanel.props.accessibilityRole).toBe('header')
    Expect(within(headingPanel).queryByText('P — Projects')).toBeNull()

    await act(async () => {
      TR.Interaction.PressKey('p')
    })
    Expect(TR.Interaction.Attention.read().targetLabel).toBe('Projects')
    Expect(screen.queryByText('Interaction hints')).toBeNull()

    await act(async () => {
      TR.Interaction.PressKey('?')
      TR.Interaction.PressKey('?')
    })
    Expect(screen.queryByText('Interaction hints')).toBeNull()
    screen.unmount()
    withdraw.forEach(dispose => dispose())
    resetInteractionRuntime()
  })

  Test('shows typed narrowing and its matching targets instead of changing attention invisibly', async () => {
    resetInteractionRuntime()
    const withdraw = [
      interactionOutline.register(region('main', 'WordFlower', true)),
      interactionOutline.register(item('home', 'main', 'Home')),
      interactionOutline.register(item('projects', 'main', 'Projects')),
    ]
    TR.Interaction.Attention.revalidateOutline()
    const screen = render(React.createElement(InteractionLayersHost))

    await act(async () => {
      TR.Interaction.PressKey('p')
    })
    Expect(screen.getByText('Narrowing “p”')).toBeDefined()
    Expect(screen.getByText('Projects')).toBeDefined()
    Expect(screen.queryByText('Home')).toBeNull()

    await act(async () => {
      TR.Interaction.PressKey('z')
    })
    Expect(screen.getByText('Narrowing “pz”')).toBeDefined()
    Expect(screen.getByText('No matching targets')).toBeDefined()

    screen.unmount()
    withdraw.forEach(dispose => dispose())
    resetInteractionRuntime()
  })

  Test('renders region overview with authored accelerators excluded from generated keys', async () => {
    resetInteractionRuntime()
    const unregisterCommand = registerCommand('@test/Finish', 'Finish document', 'f')
    const withdraw = [
      interactionOutline.register(region('wordflower', 'WordFlower', true)),
      interactionOutline.register(region('focus', 'Focus session')),
    ]
    TR.Interaction.Attention.revalidateOutline()
    const screen = render(React.createElement(InteractionLayersHost))
    await act(async () => undefined)

    await act(async () => {
      TR.Interaction.PressKey('Escape')
    })
    Expect(screen.getByText('Interaction overview')).toBeDefined()
    Expect(screen.getByText('W — WordFlower')).toBeDefined()
    Expect(screen.getByText('O — Focus session')).toBeDefined()
    Expect(screen.queryByText('F — Focus session')).toBeNull()
    await act(async () => {
      TR.Interaction.PressKey('o')
    })
    Expect(TR.Interaction.Attention.read().focusRegionLabel).toBe('Focus session')
    Expect(screen.queryByText('Interaction overview')).toBeNull()

    screen.unmount()
    withdraw.forEach(dispose => dispose())
    unregisterCommand()
    resetInteractionRuntime()
  })

  Test('dispatches a two-event collision key through the same prefix-free allocation shown by hints', async () => {
    resetInteractionRuntime()
    const withdraw = [
      interactionOutline.register(region('main', 'Main', true)),
      interactionOutline.register(item('one', 'main', 'A')),
      interactionOutline.register(item('three', 'main', 'A')),
      interactionOutline.register(item('two', 'main', 'A')),
    ]
    TR.Interaction.Attention.revalidateOutline()
    const screen = render(React.createElement(InteractionLayersHost))
    await act(async () => undefined)
    await act(async () => {
      TR.Interaction.PressKey('?')
    })
    Expect(within(screen.getByTestId('tao-interaction-row:one')).getByText('A — A')).toBeDefined()
    Expect(within(screen.getByTestId('tao-interaction-row:three')).getByText('BA — A')).toBeDefined()
    Expect(within(screen.getByTestId('tao-interaction-row:two')).getByText('BB — A')).toBeDefined()

    await act(async () => {
      TR.Interaction.PressKey('b')
    })
    Expect(TR.Interaction.Attention.read().mode).toBe('hints')
    await act(async () => {
      TR.Interaction.PressKey('b')
    })
    Expect(TR.Interaction.Attention.read().target).toBe('two')
    Expect(TR.Interaction.Attention.read().narrowing).toBe('')

    screen.unmount()
    withdraw.forEach(dispose => dispose())
    resetInteractionRuntime()
  })

  Test('renders disabled palette state and refuses to invoke that command', async () => {
    resetInteractionRuntime()
    let invoked = 0
    const disabled = TR.Interaction.Command({
      action: () => TR.Action(() => invoked += 1),
      members: {
        Enabled: () => TR.Value(false),
        Title: () => TR.Value('Unavailable'),
      },
      name: 'Unavailable',
      slots: [],
    })
    const unregister = commandCatalog.register({
      commands: [{
        command: () => disabled,
        identity: '@test/Unavailable',
        name: 'Unavailable',
        scope: { kind: 'module' },
        slots: [],
        static: { title: 'Unavailable' },
      }],
      module: '@test/Unavailable',
    })
    const withdraw = interactionOutline.register(region('main', 'Main', true))
    TR.Interaction.Attention.revalidateOutline()
    const screen = render(React.createElement(InteractionLayersHost))
    await act(async () => {
      TR.Interaction.PressKey('primary+k')
    })

    Expect(screen.getByTestId('tao-interaction-row:@test/Unavailable').props.accessibilityState).toEqual({
      disabled: true,
    })
    await act(async () => {
      TR.Interaction.PressKey('Enter')
    })
    Expect(invoked).toBe(0)

    screen.unmount()
    withdraw()
    unregister()
    resetInteractionRuntime()
  })

  Test('shows target verbs and narrows the full command palette through attention', async () => {
    resetInteractionRuntime()
    const unregisterFinish = registerCommand('@test/Finish', 'Finish document', 'f')
    const unregisterDuplicate = registerCommand('@test/Duplicate', 'Duplicate document')
    const unregisterDelete = registerCommand('@test/Delete', 'Delete document')
    const withdraw = [
      interactionOutline.register(region('documents', 'Documents', true)),
      interactionOutline.register({
        ...item('draft', 'documents', 'Draft the intro'),
        live: {
          commandPolicy: { hidden: [], surfaced: ['@test/Finish'] },
          entityType: 'Document',
          runtimeValue: TR.Value('draft'),
        },
      }),
    ]
    TR.Interaction.Attention.revalidateOutline()
    TR.Interaction.Attention.target('draft')
    const screen = render(React.createElement(InteractionLayersHost))
    await act(async () => undefined)

    await act(async () => {
      TR.Interaction.PressKey('.')
    })
    Expect(screen.getByText('Actions for Draft the intro')).toBeDefined()
    Expect(screen.getByText('F — Finish document')).toBeDefined()

    await act(async () => {
      TR.Interaction.PressKey('Escape')
      TR.Interaction.PressKey('primary+k')
    })
    Expect(screen.getByText('Command palette')).toBeDefined()
    Expect(screen.getByText(/Duplicate document$/)).toBeDefined()
    await act(async () => {
      TR.Interaction.Narrow('dup doc')
    })
    Expect(TR.Interaction.Attention.read().targetLabel).toBe('Duplicate document')
    Expect(screen.getByText(/Duplicate document$/)).toBeDefined()
    Expect(screen.queryByText(/Delete document$/)).toBeNull()

    screen.unmount()
    withdraw.forEach(dispose => dispose())
    unregisterFinish()
    unregisterDuplicate()
    unregisterDelete()
    resetInteractionRuntime()
  })

  Test('deduplicates titled mounted entities and activates their ordinary outline occurrence', async () => {
    resetInteractionRuntime()
    let firstActivations = 0
    let duplicateActivations = 0
    const entityItem = (identity: string, activate: () => void): TaoOutlineEntry => ({
      corpus: () => ['Morning Pages'],
      identity,
      kind: 'item',
      label: () => 'Morning Pages',
      live: {
        activate,
        entityType: 'Document',
        runtimeValue: TR.Value({ Id: 'doc-1', Title: 'Morning Pages' }),
      },
      parent: 'documents',
      provenance: { entity: 'Document', handle: 'doc-1' },
    })
    const withdraw = [
      interactionOutline.register(region('documents', 'Documents', true)),
      interactionOutline.register(entityItem('document-a', () => firstActivations += 1)),
      interactionOutline.register(entityItem('document-b', () => duplicateActivations += 1)),
    ]
    TR.Interaction.Attention.revalidateOutline()
    const screen = render(React.createElement(InteractionLayersHost))
    await act(async () => undefined)

    await act(async () => {
      TR.Interaction.PressKey('primary+k')
    })
    Expect(screen.getAllByText('Morning Pages')).toHaveLength(1)
    await act(async () => {
      TR.Interaction.Narrow('mor pag')
    })
    Expect(TR.Interaction.Attention.read().targetLabel).toBe('Morning Pages')
    await act(async () => {
      TR.Interaction.PressKey('Enter')
    })
    Expect(firstActivations).toBe(1)
    Expect(duplicateActivations).toBe(0)
    Expect(TR.Interaction.Attention.read().target).toBe('document-a')

    screen.unmount()
    withdraw.forEach(dispose => dispose())
    resetInteractionRuntime()
  })

  Test('anchors nested measurements to the app root and never treats parent-relative onLayout as global', () => {
    resetInteractionRuntime()
    const unmeasured = interactionMeasurements.bind('unmeasured')
    ;(unmeasured['onLayout'] as (event: unknown) => void)({
      nativeEvent: { layout: { height: 20, width: 80, x: 7, y: 9 } },
    })
    Expect(interactionMeasurements.read('unmeasured')).toBeUndefined()

    let rootOrigin = { x: 100, y: 200 }
    let controlWindow = { x: 132, y: 246 }
    const root = interactionMeasurements.bindRoot()
    const control = interactionMeasurements.bind('control')
    ;(root['ref'] as (node: object | null) => void)({
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) =>
        callback(rootOrigin.x, rootOrigin.y, 500, 700),
    })
    ;(control['ref'] as (node: object | null) => void)({
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) =>
        callback(controlWindow.x, controlWindow.y, 80, 20),
    })
    ;(control['onLayout'] as (event: unknown) => void)({
      nativeEvent: { layout: { height: 20, width: 80, x: 7, y: 9 } },
    })
    Expect(interactionMeasurements.read('control')).toEqual({ height: 20, width: 80, x: 32, y: 46 })

    rootOrigin = { x: 112, y: 221 }
    controlWindow = { x: 140, y: 260 }
    ;(root['onLayout'] as (event: unknown) => void)({ nativeEvent: { layout: {} } })
    Expect(interactionMeasurements.read('control')).toEqual({ height: 20, width: 80, x: 28, y: 39 })
    ;(control['ref'] as (node: object | null) => void)(null)
    Expect(interactionMeasurements.read('control')).toBeUndefined()
    resetInteractionRuntime()
  })

  Test('rerenders only the interaction-designed occurrence whose local attention changed', async () => {
    resetInteractionRuntime()
    const renders = { affected: 0, static: 0, unaffected: 0 }
    const occurrences: Partial<Record<keyof typeof renders, ReturnType<typeof TR.Interaction.FromProps>>> = {}
    const taoProps = Object.fromEntries(
      (Object.keys(renders) as Array<keyof typeof renders>).map(name => [
        name,
        {
          ...(name === 'static'
            ? {}
            : { designSpec: { entries: [['fill', 'when', 'hovered']] } }),
          interaction: {
            control: {
              declaration: `@test/${name}`,
              identity: `@test#${name}`,
              kind: 'control',
              role: 'action',
              view: name,
            },
          },
        } satisfies TaoProps,
      ]),
    ) as Record<keyof typeof renders, TaoProps>
    function Probe(props: { name: keyof typeof renders }) {
      renders[props.name] += 1
      const owned = taoProps[props.name]
      TR.Interaction.UseOccurrence(owned)
      occurrences[props.name] = TR.Interaction.FromProps(owned)
      return null
    }
    const screen = render(React.createElement(
      React.Fragment,
      null,
      React.createElement(Probe, { name: 'affected' }),
      React.createElement(Probe, { name: 'unaffected' }),
      React.createElement(Probe, { name: 'static' }),
    ))
    await act(async () => undefined)
    const before = { ...renders }

    await act(async () => {
      TR.Interaction.Hover(occurrences.affected, true)
    })

    Expect(renders).toEqual({
      affected: before.affected + 1,
      static: before.static,
      unaffected: before.unaffected,
    })
    screen.unmount()
    resetInteractionRuntime()
  })
})
