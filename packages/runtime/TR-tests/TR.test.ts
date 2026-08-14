import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoLayout, TaoLayoutEntry } from '../TaoRuntime-src/TR-layout'

function layoutEntries(layout: TaoLayout | undefined): readonly TaoLayoutEntry[] {
  return layout?.entries ?? []
}

function configuredStack(name: string, initial: TR.Presentable): TR.NavigationValue {
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration(name, TR.NavKind.Stack()),
    { Initial: initial },
  ))
}

function configuredSlot(
  name: string,
  initial: TR.Presentable | TR.NavigationValue,
): TR.NavigationValue {
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration(name, TR.NavKind.Slot()),
    { Initial: initial },
  ))
}

function configuredSelection(definition: {
  display: TR.Evaluable
  initial: string
  items: Record<string, { content: TR.Presentable | TR.NavigationValue; label: TR.Evaluable }>
  name: string
}): TR.NavigationValue {
  const items = Object.fromEntries(
    Object.entries(definition.items).map(([key, item]) => [
      `@${key}`,
      { Content: item.content, Label: item.label },
    ]),
  )
  return TR.Navigation.Mount(TR.Navigation.Configure(
    TR.Navigation.Declaration(definition.name, TR.NavKind.Selection()),
    {
      Display: definition.display,
      Initial: TR.Value(`@${definition.initial}`),
      ...items,
    },
  ))
}

Describe('TR.Value', () => {
  Test('wraps JavaScript values as evaluable Tao runtime values', () => {
    const value: TR.Value<string> = TR.Value('Hello')

    Expect(value.jsValue).toBe('Hello')
    Expect(value.evaluate()).toBe(value)
  })
})

Describe('TR.Alias', () => {
  Test('wraps evaluable Tao values as aliases', () => {
    const value: TR.Value<number> = TR.Value(3)
    const alias: TR.Alias<number> = TR.Alias(value)

    Expect(alias.evaluate()).toBe(value)
    Expect(alias.evaluate().jsValue).toBe(3)
  })

  Test('re-evaluates lazy let values on each use', () => {
    let evaluations = 0
    const alias: TR.Alias<string> = TR.Alias(() => {
      evaluations += 1
      return TR.Value(`lazy ${evaluations}`)
    })

    Expect(evaluations).toBe(0)
    Expect(alias.evaluate().jsValue).toBe('lazy 1')
    Expect(alias.evaluate().jsValue).toBe('lazy 2')
    Expect(evaluations).toBe(2)
  })

  Test('preserves parameterized action types through aliases', () => {
    const calls: string[] = []
    const alias: TR.Alias<TR.Action<[TR.Value<string>]>> = TR.Alias(() =>
      TR.Action((value: TR.Value<string>) => calls.push(value.jsValue))
    )

    TR.Do(alias.evaluate(), TR.Value('saved'))

    Expect(calls).toEqual(['saved'])
  })
})

Describe('TR.Action', () => {
  Test('exposes invokable action payloads', () => {
    const calls: number[] = []
    const action = TR.Action((step: number) => calls.push(step))

    action.jsValue.invoke(2)

    Expect(action.evaluate()).toBe(action)
    Expect(action.evaluate().jsValue).toBe(action.jsValue)
    Expect(calls).toEqual([2])
  })

  Test('invokes action payloads through TR.Do with runtime arguments', () => {
    const calls: number[] = []
    const action = TR.Action((step: number) => calls.push(step))

    TR.Do(action, 3)

    Expect(calls).toEqual([3])
  })
})

Describe('TR.Set', () => {
  Test('updates state wrappers with evaluated runtime values', () => {
    let assigned: number | undefined
    const state = {
      evaluate: () => TR.Value(1),
      set(value: TR.Value<number>) {
        assigned = value.evaluate().jsValue
      },
    } as TR.State<number>

    TR.Set(state, () => TR.Value(5))

    Expect(assigned).toBe(5)
  })
})

