import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoLayout, TaoLayoutEntry } from '../TaoRuntime-src/TR-layout'

function layoutEntries(layout: TaoLayout | undefined): readonly TaoLayoutEntry[] {
  return layout?.entries ?? []
}

Describe('TR.Accessibility', () => {
  Test('creates generated-code accessibility metadata', () => {
    Expect(Object.keys(TR.Accessibility).sort()).toEqual(['create'])
    Expect(TR.Accessibility.create([['id', 'main'], ['label', 'Main label'], ['role', 'button']])).toEqual({
      entries: [['id', 'main'], ['label', 'Main label'], ['role', 'button']],
    })
  })
})

Describe('TR.ActionSheetIOS', () => {
  Test('bridges iOS action-sheet selections through a deterministic driver', async () => {
    try {
      TR.ActionSheetIOS.setDriverForTests({
        showActionSheetWithOptions(options, callback) {
          Expect(options.options).toEqual(['Cancel', 'Save'])
          callback(1)
        },
        showShareActionSheetWithOptions(_options, _failureCallback, successCallback) {
          successCallback(true, 'com.apple.UIKit.activity.CopyToPasteboard')
        },
      })

      const selection = await TR.ActionSheetIOS.choose({
        cancelButtonIndex: 0,
        options: ['Cancel', 'Save'],
        title: 'Kitchen action',
      })
      const shareResult = await TR.ActionSheetIOS.share({ message: 'Kitchen share' })

      Expect(selection).toEqual({ buttonIndex: 1, canceled: false })
      Expect(shareResult).toEqual({
        activityType: 'com.apple.UIKit.activity.CopyToPasteboard',
        completed: true,
      })
    } finally {
      TR.ActionSheetIOS.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible iOS action-sheet actions', async () => {
    let callbackSelection: TR.ActionSheetIOSSelection | undefined
    try {
      TR.ActionSheetIOS.setDriverForTests({
        showActionSheetWithOptions(options, callback) {
          callback(options.cancelButtonIndex ?? 0)
        },
        showShareActionSheetWithOptions(_options, _failureCallback, successCallback) {
          successCallback(false)
        },
      })

      const selection = await TR.ActionSheetIOS.chooseAction(
        {
          cancelButtonIndex: 0,
          options: ['Cancel', 'Save'],
        },
        TR.ActionSheetIOS.chosenAction(chosen => {
          callbackSelection = chosen
        }),
      ).invoke()

      Expect(selection).toEqual({ buttonIndex: 0, canceled: true })
      Expect(callbackSelection).toEqual(selection)
    } finally {
      TR.ActionSheetIOS.setDriverForTests()
    }
  })

  Test('exposes iOS action-sheet bridge helpers', () => {
    Expect(Object.keys(TR.ActionSheetIOS).sort()).toEqual([
      'choose',
      'chooseAction',
      'chosenAction',
      'setDriverForTests',
      'share',
    ])
  })
})

Describe('TR.AccessibilityInfo', () => {
  Test('exposes accessibility preference bridge helpers', () => {
    Expect(Object.keys(TR.AccessibilityInfo).sort()).toEqual(['preferences', 'setDriverForTests'])
  })
})

Describe('TR.Value', () => {
  Test('wraps JavaScript values as evaluable Tao runtime values', () => {
    const value: TR.Value<string> = TR.Value('Hello')

    Expect(value.jsValue).toBe('Hello')
    Expect(value.evaluate()).toBe(value)
  })
})

Describe('TR.Alert', () => {
  Test('bridges native messages and confirmations through a deterministic driver', () => {
    const alerts: Array<{ buttons?: unknown[]; message?: string; title: string }> = []
    let confirmed = false
    try {
      TR.Alert.setDriverForTests({
        alert(title, message, buttons) {
          alerts.push({ buttons, message, title })
        },
      })

      TR.Alert.message('Kitchen alert', 'Informational alert')
      TR.Alert.confirm(
        'Confirm kitchen',
        'Continue?',
        TR.Alert.confirmedAction(() => {
          confirmed = true
        }),
        { confirmText: 'Continue', destructive: true },
      )

      Expect(alerts[0]).toMatchObject({ message: 'Informational alert', title: 'Kitchen alert' })
      Expect(alerts[1]).toMatchObject({ message: 'Continue?', title: 'Confirm kitchen' })
      const confirmButton = alerts[1]!.buttons?.[1] as { onPress(): void; style: string; text: string }
      Expect(confirmButton).toMatchObject({ style: 'destructive', text: 'Continue' })
      confirmButton.onPress()
      Expect(confirmed).toBe(true)
    } finally {
      TR.Alert.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible alert actions', () => {
    const alerts: Array<{ buttons?: unknown[]; title: string }> = []
    let confirmed = false
    try {
      TR.Alert.setDriverForTests({
        alert(title, _message, buttons) {
          alerts.push({ buttons, title })
        },
      })

      TR.Alert.messageAction('Action alert').invoke()
      TR.Alert.confirmAction(
        'Confirm action',
        'Continue?',
        TR.Alert.confirmedAction(() => {
          confirmed = true
        }),
      ).invoke()

      Expect(alerts.map(alert => alert.title)).toEqual(['Action alert', 'Confirm action'])
      const confirmButton = alerts[1]!.buttons?.[1] as { onPress(): void }
      confirmButton.onPress()
      Expect(confirmed).toBe(true)
    } finally {
      TR.Alert.setDriverForTests()
    }
  })

  Test('exposes alert bridge helpers', () => {
    Expect(Object.keys(TR.Alert).sort()).toEqual([
      'confirm',
      'confirmAction',
      'confirmedAction',
      'message',
      'messageAction',
      'setDriverForTests',
    ])
  })
})

Describe('TR.Animated', () => {
  Test('bridges React Native animation helpers through a deterministic driver', () => {
    const calls: unknown[] = []
    try {
      TR.Animated.setDriverForTests({
        Value: class {
          constructor(readonly value: number) {
            calls.push(['value', value])
          }
        },
        parallel(animations) {
          calls.push(['parallel', animations.length])
          return {
            start(callback) {
              callback?.({ finished: true })
            },
          }
        },
        sequence(animations) {
          calls.push(['sequence', animations.length])
          return {
            start(callback) {
              callback?.({ finished: true })
            },
          }
        },
        spring(value, config) {
          calls.push(['spring', value, config])
          return {
            start(callback) {
              callback?.({ finished: true })
            },
          }
        },
        timing(value, config) {
          calls.push(['timing', value, config])
          return {
            start(callback) {
              callback?.({ finished: true })
            },
          }
        },
      })

      const value = TR.Animated.value(0)
      const timing = TR.Animated.timing(value, { duration: 120, toValue: 1 })
      const spring = TR.Animated.spring(value, { friction: 6, toValue: 0 })
      const sequence = TR.Animated.sequence([timing, spring])
      const parallel = TR.Animated.parallel([timing, spring])
      let finished: boolean | undefined
      TR.Animated.start(
        parallel,
        TR.Animated.finishedAction(result => {
          finished = result
        }),
      )

      Expect(calls[0]).toEqual(['value', 0])
      Expect(calls[1]).toEqual(['timing', value, { duration: 120, toValue: 1, useNativeDriver: true }])
      Expect(calls[2]).toEqual(['spring', value, { friction: 6, toValue: 0, useNativeDriver: true }])
      Expect(calls[3]).toEqual(['sequence', 2])
      Expect(calls[4]).toEqual(['parallel', 2])
      Expect(sequence).toBeDefined()
      Expect(finished).toBe(true)
    } finally {
      TR.Animated.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible animation actions', () => {
    let started = false
    let callbackResult: boolean | undefined

    TR.Animated.action(
      {
        start(callback) {
          started = true
          callback?.({ finished: false })
        },
      },
      TR.Animated.finishedAction(finished => {
        callbackResult = finished
      }),
    ).invoke()

    Expect(started).toBe(true)
    Expect(callbackResult).toBe(false)
  })

  Test('exposes Animated bridge helpers', () => {
    Expect(Object.keys(TR.Animated).sort()).toEqual([
      'action',
      'finishedAction',
      'parallel',
      'sequence',
      'setDriverForTests',
      'spring',
      'start',
      'timing',
      'value',
    ])
  })
})

Describe('TR.AppState', () => {
  Test('exposes app state bridge helpers', () => {
    Expect(Object.keys(TR.AppState).sort()).toEqual(['setDriverForTests', 'status'])
  })
})

Describe('TR.Appearance', () => {
  Test('exposes appearance bridge helpers', () => {
    Expect(Object.keys(TR.Appearance).sort()).toEqual(['colorScheme', 'setDriverForTests'])
  })
})

Describe('TR.I18n', () => {
  Test('bridges native layout-direction state through a deterministic driver', () => {
    const calls: Array<[string, boolean]> = []
    try {
      TR.I18n.setDriverForTests({
        allowRTL(allowRTL) {
          calls.push(['allowRTL', allowRTL])
        },
        doLeftAndRightSwapInRTL: true,
        forceRTL(forceRTL) {
          calls.push(['forceRTL', forceRTL])
        },
        isRTL: true,
        swapLeftAndRightInRTL(swapLeftAndRight) {
          calls.push(['swapLeftAndRightInRTL', swapLeftAndRight])
        },
      })

      Expect(TR.I18n.info()).toEqual({
        direction: 'rtl',
        isRTL: true,
        swapsLeftAndRight: true,
      })
      Expect(TR.I18n.direction()).toBe('rtl')

      TR.I18n.allowRTL(false)
      TR.I18n.forceRTL()
      TR.I18n.swapLeftAndRightInRTL(false)

      Expect(calls).toEqual([
        ['allowRTL', false],
        ['forceRTL', true],
        ['swapLeftAndRightInRTL', false],
      ])
    } finally {
      TR.I18n.setDriverForTests()
    }
  })

  Test('exposes i18n bridge helpers', () => {
    Expect(Object.keys(TR.I18n).sort()).toEqual([
      'allowRTL',
      'direction',
      'forceRTL',
      'info',
      'setDriverForTests',
      'swapLeftAndRightInRTL',
    ])
  })
})

Describe('TR.InteractionManager', () => {
  Test('bridges post-interaction work through a deterministic driver', () => {
    let runs = 0
    let cancels = 0
    try {
      TR.InteractionManager.setDriverForTests({
        runAfterInteractions(task) {
          runs += 1
          task()
          return {
            cancel() {
              cancels += 1
            },
          }
        },
      })

      const task = TR.InteractionManager.defer(TR.InteractionManager.taskAction(() => {
        runs += 10
      }))
      task.cancel?.()

      Expect(runs).toBe(11)
      Expect(cancels).toBe(1)
    } finally {
      TR.InteractionManager.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible deferred actions', () => {
    let runs = 0
    try {
      TR.InteractionManager.setDriverForTests({
        runAfterInteractions(task) {
          task()
          return {}
        },
      })

      TR.InteractionManager.deferAction(TR.InteractionManager.taskAction(() => {
        runs += 1
      })).invoke()

      Expect(runs).toBe(1)
    } finally {
      TR.InteractionManager.setDriverForTests()
    }
  })

  Test('exposes interaction manager bridge helpers', () => {
    Expect(Object.keys(TR.InteractionManager).sort()).toEqual([
      'defer',
      'deferAction',
      'setDriverForTests',
      'taskAction',
    ])
  })
})

Describe('TR.LayoutAnimation', () => {
  Test('bridges native layout animation configs through a deterministic driver', () => {
    const configured: Array<{ config: TR.LayoutAnimationConfig; failed: boolean }> = []
    let ended = 0
    try {
      TR.LayoutAnimation.setDriverForTests({
        configureNext(config, onEnd, onFail) {
          configured.push({ config, failed: onFail !== undefined })
          onEnd?.()
        },
        create(duration, type, property) {
          return { duration, property, type }
        },
        Presets: {
          easeInEaseOut: { preset: 'easeInEaseOut' },
          linear: { preset: 'linear' },
          spring: { preset: 'spring' },
        },
      })

      const config = TR.LayoutAnimation.create(250, 'linear', 'scaleY')
      TR.LayoutAnimation.configureNext(config, {
        end: TR.LayoutAnimation.completeAction(() => {
          ended += 1
        }),
      })
      TR.LayoutAnimation.preset('spring')

      Expect(config).toEqual({ duration: 250, property: 'scaleY', type: 'linear' })
      Expect(configured).toEqual([
        { config: { duration: 250, property: 'scaleY', type: 'linear' }, failed: false },
        { config: { preset: 'spring' }, failed: false },
      ])
      Expect(ended).toBe(1)
    } finally {
      TR.LayoutAnimation.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible layout animation actions', () => {
    let configured = 0
    let callbackCount = 0
    try {
      TR.LayoutAnimation.setDriverForTests({
        configureNext(_config, onEnd) {
          configured += 1
          onEnd?.()
        },
        create(duration, type, property) {
          return { duration, property, type }
        },
        Presets: {
          easeInEaseOut: { preset: 'easeInEaseOut' },
          linear: { preset: 'linear' },
          spring: { preset: 'spring' },
        },
      })

      TR.LayoutAnimation.presetAction(
        'linear',
        {
          end: TR.LayoutAnimation.completeAction(() => {
            callbackCount += 1
          }),
        },
        TR.LayoutAnimation.completeAction(() => {
          callbackCount += 10
        }),
      ).invoke()

      Expect(configured).toBe(1)
      Expect(callbackCount).toBe(11)
    } finally {
      TR.LayoutAnimation.setDriverForTests()
    }
  })

  Test('exposes layout animation bridge helpers', () => {
    Expect(Object.keys(TR.LayoutAnimation).sort()).toEqual([
      'completeAction',
      'config',
      'configureNext',
      'create',
      'preset',
      'presetAction',
      'setDriverForTests',
    ])
  })
})

Describe('TR.PermissionsAndroid', () => {
  Test('bridges Android permission checks and requests through a deterministic driver', async () => {
    const requests: Array<{ permission: string; rationale?: unknown }> = []
    try {
      TR.PermissionsAndroid.setDriverForTests({
        async check(permission) {
          return permission === 'android.permission.CAMERA'
        },
        async request(permission, rationale) {
          requests.push({ permission, rationale })
          return permission === 'android.permission.POST_NOTIFICATIONS' ? 'never_ask_again' : 'granted'
        },
        async requestMultiple(permissions) {
          return Object.fromEntries(permissions.map(permission => [permission, 'granted']))
        },
        PERMISSIONS: {
          CAMERA: 'android.permission.CAMERA',
          POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
        },
      })

      const camera = TR.PermissionsAndroid.permission('CAMERA')
      const notifications = TR.PermissionsAndroid.permission('POST_NOTIFICATIONS')
      const checked = await TR.PermissionsAndroid.check(camera)
      const requested = await TR.PermissionsAndroid.request({
        permission: notifications,
        rationale: { message: 'Need notifications', title: 'Notifications' },
      })
      const many = await TR.PermissionsAndroid.requestMany([camera, notifications])

      Expect(checked).toBe(true)
      Expect(requested).toBe('never_ask_again')
      Expect(many).toEqual({
        'android.permission.CAMERA': 'granted',
        'android.permission.POST_NOTIFICATIONS': 'granted',
      })
      Expect(requests).toEqual([{
        permission: 'android.permission.POST_NOTIFICATIONS',
        rationale: { message: 'Need notifications', title: 'Notifications' },
      }])
    } finally {
      TR.PermissionsAndroid.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible Android permission actions', async () => {
    let callbackStatus: TR.AndroidPermissionStatus | undefined
    try {
      TR.PermissionsAndroid.setDriverForTests({
        async check() {
          return false
        },
        async request() {
          return 'granted'
        },
        async requestMultiple() {
          return {}
        },
      })

      const status = await TR.PermissionsAndroid.requestAction(
        { permission: 'android.permission.CAMERA' },
        TR.PermissionsAndroid.requestedAction(result => {
          callbackStatus = result
        }),
      ).invoke()

      Expect(status).toBe('granted')
      Expect(callbackStatus).toBe('granted')
    } finally {
      TR.PermissionsAndroid.setDriverForTests()
    }
  })

  Test('exposes Android permission bridge helpers', () => {
    Expect(Object.keys(TR.PermissionsAndroid).sort()).toEqual([
      'check',
      'permission',
      'request',
      'requestAction',
      'requestMany',
      'requestedAction',
      'setDriverForTests',
    ])
  })
})

Describe('TR.NativeColor', () => {
  Test('bridges platform-native color helpers through a deterministic driver', () => {
    try {
      TR.NativeColor.setDriverForTests({
        PlatformColor(...colors) {
          return { platform: colors }
        },
        DynamicColorIOS(colors) {
          return { dynamic: colors }
        },
        processColor(color) {
          return color === '#ffffff' ? 0xffffff : undefined
        },
      })

      Expect(TR.NativeColor.platform('labelColor', 'systemBlueColor')).toEqual({
        platform: ['labelColor', 'systemBlueColor'],
      })
      Expect(TR.NativeColor.dynamicIOS({ dark: '#000000', light: '#ffffff' })).toEqual({
        dynamic: { dark: '#000000', light: '#ffffff' },
      })
      Expect(TR.NativeColor.process('#ffffff')).toBe(0xffffff)
      Expect(TR.NativeColor.process('missing')).toBeUndefined()
    } finally {
      TR.NativeColor.setDriverForTests()
    }
  })

  Test('falls back to the light color when DynamicColorIOS is unavailable', () => {
    try {
      TR.NativeColor.setDriverForTests({
        PlatformColor(...colors) {
          return colors[0]
        },
      })

      Expect(TR.NativeColor.dynamicIOS({ dark: '#000000', light: '#ffffff' })).toBe('#ffffff')
    } finally {
      TR.NativeColor.setDriverForTests()
    }
  })

  Test('exposes native color bridge helpers', () => {
    Expect(Object.keys(TR.NativeColor).sort()).toEqual(['dynamicIOS', 'platform', 'process', 'setDriverForTests'])
  })
})

Describe('TR.NativeList', () => {
  Test('bridges React Native list components through a deterministic driver', () => {
    const FlatList = (_props: TR.NativeListProps<{ id: string; title: string }>) => null
    const SectionList = (_props: TR.NativeSectionListProps<{ id: string; title: string }>) => null
    try {
      TR.NativeList.setDriverForTests({
        FlatList,
        SectionList,
      })

      const data = [{ id: 'a', title: 'A' }]
      const flat = TR.NativeList.Flat({
        data,
        keyExtractor: TR.NativeList.itemKey('id'),
        renderItem: () => null,
      })
      const section = TR.NativeList.Section({
        keyExtractor: TR.NativeList.indexKey(),
        renderItem: () => null,
        sections: [{ data, title: 'Letters' }],
      })
      const flatProps = flat.props as TR.NativeListProps<{ id: string; title: string }>
      const sectionProps = section.props as TR.NativeSectionListProps<{ id: string; title: string }>

      Expect(flat.type).toBe(FlatList)
      Expect(flatProps.data).toEqual(data)
      Expect(flatProps.keyExtractor?.(data[0]!, 3)).toBe('a')
      Expect(section.type).toBe(SectionList)
      Expect(sectionProps.sections[0]?.title).toBe('Letters')
      Expect(sectionProps.keyExtractor?.(data[0]!, 3)).toBe('3')
    } finally {
      TR.NativeList.setDriverForTests()
    }
  })

  Test('exposes native list bridge helpers', () => {
    Expect(Object.keys(TR.NativeList).sort()).toEqual(['Flat', 'Section', 'indexKey', 'itemKey', 'setDriverForTests'])
  })
})

Describe('TR.StyleSheet', () => {
  Test('bridges React Native StyleSheet helpers through a deterministic driver', () => {
    try {
      TR.StyleSheet.setDriverForTests({
        absoluteFill: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
        absoluteFillObject: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
        compose(style1, style2) {
          return [style1, style2]
        },
        create(styles) {
          return styles
        },
        flatten(style) {
          return Array.isArray(style) ? Object.assign({}, ...style) : style as TR.StyleObject
        },
        hairlineWidth: 0.5,
      })

      const styles = TR.StyleSheet.create({
        label: { color: '#111111', padding: 8 },
      })
      const composed = TR.StyleSheet.compose(styles.label, { margin: 4 })

      Expect(styles.label).toEqual({ color: '#111111', padding: 8 })
      Expect(TR.StyleSheet.flatten(composed)).toEqual({ color: '#111111', margin: 4, padding: 8 })
      Expect(TR.StyleSheet.absoluteFill()).toEqual({ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 })
      Expect(TR.StyleSheet.absoluteFillObject()).toEqual({ bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 })
      Expect(TR.StyleSheet.hairlineWidth()).toBe(0.5)
    } finally {
      TR.StyleSheet.setDriverForTests()
    }
  })

  Test('exposes style sheet bridge helpers', () => {
    Expect(Object.keys(TR.StyleSheet).sort()).toEqual([
      'absoluteFill',
      'absoluteFillObject',
      'compose',
      'create',
      'flatten',
      'hairlineWidth',
      'setDriverForTests',
    ])
  })
})

Describe('TR.PanResponder', () => {
  Test('bridges React Native PanResponder creation through a deterministic driver', () => {
    let callbackKeys: string[] = []
    try {
      TR.PanResponder.setDriverForTests({
        create(callbacks) {
          callbackKeys = Object.keys(callbacks).sort()
          return {
            panHandlers: {
              onMoveShouldSetResponder: callbacks.onMoveShouldSetPanResponder,
              onResponderMove: callbacks.onPanResponderMove,
            },
          }
        },
      })

      const responder = TR.PanResponder.create({
        onMoveShouldSetPanResponder() {
          return true
        },
        onPanResponderMove() {},
      })

      Expect(callbackKeys).toEqual(['onMoveShouldSetPanResponder', 'onPanResponderMove'])
      Expect(TR.PanResponder.handlers(responder)).toEqual({
        onMoveShouldSetResponder: responder.panHandlers['onMoveShouldSetResponder'],
        onResponderMove: responder.panHandlers['onResponderMove'],
      })
      Expect(TR.PanResponder.shouldSet(true)({}, {})).toBe(true)
      Expect(TR.PanResponder.shouldSet(false)({}, {})).toBe(false)
    } finally {
      TR.PanResponder.setDriverForTests()
    }
  })

  Test('exposes PanResponder bridge helpers', () => {
    Expect(Object.keys(TR.PanResponder).sort()).toEqual(['create', 'handlers', 'setDriverForTests', 'shouldSet'])
  })
})

Describe('TR.InputAccessory', () => {
  Test('bridges iOS input accessory helpers through a deterministic driver', () => {
    const AccessoryView = (_props: TR.InputAccessoryProps) => null
    try {
      TR.InputAccessory.setDriverForTests({
        InputAccessoryView: AccessoryView,
      })

      const id = TR.InputAccessory.id('kitchen')
      const element = TR.InputAccessory.View({ backgroundColor: '#ffffff', nativeID: id })

      Expect(id).toBe('tao-input-accessory-kitchen')
      Expect(TR.InputAccessory.textInputProps(id)).toEqual({ inputAccessoryViewID: 'tao-input-accessory-kitchen' })
      Expect(element.type).toBe(AccessoryView)
      Expect(element.props).toEqual({ backgroundColor: '#ffffff', nativeID: 'tao-input-accessory-kitchen' })
    } finally {
      TR.InputAccessory.setDriverForTests()
    }
  })

  Test('exposes input accessory bridge helpers', () => {
    Expect(Object.keys(TR.InputAccessory).sort()).toEqual(['View', 'id', 'setDriverForTests', 'textInputProps'])
  })
})

Describe('TR.ToastAndroid', () => {
  Test('bridges Android toast variants through a deterministic driver', () => {
    const calls: unknown[] = []
    try {
      TR.ToastAndroid.setDriverForTests({
        BOTTOM: 10,
        CENTER: 20,
        LONG: 2,
        SHORT: 1,
        TOP: 30,
        show(message, duration) {
          calls.push(['show', message, duration])
        },
        showWithGravity(message, duration, gravity) {
          calls.push(['gravity', message, duration, gravity])
        },
        showWithGravityAndOffset(message, duration, gravity, xOffset, yOffset) {
          calls.push(['offset', message, duration, gravity, xOffset, yOffset])
        },
      })

      TR.ToastAndroid.show('Short toast')
      TR.ToastAndroid.show('Long center toast', { duration: 'long', gravity: 'center' })
      TR.ToastAndroid.show('Offset toast', { gravity: 'top', xOffset: 4, yOffset: 8 })

      Expect(calls).toEqual([
        ['show', 'Short toast', 1],
        ['gravity', 'Long center toast', 2, 20],
        ['offset', 'Offset toast', 1, 30, 4, 8],
      ])
    } finally {
      TR.ToastAndroid.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible Android toast actions', () => {
    const calls: string[] = []
    let callbackCount = 0
    try {
      TR.ToastAndroid.setDriverForTests({
        show(message) {
          calls.push(message)
        },
        showWithGravity() {},
        showWithGravityAndOffset() {},
      })

      TR.ToastAndroid.showAction(
        'Action toast',
        undefined,
        TR.ToastAndroid.shownAction(() => {
          callbackCount += 1
        }),
      ).invoke()

      Expect(calls).toEqual(['Action toast'])
      Expect(callbackCount).toBe(1)
    } finally {
      TR.ToastAndroid.setDriverForTests()
    }
  })

  Test('exposes Android toast bridge helpers', () => {
    Expect(Object.keys(TR.ToastAndroid).sort()).toEqual(['setDriverForTests', 'show', 'showAction', 'shownAction'])
  })
})

Describe('TR.BackHandler', () => {
  Test('bridges native app exit through a deterministic driver', () => {
    let exits = 0
    try {
      TR.BackHandler.setDriverForTests({
        addEventListener() {
          return { remove() {} }
        },
        exitApp() {
          exits += 1
        },
      })

      TR.BackHandler.exitApp()

      Expect(exits).toBe(1)
    } finally {
      TR.BackHandler.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible app-exit actions', () => {
    let exits = 0
    let callbackCount = 0
    try {
      TR.BackHandler.setDriverForTests({
        addEventListener() {
          return { remove() {} }
        },
        exitApp() {
          exits += 1
        },
      })

      TR.BackHandler.exitAppAction(TR.BackHandler.exitedAction(() => {
        callbackCount += 1
      })).invoke()

      Expect(exits).toBe(1)
      Expect(callbackCount).toBe(1)
    } finally {
      TR.BackHandler.setDriverForTests()
    }
  })

  Test('creates hardware-back callback actions', () => {
    let handled = false

    const press = TR.BackHandler.pressAction(() => {
      handled = true
      return true
    })

    Expect(press.invoke()).toBe(true)
    Expect(handled).toBe(true)
  })

  Test('exposes back handler bridge helpers', () => {
    Expect(Object.keys(TR.BackHandler).sort()).toEqual([
      'exitApp',
      'exitAppAction',
      'exitedAction',
      'onPress',
      'pressAction',
      'setDriverForTests',
    ])
  })
})

Describe('TR.Async', () => {
  Test('creates Async-compatible lifecycle actions', () => {
    const events: unknown[] = []

    TR.Async.successAction<string>(result => events.push(['success', result])).invoke('Saved')
    TR.Async.errorAction(error => events.push(['error', error])).invoke('Failed')
    TR.Async.finallyAction(() => events.push(['finally'])).invoke()

    Expect(events).toEqual([
      ['success', 'Saved'],
      ['error', 'Failed'],
      ['finally'],
    ])
  })

  Test('exposes async bridge helpers', () => {
    Expect(Object.keys(TR.Async).sort()).toEqual(['action', 'errorAction', 'finallyAction', 'successAction'])
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

  Test('creates no-op action payloads', () => {
    const action = TR.NoopAction()

    action.invoke('ignored')

    Expect(typeof action.invoke).toBe('function')
  })

  Test('creates no-op callbacks', () => {
    const callback = TR.Noop()

    callback()

    Expect(callback).toBe(TR.Noop())
  })

  Test('invokes action payloads through TR.Do with runtime arguments', () => {
    const calls: number[] = []
    const action = TR.Action((step: number) => calls.push(step))

    TR.Do(action, 3)

    Expect(calls).toEqual([3])
  })
})

Describe('TR.Easing', () => {
  Test('bridges React Native easing helpers through a deterministic driver', () => {
    try {
      TR.Easing.setDriverForTests({
        back: (value = 1) => progress => progress + value,
        bezier: (x1, y1, x2, y2) => progress => progress + x1 + y1 + x2 + y2,
        bounce: value => value + 1,
        circle: value => value + 2,
        cubic: value => value ** 3,
        ease: value => value + 3,
        elastic: (value = 1) => progress => progress + value,
        exp: value => value + 4,
        in: easing => progress => easing(progress) + 5,
        inOut: easing => progress => easing(progress) + 6,
        linear: value => value,
        out: easing => progress => easing(progress) + 7,
        poly: value => progress => progress ** value,
        quad: value => value * value,
        sin: value => value + 8,
        step0: value => (value > 0 ? 1 : 0),
        step1: value => (value >= 1 ? 1 : 0),
      })

      Expect(TR.Easing.linear(0.4)).toBe(0.4)
      Expect(TR.Easing.quad(0.5)).toBe(0.25)
      Expect(TR.Easing.cubic(0.5)).toBe(0.125)
      Expect(TR.Easing.poly(3)(0.5)).toBe(0.125)
      Expect(TR.Easing.back(2)(0.5)).toBe(2.5)
      Expect(TR.Easing.bezier(1, 2, 3, 4)(0.5)).toBe(10.5)
      Expect(TR.Easing.in(TR.Easing.linear)(0.5)).toBe(5.5)
      Expect(TR.Easing.out(TR.Easing.linear)(0.5)).toBe(7.5)
      Expect(TR.Easing.inOut(TR.Easing.linear)(0.5)).toBe(6.5)
    } finally {
      TR.Easing.setDriverForTests()
    }
  })

  Test('exposes easing bridge helpers', () => {
    Expect(Object.keys(TR.Easing).sort()).toEqual([
      'back',
      'bezier',
      'bounce',
      'circle',
      'cubic',
      'ease',
      'elastic',
      'exp',
      'in',
      'inOut',
      'linear',
      'out',
      'poly',
      'quad',
      'setDriverForTests',
      'sin',
      'step0',
      'step1',
    ])
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
})

Describe('TR.Views', () => {
  Test('creates TextInput-compatible Tao change actions', () => {
    const values: string[] = []

    TR.Views.textInputAction({
      invoke(value) {
        values.push(value.evaluate().jsValue)
      },
    }).invoke({
      evaluate() {
        return this
      },
      jsValue: 'Ada',
    })

    Expect(values).toEqual(['Ada'])
  })

  Test('exposes runtime-backed stdlib primitive views', () => {
    Expect(Object.keys(TR.Views).sort()).toEqual([
      'Image',
      'KeyboardAvoidingView',
      'Pressable',
      'SafeAreaView',
      'Screen',
      'ScrollView',
      'Text',
      'TextInput',
      'View',
      'textInputAction',
    ])
  })
})

Describe('TR.Boundary', () => {
  Test('exposes app-visible boundary helpers', () => {
    Expect(Object.keys(TR.Boundary).sort()).toEqual(['Error', 'Loading'])
  })
})

Describe('TR.Clipboard', () => {
  Test('bridges text copy and read through a deterministic driver', async () => {
    let copiedText = ''
    try {
      TR.Clipboard.setDriverForTests({
        async getStringAsync() {
          return copiedText
        },
        async setStringAsync(text) {
          copiedText = text
          return true
        },
      })

      Expect(await TR.Clipboard.copyText('Copied text')).toBe(true)
      Expect(await TR.Clipboard.readText()).toBe('Copied text')
    } finally {
      TR.Clipboard.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible text copy actions', async () => {
    let copiedText = ''
    let copiedResult: boolean | undefined
    try {
      TR.Clipboard.setDriverForTests({
        async getStringAsync() {
          return copiedText
        },
        async setStringAsync(text) {
          copiedText = text
          return true
        },
      })

      await TR.Clipboard.copyTextAction(
        'Action copied',
        TR.Clipboard.copiedAction(copied => {
          copiedResult = copied
        }),
      ).invoke()

      Expect(copiedText).toBe('Action copied')
      Expect(copiedResult).toBe(true)
    } finally {
      TR.Clipboard.setDriverForTests()
    }
  })

  Test('exposes clipboard bridge helpers', () => {
    Expect(Object.keys(TR.Clipboard).sort()).toEqual([
      'copiedAction',
      'copyText',
      'copyTextAction',
      'readText',
      'setDriverForTests',
    ])
  })
})

Describe('TR.Device', () => {
  Test('normalizes deterministic viewport values for generated-code tests', () => {
    try {
      TR.Device.setViewportForTests({
        height: 390,
        scale: 3,
        width: 844,
      })

      Expect(TR.Device.viewport()).toEqual({
        fontScale: 1,
        height: 390,
        orientation: 'landscape',
        scale: 3,
        width: 844,
      })
    } finally {
      TR.Device.setViewportForTests()
    }
  })

  Test('exposes device bridge helpers', () => {
    Expect(Object.keys(TR.Device).sort()).toEqual(['setViewportForTests', 'viewport'])
  })
})

Describe('TR.Feedback', () => {
  Test('bridges haptic feedback through a deterministic driver', async () => {
    const calls: string[] = []
    try {
      TR.Feedback.setDriverForTests(feedbackDriverForTests(calls))

      await TR.Feedback.impact('heavy')
      await TR.Feedback.notification('warning')
      await TR.Feedback.selection()

      Expect(calls).toEqual(['impact:Heavy', 'notification:Warning', 'selection'])
    } finally {
      TR.Feedback.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible haptic feedback actions', async () => {
    const calls: string[] = []
    let callbackCount = 0
    try {
      TR.Feedback.setDriverForTests(feedbackDriverForTests(calls))

      await TR.Feedback.impactAction(
        'soft',
        TR.Feedback.feedbackAction(() => {
          callbackCount += 1
        }),
      ).invoke()
      await TR.Feedback.notificationAction(
        'success',
        TR.Feedback.feedbackAction(() => {
          callbackCount += 1
        }),
      ).invoke()
      await TR.Feedback.selectionAction(
        TR.Feedback.feedbackAction(() => {
          callbackCount += 1
        }),
      ).invoke()

      Expect(calls).toEqual(['impact:Soft', 'notification:Success', 'selection'])
      Expect(callbackCount).toBe(3)
    } finally {
      TR.Feedback.setDriverForTests()
    }
  })

  Test('exposes feedback bridge helpers', () => {
    Expect(Object.keys(TR.Feedback).sort()).toEqual([
      'feedbackAction',
      'impact',
      'impactAction',
      'notification',
      'notificationAction',
      'selection',
      'selectionAction',
      'setDriverForTests',
    ])
  })
})

Describe('TR.Resource', () => {
  Test('creates Pressable-compatible mutation actions', () => {
    const inputs: string[] = []
    const mutation: TR.ResourceMutation<string, string> = {
      data: undefined,
      error: undefined,
      isError: false,
      isIdle: true,
      isLoading: false,
      isSuccess: false,
      mutate(input) {
        inputs.push(input)
      },
      mutateAsync: async input => input,
      reset() {},
      status: 'idle',
    }

    TR.Resource.mutationAction(mutation, 'Saved item').invoke()

    Expect(inputs).toEqual(['Saved item'])
  })

  Test('exposes async resource bridge helpers', () => {
    Expect(Object.keys(TR.Resource).sort()).toEqual(['mutation', 'mutationAction', 'query'])
  })
})

Describe('TR.SecureStore', () => {
  Test('bridges secure text persistence through a deterministic driver', async () => {
    const values = new Map<string, string>()
    try {
      TR.SecureStore.setDriverForTests(secureStoreDriverForTests(values))

      Expect(await TR.SecureStore.available()).toBe(true)
      await TR.SecureStore.saveText('token', 'secret-token')
      Expect(await TR.SecureStore.readText('token')).toBe('secret-token')
      await TR.SecureStore.deleteText('token')
      Expect(await TR.SecureStore.readText('token')).toBe(null)
    } finally {
      TR.SecureStore.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible secure store actions', async () => {
    const values = new Map<string, string>()
    let saved = false
    let deleted = false
    try {
      TR.SecureStore.setDriverForTests(secureStoreDriverForTests(values))

      await TR.SecureStore.saveTextAction(
        'session',
        'saved-session',
        TR.SecureStore.completeAction(() => {
          saved = true
        }),
      ).invoke()
      await TR.SecureStore.deleteTextAction(
        'session',
        TR.SecureStore.completeAction(() => {
          deleted = true
        }),
      ).invoke()

      Expect(saved).toBe(true)
      Expect(deleted).toBe(true)
      Expect(values.has('session')).toBe(false)
    } finally {
      TR.SecureStore.setDriverForTests()
    }
  })

  Test('exposes secure store bridge helpers', () => {
    Expect(Object.keys(TR.SecureStore).sort()).toEqual([
      'available',
      'completeAction',
      'deleteText',
      'deleteTextAction',
      'readText',
      'saveText',
      'saveTextAction',
      'setDriverForTests',
    ])
  })
})

Describe('TR.Share', () => {
  Test('bridges share content through a deterministic driver', async () => {
    const sharedContent: TR.ShareContent[] = []
    try {
      TR.Share.setDriverForTests({
        async share(content) {
          sharedContent.push(content)
          return { action: 'sharedAction' }
        },
      })

      Expect(await TR.Share.content({ message: 'Shared message', title: 'Share title', url: 'https://tao.dev' }))
        .toEqual({
          action: 'sharedAction',
        })
      Expect(sharedContent).toEqual([{ message: 'Shared message', title: 'Share title', url: 'https://tao.dev' }])
    } finally {
      TR.Share.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible share actions', async () => {
    let sharedMessage = ''
    let sharedAction = ''
    try {
      TR.Share.setDriverForTests({
        async share(content) {
          sharedMessage = content.message ?? ''
          return { action: 'dismissedAction' }
        },
      })

      await TR.Share.textAction(
        'Share from action',
        undefined,
        TR.Share.sharedAction(result => {
          sharedAction = result.action
        }),
      ).invoke()

      Expect(sharedMessage).toBe('Share from action')
      Expect(sharedAction).toBe('dismissedAction')
    } finally {
      TR.Share.setDriverForTests()
    }
  })

  Test('exposes share bridge helpers', () => {
    Expect(Object.keys(TR.Share).sort()).toEqual([
      'content',
      'contentAction',
      'setDriverForTests',
      'sharedAction',
      'text',
      'textAction',
    ])
  })
})

Describe('TR.Form', () => {
  Test('creates TextInput-compatible form change actions', () => {
    const values: string[] = []
    const field: TR.TextField = {
      invalid: false,
      onBlur() {},
      onChangeText(value) {
        values.push(value)
      },
      value: '',
    }

    TR.Form.textInputAction(field).invoke({
      evaluate() {
        return this
      },
      jsValue: 'Ada',
    })

    Expect(values).toEqual(['Ada'])
  })

  Test('creates TextInput-compatible form blur actions', () => {
    let blurred = false
    const field: TR.TextField = {
      invalid: false,
      onBlur() {
        blurred = true
      },
      onChangeText() {},
      value: '',
    }

    TR.Form.textBlurAction(field).invoke()

    Expect(blurred).toBe(true)
  })

  Test('creates valid submit callback actions', () => {
    const values: Array<{ name: string }> = []

    TR.Form.validAction<{ name: string }>(value => {
      values.push(value)
    }).invoke({ name: 'Ada' })

    Expect(values).toEqual([{ name: 'Ada' }])
  })

  Test('exposes form bridge helpers', () => {
    Expect(Object.keys(TR.Form).sort()).toEqual([
      'submitAction',
      'textBlurAction',
      'textField',
      'textInputAction',
      'use',
      'validAction',
    ])
  })
})

Describe('TR.Image', () => {
  Test('creates native remote image sources and normalizes resize modes', () => {
    Expect(TR.Image.remote('https://tao.dev/kitchen.png')).toEqual({ uri: 'https://tao.dev/kitchen.png' })
    Expect(TR.Image.resizeMode('contain')).toBe('contain')
    Expect(TR.Image.resizeMode('unexpected')).toBe('cover')
  })

  Test('exposes image bridge helpers', () => {
    Expect(Object.keys(TR.Image).sort()).toEqual(['remote', 'resizeMode'])
  })
})

Describe('TR.Indicator', () => {
  Test('normalizes activity indicator sizes', () => {
    Expect(TR.Indicator.size('large')).toBe('large')
    Expect(TR.Indicator.size('unexpected')).toBe('small')
  })

  Test('exposes indicator bridge helpers', () => {
    Expect(Object.keys(TR.Indicator).sort()).toEqual(['LabeledSpinner', 'Spinner', 'size'])
  })
})

Describe('TR.Linking', () => {
  Test('opens supported URLs through a deterministic driver', async () => {
    const openedURLs: string[] = []
    try {
      TR.Linking.setDriverForTests({
        async canOpenURL(url) {
          return url.startsWith('https://')
        },
        async openURL(url) {
          openedURLs.push(url)
        },
      })

      Expect(await TR.Linking.openURL('mailto:ro@example.com')).toBe(false)
      Expect(await TR.Linking.openURL('https://tao.dev')).toBe(true)
      Expect(openedURLs).toEqual(['https://tao.dev'])
    } finally {
      TR.Linking.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible URL actions', async () => {
    let openedURL = ''
    let openedResult: boolean | undefined
    try {
      TR.Linking.setDriverForTests({
        async canOpenURL() {
          return true
        },
        async openURL(url) {
          openedURL = url
        },
      })

      await TR.Linking.openURLAction(
        'https://tao.dev/docs',
        TR.Linking.openedAction(opened => {
          openedResult = opened
        }),
      ).invoke()

      Expect(openedURL).toBe('https://tao.dev/docs')
      Expect(openedResult).toBe(true)
    } finally {
      TR.Linking.setDriverForTests()
    }
  })

  Test('exposes linking bridge helpers', () => {
    Expect(Object.keys(TR.Linking).sort()).toEqual([
      'canOpenURL',
      'openURL',
      'openURLAction',
      'openedAction',
      'setDriverForTests',
    ])
  })
})

Describe('TR.Keyboard', () => {
  Test('bridges keyboard dismissal through a deterministic driver', () => {
    let dismisses = 0
    try {
      TR.Keyboard.setDriverForTests({
        dismiss() {
          dismisses += 1
        },
      })

      TR.Keyboard.dismiss()

      Expect(dismisses).toBe(1)
    } finally {
      TR.Keyboard.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible keyboard actions', () => {
    let dismisses = 0
    let callbackCount = 0
    try {
      TR.Keyboard.setDriverForTests({
        dismiss() {
          dismisses += 1
        },
      })

      TR.Keyboard.dismissAction(
        TR.Keyboard.dismissedAction(() => {
          callbackCount += 1
        }),
      ).invoke()

      Expect(dismisses).toBe(1)
      Expect(callbackCount).toBe(1)
    } finally {
      TR.Keyboard.setDriverForTests()
    }
  })

  Test('exposes keyboard bridge helpers', () => {
    Expect(Object.keys(TR.Keyboard).sort()).toEqual([
      'dismiss',
      'dismissAction',
      'dismissedAction',
      'setDriverForTests',
    ])
  })
})

Describe('TR.Vibration', () => {
  Test('bridges native vibration through a deterministic driver', () => {
    const calls: Array<{ pattern?: TR.VibrationPattern; repeat?: boolean } | 'cancel'> = []
    try {
      TR.Vibration.setDriverForTests({
        cancel() {
          calls.push('cancel')
        },
        vibrate(pattern, repeat) {
          calls.push({ pattern, repeat })
        },
      })

      TR.Vibration.vibrate([0, 50, 25], true)
      TR.Vibration.cancel()

      Expect(calls).toEqual([{ pattern: [0, 50, 25], repeat: true }, 'cancel'])
    } finally {
      TR.Vibration.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible vibration actions', () => {
    const calls: string[] = []
    let callbackCount = 0
    try {
      TR.Vibration.setDriverForTests({
        cancel() {
          calls.push('cancel')
        },
        vibrate() {
          calls.push('vibrate')
        },
      })

      TR.Vibration.vibrateAction(
        40,
        false,
        TR.Vibration.vibratedAction(() => {
          callbackCount += 1
        }),
      ).invoke()
      TR.Vibration.cancelAction(
        TR.Vibration.canceledAction(() => {
          callbackCount += 1
        }),
      ).invoke()

      Expect(calls).toEqual(['vibrate', 'cancel'])
      Expect(callbackCount).toBe(2)
    } finally {
      TR.Vibration.setDriverForTests()
    }
  })

  Test('exposes vibration bridge helpers', () => {
    Expect(Object.keys(TR.Vibration).sort()).toEqual([
      'cancel',
      'cancelAction',
      'canceledAction',
      'setDriverForTests',
      'vibrate',
      'vibrateAction',
      'vibratedAction',
    ])
  })
})

Describe('TR.Location', () => {
  Test('bridges foreground location through a deterministic driver', async () => {
    try {
      TR.Location.setDriverForTests(locationDriverForTests(true))

      Expect(await TR.Location.current({ accuracy: 'high' })).toEqual({
        coordinates: {
          accuracy: 5,
          altitude: 12,
          heading: 90,
          latitude: 45.5,
          longitude: -122.6,
          speed: 1.5,
        },
        permissionGranted: true,
        timestamp: 1234,
      })
    } finally {
      TR.Location.setDriverForTests()
    }
  })

  Test('returns a permission result when foreground location is denied', async () => {
    try {
      TR.Location.setDriverForTests(locationDriverForTests(false))

      Expect(await TR.Location.current()).toEqual({
        permissionGranted: false,
      })
    } finally {
      TR.Location.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible location actions', async () => {
    let latitude = 0
    try {
      TR.Location.setDriverForTests(locationDriverForTests(true))

      await TR.Location.currentAction(
        {},
        TR.Location.locatedAction(result => {
          latitude = result.coordinates?.latitude ?? 0
        }),
      ).invoke()

      Expect(latitude).toBe(45.5)
    } finally {
      TR.Location.setDriverForTests()
    }
  })

  Test('exposes location bridge helpers', () => {
    Expect(Object.keys(TR.Location).sort()).toEqual(['current', 'currentAction', 'locatedAction', 'setDriverForTests'])
  })
})

Describe('TR.Media', () => {
  Test('bridges image picking through a deterministic driver', async () => {
    try {
      TR.Media.setDriverForTests({
        async requestMediaLibraryPermissionsAsync() {
          return { granted: true }
        },
        async launchImageLibraryAsync(options) {
          Expect(options).toMatchObject({
            allowsEditing: true,
            mediaTypes: ['images'],
            quality: 0.8,
          })
          return {
            assets: [{
              fileName: 'kitchen.png',
              height: 480,
              mimeType: 'image/png',
              uri: 'file:///kitchen.png',
              width: 640,
            }],
            canceled: false,
          }
        },
      })

      Expect(await TR.Media.pickImage({ allowsEditing: true, quality: 0.8 })).toEqual({
        canceled: false,
        image: {
          fileName: 'kitchen.png',
          height: 480,
          mimeType: 'image/png',
          uri: 'file:///kitchen.png',
          width: 640,
        },
        permissionGranted: true,
      })
    } finally {
      TR.Media.setDriverForTests()
    }
  })

  Test('returns a canceled result when media permission is denied', async () => {
    try {
      TR.Media.setDriverForTests({
        async requestMediaLibraryPermissionsAsync() {
          return { granted: false }
        },
        async launchImageLibraryAsync() {
          throw new Error('picker should not launch without permission')
        },
      })

      Expect(await TR.Media.pickImage()).toEqual({
        canceled: true,
        permissionGranted: false,
      })
    } finally {
      TR.Media.setDriverForTests()
    }
  })

  Test('creates Pressable-compatible image picker actions', async () => {
    let pickedURI = ''
    try {
      TR.Media.setDriverForTests({
        async requestMediaLibraryPermissionsAsync() {
          return { status: 'granted' }
        },
        async launchImageLibraryAsync() {
          return {
            assets: [{
              height: 10,
              uri: 'file:///picked.jpg',
              width: 20,
            }],
            canceled: false,
          }
        },
      })

      await TR.Media.pickImageAction(
        {},
        TR.Media.pickedAction(result => {
          pickedURI = result.image?.uri ?? ''
        }),
      ).invoke()

      Expect(pickedURI).toBe('file:///picked.jpg')
    } finally {
      TR.Media.setDriverForTests()
    }
  })

  Test('exposes media bridge helpers', () => {
    Expect(Object.keys(TR.Media).sort()).toEqual(['pickImage', 'pickImageAction', 'pickedAction', 'setDriverForTests'])
  })
})

Describe('TR.Navigation', () => {
  Test('exposes navigation bridge helpers', () => {
    Expect(Object.keys(TR.Navigation).sort()).toEqual([
      'Container',
      'back',
      'createNativeStack',
      'createRef',
      'navigate',
    ])
  })
})

Describe('TR.Network', () => {
  Test('normalizes deterministic network status for generated-code tests', () => {
    try {
      TR.Network.setStatusForTests({
        isConnected: true,
        isInternetReachable: null,
        type: 'wifi',
      })

      Expect(TR.Network.status()).toEqual({
        isConnected: true,
        isInternetReachable: null,
        isOnline: true,
        isUnknown: false,
        type: 'wifi',
      })

      TR.Network.setStatusForTests({
        isConnected: true,
        isInternetReachable: false,
        type: 'cellular',
      })

      Expect(TR.Network.status()).toEqual({
        isConnected: true,
        isInternetReachable: false,
        isOnline: false,
        isUnknown: false,
        type: 'cellular',
      })
    } finally {
      TR.Network.setStatusForTests()
    }
  })

  Test('exposes network bridge helpers', () => {
    Expect(Object.keys(TR.Network).sort()).toEqual(['setStatusForTests', 'status'])
  })
})

Describe('TR.PixelRatio', () => {
  Test('bridges pixel density through a deterministic driver', () => {
    try {
      TR.PixelRatio.setDriverForTests({
        get() {
          return 3
        },
        getFontScale() {
          return 1.25
        },
        getPixelSizeForLayoutSize(layoutSize) {
          return Math.round(layoutSize * 3)
        },
        roundToNearestPixel(layoutSize) {
          return Math.round(layoutSize * 3) / 3
        },
      })

      Expect(TR.PixelRatio.get()).toBe(3)
      Expect(TR.PixelRatio.fontScale()).toBe(1.25)
      Expect(TR.PixelRatio.pixelSize(12)).toBe(36)
      Expect(TR.PixelRatio.round(10.2)).toBe(10.333333333333334)
    } finally {
      TR.PixelRatio.setDriverForTests()
    }
  })

  Test('exposes pixel-ratio bridge helpers', () => {
    Expect(Object.keys(TR.PixelRatio).sort()).toEqual([
      'fontScale',
      'get',
      'pixelSize',
      'round',
      'setDriverForTests',
    ])
  })
})

Describe('TR.Modal', () => {
  Test('creates Modal-compatible lifecycle actions', () => {
    let invoked = false

    TR.Modal.action(() => {
      invoked = true
    }).invoke()

    Expect(invoked).toBe(true)
  })

  Test('normalizes modal animation and presentation options', () => {
    Expect(TR.Modal.animation('fade')).toBe('fade')
    Expect(TR.Modal.animation('slide')).toBe('slide')
    Expect(TR.Modal.animation('unexpected')).toBe('none')
    Expect(TR.Modal.presentation('pageSheet')).toBe('pageSheet')
    Expect(TR.Modal.presentation('unexpected')).toBe('fullScreen')
  })

  Test('exposes modal bridge helpers', () => {
    Expect(Object.keys(TR.Modal).sort()).toEqual(['Root', 'action', 'animation', 'presentation'])
  })
})

Describe('TR.Platform', () => {
  Test('normalizes deterministic platform details for generated-code tests', () => {
    try {
      TR.Platform.setDriverForTests({ OS: 'ios' })

      Expect(TR.Platform.info()).toEqual({
        isNative: true,
        isWeb: false,
        os: 'ios',
      })

      Expect(TR.Platform.select({
        android: 'android value',
        default: 'default value',
        ios: 'ios value',
        native: 'native value',
      })).toBe('ios value')

      TR.Platform.setDriverForTests({ OS: 'visionos' })
      Expect(TR.Platform.info()).toEqual({
        isNative: false,
        isWeb: false,
        os: 'unknown',
      })
      Expect(TR.Platform.select({ default: 'default value', native: 'native value' })).toBe('default value')
    } finally {
      TR.Platform.setDriverForTests()
    }
  })

  Test('exposes platform bridge helpers', () => {
    Expect(Object.keys(TR.Platform).sort()).toEqual(['info', 'select', 'setDriverForTests'])
  })
})

Describe('TR.RefreshControl', () => {
  Test('creates RefreshControl-compatible actions', () => {
    let invoked = false

    TR.RefreshControl.action(() => {
      invoked = true
    }).invoke()

    Expect(invoked).toBe(true)
  })

  Test('normalizes refresh-control busy state', () => {
    Expect(TR.RefreshControl.refreshing(true)).toBe(true)
    Expect(TR.RefreshControl.refreshing(false)).toBe(false)
    Expect(TR.RefreshControl.refreshing('true')).toBe(false)
  })

  Test('exposes refresh-control bridge helpers', () => {
    Expect(Object.keys(TR.RefreshControl).sort()).toEqual(['Control', 'action', 'refreshing'])
  })
})

Describe('TR.SafeArea', () => {
  Test('converts safe-area insets into padding style values', () => {
    Expect(TR.SafeArea.edgePadding({ bottom: 5, left: 2, right: 3, top: 7 }, 10)).toEqual({
      paddingBottom: 15,
      paddingLeft: 12,
      paddingRight: 13,
      paddingTop: 17,
    })
  })

  Test('exposes safe-area bridge helpers', () => {
    Expect(Object.keys(TR.SafeArea).sort()).toEqual(['edgePadding', 'insets'])
  })
})

Describe('TR.StatusBar', () => {
  Test('normalizes status-bar styles', () => {
    Expect(TR.StatusBar.style('dark-content')).toBe('dark-content')
    Expect(TR.StatusBar.style('light-content')).toBe('light-content')
    Expect(TR.StatusBar.style('unexpected')).toBe('default')
  })

  Test('exposes status-bar bridge helpers', () => {
    Expect(Object.keys(TR.StatusBar).sort()).toEqual(['Bar', 'style'])
  })
})

Describe('TR.Toggle', () => {
  Test('normalizes toggle checked state', () => {
    Expect(TR.Toggle.value(true)).toBe(true)
    Expect(TR.Toggle.value(false)).toBe(false)
    Expect(TR.Toggle.value('true')).toBe(false)
  })

  Test('creates Toggle-compatible change actions', () => {
    const values: boolean[] = []

    TR.Toggle.action(value => values.push(value)).invoke(true)

    Expect(values).toEqual([true])
  })

  Test('exposes toggle bridge helpers', () => {
    Expect(Object.keys(TR.Toggle).sort()).toEqual(['Control', 'LabeledControl', 'action', 'value'])
  })
})

Describe('TR.Storage', () => {
  Test('creates TextInput-compatible local persistence actions', () => {
    const values: string[] = []
    const state: TR.TextStorageState = {
      isLoaded: true,
      set(value) {
        values.push(value)
      },
      value: '',
    }

    TR.Storage.textInputAction(state).invoke({
      evaluate() {
        return this
      },
      jsValue: 'Stored text',
    })

    Expect(values).toEqual(['Stored text'])
  })

  Test('creates Pressable-compatible local persistence actions', () => {
    const values: string[] = []
    const state: TR.TextStorageState = {
      isLoaded: true,
      set(value) {
        values.push(value)
      },
      value: 'Initial',
    }

    TR.Storage.textStateAction(state, 'Saved text').invoke()

    Expect(values).toEqual(['Saved text'])
  })

  Test('exposes local persistence bridge helpers', () => {
    Expect(Object.keys(TR.Storage).sort()).toEqual([
      'remove',
      'setDriverForTests',
      'textInputAction',
      'textState',
      'textStateAction',
    ])
  })
})

Describe('TR.Style', () => {
  Test('exposes deterministic visual tokens', () => {
    Expect(Object.keys(TR.Style).sort()).toEqual(['Provider', 'palette'])
    Expect(typeof TR.Style.Provider).toBe('function')
    Expect(TR.Style.palette).toMatchObject({
      accent: '#2563eb',
      background: '#f8fafc',
      text: '#111827',
    })
  })
})

Describe('TR.Surface', () => {
  Test('exposes default app-state surface helpers', () => {
    Expect(Object.keys(TR.Surface).sort()).toEqual(['Empty', 'Error', 'Loading'])
  })
})

function feedbackDriverForTests(calls: string[]) {
  return {
    ImpactFeedbackStyle: {
      Heavy: 'Heavy',
      Light: 'Light',
      Medium: 'Medium',
      Rigid: 'Rigid',
      Soft: 'Soft',
    },
    NotificationFeedbackType: {
      Error: 'Error',
      Success: 'Success',
      Warning: 'Warning',
    },
    async impactAsync(style: unknown) {
      calls.push(`impact:${style}`)
    },
    async notificationAsync(type: unknown) {
      calls.push(`notification:${type}`)
    },
    async selectionAsync() {
      calls.push('selection')
    },
  }
}

function secureStoreDriverForTests(values: Map<string, string>) {
  return {
    async deleteItemAsync(key: string) {
      values.delete(key)
    },
    async getItemAsync(key: string) {
      return values.get(key) ?? null
    },
    async isAvailableAsync() {
      return true
    },
    async setItemAsync(key: string, value: string) {
      values.set(key, value)
    },
  }
}

function locationDriverForTests(permissionGranted: boolean) {
  return {
    Accuracy: {
      Balanced: 'Balanced',
      High: 'High',
      Low: 'Low',
    },
    async getCurrentPositionAsync(_options?: Record<string, unknown>) {
      return {
        coords: {
          accuracy: 5,
          altitude: 12,
          heading: 90,
          latitude: 45.5,
          longitude: -122.6,
          speed: 1.5,
        },
        timestamp: 1234,
      }
    },
    async requestForegroundPermissionsAsync() {
      return { granted: permissionGranted }
    },
  }
}

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
