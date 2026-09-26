import { jest } from '@jest/globals'
import { ExpoApiSource, NativeBindings } from '@native-bindings'
import TR from '@runtime/TR'
import { Errors, Repo } from '@shared'
import { Deferred, Describe, Expect, MockModule, settle, Test } from '@shared/test'
import { act, fireEvent } from '@testing-library/react-native'
import { registerRuntimeE2ELifecycle, testCompileFiles } from './test-compile-app'

registerRuntimeE2ELifecycle()

// This oracle is deliberately independent of the package declarations and generated enum mappings.
const impacts = [
  ['Light', 'light'],
  ['Medium', 'medium'],
  ['Heavy', 'heavy'],
  ['Soft', 'soft'],
  ['Rigid', 'rigid'],
] as const
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

const native = {
  impactAsync: jest.fn(async (_style: string = 'medium'): Promise<void> => {}),
  notificationAsync: jest.fn(async (_type: string = 'success'): Promise<void> => {}),
  selectionAsync: jest.fn(async (): Promise<void> => {}),
  performAndroidHapticsAsync: jest.fn(async (_type: string): Promise<void> => {}),
}
MockModule('expo-haptics', () => ({
  ...native,
  ImpactFeedbackStyle: Object.fromEntries(impacts),
  NotificationFeedbackType: Object.fromEntries(notifications),
  AndroidHaptics: Object.fromEntries(android),
}))

const nativeButton = `
  view NativeButton(Title text, Action action()) {
    render inject Title, Action \`\`\`ts
      return (
        <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
          <RN.Text>{Title}</RN.Text>
        </RN.Pressable>
      )
    \`\`\`
  }
`

async function generatedFiles(): Promise<Record<string, string>> {
  const generated = await NativeBindings.generate({
    source: ExpoApiSource,
    packageName: 'expo-haptics',
    fromDirectory: Repo.resolvePath('packages/apps/expo-host'),
  })
  Expect(generated.diagnostics).toEqual([])
  return generated.files
}

Describe('generated native Haptics bindings', () => {
  Test('invokes all four package methods with all 27 exact enum literals and preserves omitted defaults', async () => {
    const defaults: string[] = []
    native.impactAsync.mockClear().mockImplementation(async (style: string = 'medium') => {
      defaults.push(style)
    })
    native.notificationAsync.mockClear().mockImplementation(async (type: string = 'success') => {
      defaults.push(type)
    })
    native.selectionAsync.mockClear().mockResolvedValue(undefined)
    native.performAndroidHapticsAsync.mockClear()
    const cases = [
      ...impacts.map(([name]) => [name, `ImpactAsync(Style: ${name})`]),
      ...notifications.map(([name]) => [name, `NotificationAsync(Type: ${name})`]),
      ...android.map(([name]) => [name, `PerformAndroidHapticsAsync(Type: ${name})`]),
      ['ImpactDefault', 'ImpactAsync()'],
      ['NotificationDefault', 'NotificationAsync()'],
      ['Selection', 'SelectionAsync()'],
    ]
    await testCompileFiles('App.tao', {
      ...await generatedFiles(),
      'App.tao': `
        use ImpactAsync, NotificationAsync, SelectionAsync, PerformAndroidHapticsAsync from ./Bindings.tao
        use ImpactFeedbackStyle, NotificationFeedbackType, AndroidHaptics from ./Bindings.tao
        app HapticsProof { view Main }
        view Main() {
          ${cases.map(([name, call]) => `action Run${name}() { do ${call} }`).join('\n')}
          render Stack() {
            ${cases.map(([name]) => `NativeButton("${name}", Run${name})`).join('\n')}
          }
        }
        view Stack() {
          render inject Content @@content \`\`\`ts
            return <RN.View>{Content}</RN.View>
          \`\`\`
        }
        ${nativeButton}
      `,
    }, async screen => {
      for (const [name] of cases) {
        await act(async () => {
          await fireEvent.press(screen.getByText(name!))
        })
      }
      Expect(native.impactAsync.mock.calls).toEqual([...impacts.map(([, value]) => [value]), []])
      Expect(native.notificationAsync.mock.calls).toEqual([...notifications.map(([, value]) => [value]), []])
      Expect(native.performAndroidHapticsAsync.mock.calls).toEqual(android.map(([, value]) => [value]))
      Expect(native.selectionAsync.mock.calls).toEqual([[]])
      Expect(defaults.slice(-2)).toEqual(['medium', 'success'])
    })
  })

  Test(
    'waits for the native promise before continuing and reports rejection through the action failure channel',
    async () => {
      const completion = Deferred<void>()
      const rejection = Deferred<void>()
      native.selectionAsync.mockClear().mockImplementationOnce(() => completion.promise)
        .mockImplementationOnce(() => rejection.promise)
      native.notificationAsync.mockClear().mockResolvedValue(undefined)
      await testCompileFiles('App.tao', {
        ...await generatedFiles(),
        'App.tao': `
        use NotificationAsync, SelectionAsync from ./Bindings.tao
        use NotificationFeedbackType from ./Bindings.tao
        app HapticsCompletionProof { view Main }
        view Main() {
          action Run() { do SelectionAsync() do NotificationAsync(Type: Success) }
          render NativeButton("Run", Run)
        }
        ${nativeButton}
      `,
      }, async screen => {
        let completed = false
        let second: Promise<unknown> | undefined
        const failures: unknown[] = []
        const stopFailures = TR.Errors.onFailure(failure => failures.push(failure))
        const first = Promise.resolve(fireEvent.press(screen.getByText('Run'))).then(() => {
          completed = true
        })
        try {
          await settle()
          Expect(native.selectionAsync.mock.calls).toEqual([[]])
          Expect(completed).toBe(false)
          Expect(native.notificationAsync.mock.calls).toEqual([])
          completion.resolve()
          await first
          Expect(completed).toBe(true)
          Expect(native.notificationAsync.mock.calls).toEqual([['success']])

          const failure = new Errors.HostEnvironmentError('Haptic device failed')
          second = Promise.resolve(fireEvent.press(screen.getByText('Run'))).catch(error => error)
          await settle()
          Expect(native.selectionAsync.mock.calls).toEqual([[], []])
          Expect(failures).toEqual([])
          rejection.reject(failure)
          await second
          Expect(failures).toMatchObject([{
            action: 'Run',
            case: 'Unexpected',
            message: 'Haptic device failed',
            retryEligible: false,
          }])
          Expect(native.notificationAsync.mock.calls).toEqual([['success']])
        } finally {
          completion.resolve()
          rejection.resolve()
          await Promise.allSettled([first, second])
          stopFailures()
        }
      })
    },
  )
})