Describe('TR.CompoundSet', () => {
  Test('computes numeric compound state updates', () => {
    const state = {
      evaluate: () => TR.Value(8),
    } as TR.State<number>

    Expect(TR.CompoundSet(state, '+=', TR.Value(2)).jsValue).toBe(10)
    Expect(TR.CompoundSet(state, '-=', TR.Value(2)).jsValue).toBe(6)
    Expect(TR.CompoundSet(state, '*=', TR.Value(2)).jsValue).toBe(16)
    Expect(TR.CompoundSet(state, '/=', TR.Value(2)).jsValue).toBe(4)
  })
})

Describe('TR.BlockScope', () => {
  Test('creates child scopes that can shadow parent declarations', () => {
    const parent: TR.Scope = {
      Name: TR.Alias(TR.Value('parent')),
    }

    const result = TR.BlockScope(parent, child => {
      child['Name'] = TR.Alias(TR.Value('child'))
      return {
        child,
        value: child['Name'].evaluate().jsValue,
      }
    })

    Expect(result.value).toBe('child')
    Expect(parent['Name'].evaluate().jsValue).toBe('parent')
    Expect(Object.getPrototypeOf(result.child)).toBe(parent)
  })
})

Describe('TR.Use', () => {
  Test('binds imported declarations lazily so cyclic modules resolve after initialization', () => {
    const scope: TR.Scope = {}
    let imported: TR.Alias<string> | undefined
    TR.Use(scope, 'Greeting', () => imported)

    imported = TR.Alias(TR.Value('Hello'))

    Expect(scope['Greeting']).toBe(imported)
    Expect(scope['Greeting'].evaluate().jsValue).toBe('Hello')
  })

  Test('reflects live updates of the imported binding', () => {
    const scope: TR.Scope = {}
    let imported = TR.Alias(TR.Value('first'))
    TR.Use(scope, 'Name', () => imported)

    Expect(scope['Name'].evaluate().jsValue).toBe('first')
    imported = TR.Alias(TR.Value('second'))
    Expect(scope['Name'].evaluate().jsValue).toBe('second')
  })

  Test('lets child scopes shadow imported bindings', () => {
    const scope: TR.Scope = {}
    TR.Use(scope, 'Name', () => TR.Alias(TR.Value('imported')))

    const shadowed = TR.BlockScope(scope, child => {
      child['Name'] = TR.Alias(TR.Value('local'))
      return child['Name'].evaluate().jsValue
    })

    Expect(shadowed).toBe('local')
    Expect(scope['Name'].evaluate().jsValue).toBe('imported')
  })
})

