import { beforeEach, jest } from '@jest/globals'
import { Repo } from '@shared'
import { Deferred, Describe, Expect, MockModule, settle, Test } from '@shared/test'
import { act, fireEvent, fireEventAsync } from '@testing-library/react-native'
import * as RN from 'react-native'
import { compileAndRenderApp, registerRuntimeE2ELifecycle, type RuntimeScreen } from './test-compile-app'

registerRuntimeE2ELifecycle()

type ClipboardEvent = { contentTypes: string[] }
type ClipboardImage = { data: string; size: { width: number; height: number } }
type ClipboardSubscription = { remove(): void }
const subscriptions: { emit(event: ClipboardEvent): void; remove: ReturnType<typeof jest.fn<() => void>> }[] = []
const clipboard = {
  getStringAsync: jest.fn<(_options?: { preferredFormat?: string }) => Promise<string>>(),
  setStringAsync: jest.fn<(_text: string, _options?: { inputFormat?: string }) => Promise<boolean>>(),
  hasStringAsync: jest.fn<() => Promise<boolean>>(),
  getImageAsync: jest.fn<(_options: { format: string; jpegQuality?: number }) => Promise<ClipboardImage | null>>(),
  setImageAsync: jest.fn<(_image: string) => Promise<void>>(),
  hasImageAsync: jest.fn<() => Promise<boolean>>(),
  getUrlAsync: jest.fn<() => Promise<string | null>>(),
  setUrlAsync: jest.fn<(_url: string) => Promise<void>>(),
  hasUrlAsync: jest.fn<() => Promise<boolean>>(),
  addClipboardListener: jest.fn<(_callback: (event: ClipboardEvent) => void) => ClipboardSubscription>(),
  removeClipboardListener: jest.fn<(_subscription: ClipboardSubscription) => void>(),
}
MockModule('expo-clipboard', () => ({
  ...clipboard,
  ContentType: { PLAIN_TEXT: 'plain-text', HTML: 'html', IMAGE: 'image', URL: 'url' },
  StringFormat: { PLAIN_TEXT: 'plainText', HTML: 'html' },
}))

// Literal UI/native pairs are independent of the demo source and generated declarations.
const impacts = [['Light', 'light'], ['Medium', 'medium'], ['Heavy', 'heavy'], ['Soft', 'soft'], [
  'Rigid',
  'rigid',
]] as const
const notifications = [['Success', 'success'], ['Warning', 'warning'], ['Error', 'error']] as const
const android = [
  ['Confirm', 'confirm'],
  ['Reject', 'reject'],
  ['Gesture_Start', 'gesture-start'],
  ['Gesture_End', 'gesture-end'],
  ['Toggle_On', 'toggle-on'],
  ['Toggle_Off', 'toggle-off'],
  ['Clock_Tick', 'clock-tick'],
  ['Context_Click', 'context-click'],
  ['Drag_Start', 'drag-start'],
  ['Keyboard_Tap', 'keyboard-tap'],
  ['Keyboard_Press', 'keyboard-press'],
  ['Keyboard_Release', 'keyboard-release'],
  ['Long_Press', 'long-press'],
  ['Virtual_Key', 'virtual-key'],
  ['Virtual_Key_Release', 'virtual-key-release'],
  ['No_Haptics', 'no-haptics'],
  ['Segment_Tick', 'segment-tick'],
  ['Segment_Frequent_Tick', 'segment-frequent-tick'],
  ['Text_Handle_Move', 'text-handle-move'],
] as const
const haptics = {
  impactAsync: jest.fn<(_style?: string) => Promise<void>>(),
  notificationAsync: jest.fn<(_type?: string) => Promise<void>>(),
  selectionAsync: jest.fn<() => Promise<void>>(),
  performAndroidHapticsAsync: jest.fn<(_type: string) => Promise<void>>(),
}
MockModule('expo-haptics', () => ({
  ...haptics,
  ImpactFeedbackStyle: Object.fromEntries(impacts),
  NotificationFeedbackType: Object.fromEntries(notifications),
  AndroidHaptics: Object.fromEntries(android),
}))

beforeEach(() => {
  clipboard.getStringAsync.mockReset().mockResolvedValue('')
  clipboard.setStringAsync.mockReset().mockResolvedValue(true)
  clipboard.hasStringAsync.mockReset().mockResolvedValue(false)
  clipboard.getImageAsync.mockReset().mockResolvedValue(null)
  clipboard.setImageAsync.mockReset().mockResolvedValue(undefined)
  clipboard.hasImageAsync.mockReset().mockResolvedValue(false)
  clipboard.getUrlAsync.mockReset().mockResolvedValue(null)
  clipboard.setUrlAsync.mockReset().mockResolvedValue(undefined)
  clipboard.hasUrlAsync.mockReset().mockResolvedValue(false)
  subscriptions.length = 0
  clipboard.addClipboardListener.mockReset().mockImplementation(emit => {
    // Retain emit after removal so the test can simulate a native event already in flight.
    const subscription = { emit, remove: jest.fn<() => void>() }
    subscriptions.push(subscription)
    return subscription
  })
  clipboard.removeClipboardListener.mockReset().mockImplementation(subscription => subscription.remove())
  for (const method of Object.values(haptics)) {
    method.mockReset().mockResolvedValue(undefined)
  }
})

