import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import { DesignControls } from '../TaoRuntime-src/TR-design'
import { InteractionAttention } from '../TaoRuntime-src/TR-interaction-attention'
import { CommandCatalog } from '../TaoRuntime-src/TR-interaction-catalog'
import {
  InteractionOutline,
  siblingRegionIdentity,
  type TaoInteractionOccurrence,
  type TaoOutlineEntry,
} from '../TaoRuntime-src/TR-interaction-outline'

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
        Workspace: { collection: 'Workspaces', fields: { Name: { kind: 'text' } } },
      },
      name: 'InteractionPicker',
    }, testDataConnection())
    TR.Data.Create(schema, 'Document', { Title: TR.Value('Other') })
    TR.Data.Create(schema, 'Workspace', { Name: TR.Value('Archive') })
    const otherDocument = schema.query({ entity: 'Document', filters: [] })[0]
    const workspace = schema.query({ entity: 'Workspace', filters: [] })[0]
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
    Expect(attention.choosePendingSearchResult(TR.Value(workspace))).toBe(true)
    Expect(selected).toBe(workspace)
    Expect(attention.read().verbPending).toBeUndefined()
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
})