Describe('TR.Layout', () => {
  Test('resolves deterministic container defaults from explicit entries', () => {
    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: [['content', 'baseline', 'left'], ['fill']],
    })).toEqual({
      alignItems: 'baseline',
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexGrow: 1,
      justifyContent: 'flex-start',
    })
    Expect(TR.Layout.resolve({
      direction: 'column',
      entries: [['content', 'top', 'stretch'], ['fill']],
    })).toEqual({
      alignItems: 'stretch',
      alignSelf: 'stretch',
      flexDirection: 'column',
      flexGrow: 1,
      justifyContent: 'flex-start',
    })
    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: [['content', 'left', 'center'], ['hug']],
    })).toEqual({
      alignItems: 'center',
      flexDirection: 'row',
      flexGrow: 0,
      justifyContent: 'flex-start',
    })
    Expect(TR.Layout.resolve({
      direction: 'column',
      entries: [['content', 'top', 'center'], ['hug']],
    })).toEqual({
      alignItems: 'center',
      flexDirection: 'column',
      flexGrow: 0,
      justifyContent: 'flex-start',
    })
    Expect({
      ...TR.Layout.resolve({
        direction: 'row',
        entries: [['content', 'baseline', 'left'], ['compress'], ['hug']],
      }),
      flexWrap: 'wrap',
    }).toEqual({
      alignItems: 'baseline',
      flexDirection: 'row',
      flexGrow: 0,
      flexShrink: 1,
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
    })
  })

  Test('maps content, spacing, and pressure entries to React Native style values', () => {
    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: [
        ['content', 'spread-inset', 'center'],
        ['gap', 8],
        ['pad', 'horizontal', 4, 'vertical', 2],
        ['margin', 'top', 3, 'horizontal', 5],
        ['compress'],
        ['fill'],
      ],
    })).toEqual({
      alignItems: 'center',
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexGrow: 1,
      flexShrink: 1,
      gap: 8,
      justifyContent: 'space-around',
      marginLeft: 5,
      marginRight: 5,
      marginTop: 3,
      paddingBottom: 2,
      paddingLeft: 4,
      paddingRight: 4,
      paddingTop: 2,
    })
    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: [
        ['content', 'center'],
        ['gap', 2],
      ],
    })).toEqual({
      alignItems: 'center',
      flexDirection: 'row',
      gap: 2,
      justifyContent: 'center',
    })
  })

  Test('maps dimensions and axis-relative item sizing', () => {
    Expect(TR.Layout.resolve({
      parentDirection: 'row',
      entries: [
        ['aligned', 'center'],
        ['width', 'fill'],
      ],
    })).toEqual({
      alignSelf: 'center',
      flexGrow: 1,
    })
    Expect(TR.Layout.resolve({
      parentDirection: 'row',
      entries: [
        ['width', 'fill'],
        ['height', 32],
      ],
    })).toEqual({
      flexGrow: 1,
      height: 32,
    })
    Expect(TR.Layout.resolve({
      parentDirection: 'column',
      entries: [
        ['width', 'fill'],
        ['height', 'fill'],
      ],
    })).toEqual({
      alignSelf: 'stretch',
      flexGrow: 1,
    })
    Expect(TR.Layout.resolve({
      entries: [
        ['fill'],
      ],
    })).toEqual({
      alignSelf: 'stretch',
      flexGrow: 1,
    })
    Expect(TR.Layout.resolve({
      entries: [
        ['fill'],
        ['hug'],
      ],
    })).toEqual({
      alignSelf: 'stretch',
      flexGrow: 0,
    })
    Expect(TR.Layout.resolve({
      entries: [
        ['claim', 2],
      ],
    })).toEqual({
      flexGrow: 2,
    })
  })

  Test('exposes only generated-code layout controls', () => {
    Expect(typeof TR.Layout.create).toBe('function')
    Expect(typeof TR.Layout.merge).toBe('function')
    Expect(typeof TR.Layout.resolve).toBe('function')
    Expect('nativePropsWithStyle' in TR.Layout).toBe(false)
    Expect('resolveProps' in TR.Layout).toBe(false)
  })

  Test('overlays layout entries over defaults by semantic slot', () => {
    const rowLayout = TR.Layout.merge(
      TR.Layout.create([['content', 'baseline', 'left'], ['fill'], ['gap', 4]]),
      TR.Layout.create([['content', 'right'], ['gap', 8]]),
      { direction: 'row' },
    )

    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: layoutEntries(rowLayout),
    })).toEqual({
      alignItems: 'baseline',
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexGrow: 1,
      gap: 8,
      justifyContent: 'flex-end',
    })

    const claimedRowLayout = TR.Layout.merge(
      TR.Layout.create([['content', 'baseline', 'left'], ['fill']]),
      TR.Layout.create([['claim', 2]]),
      { direction: 'row' },
    )

    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: layoutEntries(claimedRowLayout),
    })).toEqual({
      alignItems: 'baseline',
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexGrow: 2,
      justifyContent: 'flex-start',
    })

    const spacingLayout = TR.Layout.merge(
      TR.Layout.create([['pad', 12], ['margin', 'vertical', 4]]),
      TR.Layout.create([['pad', 'horizontal', 6], ['margin', 'left', 2]]),
    )

    Expect(TR.Layout.resolve({
      entries: layoutEntries(spacingLayout),
    })).toEqual({
      marginBottom: 4,
      marginLeft: 2,
      marginTop: 4,
      paddingBottom: 12,
      paddingLeft: 6,
      paddingRight: 6,
      paddingTop: 12,
    })
  })

  Test('treats missing layouts as empty inputs when merging', () => {
    const overlayOnly = TR.Layout.merge(
      undefined,
      TR.Layout.create([['content', 'right'], ['gap', 8]]),
      { direction: 'row' },
    )
    const baseOnly = TR.Layout.merge(
      TR.Layout.create([['content', 'baseline', 'left'], ['fill']]),
      undefined,
      { direction: 'row' },
    )

    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: layoutEntries(overlayOnly),
    })).toEqual({
      flexDirection: 'row',
      gap: 8,
      justifyContent: 'flex-end',
    })
    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: layoutEntries(baseOnly),
    })).toEqual({
      alignItems: 'baseline',
      alignSelf: 'stretch',
      flexDirection: 'row',
      flexGrow: 1,
      justifyContent: 'flex-start',
    })
    Expect(TR.Layout.merge(undefined, undefined, { direction: 'row' })).toBeUndefined()
  })
})

