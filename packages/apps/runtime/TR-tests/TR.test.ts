import TR from '@runtime/TR'
import { Describe, Expect, setReactNativeDevModeForTest, Test } from '@shared/test'
import type { TaoLayout, TaoLayoutEntry } from '../TaoRuntime-src/TR-layout'
import { configuredStack } from './TR-navigation-test-fixtures'

function layoutEntries(layout: TaoLayout | undefined): readonly TaoLayoutEntry[] {
  return layout?.entries ?? []
}

function thrownBy(action: () => unknown): (Error & { details?: unknown }) | undefined {
  try {
    action()
    return undefined
  } catch (error) {
    return error as Error & { details?: unknown }
  }
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
    Expect(calls).toEqual([2])
  })

  Test('invokes action payloads through TR.Do with runtime arguments', () => {
    const calls: number[] = []
    const action = TR.Action((step: number) => calls.push(step))

    const completion = TR.Do(action, 3)

    Expect(calls).toEqual([3])
    Expect(completion).toBeUndefined()
  })

  Test('unwraps bridged action arguments and forwards asynchronous completion', async () => {
    const calls: string[] = []
    const action = TR.BridgedAction<[TR.Value<string>]>(async value => {
      await Promise.resolve()
      calls.push(value)
    })

    await TR.Do(action, TR.Value('https://example.com/story'))

    Expect(calls).toEqual(['https://example.com/story'])

    const synchronous = TR.BridgedAction<[TR.Value<string>]>(value => {
      calls.push(`sync:${value}`)
    })
    synchronous.evaluate().jsValue.invoke(TR.Value('local'))
    Expect(calls).toEqual(['https://example.com/story', 'sync:local'])
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
    Expect(TR.Layout.resolve({
      direction: 'row',
      entries: [['content', 'baseline', 'left'], ['compress'], ['hug']],
    })).toEqual({
      alignItems: 'baseline',
      flexDirection: 'row',
      flexGrow: 0,
      flexShrink: 1,
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

Describe('TR.WarnUnhonoredLayout', () => {
  Test('names an unhonorable declaration once per component, and never in production', () => {
    const calls: unknown[][] = []
    const warn = console.warn
    const environment = process.env.NODE_ENV
    console.warn = (...args: unknown[]) => calls.push(args)
    try {
      process.env.NODE_ENV = 'development'
      TR.WarnUnhonoredLayout('TestSwitch', { layout: TR.Layout.create([['pad', 8], ['gap', 4]]) })
      TR.WarnUnhonoredLayout('TestSwitch', { layout: TR.Layout.create([['gap', 4]]) })
      TR.WarnUnhonoredLayout('TestSlider', { style: { backgroundColor: 'red' } })
      process.env.NODE_ENV = 'production'
      TR.WarnUnhonoredLayout('TestPicker', { layout: TR.Layout.create([['pad', 8]]) })
    } finally {
      console.warn = warn
      if (environment === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = environment
      }
    }

    // The clause names the author wrote, not the shape of the object carrying them.
    Expect(calls).toEqual([[
      'Tao: the platform-native TestSwitch ignores styling clauses (pad, gap). '
      + `Use the design's semantic surface, or alias a styled implementation instead.`,
    ]])
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
  })

  Test('copies ambient app, response, and navigation context without carrying layout props', () => {
    const home = TR.Navigation.View({ name: 'Ambient home', render: () => null })
    const navigation = configuredStack('Ambient stack', home)
    const app = TR.Navigation.App({
      id: 'ambient-app',
      version: '1.0.0',
      name: 'Ambient app',
      navigator: () => navigation,
      auxiliaries: () => ({}),
    })
    const response = { respond: () => {} }

    const studio: TR.TaoStudioIdentity = {
      end: 24,
      kind: 'render',
      sourcePath: '/project/Main.tao',
      start: 10,
    }
    Expect(TR.TaoContext({
      declarationSpec: TR.Design.Spec([['pad', 12]]),
      layout: TR.Layout.create([['gap', 9]]),
      studio,
      testTag: 'outer',
      callerProps: { app, navigation, response },
    })).toEqual({ app, navigation, response })
  })

  Test('carries a declaration header to the render root without disturbing its caller props', () => {
    const header = TR.Design.Spec([['pad', 12], ['bg', 'paper']])
    const callerProps: TR.TaoProps = {
      designSpec: TR.Design.Spec([['pad', 0]]),
      testTag: 'card',
    }

    Expect(TR.DeclarationTaoProps(callerProps, header)).toEqual({ ...callerProps, declarationSpec: header })
    Expect(TR.DeclarationTaoProps(undefined, header)).toEqual({ declarationSpec: header })
    // A second declaration one level down replaces the header rather than stacking onto it.
    const nested = TR.Design.Spec([['pad', 4]])
    Expect(TR.DeclarationTaoProps(TR.DeclarationTaoProps(callerProps, header), nested)).toEqual({
      ...callerProps,
      declarationSpec: nested,
    })
  })
})

Describe('TR.Views', () => {
  // REMOVAL CANDIDATE: Exact export names constrain additions and repeat view coverage; retain until the dedicated view suites are checked for every current public primitive.
  Test('exposes runtime-backed stdlib primitive views', () => {
    Expect(Object.keys(TR.Views).sort()).toEqual([
      'Checkbox',
      'Image',
      'Panes',
      'Placeholder',
      'Pressable',
      'Progress',
      'ScrollView',
      'Spacer',
      'Spinner',
      'Text',
      'TextInput',
      'View',
    ])
  })
})

Describe('TR.Dev', () => {
  // REMOVAL CANDIDATE: This asserts API shape and private-symbol absence; behavioral diagnostic tests survive, but removing it permits accidental internal exports.
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

Describe('TR.Errors', () => {
  Test('publishes the three throwing categories a compiled program can name', () => {
    const invariant = thrownBy(() =>
      TR.Errors.failInvariant('Tao Studio focused view is not available in the selected app scope.', {
        subjectId: 'Main.tao#Card',
      })
    )
    Expect(invariant?.name).toBe('UnexpectedBehaviorError')
    Expect(invariant?.message).toBe('Tao Studio focused view is not available in the selected app scope.')
    Expect(invariant?.details).toEqual({ subjectId: 'Main.tao#Card' })

    const input = thrownBy(() => TR.Errors.failInput('Give the workspace a name before saving it.'))
    Expect(input?.name).toBe('UserInputError')
    Expect(input?.message).toBe('Give the workspace a name before saving it.')

    const host = thrownBy(() => TR.Errors.failHost('Tao Studio cell bootstrap was rejected (503).'))
    Expect(host?.name).toBe('HostEnvironmentError')
    Expect(host?.message).toBe('Tao Studio cell bootstrap was rejected (503).')
  })
})
