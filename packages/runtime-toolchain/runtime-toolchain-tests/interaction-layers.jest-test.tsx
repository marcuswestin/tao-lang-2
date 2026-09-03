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
    Expect(screen.UNSAFE_getByProps({ testID: 'tao-interaction-layers' }).props.accessibilityElementsHidden).toBe(true)

    await act(async () => {
      TR.Interaction.PressKey('?')
    })
    Expect(screen.getByText('Interaction hints')).toBeDefined()
    Expect(screen.getByText('H — Home')).toBeDefined()
    Expect(screen.getByText('P — Projects')).toBeDefined()
    const projectRow = screen.getByTestId('tao-interaction-row:projects')
    Expect(projectRow.props.style.flat().find((style: { left?: number }) => style?.left === 120)).toBeDefined()
    const headingPanel = screen.UNSAFE_getByProps({ accessibilityLabel: 'Interaction hints' })
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

  Test('dispatches a collision fallback key through the same allocation shown by hints', async () => {
    resetInteractionRuntime()
    const withdraw = [
      interactionOutline.register(region('main', 'Main', true)),
      interactionOutline.register(item('alpha', 'main', 'Alpha')),
      interactionOutline.register(item('apple', 'main', 'Apple')),
    ]
    TR.Interaction.Attention.revalidateOutline()
    const screen = render(React.createElement(InteractionLayersHost))
    await act(async () => undefined)
    await act(async () => {
      TR.Interaction.PressKey('?')
    })
    Expect(screen.getByText('A — Alpha')).toBeDefined()
    Expect(screen.getByText('P — Apple')).toBeDefined()

    await act(async () => {
      TR.Interaction.PressKey('p')
    })
    Expect(TR.Interaction.Attention.read().targetLabel).toBe('Apple')
    Expect(TR.Interaction.Attention.read().narrowing).toBe('')

    screen.unmount()
    withdraw.forEach(dispose => dispose())
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

  Test('keeps measurement callbacks stable and caches onLayout bounds without synchronous reads', () => {
    resetInteractionRuntime()
    const first = interactionMeasurements.bind('control')
    const second = interactionMeasurements.bind('control')
    Expect(second['ref']).toBe(first['ref'])
    Expect(second['onLayout']).toBe(first['onLayout'])
    ;(first['onLayout'] as (event: unknown) => void)({
      nativeEvent: { layout: { height: 20, width: 80, x: 12, y: 16 } },
    })
    Expect(interactionMeasurements.read('control')).toEqual({ height: 20, width: 80, x: 12, y: 16 })
    resetInteractionRuntime()
  })
})