Describe('TR.TaoProps', () => {
  Test('packages local props with optional caller props without resolving them', () => {
    const callerProps = {
      layout: TR.Layout.create([['gap', 12], ['pad', 4]]),
    }
    Expect(TR.TaoProps(
      { layout: TR.Layout.create([['gap', 8]]) },
      callerProps,
    )).toEqual({
      layout: { entries: [['gap', 8]] },
      callerProps,
    })
    Expect(TR.TaoProps({ style: { backgroundColor: 'red' } })).toEqual({
      style: { backgroundColor: 'red' },
    })
    Expect(TR.TaoProps(
      { parentDirection: 'row' },
      { parentDirection: 'column' },
    )).toEqual({
      callerProps: { parentDirection: 'column' },
      parentDirection: 'row',
    })
    Expect(TR.TaoProps(
      { layout: TR.Layout.create([['width', 'fill']]) },
      { parentDirection: 'column' },
    )).toEqual({
      callerProps: { parentDirection: 'column' },
      layout: { entries: [['width', 'fill']] },
      parentDirection: 'column',
    })
    Expect(TR.TaoProps({ layout: undefined })).toEqual({ layout: undefined })
    Expect(TR.TaoProps({}, undefined)).toEqual({})
  })

  Test('copies ambient app, dialogue, and navigation context without carrying layout props', () => {
    const home = TR.Navigation.UI({ name: 'Ambient home', render: () => null })
    const navigation = configuredStack('Ambient stack', home)
    const app = TR.Navigation.App({
      name: 'Ambient app',
      navigator: () => navigation,
      auxiliaries: () => ({}),
    })
    const dialogue = { respond: () => {} }

    Expect(TR.TaoContext({
      layout: TR.Layout.create([['gap', 9]]),
      testTag: 'outer',
      callerProps: { app, dialogue, navigation },
    })).toEqual({ app, dialogue, navigation })
  })
})

Describe('TR.Views', () => {
  Test('exposes runtime-backed stdlib primitive views', () => {
    Expect(Object.keys(TR.Views).sort()).toEqual(['Pressable', 'Text', 'TextInput', 'View'])
  })
})

