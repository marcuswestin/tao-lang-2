import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { RuntimeAssert } from '../TaoRuntime-src/TR-assert'
import { memoryKeyValueStorage } from '../TaoRuntime-src/TR-data-provider'
import { UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import type {
  BrowserNavigationHistoryDriver,
  BrowserNavigationPosition,
} from '../TaoRuntime-src/TR-navigation-browser-history'
import { RuntimeHostReadChannel } from '../TaoRuntime-src/TR-navigation-host-slots'
import type { TaoDeclarationIdentityTuple } from '../TaoRuntime-src/TR-navigation-identity'
import { setNavigationRestorationStorageForTests } from '../TaoRuntime-src/TR-navigation-restoration'
import { configuredStack } from './TR-navigation-test-fixtures'

function browserHistoryHarness() {
  let epoch: string | undefined
  let listener: ((position: BrowserNavigationPosition | undefined) => void) | undefined
  const pushes: number[] = []
  const replacements: number[] = []
  const driver: BrowserNavigationHistoryDriver = {
    go: () => {},
    push(position) {
      epoch = position.epoch
      pushes.push(position.sequence)
    },
    replace(position) {
      epoch = position.epoch
      replacements.push(position.sequence)
    },
    subscribe(nextListener) {
      listener = nextListener
      return () => {
        if (listener === nextListener) {
          listener = undefined
        }
      }
    },
  }
  return {
    driver,
    pop(sequence: number) {
      listener?.(epoch ? { epoch, sequence } : undefined)
    },
    pushes,
    replacements,
  }
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
  items: Record<string, {
    content: TR.Presentable | TR.NavigationValue
    icon?: TR.Evaluable
    label: TR.Evaluable
  }>
  name: string
}): TR.NavigationValue {
  const items = Object.fromEntries(
    Object.entries(definition.items).map(([key, item]) => [
      `@${key}`,
      { Content: item.content, ...(item.icon ? { Icon: item.icon } : {}), Label: item.label },
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

function thirdPartySelectionKind(options: { sealed?: boolean } = {}) {
  let activateFromUi: (key: string) => boolean = () => false
  const presented: string[] = []
  const kind: TR.NavKind<'selection', TR.SelectionNavConfiguration> = {
    hostSlots: { reads: [], requires: [] },
    profile: 'selection',
    protocolVersion: 2,
    activate: (mount, key) => mount.activate(key),
    back: mount => mount.back(),
    canGoBack: mount => mount.canGoBack,
    configure(declaration, config) {
      return Object.freeze({
        config: Object.freeze(config),
        declaration,
        kind,
        profile: 'selection' as const,
      })
    },
    dismiss: mount => mount.dismiss(),
    mount(descriptor) {
      let activeKey = descriptor.config.initial
      const depths = new Map(Object.keys(descriptor.config.items).map(key => [key, 0]))
      const listeners = new Set<() => void>()
      let version = 0
      const emit = () => {
        version += 1
        for (const listener of listeners) {
          listener()
        }
      }
      const mount: TR.NavMount<'selection', TR.SelectionNavConfiguration> = {
        get canGoBack() {
          return (depths.get(activeKey) ?? 0) > 0
        },
        descriptor,
        kind: 'selection',
        name: descriptor.declaration.name,
        activate(key) {
          if (!depths.has(key)) {
            return false
          }
          activeKey = key
          emit()
          return true
        },
        back() {
          const depth = depths.get(activeKey) ?? 0
          if (depth === 0) {
            return false
          }
          depths.set(activeKey, depth - 1)
          emit()
          return true
        },
        dismiss() {
          return this.back()
        },
        evaluate() {
          return this
        },
        present(presentable) {
          depths.set(activeKey, (depths.get(activeKey) ?? 0) + 1)
          presented.push(`${activeKey}:${presentable.name}`)
          emit()
        },
        presentOverlay(presentable) {
          this.present(presentable, {})
        },
        render: () => null,
        reset() {
          activeKey = descriptor.config.initial
          for (const key of depths.keys()) {
            depths.set(key, 0)
          }
          emit()
        },
        snapshot: () => version,
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      // A custom rendered tab control closes over its own structural mount and calls Activate
      // directly; it has no knowledge of RuntimeAppDefinition.
      activateFromUi = key => mount.activate(key)
      return options.sealed ? Object.seal(mount) : mount
    },
    present: (mount, presentable, arguments_) => mount.present(presentable, arguments_),
    render: (mount, taoProps) => mount.render(taoProps),
    reset: mount => mount.reset(),
  }
  return {
    activateFromUi: (key: string) => activateFromUi(key),
    kind,
    presented,
  }
}

Describe('TR.Navigation', () => {
  Test('publishes immutable descriptors, independent mounts, and profile conformance', () => {
    TR.testNavKind(TR.NavKind.Stack(), 'stack')
    TR.testNavKind(TR.NavKind.Slot(), 'slot')
    TR.testNavKind(TR.NavKind.Selection(), 'selection')
    TR.testNavKind(TR.NavKind.Split(), 'split')
    TR.testNavKind(TR.NavKind.Frame(), 'frame')
    TR.testNavKind(TR.NavKind.Basic.Stack(), 'stack')
    TR.testNavKind(TR.NavKind.Basic.Slot(), 'slot')
    TR.testNavKind(TR.NavKind.Basic.Selection(), 'selection')
    TR.testNavKind(TR.NavKind.Basic.Split(), 'split')
    TR.testNavKind(TR.NavKind.Basic.Frame(), 'frame')

    const kind = TR.NavKind.Stack()
    const declaration = TR.NavKind.Declaration('ThirdPartyStack')
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
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

  Test('refreshes visually stable command closures independently of duplicate shortcut keys', () => {
    const invoked: string[] = []
    const command = (name: string, value: string) =>
      TR.Interaction.Command({
        action: () => TR.Action(() => invoked.push(value)),
        members: { Key: () => TR.Value('primary+k'), Label: () => TR.Value(name) },
        name,
      }).read()
    const channel = new RuntimeHostReadChannel()
    channel.publish({ header: true, toolbar: [command('First', 'old-first'), command('Second', 'old-second')] })
    const stableSnapshot = channel.read()

    channel.publish({ header: true, toolbar: [command('First', 'new-first'), command('Second', 'new-second')] })
    stableSnapshot.toolbar[0]?.invoke()
    stableSnapshot.toolbar[1]?.invoke()
    Expect(invoked).toEqual(['new-first', 'new-second'])
  })

  Test('reconciles native gesture and header dismissal idempotently by entry identity', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
    const kind = TR.NavKind.Stack()
    const descriptor = kind.configure(TR.NavKind.Declaration('Native reconciliation'), { initial: home })
    const stack = kind.mount(descriptor) as TR.NavigationValue & {
      depth: number
      reconcileNativeDismissal(instanceId: number, count: number): void
    }

    stack.present(detail, {})
    stack.present(detail, {})
    Expect(stack.depth).toBe(3)
    stack.reconcileNativeDismissal(3, 1)
    Expect(stack.depth).toBe(2)
    stack.reconcileNativeDismissal(3, 1)
    Expect(stack.depth).toBe(2)

    // Header Back reduces Tao first; the later native callback for entry 2 is stale and inert.
    stack.back()
    stack.reconcileNativeDismissal(2, 1)
    Expect(stack.depth).toBe(1)
  })

  Test('keeps overlay precedence when a native gesture reports content dismissal', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
    const notice = TR.Navigation.View({ name: 'Notice', render: () => null })
    const kind = TR.NavKind.Stack()
    const stack = kind.mount(kind.configure(
      TR.NavKind.Declaration('Native overlay reconciliation'),
      { initial: home },
    )) as TR.NavigationValue & {
      depth: number
      reconcileNativeDismissal(instanceId: number, count: number): void
    }

    stack.present(detail, {})
    stack.presentOverlay(notice, {})
    stack.reconcileNativeDismissal(2, 1)
    Expect(stack.depth).toBe(2)
    Expect(stack.historyDepth()).toBe(2)

    Expect(stack.back()).toBe(true)
    Expect(stack.depth).toBe(2)
    stack.reconcileNativeDismissal(2, 1)
    Expect(stack.depth).toBe(1)
  })

  Test('delegates retained Stack Initial navigation depth, Back, reset, and subscriptions', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const nestedDetail = TR.Navigation.View({ name: 'Nested detail', render: () => null })
    const outerDetail = TR.Navigation.View({ name: 'Outer detail', render: () => null })
    const nested = configuredStack('Nested initial', home)
    const kind = TR.NavKind.Stack()
    const outer = kind.mount(kind.configure(
      TR.NavKind.Declaration('Outer stack'),
      { initial: nested },
    )) as TR.NavigationValue
    let revisions = 0
    outer.subscribe(() => revisions += 1)

    nested.present(nestedDetail, {})
    Expect(outer.canGoBack).toBe(true)
    Expect(outer.historyDepth()).toBe(1)
    Expect(revisions).toBe(1)

    outer.present(outerDetail, {})
    Expect(outer.historyDepth()).toBe(2)
    Expect(outer.back()).toBe(true)
    Expect(outer.historyDepth()).toBe(1)
    Expect(outer.back()).toBe(true)
    Expect(outer.canGoBack).toBe(false)

    nested.present(nestedDetail, {})
    outer.reset()
    Expect(nested.canGoBack).toBe(false)
    Expect(outer.historyDepth()).toBe(0)
  })

  Test('counts retained Slot Initial navigation beneath a presented entry', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const nestedDetail = TR.Navigation.View({ name: 'Nested detail', render: () => null })
    const presented = TR.Navigation.View({ name: 'Presented', render: () => null })
    const nested = configuredStack('Retained initial', home)
    const slot = configuredSlot('Retaining slot', nested)

    nested.present(nestedDetail, {})
    nested.present(nestedDetail, {})
    slot.present(presented, {})
    Expect(slot.historyDepth()).toBe(3)
    Expect(slot.back()).toBe(true)
    Expect(slot.historyDepth()).toBe(2)
    Expect(slot.back()).toBe(true)
    Expect(slot.historyDepth()).toBe(1)
    Expect(slot.back()).toBe(true)
    Expect(slot.historyDepth()).toBe(0)
  })

  Test('mounts declaration-owned descriptors per app occurrence and resolves explicit nested targets', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
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
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
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

  Test('replays the actual auxiliary occurrence removed ahead of newer root history', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
    const notice = TR.Navigation.View({ name: 'Notice', render: () => null })
    const root = configuredStack('History root', home)
    const auxiliary = configuredSlot('History auxiliary', home)
    const app = TR.Navigation.App({
      name: 'Ordered history app',
      navigator: () => root,
      auxiliaries: () => ({ auxiliary }),
    })
    const browser = browserHistoryHarness()
    app.attachBrowserHistory(browser.driver)
    // Force app ownership registration, then use the explicit-target APIs without Tao props.
    void app.navigator
    void app.auxiliaries
    TR.Navigation.PresentOverlay(undefined, auxiliary, notice, {})
    TR.Navigation.PresentIn(undefined, root, detail, {})
    Expect(browser.pushes).toEqual([1, 2])

    browser.pop(1)
    Expect(auxiliary.canGoBack).toBe(false)
    Expect(root.canGoBack).toBe(true)
    browser.pop(2)
    Expect(auxiliary.canGoBack).toBe(true)
    Expect(root.canGoBack).toBe(true)
  })

  Test('hosts overlays directly on every configured navigation value', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const notice = TR.Navigation.View({ name: 'Notice', render: () => null })
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
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const saved = TR.Navigation.View({ name: 'Saved', render: () => null })
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
    ).toThrow('Duration must be a finite non-negative duration')
    Expect(() =>
      TR.Navigation.PresentToast(taoProps, saved, {}, {
        duration: TR.Value(-1),
        key: TR.Value('saved'),
      })
    ).toThrow('Duration must be a finite non-negative duration')
    TR.Navigation.beginTest()
  })

  Test('stacks independent asks and resolves back or dismiss as none', async () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const confirm = TR.Navigation.View({ name: 'Confirm', render: () => null })
    const stack = configuredStack('Ask host', home)
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
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const settings = TR.Navigation.View({ name: 'Settings', render: () => null })
    const homeStack = configuredStack('Home stack', home)
    const settingsStack = configuredStack('Settings stack', settings)
    const selection = configuredSelection({
      display: TR.Value('automatic'),
      initial: 'home',
      items: {
        home: { content: homeStack, icon: TR.Value('house'), label: TR.Value('Home') },
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

    Expect(selection.descriptor.config['items']['home'].icon?.evaluate().jsValue).toBe('house')
    Expect(selection.descriptor.config['items']['settings'].icon).toBeUndefined()
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

  Test('keeps selection, toasts, and replacement out of browser history', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const settings = TR.Navigation.View({ name: 'Settings', render: () => null })
    const selection = configuredSelection({
      display: TR.Value('automatic'),
      initial: 'home',
      items: {
        home: { content: home, label: TR.Value('Home') },
        settings: { content: settings, label: TR.Value('Settings') },
      },
      name: 'History-free selection',
    })
    const replacement = configuredStack('History-free replacement', home)
    const app = TR.Navigation.App({
      name: 'History classification app',
      navigator: () => selection,
      auxiliaries: () => ({}),
    })
    const browser = browserHistoryHarness()
    app.attachBrowserHistory(browser.driver)
    void app.navigator

    TR.Navigation.Activate({ app }, app, 'settings')
    TR.Navigation.PresentToast({ app }, home, {}, {
      duration: TR.Value(3),
      key: TR.Value('saved'),
    })
    TR.Navigation.Replace({ app }, replacement, app)

    Expect(browser.pushes).toEqual([])
    TR.Navigation.beginTest()
  })

  Test('tracks UI-driven activation from a structural third-party selection mount', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const settings = TR.Navigation.View({ name: 'Settings', render: () => null })
    const homeDetail = TR.Navigation.View({ name: 'Home detail', render: () => null })
    const settingsDetail = TR.Navigation.View({ name: 'Settings detail', render: () => null })
    const thirdParty = thirdPartySelectionKind()
    const selection = TR.Navigation.Configure(
      TR.Navigation.Declaration('Structural selection', thirdParty.kind),
      {
        '@home': { Content: home, Label: TR.Value('Home') },
        '@settings': { Content: settings, Label: TR.Value('Settings') },
        Display: TR.Value('tabs'),
        Initial: TR.Value('@home'),
      },
    )
    const app = TR.Navigation.App({
      name: 'Structural selection app',
      navigator: () => selection,
      auxiliaries: () => ({}),
    })
    const browser = browserHistoryHarness()
    app.attachBrowserHistory(browser.driver)

    TR.Navigation.PresentIn(undefined, app.navigator, homeDetail, {})
    Expect(thirdParty.activateFromUi('settings')).toBe(true)
    TR.Navigation.PresentIn(undefined, app.navigator, settingsDetail, {})
    Expect(thirdParty.activateFromUi('home')).toBe(true)

    browser.pop(1)
    Expect(thirdParty.activateFromUi('home')).toBe(true)
    browser.pop(2)

    Expect(thirdParty.presented).toEqual([
      'home:Home detail',
      'settings:Settings detail',
      'home:Home detail',
    ])

    browser.pop(1)
    Expect(thirdParty.activateFromUi('settings')).toBe(true)
    browser.pop(2)

    Expect(thirdParty.presented).toEqual([
      'home:Home detail',
      'settings:Settings detail',
      'home:Home detail',
    ])
    Expect(browser.replacements.at(-1)).toBe(1)
    TR.Navigation.beginTest()
  })

  Test('invalidates Forward after UI activation from a sealed structural selection mount', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const settings = TR.Navigation.View({ name: 'Settings', render: () => null })
    const homeDetail = TR.Navigation.View({ name: 'Home detail', render: () => null })
    const settingsDetail = TR.Navigation.View({ name: 'Settings detail', render: () => null })
    const thirdParty = thirdPartySelectionKind({ sealed: true })
    const selection = TR.Navigation.Configure(
      TR.Navigation.Declaration('Sealed structural selection', thirdParty.kind),
      {
        '@home': { Content: home, Label: TR.Value('Home') },
        '@settings': { Content: settings, Label: TR.Value('Settings') },
        Display: TR.Value('tabs'),
        Initial: TR.Value('@home'),
      },
    )
    const app = TR.Navigation.App({
      name: 'Sealed structural app',
      navigator: () => selection,
      auxiliaries: () => ({}),
    })
    const browser = browserHistoryHarness()
    app.attachBrowserHistory(browser.driver)

    TR.Navigation.PresentIn(undefined, app.navigator, homeDetail, {})
    Expect(thirdParty.activateFromUi('settings')).toBe(true)
    TR.Navigation.PresentIn(undefined, app.navigator, settingsDetail, {})
    Expect(thirdParty.activateFromUi('home')).toBe(true)
    browser.pop(1)
    browser.pop(2)

    Expect(thirdParty.presented).toEqual([
      'home:Home detail',
      'settings:Settings detail',
    ])
    Expect(browser.replacements.at(-1)).toBe(1)
    TR.Navigation.beginTest()
  })

  Test('refreshes selection context on reset before deciding whether Forward remains valid', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const settings = TR.Navigation.View({ name: 'Settings', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
    const thirdParty = thirdPartySelectionKind()
    const selection = TR.Navigation.Configure(
      TR.Navigation.Declaration('Resettable structural selection', thirdParty.kind),
      {
        '@home': { Content: home, Label: TR.Value('Home') },
        '@settings': { Content: settings, Label: TR.Value('Settings') },
        Display: TR.Value('tabs'),
        Initial: TR.Value('@home'),
      },
    )
    const app = TR.Navigation.App({
      name: 'Resettable structural app',
      navigator: () => selection,
      auxiliaries: () => ({}),
    })
    const browser = browserHistoryHarness()
    app.attachBrowserHistory(browser.driver)
    void app.navigator

    Expect(thirdParty.activateFromUi('settings')).toBe(true)
    app.reset()
    TR.Navigation.PresentIn(undefined, app.navigator, detail, {})
    browser.pop(0)
    Expect(thirdParty.activateFromUi('settings')).toBe(true)
    browser.pop(1)

    Expect(thirdParty.presented).toEqual(['home:Detail'])
    Expect(browser.replacements.at(-1)).toBe(0)
    TR.Navigation.beginTest()
  })

  Test('releases replaced selection observers before tracking the replacement lane', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const settings = TR.Navigation.View({ name: 'Settings', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
    const oldKind = thirdPartySelectionKind()
    const replacementKind = thirdPartySelectionKind()
    const configure = (name: string, kind: typeof oldKind.kind) =>
      TR.Navigation.Configure(TR.Navigation.Declaration(name, kind), {
        '@home': { Content: home, Label: TR.Value('Home') },
        '@settings': { Content: settings, Label: TR.Value('Settings') },
        Display: TR.Value('tabs'),
        Initial: TR.Value('@home'),
      })
    const app = TR.Navigation.App({
      name: 'Replacement observer app',
      navigator: () => configure('Old structural selection', oldKind.kind),
      auxiliaries: () => ({}),
    })
    const browser = browserHistoryHarness()
    app.attachBrowserHistory(browser.driver)
    void app.navigator

    TR.Navigation.Replace(
      { app },
      configure('Replacement structural selection', replacementKind.kind),
      app,
    )
    TR.Navigation.PresentIn(undefined, app.navigator, detail, {})
    browser.pop(0)
    Expect(oldKind.activateFromUi('settings')).toBe(true)
    browser.pop(1)

    Expect(replacementKind.presented).toEqual(['home:Detail', 'home:Detail'])
    TR.Navigation.beginTest()
  })

  Test('does not guess app ownership when two apps share one raw navigation value', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
    const shared = configuredStack('Shared raw stack', home)
    const first = TR.Navigation.App({
      name: 'First shared app',
      navigator: () => shared,
      auxiliaries: () => ({}),
    })
    const second = TR.Navigation.App({
      name: 'Second shared app',
      navigator: () => shared,
      auxiliaries: () => ({}),
    })
    const firstBrowser = browserHistoryHarness()
    const secondBrowser = browserHistoryHarness()
    first.attachBrowserHistory(firstBrowser.driver)
    second.attachBrowserHistory(secondBrowser.driver)
    void first.navigator
    void second.navigator

    TR.Navigation.PresentIn(undefined, shared, detail, {})
    Expect(firstBrowser.pushes).toEqual([])
    Expect(secondBrowser.pushes).toEqual([])
    Expect(shared.back()).toBe(true)

    TR.Navigation.PresentIn({ app: first }, shared, detail, {})
    Expect(firstBrowser.pushes).toEqual([1])
    Expect(secondBrowser.pushes).toEqual([])
    TR.Navigation.beginTest()
  })

  Test('patches configured navigation into an independent value without mutating its base', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
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

  Test('merges configured host-slot patches without discarding the base slots', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const declaration = TR.Navigation.Declaration('Configured stack', TR.NavKind.Stack())
    const base = TR.Navigation.Configure(declaration, {
      Initial: home,
      __taoHostSlots: {
        Title: TR.Value('Base'),
        Toolbar: Object.freeze([]),
      },
    })
    const patched = TR.Navigation.Patch(base, {
      __taoHostSlots: { Title: TR.Value('Patched') },
    })

    const baseSlots = base.config['__taoHostSlots'] as Record<string, unknown>
    const patchedSlots = patched.config['__taoHostSlots'] as Record<string, unknown>
    Expect((baseSlots['Title'] as TR.Evaluable).evaluate().jsValue).toBe('Base')
    Expect((patchedSlots['Title'] as TR.Evaluable).evaluate().jsValue).toBe('Patched')
    Expect(patchedSlots['Toolbar']).toEqual(baseSlots['Toolbar'])
  })

  Test('resolves the nearest navigation through nested caller props', () => {
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
    const overlay = TR.Navigation.View({ name: 'Overlay', render: () => null })
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
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Detail', render: () => null })
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
    const home = TR.Navigation.View({ name: 'Home', render: () => null })
    const settings = TR.Navigation.View({ name: 'Settings', render: () => null })
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

  // A frame's Content is read, never captured: absence is the empty-slot rule and it must survive
  // being reversed. `canGoBack` is the observable that follows the center's live content.
  Test('reads a frame slot Content on every read so an emptied slot comes back', () => {
    const home = TR.Navigation.View({ name: 'Frame home', render: () => null })
    const detail = TR.Navigation.View({ name: 'Frame detail', render: () => null })
    const center = configuredStack('Frame center', home)
    const sidebar = configuredStack('Frame sidebar', home)
    const scalar = (jsValue: unknown) => ({ evaluate: () => ({ jsValue }) })
    let occupied = true
    const kind = TR.NavKind.Frame()
    const frame = kind.mount(kind.configure(TR.NavKind.Declaration('Live frame'), {
      items: {
        bottom: { content: scalar(null), label: scalar('Status') },
        center: { content: { evaluate: () => ({ jsValue: occupied ? center : null }) }, label: scalar('Content') },
        left: { content: sidebar, label: scalar('Sidebar'), size: scalar(240) },
      },
    }))

    // An edge holds a navigator of its own and still never lends the frame its Back.
    sidebar.present(detail, {})
    Expect(kind.canGoBack(frame)).toBe(false)

    center.present(detail, {})
    Expect(kind.canGoBack(frame)).toBe(true)
    occupied = false
    Expect(kind.canGoBack(frame)).toBe(false)
    occupied = true
    Expect(kind.canGoBack(frame)).toBe(true)
    Expect(kind.back(frame)).toBe(true)
    Expect(kind.canGoBack(frame)).toBe(false)
    Expect(sidebar.canGoBack).toBe(true)
  })

  Test("restores every frame slot's own navigation across a launch boundary", async () => {
    const values = new Map<string, string>()
    const restoreStorage = setNavigationRestorationStorageForTests(memoryKeyValueStorage(values))
    try {
      const first = frameRestorationApp('frame')
      const detach = await first.app.attachRestoration()
      frameSlotNavigation(first.app, 'center').present(first.detail, {})
      frameSlotNavigation(first.app, 'left').present(first.detail, {})
      await Promise.resolve()
      await Promise.resolve()
      await new Promise<void>(resolve => queueMicrotask(resolve))
      detach()

      const second = frameRestorationApp('frame')
      const detachSecond = await second.app.attachRestoration()
      Expect(frameSlotDepth(second.app, 'center')).toBe(2)
      Expect(frameSlotDepth(second.app, 'left')).toBe(2)
      detachSecond()
    } finally {
      restoreStorage()
    }
  })
})

/** frameRestorationApp builds the Tao-shaped frame configuration one app restores through. */
function frameRestorationApp(variant: string) {
  const identity = (kind: string, name: string) =>
    TR.Navigation.Identity([
      'tao.declaration',
      1,
      'frame-restoration-test',
      '@workspace',
      'App',
      kind,
      name,
    ] as TaoDeclarationIdentityTuple)
  const scalar = (jsValue: unknown) => ({ evaluate: () => ({ jsValue }) })
  const home = TR.Navigation.View({ identity: identity('view', 'Home'), name: 'Home', render: () => null })
  const detail = TR.Navigation.View({ identity: identity('view', 'Detail'), name: 'Detail', render: () => null })
  const center = TR.Navigation.Declaration('CenterStack', TR.NavKind.Stack(), identity('nav', 'CenterStack'))
  const sidebar = TR.Navigation.Declaration('SidebarStack', TR.NavKind.Stack(), identity('nav', 'SidebarStack'))
  const frame = TR.Navigation.Declaration('Frame', TR.NavKind.Frame(), identity('nav', 'Frame'))
  const app = TR.Navigation.App({
    auxiliaries: () => ({}),
    declaration: TR.Navigation.AppDeclaration('FrameApp', identity('app', 'FrameApp')),
    name: 'FrameApp',
    navigator: () =>
      TR.Navigation.Configure(frame, {
        '@center': { Content: TR.Navigation.Configure(center, { Initial: home }), Label: scalar('Content') },
        '@left': {
          Content: TR.Navigation.Configure(sidebar, { Initial: home }),
          Label: scalar('Sidebar'),
          Size: scalar(240),
        },
        // The unfilled slot the Tao default produces: a Content that evaluates to absence.
        '@right': { Content: scalar(null), Label: scalar('Inspector'), Size: scalar(null) },
      }),
    restoration: { exclusions: [], mode: 'automatic', variant },
  })
  return { app, detail }
}

type FrameRestorationApp = ReturnType<typeof frameRestorationApp>['app']

function frameSlotNavigation(app: FrameRestorationApp, key: string): TR.NavigationValue {
  const items = (app.navigator.descriptor.config as {
    items: Record<string, { content?: TR.NavigationValue }>
  }).items
  const content = items[key]?.content
  RuntimeAssert.defined(content, `frame slot '@${key}' holds a navigator`, { key })
  return content
}

function frameSlotDepth(app: FrameRestorationApp, key: string): number {
  return (frameSlotNavigation(app, key) as TR.NavigationValue & { depth: number }).depth
}
