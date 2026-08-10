import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoLayout, TaoLayoutEntry } from '../TaoRuntime-src/TR-layout'

function layoutEntries(layout: TaoLayout | undefined): readonly TaoLayoutEntry[] {
  return layout?.entries ?? []
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

  Test('re-evaluates lazy alias values on each use', () => {
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

Describe('TR.Operator', () => {
  Test('computes arithmetic and text joining', () => {
    Expect(TR.Operator('+', TR.Value(2), TR.Value(3)).jsValue).toBe(5)
    Expect(TR.Operator('+', TR.Value('a'), TR.Value('b')).jsValue).toBe('ab')
    Expect(TR.Operator('-', TR.Value(5), TR.Value(2)).jsValue).toBe(3)
    Expect(TR.Operator('*', TR.Value(5), TR.Value(2)).jsValue).toBe(10)
    Expect(TR.Operator('/', TR.Value(5), TR.Value(2)).jsValue).toBe(2.5)
  })

  Test('computes comparisons and boolean logic', () => {
    Expect(TR.Operator('==', TR.Value(2), TR.Value(2)).jsValue).toBe(true)
    Expect(TR.Operator('!=', TR.Value(2), TR.Value(3)).jsValue).toBe(true)
    Expect(TR.Operator('<', TR.Value(2), TR.Value(3)).jsValue).toBe(true)
    Expect(TR.Operator('<=', TR.Value(3), TR.Value(3)).jsValue).toBe(true)
    Expect(TR.Operator('>', TR.Value(2), TR.Value(3)).jsValue).toBe(false)
    Expect(TR.Operator('>=', TR.Value(3), TR.Value(3)).jsValue).toBe(true)
    Expect(TR.Operator('and', TR.Value(true), TR.Value(false)).jsValue).toBe(false)
    Expect(TR.Operator('or', TR.Value(true), TR.Value(false)).jsValue).toBe(true)
  })
})

Describe('TR.UnaryOperator', () => {
  Test('negates numbers and inverts booleans', () => {
    Expect(TR.UnaryOperator('-', TR.Value(4)).jsValue).toBe(-4)
    Expect(TR.UnaryOperator('not', TR.Value(false)).jsValue).toBe(true)
  })
})

Describe('TR.When', () => {
  Test('returns the first matching branch value', () => {
    const result = TR.When<string>(
      [
        [() => TR.Value(false), () => TR.Value('first')],
        [() => TR.Value(true), () => TR.Value('second')],
      ],
      () => TR.Value('fallback'),
    )

    Expect(result.jsValue).toBe('second')
  })

  Test('returns the otherwise value when no branch matches', () => {
    const result = TR.When<string>([[() => TR.Value(false), () => TR.Value('first')]], () => TR.Value('fallback'))

    Expect(result.jsValue).toBe('fallback')
  })

  Test('evaluates only branches up to the first match', () => {
    let evaluated = 0
    const result = TR.When<number>(
      [
        [() => TR.Value(true), () => TR.Value(1)],
        [() => TR.Value(true), () => {
          evaluated += 1
          return TR.Value(2)
        }],
      ],
      () => TR.Value(3),
    )

    Expect(result.jsValue).toBe(1)
    Expect(evaluated).toBe(0)
  })
})

Describe('TR.Member', () => {
  Test('reads builtin list and text members', () => {
    Expect(TR.Member(TR.Value(['a', 'b']), 'Count').jsValue).toBe(2)
    Expect(TR.Member(TR.Value([]), 'Empty').jsValue).toBe(true)
    Expect(TR.Member(TR.Value(['a']), 'Empty').jsValue).toBe(false)
    Expect(TR.Member(TR.Value('four'), 'Length').jsValue).toBe(4)
    Expect(TR.Member(TR.Value(''), 'Empty').jsValue).toBe(true)
  })

  Test('reads item fields and missing fields', () => {
    Expect(TR.Member(TR.Value({ Title: 'Task' }), 'Title').jsValue).toBe('Task')
    Expect(TR.Member(TR.Value({}), 'Missing').jsValue).toBeUndefined()
  })
})

Describe('TR.Interpolate', () => {
  Test('renders text, number, and boolean values as text', () => {
    Expect(TR.Interpolate(TR.Value('a'))).toBe('a')
    Expect(TR.Interpolate(TR.Value(2))).toBe('2')
    Expect(TR.Interpolate(TR.Value(true))).toBe('true')
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
})

Describe('TR.Views', () => {
  Test('exposes runtime-backed stdlib primitive views', () => {
    Expect(Object.keys(TR.Views).sort()).toEqual(['Pressable', 'Text', 'TextInput', 'View'])
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
      Expect(TR.Dev.getMode()).toEqual({ enabled: true, layoutBounds: true })
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

Describe('TR.Data', () => {
  const schema: TR.DataSchema = {
    name: 'Notes',
    entities: [{
      name: 'Entry',
      collection: 'Entries',
      fields: [
        { name: 'Title', kind: 'text' },
        { name: 'Done', kind: 'boolean', defaultValue: false },
        { name: 'Position', kind: 'number', defaultValue: 0 },
      ],
    }],
  }

  Test('creates rows with generated identifiers and declared defaults', () => {
    const store = TR.Data.define(schema)
    store.configure(TR.Data.MemoryProvider())

    const row = store.create('Entry', { Title: 'Write the plan' })

    Expect(row['Title']).toBe('Write the plan')
    Expect(row['Done']).toBe(false)
    Expect(row['Position']).toBe(0)
    Expect(typeof row.Id).toBe('string')
    Expect(store.snapshot()['Entries']).toHaveLength(1)
  })

  Test('updates and removes rows by identifier', () => {
    const store = TR.Data.define(schema)
    store.configure(TR.Data.MemoryProvider())
    const row = store.create('Entry', { Title: 'Ship' })

    store.update('Entry', row.Id, { Done: true })
    Expect(store.snapshot()['Entries']?.[0]?.['Done']).toBe(true)

    store.remove('Entry', row.Id)
    Expect(store.snapshot()['Entries']).toHaveLength(0)
  })

  Test('filters and orders query results', () => {
    const store = TR.Data.define(schema)
    store.configure(TR.Data.MemoryProvider())
    store.create('Entry', { Title: 'b', Position: 2 })
    store.create('Entry', { Title: 'a', Position: 1 })
    store.create('Entry', { Title: 'done', Position: 3, Done: true })

    const open = store.query({ collection: 'Entries', where: row => row['Done'] === false })
    Expect(open.map(row => row['Title'])).toEqual(['b', 'a'])

    const ordered = store.query({ collection: 'Entries', orderField: 'Position', orderDirection: 'desc' })
    Expect(ordered.map(row => row['Title'])).toEqual(['done', 'b', 'a'])
  })

  Test('notifies subscribers when rows change', () => {
    const store = TR.Data.define(schema)
    store.configure(TR.Data.MemoryProvider())
    let notifications = 0
    const unsubscribe = store.subscribe(() => {
      notifications += 1
    })

    store.create('Entry', { Title: 'Write' })
    Expect(notifications).toBe(1)

    unsubscribe()
    store.create('Entry', { Title: 'Ship' })
    Expect(notifications).toBe(1)
  })

  Test('reports loading and failed provider status', async () => {
    const loading = TR.Data.define(schema)
    loading.configure(TR.Data.LoadingProvider())
    Expect(loading.status()).toEqual({ loading: true, failed: false })

    const failing = TR.Data.define(schema)
    failing.configure(TR.Data.FailingProvider())
    await new Promise(resolve => setTimeout(resolve, 0))
    Expect(failing.status()).toEqual({ loading: false, failed: true })
  })
})

Describe('TR.Data LocalProvider', () => {
  const schema: TR.DataSchema = {
    name: 'Persisted',
    entities: [{ name: 'Note', collection: 'Notes', fields: [{ name: 'Title', kind: 'text' }] }],
  }

  Test('writes rows to device storage and reloads them', async () => {
    const stored = new Map<string, string>()
    const storage = {
      getItem: async (key: string) => stored.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        stored.set(key, value)
      },
    }
    const first = TR.Data.define(schema)
    first.configure(TR.Data.LocalProvider('tao-test', storage))
    await flushPending()
    first.create('Note', { Title: 'Persisted title' })
    await flushPending()

    const second = TR.Data.define(schema)
    second.configure(TR.Data.LocalProvider('tao-test', storage))
    await flushPending()

    Expect(second.snapshot()['Notes']?.map(row => row['Title'])).toEqual(['Persisted title'])
  })
})

async function flushPending(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

Describe('TR.Nav', () => {
  Test('pushes and pops presented screens', () => {
    const Screen = () => null
    TR.Nav.reset()

    Expect(TR.Nav.depth()).toBe(0)
    TR.Nav.present(Screen, { Title: 'first' })
    TR.Nav.present(Screen, { Title: 'second' })
    Expect(TR.Nav.depth()).toBe(2)

    TR.Nav.dismiss()
    Expect(TR.Nav.depth()).toBe(1)
    TR.Nav.dismiss()
    Expect(TR.Nav.depth()).toBe(0)
  })

  Test('dismissing at the app root does nothing', () => {
    TR.Nav.reset()

    TR.Nav.dismiss()

    Expect(TR.Nav.depth()).toBe(0)
  })
})
