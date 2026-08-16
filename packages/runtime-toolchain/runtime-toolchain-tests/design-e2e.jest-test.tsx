import { Describe, Expect, Test } from '@shared/test'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle, testCompileApps } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime minimal design', () => {
  Test('keeps identical private bundle names mounted-app-local and applies combined precedence', async () => {
    await testCompileApps(
      `
        use StackNav from @tao/nav
        use Col, Text from @tao/ui

        workspace design Light {
          surface #ffffff
          ink #121826
          screen [fill, pad 16, bg surface]
          title [size 16, fg ink]
        }

        workspace design Dark {
          surface #000000
          ink #f6f7f3
          screen [fill, pad 16, bg surface]
          title [size 16, fg ink]
        }

        app LightApp { Name "Light" Navigator StackNav { Initial LightHome } Design Light }
        app DarkApp { Name "Dark" Navigator StackNav { Initial DarkHome } Design Dark }

        ui LightHome() {
          #screen
          render Col() [screen, claim 2, width max 720, centered] {
            #title
            Text("Light title") [title, size 20]
          }
        }

        ui DarkHome() {
          #screen
          render Col() [screen, claim 2, width max 720, centered] {
            #title
            Text("Dark title") [title, size 20]
          }
        }
      `,
      ['LightApp', 'DarkApp'],
      screens => {
        const lightScreen = screens['LightApp']!
        const darkScreen = screens['DarkApp']!
        Expect(RN.StyleSheet.flatten(lightScreen.getByTestId('screen').props.style)).toMatchObject({
          alignSelf: 'center',
          backgroundColor: '#ffffff',
          flexGrow: 2,
          maxWidth: 720,
          padding: 16,
        })
        Expect(RN.StyleSheet.flatten(darkScreen.getByTestId('screen').props.style)).toMatchObject({
          alignSelf: 'center',
          backgroundColor: '#000000',
          flexGrow: 2,
          maxWidth: 720,
          padding: 16,
        })
        Expect(RN.StyleSheet.flatten(lightScreen.getByTestId('title').props.style)).toMatchObject({
          color: '#121826',
          fontSize: 20,
        })
        Expect(RN.StyleSheet.flatten(darkScreen.getByTestId('title').props.style)).toMatchObject({
          color: '#f6f7f3',
          fontSize: 20,
        })
      },
    )
  })
})