Describe('TR.Data', () => {
  Test('persists local rows and applies strict update, relationship cascade, and rehydration', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value)
      },
    }
    const definition = {
      name: 'RuntimeDataTest',
      entities: {
        Workspace: { collection: 'Workspaces', fields: { Name: { kind: 'text' as const } } },
        Task: {
          collection: 'Tasks',
          fields: {
            Title: { kind: 'text' as const },
            Workspace: {
              kind: 'relation' as const,
              relation: 'Workspace',
              onDelete: 'cascade' as const,
            },
          },
        },
      },
    }
    const provider = TR.DataProvider.Local(storage, 'runtime-test')
    const schema = TR.Data.Schema(definition, provider, 'runtime-data-test')
    await TR.Data.Settle(schema)
    TR.Data.Create(schema, 'Workspace', { Name: TR.Value('Home') })
    Expect(() =>
      TR.Data.Create(schema, 'Task', {
        Title: TR.Value('Draft'),
        Workspace: TR.Value('Workspace-1'),
      })
    ).toThrow("Relationship 'Task.Workspace' expects a live Workspace entity handle.")
    const workspace = schema.query({ entity: 'Workspace', filters: [] })[0]
    TR.Data.Create(schema, 'Task', { Title: TR.Value('Draft'), Workspace: TR.Value(workspace) })
    await TR.Data.Settle(schema)
    const initiallyRehydrated = TR.Data.Schema(definition, provider, 'runtime-data-test')
    await TR.Data.Settle(initiallyRehydrated)
    Expect(initiallyRehydrated.query({ entity: 'Workspace', filters: [] })).toHaveLength(1)
    Expect(initiallyRehydrated.query({ entity: 'Task', filters: [] })).toHaveLength(1)
    const tasks = schema.query({ entity: 'Task', filters: [] }) as Array<Record<string, unknown>>
    Expect(tasks).toHaveLength(1)
    TR.Data.Update(TR.Value(tasks[0]), { Title: TR.Value('Updated') })
    Expect((schema.query({ entity: 'Task', filters: [] })[0] as Record<string, unknown>)['Title']).toBe('Updated')
    const workspaces = schema.query({ entity: 'Workspace', filters: [] })
    TR.Data.Delete(TR.Value(workspaces[0]))
    Expect(schema.query({ entity: 'Task', filters: [] })).toHaveLength(0)
    await TR.Data.Settle(schema)

    const rehydrated = TR.Data.Schema(definition, provider, 'runtime-data-test')
    await TR.Data.Settle(rehydrated)
    Expect(rehydrated.query({ entity: 'Workspace', filters: [] })).toHaveLength(0)
  })

  Test(
    'rehydrates the version-1 envelope under an explicit key with inverse fields and next-ID continuity',
    async () => {
      const values = new Map<string, string>([[
        'runtime-test:WordFlowerData',
        JSON.stringify({
          formatVersion: 1,
          schemaVersion: 1,
          nextId: 7,
          rows: {
            Workspace: [{ Id: 'Workspace-1', Name: 'Home', CreatedAt: 10 }],
            Document: [{ Id: 'Document-4', Title: 'First', Final: false, Workspace: 'Workspace-1' }],
          },
        }),
      ]])
      const storage = {
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          values.set(key, value)
        },
      }
      const definition = {
        name: 'Data',
        schemaVersion: 1,
        entities: {
          Workspace: {
            collection: 'Workspaces',
            defaultOrder: { field: 'CreatedAt', direction: 'asc' as const },
            fields: { Name: { kind: 'text' as const }, CreatedAt: { kind: 'time' as const } },
            inverseFields: { Documents: { relation: 'Document', inverseField: 'Workspace' } },
          },
          Document: {
            collection: 'Documents',
            fields: {
              Title: { kind: 'text' as const },
              Final: { kind: 'boolean' as const, defaultValue: false },
              Workspace: { kind: 'relation' as const, relation: 'Workspace' },
            },
          },
        },
      }
      const provider = TR.DataProvider.Local(storage, 'runtime-test')
      const schema = TR.Data.Schema(definition, provider, 'WordFlowerData')
      await TR.Data.Settle(schema)
      const workspace = schema.query({ entity: 'Workspace', filters: [] })[0] as Record<string, unknown>
      Expect(workspace['Documents'] as unknown[]).toHaveLength(1)
      TR.Data.Create(schema, 'Document', {
        Title: TR.Value('Second'),
        Workspace: TR.Value(workspace),
      })
      await TR.Data.Settle(schema)
      const documents = schema.query({ entity: 'Document', filters: [] }) as Array<Record<string, unknown>>
      Expect(documents.map(document => document['Id'])).toEqual(['Document-4', 'Document-7'])
      Expect(documents[1]?.['Final']).toBe(false)
      Expect(values.has('runtime-test:WordFlowerData')).toBe(true)
    },
  )
})

