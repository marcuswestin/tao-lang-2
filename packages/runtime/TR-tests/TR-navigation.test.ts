import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import { configuredStack } from './TR-navigation-test-fixtures'

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
    const taoProps: TR.TaoProps = { app }

    TR.Navigation.PresentIn(undefined, stack, detail, {})
    Expect(stack.back()).toBe(true)
    TR.Navigation.PresentIn(undefined, slot, detail, {})
    Expect(slot.dismiss()).toBe(true)
    const target = TR.Navigation.Target(taoProps, app, 'window')
    Expect(target).toBe(window)
    TR.Navigation.PresentOverlay(undefined, target, detail, {})
    Expect(app.back()).toBe(true)
    TR.Navigation.Replace(taoProps, replacement, app)
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
    const taoProps: TR.TaoProps = { app }

    Expect(app.canGoBack).toBe(false)
    TR.Navigation.Activate(taoProps, app, 'settings')
    Expect(app.canGoBack).toBe(false)
    Expect(() => TR.Navigation.Activate(taoProps, app, 'missing')).toThrow(
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

    const declaration = TR.Navigation.Declaration('Configured selection', TR.NavKind.Selection())
    const configured = TR.Navigation.Configure(declaration, {
      '@home': { Content: home, Label: TR.Value('Home') },
      Display: TR.Value('tabs'),
      Initial: TR.Value('@home'),
    })
    const configuredWithOther = TR.Navigation.Patch(configured, {
      '@other': { Content: detail, Label: TR.Value('Other') },
    })
    const app = TR.Navigation.App({
      name: 'Configured selection app',
      navigator: () => configuredWithOther,
      auxiliaries: () => ({}),
    })
    Expect(() => TR.Navigation.Activate({ app }, app, 'other')).not.toThrow()
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

    Expect(TR.Navigation.Target({ app: first }, first, 'window')).toBe(firstWindow)
    Expect(TR.Navigation.Target({ app: second }, second, 'window')).toBe(secondWindow)
    TR.Navigation.PresentOverlay(undefined, firstWindow, detail, {})
    TR.Navigation.PresentOverlay(undefined, secondWindow, detail, {})
    TR.Navigation.Replace({ app: first }, secondRoot, first)
    Expect(first.navigator).toBe(secondRoot)
    Expect(second.navigator).toBe(secondRoot)

    TR.Navigation.beginTest()
    Expect(first.navigator).toBe(firstRoot)
    Expect(firstWindow.back()).toBe(false)
    Expect(secondWindow.back()).toBe(false)
  })

  Test('resolves strict targets to an enclosing app variant by declaration identity', () => {
    const home = TR.Navigation.UI({ name: 'Home', render: () => null })
    const settings = TR.Navigation.UI({ name: 'Settings', render: () => null })
    const replacement = configuredStack('Signed out', home)
    const variantSelection = configuredSelection({
      display: TR.Value('drawer'),
      initial: 'home',
      items: {
        home: { content: home, label: TR.Value('Home') },
        settings: { content: settings, label: TR.Value('Settings') },
      },
      name: 'Variant selection',
    })
    const variantWindow = configuredSlot('Variant window', home)
    let namedNavigatorLoads = 0
    let namedAuxiliaryLoads = 0
    const named = TR.Navigation.App({
      name: 'Origin declaration',
      navigator: () => {
        namedNavigatorLoads += 1
        return configuredStack('Named fallback', home)
      },
      auxiliaries: () => {
        namedAuxiliaryLoads += 1
        return { window: configuredSlot('Named window', home) }
      },
    })
    const variant = TR.Navigation.App({
      declaration: named.declaration,
      name: 'Configured variant',
      navigator: () => variantSelection,
      auxiliaries: () => ({ window: variantWindow }),
    })
    const unrelated = TR.Navigation.App({
      name: 'Nested unrelated app',
      navigator: () => configuredStack('Unrelated root', home),
      auxiliaries: () => ({}),
    })
    const nestedProps: TR.TaoProps = { app: unrelated, callerProps: { app: variant } }

    TR.Navigation.Activate(nestedProps, named, 'settings')
    Expect(TR.Navigation.Target(nestedProps, named, 'window')).toBe(variantWindow)
    TR.Navigation.Replace(nestedProps, replacement, named)
    Expect(variant.navigator).toBe(replacement)
    Expect(namedNavigatorLoads).toBe(0)
    Expect(namedAuxiliaryLoads).toBe(0)

    const unmatchedOperations = [
      ['activate', () => TR.Navigation.Activate({ app: unrelated }, named, 'settings')],
      ['replace', () => TR.Navigation.Replace({ app: unrelated }, replacement, named)],
      ['target', () => TR.Navigation.Target({ app: unrelated }, named, 'window')],
    ] as const
    for (const [operation, invoke] of unmatchedOperations) {
      let unmatched: unknown
      try {
        invoke()
      } catch (error) {
        unmatched = error
      }
      Expect(unmatched).toBeInstanceOf(UnexpectedBehaviorError)
      Expect((unmatched as UnexpectedBehaviorError).details).toEqual({
        appDeclaration: 'Origin declaration',
        operation,
      })
    }
    Expect(namedNavigatorLoads).toBe(0)
    Expect(namedAuxiliaryLoads).toBe(0)
  })
})
