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
    clipboard.hasStringAsync.mockResolvedValueOnce(true)
    const screen = await openDemo('Clipboard · Expo')
    fireEvent.changeText(screen.getByLabelText('Text to copy'), 'An edited draft')
    let pending: Promise<unknown> | undefined
    try {
      pending = Promise.resolve(fireEvent.press(screen.getByRole('button', { name: 'Copy text' })))
      await settle()
      Expect(clipboard.setStringAsync.mock.calls).toEqual([['An edited draft']])
      screen.getByText('Status: Ready')
      await act(async () => {
        saved.resolve(false)
        await pending
      })
      screen.getByText('Status: Text write returned: false')
    } finally {
      saved.resolve(false)
      await pending
    }
    fireEvent.changeText(screen.getByLabelText('Text to copy'), 'Submitted draft')
    await fireEventAsync(screen.getByLabelText('Text to copy'), 'submitEditing')
    screen.getByText('Status: Text write returned: true')
    await press(screen, 'Read text')
    screen.getByText('Read result: Text from another app')
    screen.getByText('Status: Text read complete')
    await press(screen, 'Copy sample HTML')
    screen.getByText('Status: HTML write returned: true')
    await press(screen, 'Read HTML')
    screen.getByText('Read result: <i>HTML from another app</i>')
    screen.getByText('Status: HTML read complete')
    await press(screen, 'Read text')
    screen.getByText(/^Read result:\s*$/)
    for (const value of ['true']) {
      await press(screen, 'Has text?')
      screen.getByText(`Status: Has text: ${value}`)
    }
    Expect(clipboard.setStringAsync.mock.calls).toEqual([
      ['An edited draft'],
      ['Submitted draft'],
      ['<b>HTML from Native Bridge</b>', { inputFormat: 'html' }],
    ])
    Expect(clipboard.getStringAsync.mock.calls).toEqual([[], [{ preferredFormat: 'html' }], []])
    Expect(clipboard.hasStringAsync.mock.calls).toEqual([[]])
    Expect(clipboard.addClipboardListener).not.toHaveBeenCalled()
  })

  Test('copies the sample image and renders PNG and JPEG results, clearing an absent image', async () => {
    clipboard.getImageAsync.mockResolvedValueOnce({ data: 'data:image/png;base64,cG5n', size: { width: 3, height: 5 } })
      .mockResolvedValueOnce({ data: 'data:image/jpeg;base64,anBlZw==', size: { width: 7, height: 11 } })
      .mockResolvedValueOnce(null)
    clipboard.hasImageAsync.mockResolvedValueOnce(true)
    const screen = await openDemo('Clipboard · Expo')
    screen.getByText('No image read')
    await press(screen, 'Copy sample image')
    Expect(clipboard.setImageAsync.mock.calls).toEqual([
      ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='],
    ])
    screen.getByText('Status: Copied a 1 × 1 sample image')
    await press(screen, 'Read PNG')
    screen.getByText('Image: 3 × 5')
    Expect(screen.getByLabelText('Clipboard image').props.source).toEqual({ uri: 'data:image/png;base64,cG5n' })
    screen.getByText('Status: PNG read complete')
    await press(screen, 'Read JPEG')
    screen.getByText('Image: 7 × 11')
    Expect(screen.getByLabelText('Clipboard image').props.source).toEqual({ uri: 'data:image/jpeg;base64,anBlZw==' })
    screen.getByText('Status: JPEG read complete')
    await press(screen, 'Read PNG')
    screen.getByText('No image read')
    Expect(screen.queryByLabelText('Clipboard image')).toBeNull()
    for (const value of ['true']) {
      await press(screen, 'Has image?')
      screen.getByText(`Status: Has image: ${value}`)
    }
    Expect(clipboard.getImageAsync.mock.calls).toEqual([[{ format: 'png' }], [{ format: 'jpeg', jpegQuality: 0.8 }], [{
      format: 'png',
    }]])
    Expect(clipboard.hasImageAsync.mock.calls).toEqual([[]])
    Expect(clipboard.addClipboardListener).not.toHaveBeenCalled()
  })

  Test('copies the sample URL and displays present, absent and availability results', async () => {
    clipboard.getUrlAsync.mockResolvedValueOnce('https://example.com/from-another-app').mockResolvedValueOnce(null)
    clipboard.hasUrlAsync.mockResolvedValueOnce(true)
    const screen = await openDemo('Clipboard · Expo')
    await press(screen, 'Copy sample URL')
    Expect(clipboard.setUrlAsync.mock.calls).toEqual([['https://example.com/native-bridge']])
    screen.getByText('Status: URL written')
    await press(screen, 'Read URL')
    screen.getByText('URL: https://example.com/from-another-app')
    screen.getByText('Status: URL read complete')
    await press(screen, 'Read URL')
    screen.getByText(/^URL:\s*$/)
    for (const value of ['true']) {
      await press(screen, 'Has URL?')
      screen.getByText(`Status: Has URL: ${value}`)
    }
    Expect(clipboard.getUrlAsync.mock.calls).toEqual([[], []])
    Expect(clipboard.hasUrlAsync.mock.calls).toEqual([[]])
    Expect(clipboard.addClipboardListener).not.toHaveBeenCalled()
  })

  // REMOVAL CANDIDATE: Both stop APIs repeat the full Back/remount/stale-event sequence; keep until one scoped API proof can replace its duplicate lifecycle path.
  for (const stopButton of ['Stop listening', 'Stop via deprecated API']) {
    Test(`updates listener controls and events, supports ${stopButton}, and cleans up on Back`, async () => {
      const screen = await openDemo('Clipboard · Expo')
      screen.getByText('No clipboard changes received')
      Expect(screen.getByRole('button', { name: 'Start listening' }).props.accessibilityState.disabled).toBe(false)
      for (const name of ['Stop listening', 'Stop via deprecated API']) {
        Expect(screen.getByRole('button', { name }).props.accessibilityState.disabled).toBe(true)
        await press(screen, name)
      }
      Expect(clipboard.removeClipboardListener).not.toHaveBeenCalled()
      await press(screen, 'Start listening')
      screen.getByText('Listening')
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
      screen.getByText('Clipboard changes: 2')
      screen.getByText('Clipboard change received')
      await press(screen, 'Reset change count')
      screen.getByText('Clipboard changes: 0')
      screen.getByText('No clipboard changes received')
      screen.getByText('Listening')
      Expect(first.remove).not.toHaveBeenCalled()
      Expect(clipboard.addClipboardListener).toHaveBeenCalledTimes(1)
      await act(async () => {
        first.emit({ contentTypes: ['plain-text'] })
        await settle()
      })
      screen.getByText('Clipboard changes: 1')
      screen.getByText('Clipboard change received')
      await press(screen, stopButton)
      Expect(first.remove).toHaveBeenCalledTimes(1)
      Expect(clipboard.removeClipboardListener).toHaveBeenCalledTimes(stopButton === 'Stop via deprecated API' ? 1 : 0)
      screen.getByText('Not listening')
      Expect(screen.getByRole('button', { name: 'Start listening' }).props.accessibilityState.disabled).toBe(false)
      for (const name of ['Stop listening', 'Stop via deprecated API']) {
        Expect(screen.getByRole('button', { name }).props.accessibilityState.disabled).toBe(true)
      }
      await act(async () => {
        first.emit({ contentTypes: ['url'] })
        await settle()
      })
      screen.getByText('Clipboard changes: 1')
      await press(screen, 'Start listening')
      const second = subscriptions[1]!
      Expect(clipboard.addClipboardListener).toHaveBeenCalledTimes(2)
      Expect(second.remove).not.toHaveBeenCalled()
      await fireEventAsync.press(screen.getByLabelText('Back'))
      screen.getByText('Try generated native APIs on your device. Choose a surface below.')
      Expect(first.remove).toHaveBeenCalledTimes(1)
      Expect(second.remove).toHaveBeenCalledTimes(1)
      await press(screen, 'Clipboard · Expo')
      screen.getByText('Not listening')
      screen.getByText('Clipboard changes: 0')
      await press(screen, 'Start listening')
      const third = subscriptions[2]!
      await act(async () => {
        first.emit({ contentTypes: ['plain-text'] })
        second.emit({ contentTypes: ['plain-text'] })
        third.emit({ contentTypes: ['plain-text'] })
        await settle()
      })
      screen.getByText('Clipboard changes: 1')
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
      ...impacts.slice(0, 1).map(([name, value]) => [`ImpactAsync ${name}`, haptics.impactAsync, [value]] as const),
      ['NotificationAsync default', haptics.notificationAsync, []],
      ...notifications.slice(0, 1).map(([name, value]) =>
        [`NotificationAsync ${name}`, haptics.notificationAsync, [value]] as const
      ),
      ['SelectionAsync', haptics.selectionAsync, []],
    ] as const
    for (const [label, method, arguments_] of cases) {
      const count = method.mock.calls.length
      await press(screen, label)
      Expect(method).toHaveBeenCalledTimes(count + 1)
      Expect(method).toHaveBeenLastCalledWith(...arguments_)
      screen.getByText(`Status: Completed: ${label}`)
    }
    Expect(screen.queryByText('Android only: PerformAndroidHapticsAsync Confirm')).toBeNull()
    await press(screen, 'Show or hide Android haptics')
    for (const [name, value] of android.slice(0, 1)) {
      const label = `Android only: PerformAndroidHapticsAsync ${name}`
      await press(screen, label)
      Expect(haptics.performAndroidHapticsAsync).toHaveBeenLastCalledWith(value)
      screen.getByText(`Status: Completed: ${label}`)
    }
    Expect(haptics.performAndroidHapticsAsync).toHaveBeenCalledTimes(1)
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
      screen.getByText('Status: Vibration requested')
      await press(screen, 'Cancel vibration')
      Expect(cancel.mock.calls).toEqual([[]])
      screen.getByText('Status: Cancellation requested')
    } finally {
      vibrate.mockRestore()
      cancel.mockRestore()
    }
  })
})