async function press(screen: RuntimeScreen, name: string): Promise<void> {
  await fireEventAsync.press(screen.getByRole('button', { name }))
}

async function openDemo(name: string): Promise<RuntimeScreen> {
  const screen = await compileAndRenderApp(Repo.resolvePath('Apps/Test Apps/Native Bridge/App.tao'))
  await press(screen, name)
  // Merely opening a surface must not request native effects or clipboard access.
  for (const method of [...Object.values(clipboard), ...Object.values(haptics)]) {
    Expect(method).not.toHaveBeenCalled()
  }
  return screen
}

Describe('maintained Native Bridge demo', () => {
  Test('copies the edited draft and submitted input, awaits writes, and displays text and HTML reads', async () => {
    const saved = Deferred<boolean>()
    clipboard.setStringAsync.mockImplementationOnce(() => saved.promise)
    clipboard.getStringAsync.mockResolvedValueOnce('Text from another app').mockResolvedValueOnce(
      '<i>HTML from another app</i>',
    )
      .mockResolvedValueOnce('')
    clipboard.hasStringAsync.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const screen = await openDemo('Clipboard · Expo')
    fireEvent.changeText(screen.getByLabelText('Text to copy'), 'An edited draft')
    let pending: Promise<unknown> | undefined
    try {
      pending = Promise.resolve(fireEvent.press(screen.getByRole('button', { name: 'Copy text' })))
      await settle()
      Expect(clipboard.setStringAsync.mock.calls).toEqual([['An edited draft']])
      Expect(screen.getByText('Status: Ready')).toBeDefined()
      await act(async () => {
        saved.resolve(false)
        await pending
      })
      Expect(screen.getByText('Status: Text write returned: false')).toBeDefined()
    } finally {
      saved.resolve(false)
      await pending
    }
    fireEvent.changeText(screen.getByLabelText('Text to copy'), 'Submitted draft')
    await fireEventAsync(screen.getByLabelText('Text to copy'), 'submitEditing')
    Expect(screen.getByText('Status: Text write returned: true')).toBeDefined()
    await press(screen, 'Read text')
    Expect(screen.getByText('Read result: Text from another app')).toBeDefined()
    Expect(screen.getByText('Status: Text read complete')).toBeDefined()
    await press(screen, 'Copy sample HTML')
    Expect(screen.getByText('Status: HTML write returned: true')).toBeDefined()
    await press(screen, 'Read HTML')
    Expect(screen.getByText('Read result: <i>HTML from another app</i>')).toBeDefined()
    Expect(screen.getByText('Status: HTML read complete')).toBeDefined()
    await press(screen, 'Read text')
    Expect(screen.getByText(/^Read result:\s*$/)).toBeDefined()
    for (const value of ['true', 'false']) {
      await press(screen, 'Has text?')
      Expect(screen.getByText(`Status: Has text: ${value}`)).toBeDefined()
    }
    Expect(clipboard.setStringAsync.mock.calls).toEqual([
      ['An edited draft'],
      ['Submitted draft'],
      ['<b>HTML from Native Bridge</b>', { inputFormat: 'html' }],
    ])
    Expect(clipboard.getStringAsync.mock.calls).toEqual([[], [{ preferredFormat: 'html' }], []])
    Expect(clipboard.hasStringAsync.mock.calls).toEqual([[], []])
    Expect(clipboard.addClipboardListener).not.toHaveBeenCalled()
  })

  Test('copies the sample image and renders PNG and JPEG results, clearing an absent image', async () => {
    clipboard.getImageAsync.mockResolvedValueOnce({ data: 'data:image/png;base64,cG5n', size: { width: 3, height: 5 } })
      .mockResolvedValueOnce({ data: 'data:image/jpeg;base64,anBlZw==', size: { width: 7, height: 11 } })
      .mockResolvedValueOnce(null)
    clipboard.hasImageAsync.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const screen = await openDemo('Clipboard · Expo')
    Expect(screen.getByText('No image read')).toBeDefined()
    await press(screen, 'Copy sample image')
    Expect(clipboard.setImageAsync.mock.calls).toEqual([
      ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='],
    ])
    Expect(screen.getByText('Status: Copied a 1 × 1 sample image')).toBeDefined()
    await press(screen, 'Read PNG')
    Expect(screen.getByText('Image: 3 × 5')).toBeDefined()
    Expect(screen.getByLabelText('Clipboard image').props.source).toEqual({ uri: 'data:image/png;base64,cG5n' })
    Expect(screen.getByText('Status: PNG read complete')).toBeDefined()
    await press(screen, 'Read JPEG')
    Expect(screen.getByText('Image: 7 × 11')).toBeDefined()
    Expect(screen.getByLabelText('Clipboard image').props.source).toEqual({ uri: 'data:image/jpeg;base64,anBlZw==' })
    Expect(screen.getByText('Status: JPEG read complete')).toBeDefined()
    await press(screen, 'Read PNG')
    Expect(screen.getByText('No image read')).toBeDefined()
    Expect(screen.queryByLabelText('Clipboard image')).toBeNull()
    for (const value of ['true', 'false']) {
      await press(screen, 'Has image?')
      Expect(screen.getByText(`Status: Has image: ${value}`)).toBeDefined()
    }
    Expect(clipboard.getImageAsync.mock.calls).toEqual([[{ format: 'png' }], [{ format: 'jpeg', jpegQuality: 0.8 }], [{
      format: 'png',
    }]])
    Expect(clipboard.hasImageAsync.mock.calls).toEqual([[], []])
    Expect(clipboard.addClipboardListener).not.toHaveBeenCalled()
  })

  Test('copies the sample URL and displays present, absent and availability results', async () => {
    clipboard.getUrlAsync.mockResolvedValueOnce('https://example.com/from-another-app').mockResolvedValueOnce(null)
    clipboard.hasUrlAsync.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const screen = await openDemo('Clipboard · Expo')
    await press(screen, 'Copy sample URL')
    Expect(clipboard.setUrlAsync.mock.calls).toEqual([['https://example.com/native-bridge']])
    Expect(screen.getByText('Status: URL written')).toBeDefined()
    await press(screen, 'Read URL')
    Expect(screen.getByText('URL: https://example.com/from-another-app')).toBeDefined()
    Expect(screen.getByText('Status: URL read complete')).toBeDefined()
    await press(screen, 'Read URL')
    Expect(screen.getByText(/^URL:\s*$/)).toBeDefined()
    for (const value of ['true', 'false']) {
      await press(screen, 'Has URL?')
      Expect(screen.getByText(`Status: Has URL: ${value}`)).toBeDefined()
    }
    Expect(clipboard.getUrlAsync.mock.calls).toEqual([[], []])
    Expect(clipboard.hasUrlAsync.mock.calls).toEqual([[], []])
    Expect(clipboard.addClipboardListener).not.toHaveBeenCalled()
  })

  for (const stopButton of ['Stop listening', 'Stop via deprecated API']) {
    Test(`updates listener controls and events, supports ${stopButton}, and cleans up on Back`, async () => {
      const screen = await openDemo('Clipboard · Expo')
      Expect(screen.getByText('No clipboard changes received')).toBeDefined()
      Expect(screen.getByRole('button', { name: 'Start listening' }).props.accessibilityState.disabled).toBe(false)
      for (const name of ['Stop listening', 'Stop via deprecated API']) {
        Expect(screen.getByRole('button', { name }).props.accessibilityState.disabled).toBe(true)
        await press(screen, name)
      }
      Expect(clipboard.removeClipboardListener).not.toHaveBeenCalled()
      await press(screen, 'Start listening')
      Expect(screen.getByText('Listening')).toBeDefined()
      Expect(screen.getByRole('button', { name: 'Start listening' }).props.accessibilityState.disabled).toBe(true)
      for (const name of ['Stop listening', 'Stop via deprecated API']) {
        Expect(screen.getByRole('button', { name }).props.accessibilityState.disabled).toBe(false)
      }
      await press(screen, 'Start listening')
      Expect(clipboard.addClipboardListener).toHaveBeenCalledTimes(1)
      const first = subscriptions[0]!
      await act(async () => {
        first.emit({ contentTypes: ['plain-text'] })
        first.emit({ contentTypes: ['image', 'html'] })
        await settle()
      })
      Expect(screen.getByText('Clipboard changes: 2')).toBeDefined()
      Expect(screen.getByText('Clipboard change received')).toBeDefined()
      await press(screen, 'Reset change count')
      Expect(screen.getByText('Clipboard changes: 0')).toBeDefined()
      Expect(screen.getByText('No clipboard changes received')).toBeDefined()
      Expect(screen.getByText('Listening')).toBeDefined()
      Expect(first.remove).not.toHaveBeenCalled()
      Expect(clipboard.addClipboardListener).toHaveBeenCalledTimes(1)
      await act(async () => {
        first.emit({ contentTypes: ['plain-text'] })
        await settle()
      })
      Expect(screen.getByText('Clipboard changes: 1')).toBeDefined()
      Expect(screen.getByText('Clipboard change received')).toBeDefined()
      await press(screen, stopButton)
      Expect(first.remove).toHaveBeenCalledTimes(1)
      Expect(clipboard.removeClipboardListener).toHaveBeenCalledTimes(stopButton === 'Stop via deprecated API' ? 1 : 0)
      Expect(screen.getByText('Not listening')).toBeDefined()
      Expect(screen.getByRole('button', { name: 'Start listening' }).props.accessibilityState.disabled).toBe(false)
      for (const name of ['Stop listening', 'Stop via deprecated API']) {
        Expect(screen.getByRole('button', { name }).props.accessibilityState.disabled).toBe(true)
      }
      await act(async () => {
        first.emit({ contentTypes: ['url'] })
        await settle()
      })
      Expect(screen.getByText('Clipboard changes: 1')).toBeDefined()
      await press(screen, 'Start listening')
      const second = subscriptions[1]!
      Expect(clipboard.addClipboardListener).toHaveBeenCalledTimes(2)
      Expect(second.remove).not.toHaveBeenCalled()
      await fireEventAsync.press(screen.getByLabelText('Back'))
      Expect(screen.getByText('Try generated native APIs on your device. Choose a surface below.')).toBeDefined()
      Expect(first.remove).toHaveBeenCalledTimes(1)
      Expect(second.remove).toHaveBeenCalledTimes(1)
      await press(screen, 'Clipboard · Expo')
      Expect(screen.getByText('Not listening')).toBeDefined()
      Expect(screen.getByText('Clipboard changes: 0')).toBeDefined()
      await press(screen, 'Start listening')
      const third = subscriptions[2]!
      await act(async () => {
        first.emit({ contentTypes: ['plain-text'] })
        second.emit({ contentTypes: ['plain-text'] })
        third.emit({ contentTypes: ['plain-text'] })
        await settle()
      })
      Expect(screen.getByText('Clipboard changes: 1')).toBeDefined()
      Expect(third.remove).not.toHaveBeenCalled()
      screen.unmount()
      Expect(third.remove).toHaveBeenCalledTimes(1)
      Expect(second.remove).toHaveBeenCalledTimes(1)
    })
  }

  Test('wires Haptics controls and status to their native calls and toggles the Android group', async () => {
    const screen = await openDemo('Haptics · Expo')
    const cases = [
      ['ImpactAsync default', haptics.impactAsync, []],
      ...impacts.map(([name, value]) => [`ImpactAsync ${name}`, haptics.impactAsync, [value]] as const),
      ['NotificationAsync default', haptics.notificationAsync, []],
      ...notifications.map(([name, value]) =>
        [`NotificationAsync ${name}`, haptics.notificationAsync, [value]] as const
      ),
      ['SelectionAsync', haptics.selectionAsync, []],
    ] as const
    for (const [label, method, arguments_] of cases) {
      const count = method.mock.calls.length
      await press(screen, label)
      Expect(method).toHaveBeenCalledTimes(count + 1)
      Expect(method).toHaveBeenLastCalledWith(...arguments_)
      Expect(screen.getByText(`Status: Completed: ${label}`)).toBeDefined()
    }
    Expect(screen.queryByText('Android only: PerformAndroidHapticsAsync Confirm')).toBeNull()
    await press(screen, 'Show or hide Android haptics')
    for (const [name, value] of android) {
      const label = `Android only: PerformAndroidHapticsAsync ${name}`
      await press(screen, label)
      Expect(haptics.performAndroidHapticsAsync).toHaveBeenLastCalledWith(value)
      Expect(screen.getByText(`Status: Completed: ${label}`)).toBeDefined()
    }
    Expect(haptics.performAndroidHapticsAsync).toHaveBeenCalledTimes(19)
    await press(screen, 'Show or hide Android haptics')
    Expect(screen.queryByText('Android only: PerformAndroidHapticsAsync Confirm')).toBeNull()
  })

  Test('requests and cancels Vibration from the maintained controls', async () => {
    const vibrate = jest.spyOn(RN.Vibration, 'vibrate').mockImplementation(() => {})
    const cancel = jest.spyOn(RN.Vibration, 'cancel').mockImplementation(() => {})
    try {
      const screen = await openDemo('Vibration · React Native')
      Expect(vibrate).not.toHaveBeenCalled()
      Expect(cancel).not.toHaveBeenCalled()
      await press(screen, 'Vibrate')
      Expect(vibrate.mock.calls).toEqual([[200, false]])
      Expect(screen.getByText('Status: Vibration requested')).toBeDefined()
      await press(screen, 'Cancel vibration')
      Expect(cancel.mock.calls).toEqual([[]])
      Expect(screen.getByText('Status: Cancellation requested')).toBeDefined()
    } finally {
      vibrate.mockRestore()
      cancel.mockRestore()
    }
  })
})
