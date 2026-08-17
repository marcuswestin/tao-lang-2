import { RuntimeTesting } from '@runtime/testing/runtime-testing'
import TR from '@runtime/TR'
import { Repo } from '@shared'
import { AfterAll, AfterEach, Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { act, cleanup, fireEvent, render } from '@testing-library/react-native'
import { createElement, type ReactElement, type ReactNode, useState } from 'react'
import * as RN from 'react-native'
import { compileAndRenderApp, ExpectScreen, testCompileApp, testCompileFiles } from './test-compile-app'

AfterAll(async () => {
  await RuntimeTesting.stopTestCompiler()
})

AfterEach(() => {
  cleanup()
  TR.ActionSheetIOS.setDriverForTests()
  TR.AccessibilityInfo.setDriverForTests()
  TR.Alert.setDriverForTests()
  TR.Animated.setDriverForTests()
  TR.Appearance.setDriverForTests()
  TR.AppState.setDriverForTests()
  TR.BackHandler.setDriverForTests()
  TR.Clipboard.setDriverForTests()
  TR.Device.setViewportForTests()
  TR.Easing.setDriverForTests()
  TR.Feedback.setDriverForTests()
  TR.I18n.setDriverForTests()
  TR.InputAccessory.setDriverForTests()
  TR.InteractionManager.setDriverForTests()
  TR.Keyboard.setDriverForTests()
  TR.LayoutAnimation.setDriverForTests()
  TR.Linking.setDriverForTests()
  TR.Location.setDriverForTests()
  TR.Media.setDriverForTests()
  TR.NativeColor.setDriverForTests()
  TR.NativeList.setDriverForTests()
  TR.PanResponder.setDriverForTests()
  TR.PermissionsAndroid.setDriverForTests()
  TR.PixelRatio.setDriverForTests()
  TR.Platform.setDriverForTests()
  TR.SecureStore.setDriverForTests()
  TR.Share.setDriverForTests()
  TR.StyleSheet.setDriverForTests()
  TR.ToastAndroid.setDriverForTests()
  TR.Vibration.setDriverForTests()
  TR.setDevMode()
  TR.Network.setStatusForTests()
  TR.Storage.setDriverForTests()
})

Describe('Expo runtime', () => {
  Test('runs Tao text expectations with duplicate rendered text', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use DuplicateTextApp from ./

        test "Duplicate text" {
          check "matches at least one text node" {
            run DuplicateTextApp
            expect text "Repeated"
          }
        }
      `,
        'Main.tao': `
        app DuplicateTextApp { view MainView }
        view MainView {
          render Stack {
            Text "Repeated"
            Text "Repeated"
          }
        }
        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('runs Tao press text steps before later expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use PressTextApp from ./

        test "Press text" {
          check "updates rendered state" {
            run PressTextApp
            expect text "0"
            press text "Add"
            expect text "1"
          }
        }
      `,
        'Main.tao': `
        app PressTextApp { view MainView }
        view MainView {
          state Count = 0
          action AddOne {
            set Count += 1
          }
          render Stack {
            NativeButton "Add", AddOne
            Number Count
          }
        }
        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }
        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }
        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('reports Tao suite and check context for failed text expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use BrokenTextApp from ./

        test "Broken text" {
          check "misses expected text" {
            run BrokenTextApp
            expect text "Expected"
          }
        }
      `,
        'Main.tao': `
        app BrokenTextApp { view MainView }
        view MainView {
          render Text "Actual"
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /Tao check failed: Broken text > misses expected text[\s\S]*expect text "Expected"[\s\S]*Main\.test\.tao:/,
        )
      },
    )
  })

  Test('reports Tao suite and check context for failed missing text expectations', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use BrokenTextApp from ./

        test "Broken missing text" {
          check "still renders unexpected text" {
            run BrokenTextApp
            expect missing text "Actual"
          }
        }
      `,
        'Main.tao': `
        app BrokenTextApp { view MainView }
        view MainView {
          render Text "Actual"
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /Tao check failed: Broken missing text > still renders unexpected text[\s\S]*expect missing text "Actual"[\s\S]*Main\.test\.tao:/,
        )
      },
    )
  })

  Test('runs multiple Tao suites and cleans up rendered apps between Tao checks', async () => {
    await withTaoFiles(
      'tao-runtime-test-plan-',
      {
        'Main.test.tao': `
        use FirstApp, SecondApp from ./

        test "First isolated suite" {
          check "first app" {
            run FirstApp
            expect text "First"
          }
        }

        test "Second isolated suite" {
          check "second app" {
            run SecondApp
            expect missing text "First"
            expect text "Second"
          }
        }
      `,
        'First.tao': `
        app FirstApp { view MainView }
        view MainView {
          render Text "First"
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
        'Second.tao': `
        app SecondApp { view MainView }
        view MainView {
          render Text "Second"
        }
        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('compiles and renders runtime stdlib imports', async () => {
    const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
    const screen = await compileAndRenderApp(runtimeStdlibTestsPath)

    ExpectScreen(screen).toHaveText('Runtime stdlib smoke')
    ExpectScreen(screen).toHaveText('3')
    ExpectScreen(screen).toHaveText('Tap me')
    ExpectScreen(screen).toHaveText('Label')
    ExpectScreen(screen).toHaveText('Wrapped')

    Expect(screen.getByText('Runtime stdlib smoke').props).toMatchObject({
      ellipsizeMode: 'tail',
      numberOfLines: 1,
    })
    Expect(RN.StyleSheet.flatten(screen.getByText('Runtime stdlib smoke').props.style)).toMatchObject({
      color: '#111827',
      fontSize: 16,
    })
    Expect(screen.getByText('3').props).toMatchObject({
      ellipsizeMode: 'tail',
      numberOfLines: 1,
    })
    Expect(screen.getByText('Label').props).toMatchObject({
      ellipsizeMode: 'clip',
      numberOfLines: 1,
    })
    Expect(screen.getByText('Wrapped').props.ellipsizeMode).toBeUndefined()
    Expect(screen.getByText('Wrapped').props.numberOfLines).toBeUndefined()
    Expect(ancestorProp(screen.getByText('Tap me'), 'accessibilityRole')).toBe('button')
    Expect(ancestorStyleWithProp(screen.getByText('Tap me'), 'accessibilityRole', 'button')).toMatchObject({
      backgroundColor: '#2563eb',
      borderRadius: 8,
      minHeight: 44,
    })
    Expect(RN.StyleSheet.flatten(screen.getByText('Tap me').props.style)).toMatchObject({
      color: '#ffffff',
      fontWeight: '600',
    })
  })

  Test('bridges Tao accessibility clauses to React Native props', async () => {
    await testCompileApp(
      `
        use Button, Stack, Text, TextInput from @tao/ui

        app AccessibilityBridgeApp { view MainView }

        view MainView {
          action Rename Value is text { }
          action PressAccessible { }
          render Stack [id rootStack, label "Root stack"] {
            Text "Accessible text" [id accessibleText, label "Accessible text label"]
            Button "Accessible button", PressAccessible [id accessibleButton, label "Accessible button label", role button]
            TextInput "Editable value", Rename [id accessibleInput, label "Accessible input label"]
          }
        }
      `,
      async screen => {
        Expect(screen.getByTestId('rootStack').props.nativeID).toBe('rootStack')
        Expect(screen.getByLabelText('Accessible text label').props.testID).toBe('accessibleText')
        Expect(ancestorProp(screen.getByText('Accessible button'), 'testID')).toBe('accessibleButton')
        Expect(ancestorProp(screen.getByText('Accessible button'), 'accessibilityRole')).toBe('button')
        Expect(screen.getByLabelText('Accessible input label').props.testID).toBe('accessibleInput')
        Expect(RN.StyleSheet.flatten(screen.getByLabelText('Accessible input label').props.style)).toMatchObject({
          borderColor: '#cbd5e1',
          borderRadius: 8,
          minHeight: 44,
        })
      },
    )
  })

  Test('bridges default loading empty and error surfaces through generated Tao apps', async () => {
    await testCompileApp(
      `
        app SurfaceBridgeApp { view MainView }

        view MainView {
          render SurfaceProbe
        }

        view SurfaceProbe {
          render inject \`\`\`ts
            const [retried, setRetried] = React.useState(false)
            return <>
              {TR.Surface.Loading({ message: 'Loading kitchens' })}
              {TR.Surface.Empty({
                title: 'No kitchens yet',
                message: 'Create the first kitchen',
                action: { title: 'Create kitchen', invoke: () => setRetried(true) },
              })}
              {TR.Surface.Error({ message: 'Could not load kitchens' })}
              <RN.Text>{retried ? 'Retried surface' : 'Waiting surface'}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        ExpectScreen(screen).toHaveText('Loading kitchens')
        ExpectScreen(screen).toHaveText('No kitchens yet')
        ExpectScreen(screen).toHaveText('Create the first kitchen')
        ExpectScreen(screen).toHaveText('Something went wrong')
        ExpectScreen(screen).toHaveText('Could not load kitchens')
        ExpectScreen(screen).toHaveText('Waiting surface')

        fireEvent.press(screen.getByText('Create kitchen'))
        ExpectScreen(screen).toHaveText('Retried surface')
      },
    )
  })

  Test('bridges style provider palette overrides through generated Tao apps', async () => {
    await testCompileApp(
      `
        use Button, Stack, Text from @tao/ui

        app StyleProviderBridgeApp { view MainView }

        view MainView {
          action PressTheme { }
          render ThemeWrap {
            Text "Themed text"
            Button "Themed action", PressTheme
            SurfaceProbe { }
          }
        }

        layout ThemeWrap {
          render inject \`\`\`ts
            return (
              <TR.Style.Provider palette={{
                accent: '#059669',
                border: '#34d399',
                surface: '#ecfdf5',
                text: '#7c2d12',
                textOnAccent: '#fefce8',
              }}>
                {_ViewProps.children}
              </TR.Style.Provider>
            )
          \`\`\`
        }

        view SurfaceProbe {
          render inject \`\`\`ts
            return TR.Surface.Empty({ title: 'Themed empty', message: 'Themed surface message' })
          \`\`\`
        }
      `,
      async screen => {
        Expect(RN.StyleSheet.flatten(screen.getByText('Themed text').props.style)).toMatchObject({
          color: '#7c2d12',
        })
        Expect(ancestorStyleWithProp(screen.getByText('Themed action'), 'accessibilityRole', 'button')).toMatchObject({
          backgroundColor: '#059669',
        })
        Expect(RN.StyleSheet.flatten(screen.getByText('Themed action').props.style)).toMatchObject({
          color: '#fefce8',
        })
        Expect(ancestorStyleWithProp(screen.getByText('Themed empty'), 'accessibilityRole', 'summary')).toMatchObject({
          backgroundColor: '#ecfdf5',
          borderColor: '#34d399',
        })
      },
    )
  })

  Test('bridges async resource queries through generated Tao apps', async () => {
    await testCompileApp(
      `
        app ResourceBridgeApp { view MainView }

        view MainView {
          render ResourceMessage
        }

        view ResourceMessage {
          render inject \`\`\`ts
            const resource = TR.Resource.query({
              key: ['resource-bridge-test'],
              load: async () => 'Loaded from resource',
            })
            if (resource.isLoading) {
              return <RN.Text>Loading resource</RN.Text>
            }
            if (resource.isError) {
              return <RN.Text>Resource failed</RN.Text>
            }
            return <RN.Text>{resource.data}</RN.Text>
          \`\`\`
        }
      `,
      async screen => {
        Expect(await screen.findByText('Loaded from resource')).toBeDefined()
      },
    )
  })

  Test('bridges async resource mutations and query invalidation through generated Tao apps', async () => {
    await testCompileApp(
      `
        app MutationBridgeApp { view MainView }

        view MainView {
          render MutationProbe
        }

        view MutationProbe {
          render inject \`\`\`ts
            const resourceItems = React.useRef(['Seed item'])
            const items = TR.Resource.query({
              key: ['mutation-bridge-items'],
              load: async () => resourceItems.current.join(', '),
            })
            const addItem = TR.Resource.mutation({
              invalidate: [['mutation-bridge-items']],
              save: async value => {
                resourceItems.current.push(value)
                return value
              },
            })
            return <>
              <RN.Text>{items.data ?? 'Loading mutation items'}</RN.Text>
              {TR.Views.Pressable(
                {
                  title: addItem.isLoading ? 'Saving item' : 'Add mutation item',
                  action: TR.Resource.mutationAction(addItem, 'Saved item'),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{addItem.status}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(await screen.findByText('Seed item')).toBeDefined()
        fireEvent.press(screen.getByText('Add mutation item'))
        Expect(await screen.findByText('Seed item, Saved item')).toBeDefined()
        Expect(await screen.findByText('success')).toBeDefined()
      },
    )
  })

  Test('bridges React Native text input through React Hook Form', async () => {
    await testCompileApp(
      `
        app FormBridgeApp { view MainView }

        view MainView {
          render FormProbe
        }

        view FormProbe {
          render inject \`\`\`ts
            const form = TR.Form.use({ defaultValues: { name: 'Ada' } })
            const name = TR.Form.textField(form, 'name', { required: 'Name is required' })
            const submit = TR.Form.submitAction(form, TR.Form.validAction(values => form.setValue('name', values.name.toUpperCase())))
            return <>
              {TR.Views.TextInput(
                  {
                    __tao: _ViewProps.__tao,
                    value: name.value,
                    placeholder: 'Name',
                    onBlur: TR.Form.textBlurAction(name),
                    onChangeText: TR.Form.textInputAction(name),
                  },
                { nativeProps: { accessibilityLabel: 'Name' } },
              )}
              {name.error ? <RN.Text>{name.error}</RN.Text> : null}
              {TR.Views.Pressable({ title: 'Submit name', action: submit }, { nativeProps: { accessibilityRole: 'button' } })}
              <RN.Text>{name.value}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        fireEvent.changeText(screen.getByLabelText('Name'), 'Grace')
        Expect(screen.getByText('Grace')).toBeDefined()
        fireEvent.press(screen.getByText('Submit name'))
        Expect(await screen.findByText('GRACE')).toBeDefined()
        fireEvent.changeText(screen.getByLabelText('Name'), '')
        fireEvent(screen.getByLabelText('Name'), 'blur')
        Expect(await screen.findByText('Name is required')).toBeDefined()
      },
    )
  })

  Test('bridges disabled and loading pressable action state through generated Tao apps', async () => {
    await testCompileApp(
      `
        app PressableStateBridgeApp { view MainView }

        view MainView {
          render PressableStateProbe
        }

        view PressableStateProbe {
          render inject \`\`\`ts
            const [count, setCount] = React.useState(0)
            const action = { invoke: () => setCount((value: number) => value + 1) }
            return <>
              {TR.Views.Pressable(
                { title: 'Disabled action', disabled: true, action },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              {TR.Views.Pressable(
                { title: 'Save action', loadingTitle: 'Saving action', loading: true, action },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              {TR.Views.Pressable(
                { title: 'Enabled action', action },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{count}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('0')).toBeDefined()
        Expect(ancestorProp(screen.getByText('Disabled action'), 'accessibilityState')).toMatchObject({
          disabled: true,
        })
        Expect(ancestorProp(screen.getByText('Saving action'), 'accessibilityState')).toMatchObject({
          busy: true,
          disabled: true,
        })

        fireEvent.press(screen.getByText('Disabled action'))
        fireEvent.press(screen.getByText('Saving action'))
        Expect(screen.getByText('0')).toBeDefined()

        fireEvent.press(screen.getByText('Enabled action'))
        Expect(screen.getByText('1')).toBeDefined()
      },
    )
  })

  Test('bridges Expo Clipboard text actions through generated Tao apps', async () => {
    let clipboardText = ''
    TR.Clipboard.setDriverForTests({
      async getStringAsync() {
        return clipboardText
      },
      async setStringAsync(text) {
        clipboardText = text
        return true
      },
    })

    await testCompileApp(
      `
        app ClipboardBridgeApp { view MainView }

        view MainView {
          render ClipboardProbe
        }

        view ClipboardProbe {
          render inject \`\`\`ts
            const [copied, setCopied] = React.useState(false)
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Copy greeting',
                  action: TR.Clipboard.copyTextAction(
                    'Copied from Tao',
                    TR.Clipboard.copiedAction(didCopy => setCopied(didCopy)),
                  ),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{copied ? 'Copied greeting' : 'Waiting clipboard'}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Waiting clipboard')).toBeDefined()
        fireEvent.press(screen.getByText('Copy greeting'))
        Expect(await screen.findByText('Copied greeting')).toBeDefined()
        Expect(clipboardText).toBe('Copied from Tao')
      },
    )
  })

  Test('bridges Expo Linking URL actions through generated Tao apps', async () => {
    const openedURLs: string[] = []
    TR.Linking.setDriverForTests({
      async canOpenURL(url) {
        return url.startsWith('https://')
      },
      async openURL(url) {
        openedURLs.push(url)
      },
    })

    await testCompileApp(
      `
        app LinkingBridgeApp { view MainView }

        view MainView {
          render LinkingProbe
        }

        view LinkingProbe {
          render inject \`\`\`ts
            const [opened, setOpened] = React.useState(false)
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Open Tao link',
                  action: TR.Linking.openURLAction(
                    'https://tao.dev',
                    TR.Linking.openedAction(didOpen => setOpened(didOpen)),
                  ),
                },
                { nativeProps: { accessibilityRole: 'link' } },
              )}
              <RN.Text>{opened ? 'Opened Tao link' : 'Waiting link'}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Waiting link')).toBeDefined()
        fireEvent.press(screen.getByText('Open Tao link'))
        Expect(await screen.findByText('Opened Tao link')).toBeDefined()
        Expect(openedURLs).toEqual(['https://tao.dev'])
      },
    )
  })

  Test('bridges Expo Haptics feedback actions through generated Tao apps', async () => {
    const feedbackCalls: string[] = []
    TR.Feedback.setDriverForTests({
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
      async impactAsync(style) {
        feedbackCalls.push(`impact:${style}`)
      },
      async notificationAsync(type) {
        feedbackCalls.push(`notification:${type}`)
      },
      async selectionAsync() {
        feedbackCalls.push('selection')
      },
    })

    await testCompileApp(
      `
        app FeedbackBridgeApp { view MainView }

        view MainView {
          render FeedbackProbe
        }

        view FeedbackProbe {
          render inject \`\`\`ts
            const [feedback, setFeedback] = React.useState('Waiting feedback')
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Tap feedback',
                  action: TR.Feedback.impactAction(
                    'light',
                    TR.Feedback.feedbackAction(() => setFeedback('Feedback tapped')),
                  ),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{feedback}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Waiting feedback')).toBeDefined()
        fireEvent.press(screen.getByText('Tap feedback'))
        Expect(await screen.findByText('Feedback tapped')).toBeDefined()
        Expect(feedbackCalls).toEqual(['impact:Light'])
      },
    )
  })

  Test('bridges Expo Image Picker actions through generated Tao apps', async () => {
    TR.Media.setDriverForTests({
      async requestMediaLibraryPermissionsAsync() {
        return { granted: true }
      },
      async launchImageLibraryAsync() {
        return {
          assets: [{
            fileName: 'picked.png',
            height: 48,
            mimeType: 'image/png',
            uri: 'file:///picked.png',
            width: 64,
          }],
          canceled: false,
        }
      },
    })

    await testCompileApp(
      `
        app MediaBridgeApp { view MainView }

        view MainView {
          render MediaProbe
        }

        view MediaProbe {
          render inject \`\`\`ts
            const [picked, setPicked] = React.useState('Waiting image')
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Pick image',
                  action: TR.Media.pickImageAction(
                    {},
                    TR.Media.pickedAction(result => setPicked(result.image?.fileName ?? 'No image')),
                  ),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{picked}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Waiting image')).toBeDefined()
        fireEvent.press(screen.getByText('Pick image'))
        Expect(await screen.findByText('picked.png')).toBeDefined()
      },
    )
  })

  Test('bridges Expo Location foreground position actions through generated Tao apps', async () => {
    TR.Location.setDriverForTests({
      Accuracy: {
        Balanced: 'Balanced',
        High: 'High',
        Low: 'Low',
      },
      async getCurrentPositionAsync() {
        return {
          coords: {
            latitude: 45.5,
            longitude: -122.6,
          },
          timestamp: 1234,
        }
      },
      async requestForegroundPermissionsAsync() {
        return { granted: true }
      },
    })

    await testCompileApp(
      `
        app LocationBridgeApp { view MainView }

        view MainView {
          render LocationProbe
        }

        view LocationProbe {
          render inject \`\`\`ts
            const [location, setLocation] = React.useState('Waiting location')
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Find location',
                  action: TR.Location.currentAction(
                    {},
                    TR.Location.locatedAction(result => setLocation(String(result.coordinates?.latitude ?? 'No location'))),
                  ),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{location}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Waiting location')).toBeDefined()
        fireEvent.press(screen.getByText('Find location'))
        Expect(await screen.findByText('45.5')).toBeDefined()
      },
    )
  })

  Test('bridges local text persistence through AsyncStorage-compatible drivers', async () => {
    const storage = new Map<string, string>([['persisted-name', 'Stored name']])
    TR.Storage.setDriverForTests({
      async getItem(key) {
        return storage.get(key) ?? null
      },
      async removeItem(key) {
        storage.delete(key)
      },
      async setItem(key, value) {
        storage.set(key, value)
      },
    })

    await testCompileApp(
      `
        app StorageBridgeApp { view MainView }

        view MainView {
          render StorageProbe
        }

        view StorageProbe {
          render inject \`\`\`ts
            const name = TR.Storage.textState({
              key: 'persisted-name',
              initialValue: 'Initial name',
            })
            return <>
              {TR.Views.TextInput(
                { __tao: _ViewProps.__tao, value: name.value, onChangeText: TR.Storage.textInputAction(name) },
                { nativeProps: { accessibilityLabel: 'Stored name input' } },
              )}
              <RN.Text>{name.isLoaded ? name.value : 'Loading stored name'}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        await act(async () => {
          await Promise.resolve()
        })
        Expect(screen.getByText('Stored name')).toBeDefined()
        fireEvent.changeText(screen.getByLabelText('Stored name input'), 'Changed name')
        Expect(screen.getByText('Changed name')).toBeDefined()
        Expect(storage.get('persisted-name')).toBe('Changed name')
      },
    )
  })

  Test('bridges Expo SecureStore actions through generated Tao apps', async () => {
    const values = new Map<string, string>()
    TR.SecureStore.setDriverForTests({
      async deleteItemAsync(key) {
        values.delete(key)
      },
      async getItemAsync(key) {
        return values.get(key) ?? null
      },
      async isAvailableAsync() {
        return true
      },
      async setItemAsync(key, value) {
        values.set(key, value)
      },
    })

    await testCompileApp(
      `
        app SecureStoreBridgeApp { view MainView }

        view MainView {
          render SecureStoreProbe
        }

        view SecureStoreProbe {
          render inject \`\`\`ts
            const [status, setStatus] = React.useState('Waiting secure store')
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Save secure token',
                  action: TR.SecureStore.saveTextAction(
                    'token',
                    'stored-token',
                    TR.SecureStore.completeAction(() => setStatus('Saved secure token')),
                  ),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{status}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Waiting secure store')).toBeDefined()
        fireEvent.press(screen.getByText('Save secure token'))
        Expect(await screen.findByText('Saved secure token')).toBeDefined()
        Expect(values.get('token')).toBe('stored-token')
      },
    )
  })

  Test('bridges React Native share actions through generated Tao apps', async () => {
    const sharedMessages: string[] = []
    TR.Share.setDriverForTests({
      async share(content) {
        sharedMessages.push(content.message ?? '')
        return { action: 'sharedAction' }
      },
    })

    await testCompileApp(
      `
        app ShareBridgeApp { view MainView }

        view MainView {
          render ShareProbe
        }

        view ShareProbe {
          render inject \`\`\`ts
            const [status, setStatus] = React.useState('Waiting share')
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Share Tao',
                  action: TR.Share.textAction(
                    'Shared from Tao',
                    undefined,
                    TR.Share.sharedAction(result => setStatus(result.action)),
                  ),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{status}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Waiting share')).toBeDefined()
        fireEvent.press(screen.getByText('Share Tao'))
        Expect(await screen.findByText('sharedAction')).toBeDefined()
        Expect(sharedMessages).toEqual(['Shared from Tao'])
      },
    )
  })

  Test('bridges React Native alert actions through generated Tao apps', async () => {
    const alertTitles: string[] = []
    TR.Alert.setDriverForTests({
      alert(title) {
        alertTitles.push(title)
      },
    })

    await testCompileApp(
      `
        app AlertBridgeApp { view MainView }

        view MainView {
          render AlertProbe
        }

        view AlertProbe {
          render inject \`\`\`ts
            const [status, setStatus] = React.useState('Waiting alert')
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Show alert',
                  action: {
                    invoke: () => {
                      TR.Alert.message('Generated alert', 'Opened from Tao')
                      setStatus('Alert opened')
                    },
                  },
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{status}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Waiting alert')).toBeDefined()
        fireEvent.press(screen.getByText('Show alert'))
        Expect(await screen.findByText('Alert opened')).toBeDefined()
        Expect(alertTitles).toEqual(['Generated alert'])
      },
    )
  })

  Test('bridges React Native keyboard dismiss actions through generated Tao apps', async () => {
    let dismisses = 0
    TR.Keyboard.setDriverForTests({
      dismiss() {
        dismisses += 1
      },
    })

    await testCompileApp(
      `
        app KeyboardBridgeApp { view MainView }

        view MainView {
          render KeyboardProbe
        }

        view KeyboardProbe {
          render inject \`\`\`ts
            const [status, setStatus] = React.useState('Keyboard waiting')
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Dismiss keyboard',
                  action: TR.Keyboard.dismissAction(
                    TR.Keyboard.dismissedAction(() => setStatus('Keyboard dismissed')),
                  ),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{status}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Keyboard waiting')).toBeDefined()
        fireEvent.press(screen.getByText('Dismiss keyboard'))
        Expect(await screen.findByText('Keyboard dismissed')).toBeDefined()
        Expect(dismisses).toBe(1)
      },
    )
  })

  Test('bridges React Native vibration actions through generated Tao apps', async () => {
    let vibrations = 0
    TR.Vibration.setDriverForTests({
      cancel() {},
      vibrate() {
        vibrations += 1
      },
    })

    await testCompileApp(
      `
        app VibrationBridgeApp { view MainView }

        view MainView {
          render VibrationProbe
        }

        view VibrationProbe {
          render inject \`\`\`ts
            const [status, setStatus] = React.useState('Vibration waiting')
            return <>
              {TR.Views.Pressable(
                {
                  title: 'Vibrate device',
                  action: TR.Vibration.vibrateAction(
                    30,
                    false,
                    TR.Vibration.vibratedAction(() => setStatus('Vibration invoked')),
                  ),
                },
                { nativeProps: { accessibilityRole: 'button' } },
              )}
              <RN.Text>{status}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Vibration waiting')).toBeDefined()
        fireEvent.press(screen.getByText('Vibrate device'))
        Expect(await screen.findByText('Vibration invoked')).toBeDefined()
        Expect(vibrations).toBe(1)
      },
    )
  })

  Test('bridges React Native app state changes through generated Tao apps', async () => {
    let appStateListener: ((status: TR.AppStateStatus) => void) | undefined
    TR.AppState.setDriverForTests({
      currentState: 'active',
      addEventListener(_type, listener) {
        appStateListener = listener
        return {
          remove() {
            appStateListener = undefined
          },
        }
      },
    })

    await testCompileApp(
      `
        app AppStateBridgeApp { view MainView }

        view MainView {
          render AppStateProbe
        }

        view AppStateProbe {
          render inject \`\`\`ts
            const status = TR.AppState.status()
            return <RN.Text>App state {status}</RN.Text>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('App state active')).toBeDefined()
        act(() => {
          appStateListener?.('background')
        })
        Expect(await screen.findByText('App state background')).toBeDefined()
      },
    )
  })

  Test('bridges React Native appearance changes through generated Tao apps', async () => {
    let appearanceListener: ((preferences: { colorScheme?: string | null }) => void) | undefined
    TR.Appearance.setDriverForTests({
      getColorScheme() {
        return 'light'
      },
      addChangeListener(listener) {
        appearanceListener = listener
        return {
          remove() {
            appearanceListener = undefined
          },
        }
      },
    })

    await testCompileApp(
      `
        app AppearanceBridgeApp { view MainView }

        view MainView {
          render AppearanceProbe
        }

        view AppearanceProbe {
          render inject \`\`\`ts
            const scheme = TR.Appearance.colorScheme()
            return <RN.Text>Appearance {scheme}</RN.Text>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Appearance light')).toBeDefined()
        act(() => {
          appearanceListener?.({ colorScheme: 'dark' })
        })
        Expect(await screen.findByText('Appearance dark')).toBeDefined()
      },
    )
  })

  Test('bridges React Native accessibility preferences through generated Tao apps', async () => {
    let reduceMotionListener: ((enabled: boolean) => void) | undefined
    let screenReaderListener: ((enabled: boolean) => void) | undefined
    TR.AccessibilityInfo.setDriverForTests({
      addEventListener(type, listener) {
        if (type === 'reduceMotionChanged') {
          reduceMotionListener = listener
        } else {
          screenReaderListener = listener
        }
        return {
          remove() {
            if (type === 'reduceMotionChanged') {
              reduceMotionListener = undefined
            } else {
              screenReaderListener = undefined
            }
          },
        }
      },
      async isReduceMotionEnabled() {
        return false
      },
      async isScreenReaderEnabled() {
        return true
      },
    })

    await testCompileApp(
      `
        app AccessibilityInfoBridgeApp { view MainView }

        view MainView {
          render AccessibilityInfoProbe
        }

        view AccessibilityInfoProbe {
          render inject \`\`\`ts
            const preferences = TR.AccessibilityInfo.preferences()
            return <>
              <RN.Text>{preferences.screenReaderEnabled ? 'Screen reader on' : 'Screen reader off'}</RN.Text>
              <RN.Text>{preferences.reduceMotionEnabled ? 'Reduce motion on' : 'Reduce motion off'}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(await screen.findByText('Screen reader on')).toBeDefined()
        Expect(screen.getByText('Reduce motion off')).toBeDefined()
        act(() => {
          reduceMotionListener?.(true)
          screenReaderListener?.(false)
        })
        Expect(await screen.findByText('Reduce motion on')).toBeDefined()
        Expect(screen.getByText('Screen reader off')).toBeDefined()
      },
    )
  })

  Test('bridges React Native hardware-back events through generated Tao apps', async () => {
    let backPressHandler: (() => boolean) | undefined
    TR.BackHandler.setDriverForTests({
      addEventListener(_type, handler) {
        backPressHandler = handler
        return {
          remove() {
            backPressHandler = undefined
          },
        }
      },
      exitApp() {},
    })

    await testCompileApp(
      `
        app BackHandlerBridgeApp { view MainView }

        view MainView {
          render BackHandlerProbe
        }

        view BackHandlerProbe {
          render inject \`\`\`ts
            const [status, setStatus] = React.useState('Back waiting')
            TR.BackHandler.onPress(TR.BackHandler.pressAction(() => {
              setStatus('Back handled')
              return true
            }))
            return <RN.Text>{status}</RN.Text>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Back waiting')).toBeDefined()
        act(() => {
          Expect(backPressHandler?.()).toBe(true)
        })
        Expect(await screen.findByText('Back handled')).toBeDefined()
      },
    )
  })

  Test('bridges React Native network status through NetInfo', async () => {
    TR.Network.setStatusForTests({
      isConnected: true,
      isInternetReachable: false,
      type: 'wifi',
    })

    await testCompileApp(
      `
        app NetworkBridgeApp { view MainView }

        view MainView {
          render NetworkProbe
        }

        view NetworkProbe {
          render inject \`\`\`ts
            const network = TR.Network.status()
            return <>
              <RN.Text>{network.isOnline ? 'Online network' : 'Offline network'}</RN.Text>
              <RN.Text>{network.type}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Offline network')).toBeDefined()
        Expect(screen.getByText('wifi')).toBeDefined()
      },
    )
  })

  Test('bridges React Native platform details through generated Tao apps', async () => {
    TR.Platform.setDriverForTests({ OS: 'android' })

    await testCompileApp(
      `
        app PlatformBridgeApp { view MainView }

        view MainView {
          render PlatformProbe
        }

        view PlatformProbe {
          render inject \`\`\`ts
            const platform = TR.Platform.info()
            const label = TR.Platform.select({
              android: 'Android platform',
              default: 'Other platform',
            })
            return <>
              <RN.Text>{platform.os}</RN.Text>
              <RN.Text>{label}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('android')).toBeDefined()
        Expect(screen.getByText('Android platform')).toBeDefined()
      },
    )
  })

  Test('bridges React Native pixel ratio helpers through generated Tao apps', async () => {
    TR.PixelRatio.setDriverForTests({
      get() {
        return 2
      },
      getFontScale() {
        return 1.5
      },
      getPixelSizeForLayoutSize(layoutSize) {
        return layoutSize * 2
      },
      roundToNearestPixel(layoutSize) {
        return Math.round(layoutSize * 2) / 2
      },
    })

    await testCompileApp(
      `
        app PixelRatioBridgeApp { view MainView }

        view MainView {
          render PixelRatioProbe
        }

        view PixelRatioProbe {
          render inject \`\`\`ts
            return <>
              <RN.Text>Pixel ratio {TR.PixelRatio.get()}</RN.Text>
              <RN.Text>Font scale {TR.PixelRatio.fontScale()}</RN.Text>
              <RN.Text>Pixel size {TR.PixelRatio.pixelSize(8)}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Pixel ratio 2')).toBeDefined()
        Expect(screen.getByText('Font scale 1.5')).toBeDefined()
        Expect(screen.getByText('Pixel size 16')).toBeDefined()
      },
    )
  })

  Test('renders stdlib Image through React Native Image', async () => {
    await testCompileApp(
      `
        use Image, Stack, Text from @tao/ui

        app ImageBridgeApp { view MainView }

        view MainView {
          render Stack {
            Text "Image bridge"
            Image "https://tao.dev/kitchen.png" [id kitchenImage, label "Kitchen image"]
          }
        }
      `,
      async screen => {
        Expect(screen.getByText('Image bridge')).toBeDefined()
        const image = screen.UNSAFE_getByType(RN.Image)
        Expect(image.props.source).toEqual({ uri: 'https://tao.dev/kitchen.png' })
        Expect(image.props.accessibilityLabel).toBe('Kitchen image')
        Expect(image.props.accessibilityRole).toBe('image')
      },
    )
  })

  Test('renders React Native activity indicators through generated Tao apps', async () => {
    await testCompileApp(
      `
        app IndicatorBridgeApp { view MainView }

        view MainView {
          render IndicatorProbe
        }

        view IndicatorProbe {
          render inject \`\`\`ts
            return <>
              {TR.Indicator.Spinner({ size: 'large', color: '#0f766e' })}
              <RN.Text>Indicator bridge</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Indicator bridge')).toBeDefined()
        const indicator = screen.UNSAFE_getByType(RN.ActivityIndicator)
        Expect(indicator.props.animating).toBe(true)
        Expect(indicator.props.color).toBe('#0f766e')
        Expect(indicator.props.size).toBe('large')
      },
    )
  })

  Test('renders React Native status-bar configuration through generated Tao apps', async () => {
    await testCompileApp(
      `
        app StatusBarBridgeApp { view MainView }

        view MainView {
          render StatusBarProbe
        }

        view StatusBarProbe {
          render inject \`\`\`ts
            return <>
              {TR.StatusBar.Bar({ style: 'light-content', backgroundColor: '#111827', animated: true })}
              <RN.Text>Status bar bridge</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Status bar bridge')).toBeDefined()
        const statusBar = screen.UNSAFE_getByType(RN.StatusBar)
        Expect(statusBar.props.barStyle).toBe('light-content')
        Expect(statusBar.props.backgroundColor).toBe('#111827')
        Expect(statusBar.props.animated).toBe(true)
      },
    )
  })

  Test('renders React Native modal overlays through generated Tao apps', async () => {
    await testCompileApp(
      `
        app ModalBridgeApp { view MainView }

        view MainView {
          render ModalProbe
        }

        view ModalProbe {
          render inject \`\`\`ts
            const [closed, setClosed] = React.useState(false)
            return <>
              {TR.Modal.Root({
                animation: 'fade',
                onRequestClose: TR.Modal.action(() => setClosed(true)),
                presentation: 'overFullScreen',
                transparent: true,
                visible: true,
                children: <RN.Text>Modal content</RN.Text>,
              })}
              <RN.Text>{closed ? 'Modal closed' : 'Modal open'}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Modal content')).toBeDefined()
        const modal = screen.UNSAFE_getByType(RN.Modal)
        Expect(modal.props.animationType).toBe('fade')
        Expect(modal.props.presentationStyle).toBe('overFullScreen')
        Expect(modal.props.transparent).toBe(true)
        Expect(modal.props.visible).toBe(true)
        modal.props.onRequestClose()
        Expect(await screen.findByText('Modal closed')).toBeDefined()
      },
    )
  })

  Test('renders React Native refresh controls through generated Tao apps', async () => {
    await testCompileApp(
      `
        app RefreshControlBridgeApp { view MainView }

        view MainView {
          render RefreshControlProbe
        }

        view RefreshControlProbe {
          render inject \`\`\`ts
            const [status, setStatus] = React.useState('Refresh waiting')
            const refreshControl = TR.RefreshControl.Control({
              action: TR.RefreshControl.action(() => setStatus('Refresh invoked')),
              color: '#0f766e',
              refreshing: false,
              title: 'Refresh kitchens',
            })
            return (
              <RN.ScrollView refreshControl={refreshControl}>
                <RN.Text>{status}</RN.Text>
              </RN.ScrollView>
            )
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Refresh waiting')).toBeDefined()
        const refreshControl = screen.UNSAFE_getByType(RN.RefreshControl)
        Expect(refreshControl.props.refreshing).toBe(false)
        Expect(refreshControl.props.tintColor).toBe('#0f766e')
        Expect(refreshControl.props.title).toBe('Refresh kitchens')
        refreshControl.props.onRefresh()
        Expect(await screen.findByText('Refresh invoked')).toBeDefined()
      },
    )
  })

  Test('renders React Native switches through generated Tao apps', async () => {
    await testCompileApp(
      `
        app ToggleBridgeApp { view MainView }

        view MainView {
          render ToggleProbe
        }

        view ToggleProbe {
          render inject \`\`\`ts
            const [enabled, setEnabled] = React.useState(false)
            return <>
              {TR.Toggle.Control({
                onChange: TR.Toggle.action(setEnabled),
                trueColor: '#0f766e',
                value: enabled,
              })}
              <RN.Text>{enabled ? 'Toggle on' : 'Toggle off'}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('Toggle off')).toBeDefined()
        const toggle = screen.UNSAFE_getByType(RN.Switch)
        Expect(toggle.props.value).toBe(false)
        Expect(toggle.props.trackColor.true).toBe('#0f766e')
        toggle.props.onValueChange(true)
        Expect(await screen.findByText('Toggle on')).toBeDefined()
      },
    )
  })

  Test('bridges safe-area insets through generated Tao apps', async () => {
    const safeAreaMock = safeAreaContextTestMock()
    safeAreaMock.setSafeAreaInsetsForTests({ bottom: 5, left: 2, right: 3, top: 7 })
    try {
      await testCompileApp(
        `
          app SafeAreaBridgeApp { view MainView }

          view MainView {
            render SafeAreaProbe
          }

          view SafeAreaProbe {
            render inject \`\`\`ts
              const insets = TR.SafeArea.insets()
              const padding = TR.SafeArea.edgePadding(insets, 10)
              return <>
                <RN.Text>{insets.left}, {insets.top}, {insets.right}, {insets.bottom}</RN.Text>
                <RN.Text>{padding.paddingLeft}, {padding.paddingTop}, {padding.paddingRight}, {padding.paddingBottom}</RN.Text>
              </>
            \`\`\`
          }
        `,
        async screen => {
          Expect(screen.getByText('2, 7, 3, 5')).toBeDefined()
          Expect(screen.getByText('12, 17, 13, 15')).toBeDefined()
        },
      )
    } finally {
      safeAreaMock.setSafeAreaInsetsForTests({ bottom: 0, left: 0, right: 0, top: 0 })
    }
  })

  Test('wraps promise-returning bridge work as a Pressable-compatible async action', async () => {
    const globals = globalThis as typeof globalThis & { __taoResolveAsyncAction?: (value: string) => void }

    try {
      await testCompileApp(
        `
          app AsyncActionBridgeApp { view MainView }

          view MainView {
            render AsyncActionProbe
          }

          view AsyncActionProbe {
            render inject \`\`\`ts
              const [status, setStatus] = React.useState('Async waiting')
              const action = TR.Async.action(
                () => new Promise<string>(resolve => {
                  ;(globalThis as any).__taoResolveAsyncAction = resolve
                }),
                { success: TR.Async.successAction(result => setStatus(result)) },
              )
              return <>
                {TR.Views.Pressable(
                  {
                    title: 'Save async action',
                    loadingTitle: 'Saving async action',
                    loading: action.pending,
                    action,
                  },
                  { nativeProps: { accessibilityRole: 'button' } },
                )}
                <RN.Text>{action.error ? 'Async failed' : status}</RN.Text>
              </>
            \`\`\`
          }
        `,
        async screen => {
          Expect(screen.getByText('Async waiting')).toBeDefined()
          fireEvent.press(screen.getByText('Save async action'))
          Expect(await screen.findByText('Saving async action')).toBeDefined()
          act(() => {
            globals.__taoResolveAsyncAction?.('Async saved')
          })
          Expect(await screen.findByText('Async saved')).toBeDefined()
        },
      )
    } finally {
      delete globals.__taoResolveAsyncAction
    }
  })

  Test('bridges React Native viewport dimensions through generated Tao apps', async () => {
    TR.Device.setViewportForTests({
      height: 480,
      width: 320,
    })

    await testCompileApp(
      `
        app DeviceBridgeApp { view MainView }

        view MainView {
          render DeviceProbe
        }

        view DeviceProbe {
          render inject \`\`\`ts
            const viewport = TR.Device.viewport()
            return <>
              <RN.Text>{viewport.orientation}</RN.Text>
              <RN.Text>{viewport.width} x {viewport.height}</RN.Text>
            </>
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.getByText('portrait')).toBeDefined()
        Expect(screen.getByText('320 x 480')).toBeDefined()
      },
    )
  })

  Test('bridges native stack navigation through React Navigation', async () => {
    await testCompileApp(
      `
        app NavigationBridgeApp { view MainView }

        view MainView {
          render NavigationProbe
        }

        view NavigationProbe {
          render inject \`\`\`ts
            const Stack = TR.Navigation.createNativeStack()
            const Details = () => <RN.Text>Details route</RN.Text>
            const Home = ({ navigation }) => (
              <RN.Pressable accessibilityRole="button" onPress={() => navigation.navigate('Details')}>
                <RN.Text>Open details</RN.Text>
              </RN.Pressable>
            )
            return (
              <TR.Navigation.Container>
                <Stack.Navigator>
                  <Stack.Screen name="Home" component={Home} />
                  <Stack.Screen name="Details" component={Details} />
                </Stack.Navigator>
              </TR.Navigation.Container>
            )
          \`\`\`
        }
      `,
      async screen => {
        fireEvent.press(await screen.findByText('Open details'))
        Expect(await screen.findByText('Details route')).toBeDefined()
      },
    )
  })

  Test('bridges error boundaries through generated Tao apps', async () => {
    const consoleError = console.error
    console.error = () => undefined
    try {
      await testCompileApp(
        `
          app BoundaryBridgeApp { view MainView }

          view MainView {
            render BoundaryProbe
          }

          view BoundaryProbe {
            render inject \`\`\`ts
              function Broken() {
                throw new Error('Broken boundary child')
              }
              return (
                <TR.Boundary.Error fallback={<RN.Text>Recovered boundary</RN.Text>}>
                  <Broken />
                </TR.Boundary.Error>
              )
            \`\`\`
          }
        `,
        async screen => {
          Expect(screen.getByText('Recovered boundary')).toBeDefined()
        },
      )
    } finally {
      console.error = consoleError
    }
  })

  Test('passes action values through render inject arguments', async () => {
    await testCompileApp(
      `
        app InjectedActionApp {
          view MainView
        }

        view MainView {
          state Count = 0
          action AddOne {
            set Count += 1
          }
          render Stack {
            NativeButton "Native add", AddOne
            Number Count
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Native add'))
        ExpectScreen(screen).toHaveText('1')
      },
    )
  })

  Test('invokes action parameters in declaration order after type-based binding', async () => {
    await testCompileApp(
      `
        app ReorderedActionApp {
          view MainView
        }

        view MainView {
          state Count = 0
          action AddTagged Step is number, Label is text {
            set Count += Step
          }
          action RunAddTagged {
            do AddTagged "tag", 3
          }
          render Stack {
            NativeButton "Run reordered action", RunAddTagged
            Number Count
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Run reordered action'))
        ExpectScreen(screen).toHaveText('3')
      },
    )
  })

  Test('renders imported project actions as runtime values', async () => {
    await testCompileFiles(
      'Main.tao',
      {
        'Main.tao': `
          app ImportedActionApp {
            view MainView
          }

          use Save from ./Actions.tao

          view MainView {
            render Button "Imported action", Save
          }

          view Button Title is text, Action is action {
            render inject Title, Action \`\`\`ts
              return <RN.Text>{Title}</RN.Text>
            \`\`\`
          }
        `,
        'Actions.tao': `
          project action Save { }
        `,
      },
      screen => {
        ExpectScreen(screen).toHaveText('Imported action')
      },
    )
  })

  Test('emits item constructor fields in declaration order after type-based binding', async () => {
    await testCompileApp(
      `
        app ItemOrderApp {
          view MainView
        }

        type Name is text
        type Age is number
        type Person is {
          Name
          Age
        }

        alias Ada = Person { Age 40 Name "Ada" }

        view MainView {
          render Keys Ada
        }

        view Keys Person {
          render inject Person \`\`\`ts
            return <RN.Text>{Object.keys(Person).join(",")}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Name,Age')
      },
    )
  })

  Test('rerenders state-backed item member access after state updates', async () => {
    await testCompileApp(
      `
        app StatefulItemMemberApp {
          view MainView
        }

        type Name is text
        type Person is {
          Name
        }

        view MainView {
          state Current = Person { Name "Ada" }
          action Rename {
            set Current = Person { Name "Grace" }
          }
          render Stack {
            Button "Rename", Rename
            Text Current.Name
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view Button Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Text Value is text {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Ada')

        fireEvent.press(screen.getByText('Rename'))
        ExpectScreen(screen).toHaveText('Grace')
      },
    )
  })

  Test('compiles and renders the Layout and App Shell app', async () => {
    const layoutAppPath = Repo.resolvePath('Apps/Test Apps/Layout and App Shell/Layout and App Shell.tao')
    const screen = await compileAndRenderApp(layoutAppPath)
    const viewStyles = screen.UNSAFE_getAllByType(RN.View)
      .map(view => RN.StyleSheet.flatten(view.props.style))
      .filter(Boolean)

    ExpectScreen(screen).toHaveText('Layout and app shell')
    ExpectScreen(screen).toHaveText('This screen should sit inside the default Tao app shell.')
    ExpectScreen(screen).toHaveText('Safe default app frame')
    ExpectScreen(screen).toHaveText('Primary action')
    ExpectScreen(screen).toHaveText('Deterministic')
    Expect(viewStyles.some(style => style.gap === 12 && style.padding === 16 && style.flexGrow === 1)).toBe(true)
    Expect(viewStyles.some(style => style.gap === 8 && style.padding === 12 && style.alignSelf === 'stretch')).toBe(
      true,
    )
    Expect(viewStyles.some(style => style.flexShrink === 1)).toBe(true)
    Expect(viewStyles.some(style => String(style.backgroundColor).startsWith('hsl('))).toBe(false)
  })

  Test('renders the app shell with safe-area padding and keyboard scroll defaults', () => {
    const safeAreaMock = safeAreaContextTestMock()
    safeAreaMock.setSafeAreaInsetsForTests({ bottom: 5, left: 2, right: 3, top: 7 })
    try {
      const screen = render(createElement(
        TR.AppShell,
        null,
        createElement(RN.Text, null, 'Shell content'),
      ))
      const scrollView = screen.UNSAFE_getByType(RN.ScrollView)
      const keyboardView = screen.UNSAFE_getByType(RN.KeyboardAvoidingView)
      const contentStyle = RN.StyleSheet.flatten(scrollView.props.contentContainerStyle)

      ExpectScreen(screen).toHaveText('Shell content')
      Expect(contentStyle).toMatchObject({
        flexGrow: 1,
        paddingBottom: 17,
        paddingLeft: 14,
        paddingRight: 15,
        paddingTop: 19,
        width: '100%',
      })
      Expect(scrollView.props.keyboardShouldPersistTaps).toBe('handled')
      Expect(RN.StyleSheet.flatten(keyboardView.props.style)).toMatchObject({
        backgroundColor: '#f8fafc',
        flex: 1,
      })
    } finally {
      safeAreaMock.setSafeAreaInsetsForTests({ bottom: 0, left: 0, right: 0, top: 0 })
    }
  })

  Test('provides a runtime parent direction to app root content', async () => {
    await testCompileApp(
      `
        app RootDirectionApp {
            view MainView
        }

        use Text from @tao/ui

        view MainView {
            render Text "Root width fill" [width fill]
        }
      `,
      screen => {
        const textStyle = RN.StyleSheet.flatten(screen.getByText('Root width fill').props.style)

        ExpectScreen(screen).toHaveText('Root width fill')
        Expect(textStyle).toMatchObject({ alignSelf: 'stretch' })
      },
    )
  })

  Test('provides default Tao props to app root injected layouts', async () => {
    await testCompileApp(
      `
        app RootInjectedLayoutDirectionApp {
            view MainView
        }

        layout Screen {
            render inject \`\`\`ts
                const style = TR.Layout.resolve({
                  parentDirection: _ViewProps.__tao?.parentDirection,
                  entries: _ViewProps.__tao?.layout?.entries ?? [],
                })
                return <RN.View testID="root-screen" style={style}>{_ViewProps.children}</RN.View>
            \`\`\`
        }

        view Text Value is text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }

        view MainView {
            render Screen [width fill] {
                Text "Root injected fill"
            }
        }
      `,
      screen => {
        const rootScreenStyle = RN.StyleSheet.flatten(screen.getByTestId('root-screen').props.style)

        ExpectScreen(screen).toHaveText('Root injected fill')
        Expect(rootScreenStyle).toMatchObject({ alignSelf: 'stretch' })
      },
    )
  })

  Test('keeps dev chrome disabled by default outside React Native dev mode', () => {
    const restoreDevGlobal = setReactNativeDevModeForTest(false)
    TR.setDevMode()
    try {
      const screen = render(createElement(
        TR.AppShell,
        null,
        createElement(
          TaoRuntimeRow,
          null,
          createElement(TR.Views.Text, null, 'Production shell'),
        ),
      ))
      const viewStyle = RN.StyleSheet.flatten(screen.UNSAFE_getAllByType(RN.View)[0]?.props.style)

      ExpectScreen(screen).toHaveText('Production shell')
      Expect(screen.queryByLabelText('Tao dev menu')).toBeNull()
      Expect(layoutBoundWidth(viewStyle)).toBeUndefined()
    } finally {
      restoreDevGlobal()
    }
  })

  Test('renders a dev menu overlay that toggles layout bounds when dev mode is enabled', () => {
    TR.setDevMode({ layoutBounds: true })

    function MenuApp(): ReactElement {
      return createElement(
        TR.AppShell,
        null,
        createElement(
          TaoRuntimeRow,
          null,
          createElement(TR.Views.Text, null, 'Menu target'),
        ),
      )
    }

    const screen = render(createElement(MenuApp))
    const menuButton = screen.getByLabelText('Tao dev menu')
    const menuStyle = RN.StyleSheet.flatten(menuButton.props.style)

    Expect(menuStyle).toMatchObject({
      bottom: 16,
      borderRadius: 15,
      height: 30,
      position: 'absolute',
      right: 16,
      width: 30,
    })
    Expect(screen.getByText('Τ')).toBeDefined()
    Expect(screen.queryByLabelText('Tao dev overlay')).toBeNull()

    fireEvent.press(menuButton)
    Expect(screen.getByLabelText('Tao dev overlay')).toBeDefined()
    Expect(screen.getByText('Layout bounds On')).toBeDefined()

    fireEvent.press(screen.getByLabelText('Toggle layout bounds'))
    Expect(screen.getByText('Layout bounds Off')).toBeDefined()
    Expect(TR.Dev.isLayoutBoundsEnabled()).toBe(false)
    Expect(
      screen.UNSAFE_getAllByType(RN.View).some(view => {
        const style = RN.StyleSheet.flatten(view.props.style)
        return layoutBoundWidth(style) === 0.5
      }),
    ).toBe(false)

    fireEvent.press(screen.getByLabelText('Tao dev overlay'))
    Expect(screen.queryByLabelText('Tao dev overlay')).toBeNull()
  })

  Test('preserves app state when toggling layout bounds', () => {
    TR.setDevMode({ layoutBounds: true })

    function StatefulChild(): ReactElement {
      const [count, setCount] = useState(0)
      return createElement(
        RN.Pressable,
        { accessibilityRole: 'button', onPress: () => setCount(value => value + 1) },
        createElement(RN.Text, null, `Stateful count ${count}`),
      )
    }

    function StatefulApp(): ReactElement {
      return createElement(
        TR.AppShell,
        null,
        createElement(StatefulChild),
      )
    }

    const screen = render(createElement(StatefulApp))

    fireEvent.press(screen.getByText('Stateful count 0'))
    ExpectScreen(screen).toHaveText('Stateful count 1')

    fireEvent.press(screen.getByLabelText('Tao dev menu'))
    fireEvent.press(screen.getByLabelText('Toggle layout bounds'))

    ExpectScreen(screen).toHaveText('Stateful count 1')
  })

  Test('repositions the dev menu through drag responder events', () => {
    TR.setDevMode({ enabled: true })

    const screen = render(createElement(
      TR.AppShell,
      null,
      createElement(RN.Text, null, 'Drag target'),
    ))

    act(() => {
      const menuButton = screen.getByLabelText('Tao dev menu')
      menuButton.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } })
      menuButton.props.onTouchMove({ nativeEvent: { pageX: 90, pageY: 80 } })
    })

    const movedStyle = RN.StyleSheet.flatten(screen.getByLabelText('Tao dev menu').props.style)
    Expect(movedStyle).toMatchObject({
      bottom: 36,
      right: 26,
    })

    act(() => {
      const menuButton = screen.getByLabelText('Tao dev menu')
      menuButton.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } })
      menuButton.props.onTouchMove({ nativeEvent: { pageX: 1000, pageY: 1000 } })
    })

    const clampedStyle = RN.StyleSheet.flatten(screen.getByLabelText('Tao dev menu').props.style)
    Expect(clampedStyle).toMatchObject({
      bottom: 8,
      right: 8,
    })

    act(() => {
      const menuButton = screen.getByLabelText('Tao dev menu')
      menuButton.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } })
      menuButton.props.onTouchMove({ nativeEvent: { pageX: -10000, pageY: -10000 } })
    })

    const frame = RN.Dimensions.get('window')
    const upperClampedStyle = RN.StyleSheet.flatten(screen.getByLabelText('Tao dev menu').props.style)
    Expect(upperClampedStyle).toMatchObject({
      bottom: Math.max(8, frame.height - 38),
      right: Math.max(8, frame.width - 38),
    })
  })

  Test('does not draw layout bounds when Tao dev mode is disabled', () => {
    TR.setDevMode({ enabled: false })

    const screen = render(createElement(
      TaoRuntimeRow,
      null,
      createElement(TR.Views.Text, null, 'Normal bounds'),
    ))
    const style = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)

    Expect(layoutBoundWidth(style)).toBeUndefined()
  })

  Test('draws layout bounds when Tao dev mode enables them', () => {
    TR.setDevMode({ layoutBounds: true })
    const screen = render(createElement(
      TaoRuntimeRow,
      null,
      createElement(TR.Views.Text, null, 'Debug bounds'),
    ))
    const viewStyle = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)
    const textStyle = RN.StyleSheet.flatten(screen.getByText('Debug bounds').props.style)

    Expect(layoutBoundWidth(viewStyle)).toBe(0.5)
    Expect(String(layoutBoundColor(viewStyle))).toMatch(/^#[0-9a-f]{6}$/)
    if (viewStyle.boxShadow) {
      Expect(String(viewStyle.boxShadow)).toContain(String(layoutBoundColor(viewStyle)))
    }
    Expect(layoutBoundWidth(textStyle)).toBe(0.5)
    Expect(layoutBoundColor(textStyle)).not.toBe(layoutBoundColor(viewStyle))
  })

  Test('keeps layout bound colors stable across rerenders', () => {
    TR.setDevMode({ layoutBounds: true })

    function RerenderingChild(): ReactElement {
      const [count, setCount] = useState(0)
      return createElement(
        RN.View,
        null,
        createElement(TR.Views.Text, null, 'Stable debug color'),
        createElement(
          RN.Pressable,
          { accessibilityRole: 'button', onPress: () => setCount(value => value + 1) },
          createElement(RN.Text, null, `Force render ${count}`),
        ),
      )
    }

    const screen = render(createElement(RerenderingChild))
    const initialColor = layoutBoundColor(RN.StyleSheet.flatten(screen.getByText('Stable debug color').props.style))

    fireEvent.press(screen.getByText('Force render 0'))

    const nextColor = layoutBoundColor(RN.StyleSheet.flatten(screen.getByText('Stable debug color').props.style))
    Expect(nextColor).toBe(initialColor)
  })

  Test('does not override existing bounding-box styles with dev layout bounds', () => {
    TR.setDevMode({ layoutBounds: true })

    const screen = render(createElement(
      TaoRuntimeBox,
      { __tao: { style: { borderWidth: 1 } } },
      'Already bounded',
    ))
    const style = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)

    Expect(style.borderWidth).toBe(1)
    Expect(style.borderColor).toBeUndefined()
    Expect(style.outlineWidth).toBeUndefined()
  })

  Test('preserves resolved Tao layout styles when adding dev layout bounds', () => {
    TR.setDevMode({ layoutBounds: true })

    const screen = render(createElement(
      TaoRuntimeBox,
      { __tao: { layout: TR.Layout.create([['gap', 4]]) } },
      'Resolved style bounds',
    ))
    const style = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)

    Expect(style.gap).toBe(4)
    Expect(layoutBoundWidth(style)).toBe(0.5)
  })

  Test('resolves chained Tao props downstream in runtime views', () => {
    TR.setDevMode({ enabled: false })

    const screen = render(createElement(
      TaoRuntimeBox,
      {
        __tao: TR.TaoProps(
          {
            layout: TR.Layout.create([['gap', 4]]),
            style: { borderWidth: 1 },
          },
          {
            layout: TR.Layout.create([['pad', 6]]),
            style: { borderColor: 'red' },
          },
        ),
      },
      'Chained props',
    ))
    const style = RN.StyleSheet.flatten(screen.UNSAFE_getByType(RN.View).props.style)

    Expect(style.gap).toBe(4)
    Expect(style.padding).toBe(6)
    Expect(style.borderColor).toBe('red')
    Expect(style.borderWidth).toBe(1)
  })

  Test('uses the immediate runtime parent direction for children', () => {
    TR.setDevMode({ enabled: false })

    const screen = render(createElement(
      TaoRuntimeRow,
      null,
      createElement(
        TR.Views.Text,
        {
          __tao: TR.TaoProps({
            layout: TR.Layout.create([['width', 'fill']]),
            parentDirection: 'column',
          }),
        },
        'Immediate direction',
      ),
    ))
    const style = RN.StyleSheet.flatten(screen.getByText('Immediate direction').props.style)

    Expect(style.flexGrow).toBe(1)
    Expect(style.alignSelf).toBeUndefined()
  })

  Test('preserves existing child caller props when adding parent direction', () => {
    TR.setDevMode({ enabled: false })

    const screen = render(createElement(
      TaoRuntimeRow,
      null,
      createElement(
        TR.Views.Text,
        {
          __tao: TR.TaoProps(
            { layout: TR.Layout.create([['width', 'fill']]) },
            {
              parentDirection: 'column',
              style: { borderWidth: 2 },
            },
          ),
        },
        'Preserved caller props',
      ),
    ))
    const style = RN.StyleSheet.flatten(screen.getByText('Preserved caller props').props.style)

    Expect(style.borderWidth).toBe(2)
    Expect(style.flexGrow).toBe(1)
    Expect(style.alignSelf).toBeUndefined()
  })

  Test('forwards content layout through custom layout wrappers', async () => {
    await testCompileApp(
      `
        app WrapperLayout {
            view MainView
        }

        use Col, Text from @tao/ui

        layout Screen {
            render Col {
                Text "Wrapped center"
            }
        }

        view MainView {
            render Screen [content center]
        }
      `,
      screen => {
        const centeredView = screen.UNSAFE_getAllByType(RN.View).find(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.alignItems === 'center' && style.justifyContent === 'center'
        })

        ExpectScreen(screen).toHaveText('Wrapped center')
        Expect(centeredView).toBeDefined()
      },
    )
  })

  Test('does not forward caller layout into nested render statements', async () => {
    await testCompileApp(
      `
        app NestedRenderLayout {
            view MainView
        }

        use Col, Row, Text from @tao/ui

        layout Card {
            render Col {
                render Row {
                    Text "Nested render layout"
                }
            }
        }

        view MainView {
            render Card [gap 9]
        }
      `,
      screen => {
        const gapNineViews = screen.UNSAFE_getAllByType(RN.View).filter(view => {
          const style = RN.StyleSheet.flatten(view.props.style)
          return style?.gap === 9
        })

        ExpectScreen(screen).toHaveText('Nested render layout')
        Expect(gapNineViews).toHaveLength(1)
      },
    )
  })

  Test('runs actions whose parameters shadow generated runtime names', async () => {
    await testCompileApp(
      `
        app ShadowedActionParameterApp {
          view MainView
        }

        view MainView {
          state Count = 0
          action AddStep _Scope is number {
            set Count += _Scope
          }
          action AddOne {
            do AddStep 1
          }
          render Stack {
            NativeButton "Add with shadowed parameter", AddOne
            Number Count
          }
        }

        layout Stack {
          render inject \`\`\`ts
            return <>{_ViewProps.children}</>
          \`\`\`
        }

        view NativeButton Title is text, Action is action {
          render inject Title, Action \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Action.invoke()}>
                <RN.Text>{Title}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }

        view Number Value is number {
          render inject Value \`\`\`ts
            return <RN.Text>{Value}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('0')

        fireEvent.press(screen.getByText('Add with shadowed parameter'))
        ExpectScreen(screen).toHaveText('1')
      },
    )
  })

  Test('lets caller layout override custom layout wrapper root layout', async () => {
    await testCompileApp(
      `
        app WrapperLayoutOverride {
            view MainView
        }

        use Row, Text from @tao/ui

        layout Screen {
            render Row [gap 12, content spread center] {
                Text "Wrapped gap"
            }
        }

        view MainView {
            render Screen [gap 8]
        }
      `,
      screen => {
        const viewStyles = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .filter(Boolean)

        ExpectScreen(screen).toHaveText('Wrapped gap')
        Expect(viewStyles.some(style => style.gap === 8)).toBe(true)
        Expect(viewStyles.some(style => style.gap === 12)).toBe(false)
      },
    )
  })

  Test('overlays compiled layout clauses over stdlib layout defaults', async () => {
    await testCompileApp(
      `
        app ExplicitRowLayout {
            view MainView
        }

        use Row, Text from @tao/ui

        view MainView {
            render Row [content right, gap 4, claim 2] {
                Text "Explicit row"
            }
        }
      `,
      screen => {
        const rowStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style => style?.gap === 4)

        ExpectScreen(screen).toHaveText('Explicit row')
        Expect(rowStyle).toMatchObject({
          alignItems: 'baseline',
          alignSelf: 'stretch',
          flexDirection: 'row',
          flexGrow: 2,
          gap: 4,
          justifyContent: 'flex-end',
        })
      },
    )
  })

  Test('applies axis-relative fill through custom layout root layout clauses', async () => {
    await testCompileApp(
      `
        app WrapperLayoutFill {
            view MainView
        }

        use Box, Row, Text from @tao/ui

        layout Screen {
            render Box [fill] {
                Text "Root fill"
            }
        }

        view MainView {
            render Row [gap 3] {
                Screen
            }
        }
      `,
      screen => {
        const boxStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style =>
            style?.gap === undefined
            && style?.flexDirection === 'row'
            && style?.flexGrow === 1
            && style?.alignSelf === 'stretch'
          )

        ExpectScreen(screen).toHaveText('Root fill')
        Expect(boxStyle).toBeDefined()
      },
    )
  })

  Test('does not apply stdlib layout identity to local stdlib-named views', async () => {
    await testCompileApp(
      `
        app LocalRowIdentity {
            view MainView
        }

        view Row {
            render inject \`\`\`ts
                const style = TR.Layout.resolve({
                  entries: _ViewProps.__tao?.layout?.entries ?? [],
                })
                return <RN.View style={style}>{_ViewProps.children}</RN.View>
            \`\`\`
        }

        view Text Value is text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }

        view MainView {
            render Row [gap 4] {
                Text "Local row"
            }
        }
      `,
      screen => {
        const localRowStyle = screen.UNSAFE_getAllByType(RN.View)
          .map(view => RN.StyleSheet.flatten(view.props.style))
          .find(style => style?.gap === 4)

        ExpectScreen(screen).toHaveText('Local row')
        Expect(localRowStyle).toMatchObject({ gap: 4 })
        Expect(localRowStyle?.flexDirection).toBeUndefined()
      },
    )
  })

  Test('renders imported alias references through circular module imports', async () => {
    await testCompileFiles(
      'Main.tao',
      {
        'Main.tao': `
          app CircularAliasApp {
              view MainView
          }

          use AView from ./

          view MainView {
              render AView
          }
        `,
        'A.tao': `
          use BView from ./

          project alias SharedTitle = "Circular alias"

          project view AView {
              render BView
          }
        `,
        'B.tao': `
          use SharedTitle from ./

          alias ImportedTitle = SharedTitle

          project view BView {
              render Text ImportedTitle
          }

          view Text Value is text {
              render inject Value \`\`\`ts
                  return <RN.Text>{Value}</RN.Text>
              \`\`\`
          }
        `,
      },
      screen => {
        ExpectScreen(screen).toHaveText('Circular alias')
      },
    )
  })

  Test('renders alias references to earlier aliases', async () => {
    await testCompileApp(
      `
        app OrderedAlias {
            view MainView
        }

        alias Message = "Ordered output"
        alias Greeting = Message

        view MainView {
            render Text Greeting { }
        }

        view Text Value is text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Ordered output')
      },
    )
  })

  Test('renders block-local aliases that shadow file-level aliases', async () => {
    await testCompileApp(
      `
        app ScopedAlias {
            view MainView
        }

        alias Greeting = "Outer"

        view MainView {
            alias OuterGreeting = Greeting
            render Stack {
                alias Greeting = "Inner"
                Text Greeting
                Text OuterGreeting
            }
        }

        layout Stack {
            render inject \`\`\`ts
                return <>{_ViewProps.children}</>
            \`\`\`
        }

        view Text Value is text {
            render inject Value \`\`\`ts
                return <RN.Text>{Value}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Inner')
        ExpectScreen(screen).toHaveText('Outer')
      },
    )
  })
})

type SafeAreaContextTestMock = {
  setSafeAreaInsetsForTests(insets: { bottom: number; left: number; right: number; top: number }): void
}

function safeAreaContextTestMock(): SafeAreaContextTestMock {
  return require('react-native-safe-area-context') as SafeAreaContextTestMock
}

function layoutBoundWidth(style: { borderWidth?: unknown; outlineWidth?: unknown } | undefined): unknown {
  return style?.outlineWidth ?? style?.borderWidth
}

function layoutBoundColor(style: { borderColor?: unknown; outlineColor?: unknown } | undefined): unknown {
  return style?.outlineColor ?? style?.borderColor
}

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

function TaoRuntimeBox(props: { __tao?: TR.TaoProps; children?: ReactNode }): ReactElement {
  return TR.Views.View(props, {
    direction: 'row',
    layout: TR.Layout.create([['content', 'left', 'center'], ['hug']]),
  })
}

function TaoRuntimeRow(props: { __tao?: TR.TaoProps; children?: ReactNode }): ReactElement {
  return TR.Views.View(props, {
    direction: 'row',
    layout: TR.Layout.create([['content', 'baseline', 'left'], ['fill']]),
  })
}

function ancestorProp(node: { parent?: any }, prop: string): unknown {
  let current = node.parent
  while (current) {
    if (current.props?.[prop] !== undefined) {
      return current.props[prop]
    }
    current = current.parent
  }
  return undefined
}

function ancestorStyleWithProp(
  node: { parent?: any },
  prop: string,
  value: unknown,
): Record<string, unknown> | undefined {
  let current = node.parent
  while (current) {
    if (current.props?.[prop] === value) {
      return RN.StyleSheet.flatten(current.props.style) as Record<string, unknown> | undefined
    }
    current = current.parent
  }
  return undefined
}
