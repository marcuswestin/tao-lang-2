import { AfterEach, Describe, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'
import { ExpectScreen, testCompileApp } from './test-compile-app'

AfterEach(() => cleanup())

Describe('Tao injection runtime', () => {
  Test('renders inject arguments as direct TS values', async () => {
    await testCompileApp(
      `
        app InjectArgs {
            ui MainView
        }

        alias UserName = "Ro"
        alias Count = 3

        ui MainView {
            render Text "Hello"
        }

        ui Text Value text {
            render inject Value, Name UserName, Count \`\`\`ts
                return <RN.Text>{Value + " " + Name + " " + Count}</RN.Text>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Hello Ro 3')
      },
    )
  })
})