Describe('TR.Navigation', () => {
  Test('publishes immutable descriptors, independent mounts, and profile conformance', () => {
    TR.testNavKind(TR.NavKind.Stack(), 'stack')
    TR.testNavKind(TR.NavKind.Slot(), 'slot')
    TR.testNavKind(TR.NavKind.Selection(), 'selection')

    const kind = TR.NavKind.Stack()
    const declaration = TR.NavKind.Declaration('ThirdPartyStack')
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const detail = TR.Navigation.UI({ name: 'Detail', render: () => null })
    const descriptor: TR.NavDescriptor<'stack', TR.StackNavConfiguration> = kind.configure(
      declaration,
      { initial: home },
    )
    const first: TR.NavMount<'stack', TR.StackNavConfiguration> = kind.mount(descriptor)
    const second = kind.mount(descriptor)

    Expect(Object.isFrozen(declaration)).toBe(true)
    Expect(Object.isFrozen(descriptor)).toBe(true)
    Expect(Object.isFrozen(descriptor.config)).toBe(true)
    Expect(descriptor.declaration).toBe(declaration)
    Expect(first).not.toBe(second)
    Expect(kind.render(first)).not.toBe(undefined)
    kind.present(first, detail, {})
    Expect(kind.canGoBack(first)).toBe(true)
    Expect(kind.canGoBack(second)).toBe(false)
    Expect(kind.back(first)).toBe(true)
  })

  Test('mounts declaration-owned descriptors per app occurrence and resolves explicit nested targets', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const detail = TR.Navigation.UI({ name: 'Detail', render: () => null })
    const stackDeclaration = TR.Navigation.Declaration('CopiedStack', TR.NavKind.Stack())
    const slotDeclaration = TR.Navigation.Declaration('CopiedSlot', TR.NavKind.Slot())
    const nestedStack = TR.Navigation.Configure(stackDeclaration, { Initial: home })
    const rootSlot = TR.Navigation.Configure(slotDeclaration, { Initial: nestedStack })
    const app = TR.Navigation.App({
      name: 'Descriptor app',
      navigator: () => rootSlot,
      auxiliaries: () => ({}),
    })

    Expect(Object.isFrozen(stackDeclaration)).toBe(true)
    Expect(Object.isFrozen(nestedStack)).toBe(true)
    Expect(nestedStack.evaluate()).toBe(nestedStack)
    Expect(app.navigator.kind).toBe('slot')
    Expect(app.resolve(nestedStack)).toBeDefined()

    TR.Navigation.PresentIn({ app }, nestedStack, detail, {})
    Expect(app.canGoBack).toBe(true)
    Expect(app.back()).toBe(true)
    Expect(app.canGoBack).toBe(false)

    const patched = TR.Navigation.Patch(nestedStack, { Initial: detail })
    Expect(patched).not.toBe(nestedStack)
    Expect(patched.declaration).toBe(stackDeclaration)
    Expect(nestedStack.config['Initial']).toBe(home)
  })

  Test('composes declaration-owned navs, app targets, nav overlays, dismiss, and replacement', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const detail = TR.Navigation.UI({ name: 'Detail', render: () => null })
    const stack = configuredStack('Main', home)
    const slot = configuredSlot('Slot', stack)
    const window = configuredSlot('Window', home)
    const replacement = configuredStack('Replacement', detail)
    const app = TR.Navigation.App({
      name: 'Configured navigation test',
      navigator: () => slot,
      auxiliaries: () => ({ window }),
    })

    TR.Navigation.PresentIn(undefined, stack, detail, {})
    Expect(stack.back()).toBe(true)
    TR.Navigation.PresentIn(undefined, slot, detail, {})
    Expect(slot.dismiss()).toBe(true)
    const target = TR.Navigation.Target(app, 'window')
    Expect(target).toBe(window)
    TR.Navigation.PresentOverlay(undefined, target, detail, {})
    Expect(app.back()).toBe(true)
    TR.Navigation.Replace(replacement, app)
    Expect(app.navigator).toBe(replacement)
    TR.Navigation.beginTest()
    Expect(app.navigator).toBe(slot)
  })

  Test('hosts overlays directly on every configured navigation value', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const notice = TR.Navigation.UI({ name: 'Notice', render: () => null })
    const stack = configuredStack('Stack', home)
    const slot = configuredSlot('Slot', stack)

    TR.Navigation.PresentOverlay(undefined, stack, notice, {})
    TR.Navigation.PresentOverlay(undefined, stack, notice, {})
    Expect(stack.canGoBack).toBe(true)
    Expect(stack.back()).toBe(true)
    Expect(stack.back()).toBe(true)
    Expect(stack.back()).toBe(false)

    TR.Navigation.PresentOverlay(undefined, slot, notice, {})
    Expect(slot.canGoBack).toBe(true)
    Expect(slot.dismiss()).toBe(true)
    Expect(slot.canGoBack).toBe(false)
  })

  Test('owns keyed transient toasts at app scope without participating in Back', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const saved = TR.Navigation.UI({ name: 'Saved', render: () => null })
    const stack = configuredStack('Toast host', home)
    const app = TR.Navigation.App({ name: 'Toast App', navigator: () => stack, auxiliaries: () => ({}) })
    const taoProps: TR.TaoProps = { app }

    TR.Navigation.PresentToast(taoProps, saved, {}, {
      duration: TR.Value(3),
      key: TR.Value('saved'),
    })
    Expect(app.canGoBack).toBe(false)
    Expect(app.back()).toBe(false)
    Expect(() =>
      TR.Navigation.PresentToast(taoProps, saved, {}, {
        duration: TR.Value(0),
        key: TR.Value(''),
      })
    ).not.toThrow()
    Expect(() =>
      TR.Navigation.PresentToast(taoProps, saved, {}, {
        duration: TR.Value(1),
        key: TR.Value(1),
      })
    ).toThrow('Key must evaluate to text')
    Expect(() =>
      TR.Navigation.PresentToast(taoProps, saved, {}, {
        duration: TR.Value(Number.POSITIVE_INFINITY),
        key: TR.Value('saved'),
      })
    ).toThrow('Duration must be a finite non-negative number')
    Expect(() =>
      TR.Navigation.PresentToast(taoProps, saved, {}, {
        duration: TR.Value(-1),
        key: TR.Value('saved'),
      })
    ).toThrow('Duration must be a finite non-negative number')
    TR.Navigation.beginTest()
  })

  Test('stacks independent dialogue asks and resolves back or dismiss as none', async () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const confirm = TR.Navigation.Dialogue({ name: 'Confirm', render: () => null })
    const stack = configuredStack('Dialogue host', home)
    const taoProps: TR.TaoProps = { navigation: stack }

    const first = TR.Navigation.Ask(taoProps, confirm, { Title: TR.Value('First') })
    const second = TR.Navigation.Ask(taoProps, confirm, { Title: TR.Value('Second') })
    Expect(stack.canGoBack).toBe(true)

    Expect(stack.back()).toBe(true)
    Expect((await second).evaluate().jsValue).toBe(null)
    Expect(stack.canGoBack).toBe(true)

    TR.Navigation.Dismiss(taoProps)
    Expect((await first).evaluate().jsValue).toBe(null)
    Expect(stack.canGoBack).toBe(false)
  })

  Test('activates keyed selection items without adding navigation history', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const settings = TR.Navigation.UI({ name: 'Settings', render: () => null })
    const homeStack = configuredStack('Home stack', home)
    const settingsStack = configuredStack('Settings stack', settings)
    const selection = configuredSelection({
      display: TR.Value('automatic'),
      initial: 'home',
      items: {
        home: { content: homeStack, label: TR.Value('Home') },
        settings: { content: settingsStack, label: TR.Value('Settings') },
      },
      name: 'Main selection',
    })
    const app = TR.Navigation.App({
      name: 'Selection App',
      navigator: () => selection,
      auxiliaries: () => ({}),
    })

    Expect(app.canGoBack).toBe(false)
    TR.Navigation.Activate(app, 'settings')
    Expect(app.canGoBack).toBe(false)
    Expect(() => TR.Navigation.Activate(app, 'missing')).toThrow(
      "App Selection App has no selection item '@missing'.",
    )

    TR.Navigation.PresentIn(undefined, settingsStack, home, {})
    Expect(app.canGoBack).toBe(true)
    Expect(app.back()).toBe(true)
    Expect(app.canGoBack).toBe(false)
    TR.Navigation.beginTest()
    Expect(app.canGoBack).toBe(false)
  })

  Test('patches configured navigation into an independent value without mutating its base', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const detail = TR.Navigation.UI({ name: 'Detail', render: () => null })
    const base = configuredStack('Base stack', home)
    const patched = TR.Navigation.Patch(base, { Initial: detail })

    Expect(patched).not.toBe(base)
    Expect(base.canGoBack).toBe(false)
    Expect(patched.canGoBack).toBe(false)
    TR.Navigation.PresentIn(undefined, patched, home, {})
    Expect(patched.canGoBack).toBe(true)
    Expect(base.canGoBack).toBe(false)

    const selection = configuredSelection({
      display: TR.Value('automatic'),
      initial: 'home',
      items: {
        home: { content: home, label: TR.Value('Home') },
        detail: { content: detail, label: TR.Value('Detail') },
      },
      name: 'Base selection',
    })
    const drawer = TR.Navigation.Patch(selection, {
      Display: TR.Value('drawer'),
      Initial: TR.Value('@detail'),
    })
    Expect(drawer).not.toBe(selection)
    Expect(() => TR.Navigation.Patch(selection, { Unknown: TR.Value('bad') })).toThrow(
      "Navigation Base selection has no configurable property 'Unknown'.",
    )
  })

  Test('resolves the nearest navigation through nested caller props', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const detail = TR.Navigation.UI({ name: 'Detail', render: () => null })
    const overlay = TR.Navigation.UI({ name: 'Overlay', render: () => null })
    const outer = configuredStack('Outer', home)
    const nearest = configuredStack('Nearest', home)
    const nestedProps: TR.TaoProps = {
      callerProps: {
        callerProps: { navigation: outer },
        navigation: nearest,
      },
    }

    TR.Navigation.PresentIn(nestedProps, undefined, detail, {})
    Expect(nearest.canGoBack).toBe(true)
    Expect(outer.canGoBack).toBe(false)
    TR.Navigation.Dismiss(nestedProps)
    Expect(nearest.canGoBack).toBe(false)

    TR.Navigation.PresentOverlay(nestedProps, undefined, overlay, {})
    Expect(nearest.canGoBack).toBe(true)
    Expect(outer.canGoBack).toBe(false)
    TR.Navigation.Dismiss(nestedProps)
    Expect(nearest.canGoBack).toBe(false)
  })

  Test('keeps same-named generated app definitions isolated by identity and resets both', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const detail = TR.Navigation.UI({ name: 'Detail', render: () => null })
    const firstRoot = configuredStack('First root', home)
    const secondRoot = configuredStack('Second root', home)
    const firstWindow = configuredSlot('First window', home)
    const secondWindow = configuredSlot('Second window', home)
    const first = TR.Navigation.App({
      name: 'Same declaration name',
      navigator: () => firstRoot,
      auxiliaries: () => ({ window: firstWindow }),
    })
    const second = TR.Navigation.App({
      name: 'Same declaration name',
      navigator: () => secondRoot,
      auxiliaries: () => ({ window: secondWindow }),
    })

    Expect(TR.Navigation.Target(first, 'window')).toBe(firstWindow)
    Expect(TR.Navigation.Target(second, 'window')).toBe(secondWindow)
    TR.Navigation.PresentOverlay(undefined, firstWindow, detail, {})
    TR.Navigation.PresentOverlay(undefined, secondWindow, detail, {})
    TR.Navigation.Replace(secondRoot, first)
    Expect(first.navigator).toBe(secondRoot)
    Expect(second.navigator).toBe(secondRoot)

    TR.Navigation.beginTest()
    Expect(first.navigator).toBe(firstRoot)
    Expect(firstWindow.back()).toBe(false)
    Expect(secondWindow.back()).toBe(false)
  })
})

