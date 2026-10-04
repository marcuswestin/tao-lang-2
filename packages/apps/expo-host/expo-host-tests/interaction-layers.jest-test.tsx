import TR from '@runtime/TR'
import { testDataConnection } from '@runtime/TR-data-provider'
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
import { act, fireEvent, render, within } from '@testing-library/react-native'
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
    screen.getByText('Interaction hints')
    Expect(layerHost.props.importantForAccessibility).toBe('no')
    Expect(layerHost.props.style.pointerEvents).toBe('none')
    screen.getByText('H — Home')
    screen.getByText('P — Projects')
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
    screen.getByText('Narrowing “p”')
    screen.getByText('Projects')
    Expect(screen.queryByText('Home')).toBeNull()

    await act(async () => {
      TR.Interaction.PressKey('z')
    })
    screen.getByText('Narrowing “pz”')
    screen.getByText('No matching targets')

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
    screen.getByText('Interaction overview')
    screen.getByText('W — WordFlower')
    screen.getByText('O — Focus session')
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
    within(screen.getByTestId('tao-interaction-row:one')).getByText('A — A')
    within(screen.getByTestId('tao-interaction-row:three')).getByText('BA — A')
    within(screen.getByTestId('tao-interaction-row:two')).getByText('BB — A')

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

  Test('dispatches the identity-stable key the hint layer shows after candidates change', async () => {
    resetInteractionRuntime()
    const withdraw = [
      interactionOutline.register(region('main', 'Main', true)),
      interactionOutline.register(item('zebra', 'main', 'Alpha')),
      interactionOutline.register(item('zulu', 'main', 'Alpha')),
    ]
    TR.Interaction.Attention.revalidateOutline()
    const screen = render(React.createElement(InteractionLayersHost))
    await act(async () => {
      TR.Interaction.PressKey('?')
    })
    within(screen.getByTestId('tao-interaction-row:zebra')).getByText('A — Alpha')
    within(screen.getByTestId('tao-interaction-row:zulu')).getByText('L — Alpha')

    await act(async () => {
      TR.Interaction.PressKey('?')
    })
    withdraw.push(interactionOutline.register(item('aardvark', 'main', 'Alpha')))
    TR.Interaction.Attention.revalidateOutline()
    await act(async () => {
      TR.Interaction.PressKey('?')
    })
    within(screen.getByTestId('tao-interaction-row:aardvark')).getByText('P — Alpha')

    await act(async () => {
      TR.Interaction.PressKey('p')
    })
    Expect(TR.Interaction.Attention.read().target).toBe('aardvark')

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
      selected: true,
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
    screen.getByText('Actions for Draft the intro')
    screen.getByText('F — Finish document')

    await act(async () => {
      TR.Interaction.PressKey('Escape')
      TR.Interaction.PressKey('primary+k')
    })
    screen.getByText('Command palette')
    screen.getByText(/Duplicate document$/)
    await act(async () => {
      TR.Interaction.Narrow('dup doc')
    })
    Expect(TR.Interaction.Attention.read().targetLabel).toBe('Duplicate document')
    screen.getByText(/Duplicate document$/)
    Expect(screen.queryByText(/Delete document$/)).toBeNull()

    screen.unmount()
    withdraw.forEach(dispose => dispose())
    unregisterFinish()
    unregisterDuplicate()
    unregisterDelete()
    resetInteractionRuntime()
  })

  Test('renders mounted targets, store fallback, and scalar input for required command slots', async () => {
    resetInteractionRuntime()
    const schema = TR.Data.Schema({
      entities: {
        InteractionLayerWorkspace: {
          collection: 'InteractionLayerWorkspaces',
          fields: { Name: { kind: 'text', title: true } },
        },
      },
      name: 'InteractionLayerPicker',
    }, testDataConnection())
    TR.Data.Create(schema, 'InteractionLayerWorkspace', { Name: TR.Value('Archive') })
    const invoked: string[] = []
    const move = TR.Interaction.Command({
      // Fills are evaluated the way the compiler emits them: once where the fill is read, and once
      // more inside the runtime call that receives it.
      action: fills =>
        TR.Action(() => {
          const workspace = fills['Workspace']?.evaluate().evaluate().jsValue
          invoked.push(`${TR.Data.Read(workspace, 'Name')}:${fills['Name']?.evaluate().evaluate().jsValue}`)
        }),
      members: { Key: () => TR.Value('m'), Title: () => TR.Value('Move document') },
      name: 'Move',
      slots: ['Document', 'Workspace', 'Name'],
    })
    const unregister = commandCatalog.register({
      commands: [{
        command: () => move,
        identity: '@test/Move',
        name: 'Move',
        scope: { kind: 'module' },
        slots: [
          { entity: true, name: 'Document', required: true, type: 'Document' },
          { entity: true, name: 'Workspace', required: true, type: 'InteractionLayerWorkspace' },
          { entity: false, name: 'Name', required: true, type: 'text' },
        ],
        static: { key: 'm', title: 'Move document' },
      }],
      module: '@test/Move',
    })
    const withdraw = [
      interactionOutline.register(region('documents', 'Documents', true)),
      interactionOutline.register({
        ...item('document', 'documents', 'Draft'),
        live: {
          commandPolicy: { hidden: [], surfaced: ['@test/Move'] },
          entityType: 'Document',
          runtimeValue: TR.Value('draft'),
        },
      }),
      interactionOutline.register({
        ...item('home', 'documents', 'Home'),
        live: { entityType: 'InteractionLayerWorkspace', runtimeValue: TR.Value('home') },
      }),
    ]
    TR.Interaction.Attention.revalidateOutline()
    TR.Interaction.Attention.target('document')
    const screen = render(React.createElement(InteractionLayersHost))

    await act(async () => {
      TR.Interaction.PressKey('.')
      TR.Interaction.PressKey('m')
    })
    screen.getByText('Choose Workspace for Move document')
    screen.getByText('Home')
    screen.getByTestId('tao-interaction-pending-search')

    await act(async () => {
      fireEvent.press(screen.getByTestId('tao-interaction-pending-search'))
    })
    const archive = screen.getByLabelText('Archive')
    await act(async () => {
      fireEvent.press(archive)
    })
    const input = screen.getByTestId('tao-interaction-pending-input')
    Expect(input.props.accessibilityLabel).toBe('Name for Move document')
    await act(async () => {
      fireEvent.changeText(input, 'Filed')
    })
    await act(async () => {
      fireEvent(screen.getByTestId('tao-interaction-pending-input'), 'submitEditing')
    })
    Expect(invoked).toEqual(['Archive:Filed'])

    screen.unmount()
    withdraw.forEach(dispose => dispose())
    unregister()
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
              nameStatus: 'missing',
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
