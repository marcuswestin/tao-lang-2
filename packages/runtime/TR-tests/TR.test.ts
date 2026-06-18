import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

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
  })

  Test('exposes only generated-code layout controls', () => {
    Expect(typeof TR.Layout.create).toBe('function')
    Expect(typeof TR.Layout.resolve).toBe('function')
    Expect('merge' in TR.Layout).toBe(false)
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
      layout: [['gap', 8]],
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
    Expect(TR.TaoProps({ layout: undefined })).toEqual({ layout: undefined })
    Expect(TR.TaoProps({}, undefined)).toEqual({})
  })
})

Describe('TR.Views', () => {
  Test('exposes runtime-backed stdlib primitive views', () => {
    Expect(Object.keys(TR.Views).sort()).toEqual(['Pressable', 'Text', 'View'])
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