Describe('TR.Dev', () => {
  Test('exposes only public hook-free diagnostic controls', () => {
    Expect(typeof TR.Dev.getMode).toBe('function')
    Expect(typeof TR.Dev.isLayoutBoundsEnabled).toBe('function')
    Expect('DevModeProvider' in TR).toBe(false)
    Expect('setReactNativeRuntime' in TR).toBe(false)
    Expect('useDevRepaintSignal' in TR.AppShell).toBe(false)
    Expect('processCreateReactElementArgs' in TR.Dev).toBe(false)
    Expect('useMode' in TR.Dev).toBe(false)
  })

  Test('treats empty dev mode options as a reset to platform defaults', () => {
    const restoreDevGlobal = setReactNativeDevModeForTest(true)
    try {
      TR.setDevMode({ enabled: false })
      Expect(TR.Dev.isEnabled()).toBe(false)

      TR.setDevMode({})
      Expect(TR.Dev.getMode()).toEqual({ enabled: true, layoutBounds: false })
    } finally {
      restoreDevGlobal()
      TR.setDevMode({ enabled: false })
    }
  })
})

function setReactNativeDevModeForTest(value: boolean): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, '__DEV__')
  Object.defineProperty(globalThis, '__DEV__', {
    configurable: true,
    value,
    writable: true,
  })
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, '__DEV__', descriptor)
      return
    }
    delete (globalThis as { __DEV__?: unknown }).__DEV__
  }
}
