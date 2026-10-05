import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import React from 'react'
import { testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import { DesignControls } from '../TaoRuntime-src/TR-design'
import { UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import { InteractionAttention, runtimeInteractionValue } from '../TaoRuntime-src/TR-interaction-attention'
import { CommandCatalog } from '../TaoRuntime-src/TR-interaction-catalog'
import {
  InteractionOutline,
  siblingRegionIdentity,
  type TaoInteractionOccurrence,
  type TaoOutlineEntry,
  type TaoOutlineLiveNode,
  visualOrder,
} from '../TaoRuntime-src/TR-interaction-outline'
import type { TaoProps } from '../TaoRuntime-src/TR-TaoProps'

function register(outline: InteractionOutline, entry: TaoOutlineEntry): () => void {
  return outline.register(entry)
}

function region(
  identity: string,
  options: { active?: () => boolean; modal?: boolean; parent?: string; primary?: boolean } = {},
): TaoOutlineEntry {
  return {
    identity,
    kind: 'region',
    label: () => 'Same display label',
    live: {
      active: options.active ?? (() => true),
      ...(options.modal === undefined ? {} : { modal: options.modal }),
      ...(options.primary === undefined ? {} : { primary: options.primary }),
    },
    ...(options.parent === undefined ? {} : { parent: options.parent }),
    provenance: {},
  }
}

function item(
  identity: string,
  parent: string,
  label: string,
  live: TaoOutlineEntry['live'] = {},
): TaoOutlineEntry {
  return { corpus: () => [label], identity, kind: 'item', label: () => label, live, parent, provenance: {} }
}

Describe('TR.Interaction attention', () => {
  Test('keeps an old conditional bundle subscribed through an intermediate rename', () => {
    const designPath = '/project/PressedTheme.tao'
    const consumerPath = '/project/PressedView.tao'
    const identity = 'test.interaction.old-design-cohort'
    const publish = (epoch: number, bundle: string, consumerEpoch: number) =>
      DesignControls.Declaration(
        {
          bundles: { [bundle]: DesignControls.Spec([['bg', 'paper', 'when', 'pressed']]) },
          name: 'PressedTheme',
          tokens: { paper: `#${epoch}${epoch}${epoch}${epoch}${epoch}${epoch}` },
        },
        identity,
        { epoch, path: designPath, sourceEpochs: { [consumerPath]: consumerEpoch } },
      )
    const first = publish(1, 'title', 1)
    const source = { designEpochs: { [designPath]: 1 }, epoch: 1, path: consumerPath }
    const cohort = DesignControls.Cohort(source)
    const oldSpec = DesignControls.Spec([['title']], { ...source, cohort, kind: 'style' })
    publish(2, 'title', 1)
    publish(3, 'headline', 1)
    const app = TR.Navigation.App({
      id: 'pressed-theme',
      name: 'Pressed theme',
      auxiliaries: () => ({}),
      design: () => first,
      navigator: () => {
        throw new UnexpectedBehaviorError('Design subscription must not mount navigation.')
      },
      version: '1.0.0',
    })
    const props: TaoProps = { app, designSpec: oldSpec }
    const useContext = React.useContext
    const useRef = React.useRef
    const useEffect = React.useEffect
    const useSyncExternalStore = React.useSyncExternalStore
    let subscribed: unknown
    React.useContext = (() => undefined) as typeof React.useContext
    React.useRef = (value => ({ current: value })) as typeof React.useRef
    React.useEffect = (() => undefined) as typeof React.useEffect
    React.useSyncExternalStore = ((subscribe, getSnapshot) => {
      subscribed = subscribe
      return getSnapshot()
    }) as typeof React.useSyncExternalStore
    try {
      TR.Interaction.UseOccurrence(props)
      Expect(subscribed).toBe(TR.Interaction.Attention.subscribe)
      let pressed = false
      const resolveOld = () =>
        DesignControls.resolve(first, oldSpec, undefined, 'light', subject => subject === 'pressed' && pressed).style
      Expect(resolveOld()).toBeUndefined()
      pressed = true
      Expect(resolveOld()).toEqual({ backgroundColor: '#222222' })
      const currentSource = { designEpochs: { [designPath]: 3 }, epoch: 3, path: consumerPath }
      const currentSpec = DesignControls.Spec([['headline']], {
        ...currentSource,
        cohort: DesignControls.Cohort(currentSource),
        kind: 'style',
      })
      TR.Interaction.UseOccurrence({ app, designSpec: currentSpec })
      Expect(subscribed).toBe(TR.Interaction.Attention.subscribe)
      Expect(DesignControls.resolve(first, currentSpec, undefined, 'light', () => true).style)
        .toEqual({ backgroundColor: '#333333' })
    } finally {
      React.useContext = useContext
      React.useRef = useRef
      React.useEffect = useEffect
      React.useSyncExternalStore = useSyncExternalStore
      app.dispose()
    }
  })

  Test('secondary activation opens row verbs without invoking selection', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    let selections = 0
    register(outline, region('documents', { primary: true }))
    register(
      outline,
      item('draft', 'documents', 'Draft', {
        activate: () => {
          selections += 1
        },
      }),
    )
    const archive = TR.Interaction.Command({
      action: () => TR.Action(() => undefined),
      members: { Title: () => TR.Value('Archive') },
      name: 'Archive',
    })
    catalog.registerSurface({ commands: [archive], hidden: [], identity: 'Draft actions' }, 'draft')
    attention.revalidateOutline()

    attention.targetAndOpenVerbs('draft')

    Expect(attention.read().target).toBe('draft')
    Expect(attention.read().mode).toBe('verbs')
    Expect(attention.read().verbs.map(verb => verb.label)).toEqual(['Archive'])
    Expect(selections).toBe(0)
    attention.targetAndOpenVerbs('unmounted')
    Expect(selections).toBe(0)
  })

  Test('typing selects a mounted row and asks it to reveal', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    const revealed: string[] = []
    register(outline, region('documents', { primary: true }))
    register(outline, item('first', 'documents', 'First'))
    register(
      outline,
      item('below', 'documents', 'Below viewport', {
        scrollIntoView: () => revealed.push('below'),
      }),
    )
    attention.revalidateOutline()

    attention.narrow('below')

    Expect(attention.read().target).toBe('below')
    Expect(revealed).toEqual(['below'])
    Expect(attention.read().candidates).toEqual(['below'])
  })

  Test('orders structural rows independently of scrolling and unequal control heights', () => {
    const nodes = [
      measuredNode('right-tall', { height: 90, width: 20, x: 80, y: 10 }),
      measuredNode('left-short', { height: 30, width: 20, x: 10, y: 40 }),
      measuredNode('second-row', { height: 20, width: 20, x: 5, y: 110 }),
    ]

    Expect(visualOrder(nodes).map(node => node.identity)).toEqual([
      'left-short',
      'right-tall',
      'second-row',
    ])
    const scrolled = nodes.map(node =>
      measuredNode(node.identity, {
        ...node.live!.measure!()!,
        y: node.live!.measure!()!.y - 240,
      })
    )
    Expect(visualOrder(scrolled).map(node => node.identity)).toEqual([
      'left-short',
      'right-tall',
      'second-row',
    ])
  })

  Test('keeps registration order when any candidate has no complete visual measurement', () => {
    const measured = measuredNode('measured', { height: 20, width: 20, x: 80, y: 20 })
    const unmeasured = measuredNode('unmeasured', undefined)

    Expect(visualOrder([measured, unmeasured]).map(node => node.identity)).toEqual([
      'measured',
      'unmeasured',
    ])
  })

  Test('narrows by greedy locale-aware word-prefix subsequence and eagerly targets one result', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    register(outline, region('workspaces', { primary: true }))
    register(outline, item('home', 'workspaces', 'Home writing'))
    register(outline, item('projects', 'workspaces', 'Projects daily notes'))
    register(outline, item('archive', 'workspaces', 'Project archive'))
    attention.revalidateOutline()

    attention.narrow('pro no')

    Expect(attention.read().candidates).toEqual(['projects'])
    Expect(attention.read().target).toBe('projects')
    Expect(attention.read().targetLabel).toBe('Projects daily notes')
    Expect(attention.read().mode).toBe('narrowing')
  })

  Test('reserves interaction punctuation instead of adding it to narrowing', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('main', { primary: true }))
    register(outline, item('draft', 'main', 'Draft'))
    attention.revalidateOutline()

    Expect(attention.pressKey('.')).toBe(true)
    Expect(attention.read().narrowing).toBe('')
    Expect(attention.pressKey('/')).toBe(true)
    Expect(attention.read().mode).toBe('hints')
    Expect(attention.read().narrowing).toBe('')
    Expect(attention.pressKey('?')).toBe(true)
    Expect(attention.read().narrowing).toBe('')
    Expect(attention.pressKey('/')).toBe(true)
    Expect(attention.read().mode).toBe('hints')
    Expect(attention.pressKey('Escape')).toBe(true)
    Expect(attention.read().mode).toBe('overview')
  })

  Test('opens the region overview instead of an empty hint surface when the current region has no targets', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('empty', { primary: true }))
    register(outline, region('workspaces'))
    register(outline, item('home', 'workspaces', 'Home'))
    attention.revalidateOutline()

    Expect(attention.read().candidates).toEqual([])
    Expect(attention.pressKey('/')).toBe(true)
    Expect(attention.read().mode).toBe('overview')
    Expect(attention.pressKey('/')).toBe(true)
    Expect(attention.read().mode).toBe('navigating')
  })

  Test('dispatches prefix-free two-letter generated keys one hardware event at a time', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('main', { primary: true }))
    register(outline, item('one', 'main', 'A'))
    register(outline, item('three', 'main', 'A'))
    register(outline, item('two', 'main', 'A'))
    attention.revalidateOutline()
    attention.pressKey('?')

    Expect(attention.pressKey('b')).toBe(true)
    Expect(attention.read().mode).toBe('hints')
    Expect(attention.read().target).toBeUndefined()
    Expect(attention.pressKey('b')).toBe(true)
    Expect(attention.read().mode).toBe('navigating')
    Expect(attention.read().target).toBe('two')
  })

  Test('descends into item controls, ascends, and moves between active regions', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('documents', { primary: true }))
    register(outline, item('draft', 'documents', 'Draft'))
    register(outline, {
      identity: 'edit',
      kind: 'action',
      label: () => 'Edit',
      live: { activate: () => undefined },
      parent: 'draft',
      provenance: {},
    })
    register(outline, region('focus-bar'))
    register(outline, {
      identity: 'pause',
      kind: 'action',
      label: () => 'Pause',
      live: { activate: () => undefined },
      parent: 'focus-bar',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.focusRegion('documents')

    Expect(attention.read().target).toBe('draft')
    attention.pressKey('ArrowRight')
    Expect(attention.read().target).toBe('edit')
    attention.pressKey('ArrowLeft')
    Expect(attention.read().target).toBe('draft')
    attention.pressKey('ArrowLeft')
    Expect(attention.read().focusRegion).toBe('focus-bar')
  })

  Test('traps a visible modal and restores focus when it disappears', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('main', { primary: true }))
    let modalActive = false
    register(outline, region('ask', { active: () => modalActive, modal: true }))
    attention.revalidateOutline()
    Expect(attention.read().focusRegion).toBe('main')

    modalActive = true
    attention.revalidateOutline()
    Expect(attention.read().focusRegion).toBe('ask')
    attention.pressKey('ArrowLeft')
    Expect(attention.read().focusRegion).toBe('ask')
    attention.focusRegion('main')
    Expect(attention.read().focusRegion).toBe('ask')
    modalActive = false
    attention.revalidateOutline()
    Expect(attention.read().focusRegion).toBe('main')
  })

  Test('rejects direct pointer targeting and activation outside the visible modal', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    const invoked: string[] = []
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'underlay',
      kind: 'action',
      label: () => 'Underlay',
      live: { activate: () => void invoked.push('underlay') },
      parent: 'main',
      provenance: {},
    })
    register(outline, region('ask', { modal: true }))
    register(outline, {
      identity: 'confirm',
      kind: 'action',
      label: () => 'Confirm',
      live: { activate: () => void invoked.push('confirm') },
      parent: 'ask',
      provenance: {},
    })
    attention.revalidateOutline()

    attention.targetAndActivate('underlay')
    Expect(attention.read().focusRegion).toBe('ask')
    Expect(attention.read().target).toBe('confirm')
    Expect(invoked).toEqual([])
    attention.targetAndActivate('confirm')
    Expect(invoked).toEqual(['confirm'])
  })

  Test('keeps root-safe Back operable when a native modal portal has no outline parent', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    let backs = 0
    register(outline, region('ask', { modal: true }))
    register(outline, {
      identity: 'back',
      kind: 'action',
      label: () => 'Back',
      live: { activate: () => backs += 1 },
      provenance: { control: 'navigation:back' },
    })
    attention.revalidateOutline()

    attention.targetAndActivate('back')

    Expect(backs).toBe(1)
  })

  Test('matches named active conditions by stable region members, never duplicate display labels', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('shell-a', { primary: true }))
    register(outline, region('shell-b'))
    attention.revalidateOutline()
    attention.focusRegion('shell-a')
    const focusBar: TaoInteractionOccurrence = {
      capabilities: {},
      region: 'shell-a',
      regionDeclaration: 'Shell',
      regionSubjects: ['FocusBar'],
      scope: 'first-shell',
    }
    const statusBar: TaoInteractionOccurrence = {
      capabilities: {},
      region: 'shell-b',
      regionDeclaration: 'Shell',
      regionSubjects: ['StatusBar'],
      scope: 'second-shell',
    }

    Expect(attention.condition('FocusBar', 'active', focusBar)).toBe(true)
    Expect(attention.condition('StatusBar', 'active', focusBar)).toBe(false)
    Expect(attention.condition('FocusBar', 'active', statusBar)).toBe(false)
    const resolved = DesignControls.resolve(
      undefined,
      DesignControls.Spec([
        ['fill', 'when', 'FocusBar', 'is', 'active'],
        ['hug', 'when', 'StatusBar', 'is', 'active'],
      ]),
      undefined,
      'light',
      (subject, value) => attention.condition(subject, value, focusBar),
    )
    Expect(resolved.layout?.entries).toEqual([['fill']])
  })

  Test('coalesces sibling roots within an owner occurrence and separates duplicate owners', () => {
    const descriptor = '@ui/Shell#Shell#nav-siblings'
    Expect(siblingRegionIdentity(descriptor, 'view#1')).toBe(siblingRegionIdentity(descriptor, 'view#1'))
    Expect(siblingRegionIdentity(descriptor, 'view#1')).not.toBe(siblingRegionIdentity(descriptor, 'view#2'))
  })

  Test('fills required pending slots in declaration order from screen targets then inline input', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const invocations: string[] = []
    const move = TR.Interaction.Command({
      action: fills =>
        TR.Action(() =>
          invocations.push(
            `${fills['Document']?.evaluate().jsValue}:${fills['Workspace']?.evaluate().jsValue}:${
              fills['Name']?.evaluate().jsValue
            }`,
          )
        ),
      members: { Key: () => TR.Value('m'), Title: () => TR.Value('Move document') },
      name: 'Move',
      slots: ['Document', 'Workspace', 'Name'],
    })
    catalog.register({
      commands: [{
        command: () => move,
        identity: '@ui/Documents.Move',
        name: 'Move',
        scope: { kind: 'module' },
        slots: [
          { entity: true, name: 'Document', required: true, type: 'Document' },
          { entity: true, name: 'Workspace', required: true, type: 'Workspace' },
          { entity: false, name: 'Name', required: true, type: 'text' },
        ],
        static: { key: 'm', title: 'Move document' },
      }],
      module: '@ui/Documents',
    })
    register(outline, region('documents', { primary: true }))
    register(
      outline,
      item('document', 'documents', 'Draft', {
        commandPolicy: { hidden: [], surfaced: ['@ui/Documents.Move'] },
        entityType: 'Document',
        runtimeValue: TR.Value('draft'),
      }),
    )
    register(
      outline,
      item('workspace', 'documents', 'Home', {
        entityType: 'Workspace',
        runtimeValue: TR.Value('home'),
      }),
    )
    attention.revalidateOutline()
    attention.target('document')
    attention.openVerbs()
    attention.pressKey('m')

    Expect(attention.read().verbPending).toMatchObject({ request: 'targets', slot: 'Workspace', type: 'Workspace' })
    Expect(attention.read().candidates).toEqual(['workspace'])
    Expect(attention.choosePendingTarget('workspace')).toBe(true)
    Expect(attention.read().verbPending).toMatchObject({ request: 'input', slot: 'Name', type: 'text' })
    Expect(attention.providePendingValue(TR.Value('Archive'))).toBe(true)
    Expect(invocations).toEqual(['draft:home:Archive'])
    Expect(attention.read().verbPending).toBeUndefined()
  })

  Test('accepts an unmounted entity only through a type-checked store-picker result', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const schema = TR.Data.Schema({
      entities: {
        Document: { collection: 'Documents', fields: { Title: { kind: 'text' } } },
        Workspace: { collection: 'Workspaces', fields: { Name: { kind: 'text', title: true } } },
      },
      name: 'InteractionPicker',
    }, testDataConnection())
    TR.Data.Create(schema, 'Document', { Title: TR.Value('Other') })
    TR.Data.Create(schema, 'Workspace', { Name: TR.Value('Home') })
    TR.Data.Create(schema, 'Workspace', { Name: TR.Value('Archive') })
    const otherDocument = schema.query({ entity: 'Document', filters: [] })[0]
    const workspace = schema.query({ entity: 'Workspace', filters: [] })[1]
    let selected: unknown
    const move = TR.Interaction.Command({
      action: fills =>
        TR.Action(() => {
          selected = fills['Workspace']?.evaluate().jsValue
        }),
      members: { Key: () => TR.Value('m'), Title: () => TR.Value('Move document') },
      name: 'Move',
      slots: ['Document', 'Workspace'],
    })
    catalog.register({
      commands: [{
        command: () => move,
        identity: '@ui/Documents.Move',
        name: 'Move',
        scope: { kind: 'module' },
        slots: [
          { entity: true, name: 'Document', required: true, type: 'Document' },
          { entity: true, name: 'Workspace', required: true, type: 'Workspace' },
        ],
        static: { key: 'm', title: 'Move document' },
      }],
      module: '@ui/Documents',
    })
    register(outline, region('documents', { primary: true }))
    register(
      outline,
      item('document', 'documents', 'Draft', {
        commandPolicy: { hidden: [], surfaced: ['@ui/Documents.Move'] },
        entityType: 'Document',
        runtimeValue: TR.Value('draft'),
      }),
    )
    attention.revalidateOutline()
    attention.target('document')
    attention.openVerbs()
    attention.pressKey('m')

    Expect(attention.read().verbPending).toMatchObject({ request: 'search', slot: 'Workspace' })
    Expect(attention.choosePendingSearchResult(TR.Value(otherDocument))).toBe(false)
    Expect(attention.pressKey('a')).toBe(true)
    Expect(attention.pendingSearchResults().map(result => result.label)).toEqual(['Archive'])
    Expect(attention.read().targetLabel).toBe('Archive')
    Expect(attention.pressKey('Enter')).toBe(true)
    Expect(selected).toBe(workspace)
    Expect(attention.read().verbPending).toBeUndefined()
  })

  // Generated command bodies evaluate a fill and hand the result to a runtime action, which
  // evaluates it once more. A fill that only survives the first evaluation fails inside the action,
  // where the failure is reported as a contained action error rather than a rejected fill.
  Test('supplies picker and scalar fills that a generated action can evaluate twice', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const schema = TR.Data.Schema({
      entities: {
        Folder: { collection: 'Folders', fields: { Name: { kind: 'text', title: true } } },
        Note: {
          collection: 'Notes',
          fields: {
            Folder: { kind: 'relation', relation: 'Folder' },
            Title: { kind: 'text', title: true },
          },
        },
      },
      name: 'InteractionFills',
    }, testDataConnection())
    TR.Data.Create(schema, 'Folder', { Name: TR.Value('Archive') })
    TR.Data.Create(schema, 'Folder', { Name: TR.Value('Home') })
    const folders = schema.query({ entity: 'Folder', filters: [] })
    const archive = folders.find(entry => TR.Data.Read(entry, 'Name') === 'Archive')
    const folder = folders.find(entry => TR.Data.Read(entry, 'Name') === 'Home')
    TR.Data.Create(schema, 'Note', { Folder: TR.Value(archive), Title: TR.Value('Draft note') })
    const note = schema.query({ entity: 'Note', filters: [] })[0]
    const file = TR.Interaction.Command({
      // Exactly the shape the compiler emits: every fill is evaluated before the runtime call, and
      // the runtime call evaluates what it is given.
      action: fills =>
        TR.Action(() => {
          TR.Data.Update(fills['Note']!.evaluate(), {
            Folder: fills['Destination']!.evaluate(),
            Title: fills['Label']!.evaluate(),
          })
        }),
      members: { Key: () => TR.Value('f'), Title: () => TR.Value('File note') },
      name: 'FileNote',
      slots: ['Note', 'Destination', 'Label'],
    })
    catalog.register({
      commands: [{
        command: () => file,
        identity: '@ui/Notes.FileNote',
        name: 'FileNote',
        scope: { kind: 'module' },
        slots: [
          { entity: true, name: 'Note', required: true, type: 'Note' },
          { entity: true, name: 'Destination', required: true, type: 'Folder' },
          { entity: false, name: 'Label', required: true, type: 'text' },
        ],
        static: { key: 'f', title: 'File note' },
      }],
      module: '@ui/Notes',
    })
    register(outline, region('notes', { primary: true }))
    register(
      outline,
      item('note', 'notes', 'Draft note', {
        commandPolicy: { hidden: [], surfaced: ['@ui/Notes.FileNote'] },
        entityType: 'Note',
        runtimeValue: TR.Value(note),
      }),
    )
    attention.revalidateOutline()
    attention.target('note')
    attention.openVerbs()
    attention.pressKey('f')

    Expect(attention.read().verbPending).toMatchObject({ request: 'search', slot: 'Destination' })
    const result = attention.pendingSearchResults().find(entry => entry.label === 'Home')
    Expect(result?.value.evaluate().evaluate().jsValue).toBe(folder)
    Expect(attention.choosePendingSearchResult(result!.value)).toBe(true)
    Expect(attention.read().verbPending).toMatchObject({ request: 'input', slot: 'Label' })
    Expect(attention.providePendingValue(runtimeInteractionValue('Filed note'))).toBe(true)

    Expect(attention.read().verbPending).toBeUndefined()
    Expect(TR.Data.Read(note, 'Title')).toBe('Filed note')
    Expect(TR.Data.Read(note, 'Folder')).toBe(folder)
  })

  Test('does not invoke a fallback after a void-returning mounted activation', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    const invoked: string[] = []
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'save',
      kind: 'action',
      label: () => 'Save',
      live: { activate: () => void invoked.push('live') },
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()

    attention.targetAndActivate('save', () => invoked.push('fallback'))

    Expect(invoked).toEqual(['live'])
  })

  Test('excludes disabled nodes from targeting and never invokes them through activation wrappers', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    const invoked: string[] = []
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'disabled',
      kind: 'action',
      label: () => 'Disabled',
      live: { activate: () => void invoked.push('live'), enabled: () => false },
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()

    Expect(attention.read().candidates).toEqual([])
    attention.targetAndActivate('disabled', () => invoked.push('fallback'))
    attention.pressKey('Enter')

    Expect(attention.read().target).toBeUndefined()
    Expect(invoked).toEqual([])
  })

  Test('uses the activation fallback when its outline node has not mounted', () => {
    const attention = new InteractionAttention(new InteractionOutline(), new CommandCatalog())
    const invoked: string[] = []

    attention.targetAndActivate('not-mounted', () => invoked.push('fallback'))

    Expect(invoked).toEqual(['fallback'])
  })

  Test('recovers from a descended item whose mounted scope disappears', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('main', { primary: true }))
    const removeItem = register(outline, item('draft', 'main', 'Draft'))
    const removeAction = register(outline, {
      identity: 'edit',
      kind: 'action',
      label: () => 'Edit',
      live: {},
      parent: 'draft',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.pressKey('ArrowRight')
    Expect(attention.read().candidates).toEqual(['edit'])

    removeAction()
    removeItem()
    register(outline, item('replacement', 'main', 'Replacement'))
    attention.revalidateOutline()

    Expect(attention.read().candidates).toEqual(['replacement'])
    Expect(attention.read().target).toBe('replacement')
  })

  Test('Enter engages an input without invoking its submit activation', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    let engaged = 0
    let submitted = 0
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'title',
      kind: 'input',
      label: () => 'Document title',
      live: {
        activate: () => submitted += 1,
        engage: () => engaged += 1,
      },
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.target('title')

    attention.pressKey('Enter')

    Expect(engaged).toBe(1)
    Expect(submitted).toBe(0)
    Expect(attention.read().engaged).toBe('title')
  })

  Test('engaging clears the narrowing that selected the target', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('main', { primary: true }))
    register(outline, item('sibling', 'main', 'Sibling row'))
    register(outline, {
      corpus: () => ['Document title'],
      identity: 'title',
      kind: 'input',
      label: () => 'Document title',
      live: { engage: () => {} },
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()
    for (const key of ['d', 'o', 'c']) {
      Expect(attention.pressKey(key)).toBe(true)
    }
    Expect(attention.read().narrowing).toBe('doc')
    Expect(attention.read().target).toBe('title')

    Expect(attention.pressKey('Enter')).toBe(true)

    Expect(attention.read().engaged).toBe('title')
    Expect(attention.read().narrowing).toBe('')
    Expect(attention.read().target).toBe('title')

    // Escape only has to disengage: the narrowing that chose the input is already gone, so the next
    // letter starts a fresh narrowing instead of extending `doc`.
    Expect(attention.pressKey('Escape')).toBe(true)
    Expect(attention.read().engaged).toBe(undefined)
    Expect(attention.pressKey('s')).toBe(true)
    Expect(attention.read().narrowing).toBe('s')
  })

  Test('applies engaged input, target, mounted view, app command, then reducer precedence', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const invoked: string[] = []
    const command = (name: string, key: string) =>
      TR.Interaction.Command({
        action: () => TR.Action(() => invoked.push(name)),
        members: { Key: () => TR.Value(key), Title: () => TR.Value(name) },
        name,
      })
    const targetCommand = command('Target', 'primary+p')
    const viewCommand = command('View', 'primary+p')
    const appCommand = command('App', 'primary+g')
    const outsideCommand = command('Outside', 'primary+o')
    const modalCommand = command('Modal', 'primary+m')
    catalog.register({
      commands: [
        {
          command: () => targetCommand,
          identity: 'Target',
          name: 'Target',
          scope: { kind: 'module' },
          slots: [{ entity: true, name: 'Document', required: true, type: 'Document' }],
          static: { key: 'primary+p' },
        },
        {
          command: () => appCommand,
          identity: 'App',
          name: 'App',
          scope: { kind: 'module' },
          slots: [],
          static: { key: 'primary+g' },
        },
      ],
      module: 'Commands',
    })
    register(outline, region('shell'))
    register(outline, region('main', { parent: 'shell', primary: true }))
    register(outline, region('covered', { active: () => false, parent: 'shell' }))
    register(
      outline,
      item('document', 'main', 'Draft', {
        commandPolicy: { hidden: [], surfaced: ['Target'] },
        entityType: 'Document',
        runtimeValue: TR.Value('draft'),
      }),
    )
    register(outline, {
      identity: 'editor',
      kind: 'input',
      label: () => 'Editor',
      live: {},
      parent: 'main',
      provenance: {},
    })
    catalog.registerSurface({ commands: [viewCommand], hidden: [], identity: 'FocusBar' }, 'shell')
    catalog.registerSurface({ commands: [outsideCommand], hidden: [], identity: 'Outside' }, 'covered')
    attention.revalidateOutline()
    attention.target('document')

    Expect(attention.pressKey('primary+p')).toBe(true)
    Expect(invoked).toEqual(['Target'])
    attention.engage('editor')
    Expect(attention.pressKey('a')).toBe(false)
    Expect(attention.pressKey('primary+c')).toBe(false)
    Expect(attention.pressKey('primary+p')).toBe(true)
    Expect(invoked).toEqual(['Target', 'View'])
    attention.disengage()
    Expect(attention.pressKey('primary+g')).toBe(true)
    Expect(invoked).toEqual(['Target', 'View', 'App'])
    register(outline, region('ask', { modal: true, parent: 'shell' }))
    register(outline, region('ask-form', { parent: 'ask' }))
    catalog.registerSurface({ commands: [modalCommand], hidden: [], identity: 'Ask' }, 'ask')
    attention.revalidateOutline()
    attention.focusRegion('ask-form')
    Expect(attention.read().focusRegion).toBe('ask-form')
    Expect(attention.pressKey('primary+o')).toBe(false)
    Expect(attention.pressKey('primary+p')).toBe(false)
    Expect(attention.pressKey('primary+m')).toBe(true)
    Expect(invoked).toEqual(['Target', 'View', 'App', 'Modal'])
    Expect(attention.pressKey('.')).toBe(true)
    Expect(attention.read().mode).toBe('navigating')
  })

  // REMOVAL CANDIDATE: The row-targeting shortcut test also selects the first of two colliding surfaces; this additionally uses the same surface identity on both rows.
  Test('dispatches a targeted row surface before a later-mounted sibling with the same chord', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const invoked: string[] = []
    const command = (name: string) =>
      TR.Interaction.Command({
        action: () => TR.Action(() => invoked.push(name)),
        members: { Key: () => TR.Value('primary+f'), Title: () => TR.Value(name) },
        name,
      })
    register(outline, region('rows', { primary: true }))
    register(outline, item('first', 'rows', 'First'))
    register(outline, item('second', 'rows', 'Second'))
    catalog.registerSurface({ commands: [command('First command')], hidden: [], identity: 'Row' }, 'first')
    catalog.registerSurface({ commands: [command('Second command')], hidden: [], identity: 'Row' }, 'second')
    attention.revalidateOutline()
    attention.target('first')

    Expect(attention.pressKey('primary+f')).toBe(true)
    Expect(invoked).toEqual(['First command'])
  })

  Test('keeps view-scoped chords in their active outline ancestry instead of promoting them globally', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const invoked: string[] = []
    const command = (name: string) =>
      TR.Interaction.Command({
        action: () => TR.Action(() => invoked.push(name)),
        members: { Key: () => TR.Value('primary+s'), Title: () => TR.Value(name) },
        name,
      })
    register(outline, region('active', { primary: true }))
    register(outline, item('active-item', 'active', 'Active item'))
    register(outline, region('other'))
    register(outline, item('other-item', 'other', 'Other item'))
    catalog.register({
      commands: [{
        command: () => command('Scoped'),
        identity: 'Scoped',
        name: 'Scoped',
        scope: { declaration: 'Scene', kind: 'view' },
        slots: [],
        static: { key: 'primary+s', title: 'Scoped' },
      }],
      module: 'Scene',
    }, 'active')
    attention.revalidateOutline()

    Expect(attention.pressKey('primary+s')).toBe(true)
    Expect(invoked).toEqual(['Scoped'])
    attention.focusRegion('other')
    Expect(attention.pressKey('primary+s')).toBe(false)
    Expect(invoked).toEqual(['Scoped'])
  })

  Test('uses a bare declared command key only inside the target verb layer', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const invoked: string[] = []
    const save = TR.Interaction.Command({
      action: () => TR.Action(() => invoked.push('Save')),
      members: { Key: () => TR.Value('s'), Title: () => TR.Value('Save') },
      name: 'Save',
    })
    catalog.register({
      commands: [{
        command: () => save,
        identity: 'Save',
        name: 'Save',
        scope: { kind: 'module' },
        slots: [],
        static: { key: 's', title: 'Save' },
      }],
      module: 'Commands',
    })
    register(outline, region('main', { primary: true }))
    register(outline, item('draft', 'main', 'Draft'))
    catalog.registerSurface({ commands: [save], hidden: [], identity: 'Draft row' }, 'draft')
    attention.revalidateOutline()

    Expect(attention.pressKey('s')).toBe(true)
    Expect(invoked).toEqual([])
    Expect(attention.read().narrowing).toBe('s')
    Expect(attention.pressKey('Backspace')).toBe(true)

    attention.target('draft')
    attention.openVerbs()
    Expect(attention.pressKey('s')).toBe(true)
    Expect(invoked).toEqual(['Save'])
    Expect(attention.read().narrowing).toBe('')
  })

  Test('does not dispatch a row-scoped shortcut until that row is targeted', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const invoked: string[] = []
    const rowCommand = (name: string) =>
      TR.Interaction.Command({
        action: () => TR.Action(() => invoked.push(name)),
        members: { Key: () => TR.Value('primary+e'), Title: () => TR.Value(name) },
        name,
      })
    register(outline, region('rows', { primary: true }))
    register(outline, item('first', 'rows', 'First'))
    register(outline, item('second', 'rows', 'Second'))
    catalog.registerSurface({ commands: [rowCommand('Edit first')], hidden: [], identity: 'First row' }, 'first')
    catalog.registerSurface({ commands: [rowCommand('Edit second')], hidden: [], identity: 'Second row' }, 'second')
    attention.revalidateOutline()

    Expect(attention.read().target).toBeUndefined()
    Expect(attention.pressKey('primary+e')).toBe(false)
    Expect(invoked).toEqual([])

    attention.target('first')
    Expect(attention.pressKey('primary+e')).toBe(true)
    Expect(invoked).toEqual(['Edit first'])
  })

  Test('narrows palette letters and cycles its selected command with arrows', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const invoked: string[] = []
    const registerCommand = (name: string) => {
      const command = TR.Interaction.Command({
        action: () => TR.Action(() => invoked.push(name)),
        members: { Title: () => TR.Value(name) },
        name,
      })
      catalog.register({
        commands: [{
          command: () => command,
          identity: name,
          name,
          scope: { kind: 'module' },
          slots: [],
          static: { title: name },
        }],
        module: `@test/${name}`,
      })
    }
    registerCommand('Archive')
    registerCommand('Duplicate')
    register(outline, region('main', { primary: true }))
    attention.revalidateOutline()

    attention.pressKey('primary+k')
    Expect(attention.read().target).toBe('Archive')
    Expect(attention.pressKey('d')).toBe(true)
    Expect(attention.read().narrowing).toBe('d')
    Expect(attention.read().target).toBe('Duplicate')
    Expect(invoked).toEqual([])

    attention.pressKey('Backspace')
    Expect(attention.read().target).toBe('Duplicate')
    attention.pressKey('ArrowDown')
    Expect(attention.read().target).toBe('Archive')
    attention.pressKey('ArrowDown')
    Expect(attention.read().target).toBe('Duplicate')
    attention.pressKey('ArrowUp')
    Expect(attention.read().target).toBe('Archive')
    attention.pressKey('Enter')
    Expect(invoked).toEqual(['Archive'])
  })

  Test('opens the palette beside an unfilled command and waits for its required value', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const invoked: string[] = []
    let titleReads = 0
    const copy = TR.Interaction.Command({
      action: fills => TR.Action(() => invoked.push(`Copy ${fills['Value']!.evaluate().jsValue}`)),
      members: {
        Title: fills => {
          titleReads += 1
          return TR.Value(`Copy ${fills['Value']!.evaluate().jsValue}`)
        },
      },
      name: 'Copy',
      slots: ['Value'],
    })
    const open = TR.Interaction.Command({
      action: () => TR.Action(() => invoked.push('Open')),
      members: { Key: () => TR.Value('primary+o'), Title: () => TR.Value('Open') },
      name: 'Open',
    })
    catalog.register({
      commands: [
        {
          command: () => copy,
          identity: 'Copy',
          name: 'Copy',
          scope: { kind: 'module' },
          slots: [{ entity: false, name: 'Value', required: true, scalarType: 'text', type: 'Text' }],
          static: { key: 'primary+c', title: 'Copy' },
        },
        {
          command: () => open,
          identity: 'Open',
          name: 'Open',
          scope: { kind: 'module' },
          slots: [],
          static: { title: 'Open' },
        },
      ],
      module: 'Commands',
    })
    register(outline, region('main', { primary: true }))
    attention.revalidateOutline()

    Expect(attention.pressKey('primary+k')).toBe(true)
    Expect(attention.read().mode).toBe('palette')
    Expect(attention.read().palette.map(entry => entry.label)).toEqual(['Copy', 'Open'])
    Expect(titleReads).toBe(0)

    attention.pressKey('Escape')
    Expect(attention.pressKey('primary+o')).toBe(true)
    Expect(invoked).toEqual(['Open'])
    Expect(attention.pressKey('primary+c')).toBe(true)
    Expect(attention.read().mode).toBe('verb-pending')
    Expect(attention.read().verbPending?.slot).toBe('Value')
    Expect(titleReads).toBe(0)
    Expect(attention.providePendingValue(TR.Value('draft'))).toBe(true)
    Expect(invoked).toEqual(['Open', 'Copy draft'])
    Expect(titleReads).toBeGreaterThan(0)
  })

  Test('keeps a mounted shell-sibling command available while navigation owns the focused region', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    let invoked = 0
    const pause = TR.Interaction.Command({
      action: () => TR.Action(() => invoked += 1),
      members: { Key: () => TR.Value('primary+p'), Title: () => TR.Value('Pause') },
      name: 'Pause',
    })
    register(outline, region('shell'))
    register(outline, region('editor', { parent: 'shell', primary: true }))
    register(outline, item('document', 'editor', 'Document'))
    register(outline, {
      identity: 'shell-siblings',
      kind: 'region',
      label: () => 'Focus session',
      live: { active: () => true },
      parent: 'shell',
      provenance: { role: 'nav-siblings' },
    })
    register(outline, {
      identity: 'focus-sessions',
      kind: 'collection',
      label: () => 'Focus sessions',
      parent: 'shell-siblings',
      provenance: {},
    })
    register(outline, item('session', 'focus-sessions', 'Session'))
    catalog.registerSurface({ commands: [pause], hidden: [], identity: 'FocusSessionControls' }, 'session')
    attention.revalidateOutline()
    attention.target('document')

    Expect(attention.pressKey('primary+p')).toBe(true)
    Expect(invoked).toBe(1)
  })

  Test('closes target-local verbs when attention moves to another region', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const command = TR.Interaction.Command({
      action: () => TR.Action(() => undefined),
      members: { Title: () => TR.Value('Edit') },
      name: 'Edit',
    })
    register(outline, region('first', { primary: true }))
    register(outline, item('first-item', 'first', 'First'))
    register(outline, region('second'))
    register(outline, item('second-item', 'second', 'Second'))
    catalog.registerSurface({ commands: [command], hidden: [], identity: 'First' }, 'first-item')
    attention.revalidateOutline()
    attention.target('first-item')
    attention.openVerbs()
    Expect(attention.read().mode).toBe('verbs')

    attention.pressKey('ArrowRight')

    Expect(attention.read().focusRegion).toBe('second')
    Expect(attention.read().mode).toBe('navigating')
    Expect(attention.read().verbs).toEqual([])
  })

  Test('reflects current command enablement and rechecks it after pending slot fills', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    let enabled = false
    let invoked = 0
    const direct = TR.Interaction.Command({
      action: () => TR.Action(() => invoked += 1),
      members: {
        Enabled: () => TR.Value(enabled),
        Label: () => TR.Value('Reactive direct label'),
        Title: () => TR.Value('Direct'),
      },
      name: 'Direct',
      slots: [],
    })
    const pending = TR.Interaction.Command({
      action: () => TR.Action(() => invoked += 10),
      members: { Enabled: () => TR.Value(enabled), Title: () => TR.Value('Pending') },
      name: 'Pending',
      slots: ['Document'],
    })
    catalog.register({
      commands: [
        {
          command: () => direct,
          identity: 'Direct',
          name: 'Direct',
          scope: { kind: 'module' },
          slots: [],
          static: { label: 'Static reactive label', title: 'Direct' },
        },
        {
          command: () => pending,
          identity: 'Pending',
          name: 'Pending',
          scope: { kind: 'module' },
          slots: [{ entity: true, name: 'Document', required: true, type: 'Document' }],
          static: { title: 'Pending' },
        },
      ],
      module: 'Commands',
    })
    register(outline, region('main', { primary: true }))
    register(
      outline,
      item('document', 'main', 'Draft', {
        entityType: 'Document',
        runtimeValue: TR.Value('draft'),
      }),
    )
    attention.revalidateOutline()

    attention.pressKey('primary+k')
    const directPaletteEntry = attention.read().palette.find(entry => entry.identity === 'Direct')
    Expect(directPaletteEntry?.enabled).toBe(false)
    Expect(directPaletteEntry?.label).toBe('Direct')
    attention.narrow('Direct')
    attention.pressKey('Enter')
    Expect(invoked).toBe(0)

    enabled = true
    attention.pressKey('primary+k')
    attention.narrow('Pending')
    attention.pressKey('Enter')
    Expect(attention.read().mode).toBe('verb-pending')
    enabled = false
    Expect(attention.choosePendingTarget('document')).toBe(true)
    Expect(invoked).toBe(0)
    Expect(attention.read().mode).toBe('navigating')
  })

  Test('refreshes an open verb surface across reactive changes and temporary zero results', async () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    let enabled = true
    let label = 'Archive'
    const archive = TR.Interaction.Command({
      action: () => TR.Action(() => undefined),
      members: {
        Enabled: () => TR.Value(enabled),
        Label: () => TR.Value(label),
        Title: () => TR.Value('Archive'),
      },
      name: 'Archive',
      slots: [],
    })
    register(outline, region('main', { primary: true }))
    register(outline, item('draft', 'main', 'Draft'))
    let withdrawSurface = catalog.registerSurface({ commands: [archive], hidden: [], identity: 'Draft' }, 'draft')
    attention.revalidateOutline()
    attention.target('draft')
    attention.openVerbs()
    Expect(attention.read().verbs).toEqual([
      Expect['objectContaining']({ enabled: true, label: 'Archive' }),
    ])

    enabled = false
    label = 'Archive unavailable'
    attention.refreshVerbs()
    await Promise.resolve()
    Expect(attention.read().verbs).toEqual([
      Expect['objectContaining']({ enabled: false, label: 'Archive unavailable' }),
    ])

    withdrawSurface()
    attention.refreshVerbs()
    await Promise.resolve()
    Expect(attention.read().mode).toBe('verbs')
    Expect(attention.read().verbs).toEqual([])

    enabled = true
    label = 'Archive restored'
    withdrawSurface = catalog.registerSurface({ commands: [archive], hidden: [], identity: 'Draft' }, 'draft')
    attention.refreshVerbs()
    await Promise.resolve()
    Expect(attention.read().mode).toBe('verbs')
    Expect(attention.read().verbs).toEqual([
      Expect['objectContaining']({ enabled: true, label: 'Archive restored' }),
    ])
    withdrawSurface()
  })

  Test('notifies attention when stable live capabilities change without remounting', async () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    let active = true
    let enabled = true
    const regionLive = { active: () => active, modal: false, primary: true }
    register(outline, {
      identity: 'main',
      kind: 'region',
      label: () => 'Main',
      live: regionLive,
      provenance: {},
    })
    register(outline, item('draft', 'main', 'Draft', { activate: () => undefined, enabled: () => enabled }))
    attention.revalidateOutline()
    attention.target('draft')
    Expect(attention.read().target).toBe('draft')
    // Drain structural registration revalidation so only the stable capability mutation can notify.
    await Promise.resolve()

    enabled = false
    outline.refreshLive()
    await Promise.resolve()
    await Promise.resolve()
    Expect(attention.read().target).toBeUndefined()
    Expect(attention.read().candidates).toEqual([])

    const liveRevision = outline.liveSnapshot()
    regionLive.modal = true
    regionLive.primary = false
    outline.refreshLive()
    await Promise.resolve()
    Expect(outline.liveSnapshot()).toBe(liveRevision + 1)

    active = false
    outline.refreshLive()
    await Promise.resolve()
    await Promise.resolve()
    Expect(attention.read().focusRegion).toBeUndefined()
  })

  Test('folds a rendered control whose visible verb label duplicates a promoted command', () => {
    const outline = new InteractionOutline()
    const catalog = new CommandCatalog()
    const attention = new InteractionAttention(outline, catalog)
    const finish = TR.Interaction.Command({
      action: () => TR.Action(() => undefined),
      members: { Title: () => TR.Value('Finish document') },
      name: 'Finish',
    })
    register(outline, region('documents', { primary: true }))
    register(outline, item('document', 'documents', 'Draft'))
    register(outline, {
      identity: 'finish-button',
      kind: 'action',
      label: () => 'Finish document',
      live: { activate: () => undefined },
      parent: 'document',
      provenance: {},
    })
    catalog.registerSurface({ commands: [finish], hidden: [], identity: 'DocumentRow' }, 'document')
    attention.revalidateOutline()
    attention.target('document')
    attention.openVerbs()

    Expect(attention.read().verbs.map(verb => verb.label)).toEqual(['Finish document'])
  })

  Test('publishes focused, pressed, and hovered conditions from one semantic control identity', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'save',
      kind: 'action',
      label: () => 'Save',
      live: {},
      parent: 'main',
      provenance: {},
    })
    const occurrence: TaoInteractionOccurrence = { capabilities: {}, control: 'save', scope: 'view#1' }
    attention.revalidateOutline()
    attention.target('save')
    attention.setPressed('save', true)
    attention.setHovered('save', true)

    Expect(attention.condition('focused', undefined, occurrence)).toBe(true)
    Expect(attention.condition('pressed', undefined, occurrence)).toBe(true)
    Expect(attention.condition('hovered', undefined, occurrence)).toBe(true)
  })

  Test('clears engagement before an imperative blur reports the same native blur', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    let blurs = 0
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'editor',
      kind: 'input',
      label: () => 'Editor',
      live: {
        blur: () => {
          blurs += 1
          attention.disengage('editor')
        },
      },
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.engage('editor')
    let notifications = 0
    const unsubscribe = attention.subscribe(() => notifications += 1)

    attention.disengage('editor')

    Expect(blurs).toBe(1)
    Expect(notifications).toBe(1)
    Expect(attention.read().engaged).toBeUndefined()
    Expect(attention.read().targetLabel).toBe('Editor')
    unsubscribe()
  })

  Test('disengages an input before pointer attention transfers to another control', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    let blurs = 0
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'editor',
      kind: 'input',
      label: () => 'Editor',
      live: { blur: () => blurs += 1 },
      parent: 'main',
      provenance: {},
    })
    register(outline, {
      identity: 'add',
      kind: 'action',
      label: () => 'Add workspace',
      live: {},
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.engage('editor')

    attention.target('add')
    attention.narrow('pro')

    Expect(blurs).toBe(1)
    Expect(attention.read().engaged).toBeUndefined()
    Expect(attention.read().narrowing).toBe('pro')
  })

  Test('direct narrowing disengages an input while hardware typing stays platform-owned', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'editor',
      kind: 'input',
      label: () => 'Editor',
      live: {},
      parent: 'main',
      provenance: {},
    })
    register(outline, item('projects', 'main', 'Projects'))
    attention.revalidateOutline()
    attention.engage('editor')

    Expect(attention.pressKey('p')).toBe(false)
    Expect(attention.read().engaged).toBe('editor')
    attention.narrow('pro')

    Expect(attention.read().engaged).toBeUndefined()
    Expect(attention.read().narrowing).toBe('pro')
    Expect(attention.read().target).toBe('projects')
  })

  Test('opens the palette by blurring and leaving an engaged input', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    let blurs = 0
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'editor',
      kind: 'input',
      label: () => 'Editor',
      live: { blur: () => blurs += 1 },
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.engage('editor')

    Expect(attention.pressKey('primary+k')).toBe(true)
    Expect(blurs).toBe(1)
    Expect(attention.read().engaged).toBeUndefined()
    Expect(attention.read().mode).toBe('palette')
    attention.pressKey('a')
    Expect(attention.read().narrowing).toBe('a')
  })

  Test('cannot engage a missing or disabled outline node', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    register(outline, region('main', { primary: true }))
    register(outline, {
      identity: 'disabled',
      kind: 'input',
      label: () => 'Disabled editor',
      live: { enabled: () => false },
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()

    attention.engage('missing')
    Expect(attention.read().engaged).toBeUndefined()
    attention.engage('disabled')
    Expect(attention.read().engaged).toBeUndefined()
  })

  Test('disengages and blurs an input when its retained outline ancestry becomes inactive or disabled', () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    let active = true
    let enabled = true
    let blurs = 0
    register(outline, region('main', { active: () => active, primary: true }))
    register(outline, {
      identity: 'editor',
      kind: 'input',
      label: () => 'Editor',
      live: { blur: () => blurs += 1, enabled: () => enabled },
      parent: 'main',
      provenance: {},
    })
    attention.revalidateOutline()
    attention.engage('editor')

    active = false
    attention.revalidateOutline()
    Expect(attention.read().engaged).toBeUndefined()
    Expect(blurs).toBe(1)

    active = true
    attention.revalidateOutline()
    attention.engage('editor')
    enabled = false
    attention.revalidateOutline()
    Expect(attention.read().engaged).toBeUndefined()
    Expect(blurs).toBe(2)
  })
})

function measuredNode(
  identity: string,
  bounds: ReturnType<NonNullable<NonNullable<TaoOutlineEntry['live']>['measure']>>,
): TaoOutlineLiveNode {
  return {
    identity,
    kind: 'item',
    label: () => identity,
    live: { measure: () => bounds },
    mount: 1,
    order: 1,
    provenance: {},
  }
}
