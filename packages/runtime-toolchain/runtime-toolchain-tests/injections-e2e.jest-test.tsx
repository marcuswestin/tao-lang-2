import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { AfterAll, AfterEach, Describe, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'
import { ExpectScreen, testCompileApp } from './test-compile-app'

AfterAll(async () => {
  await RuntimeTesting.stopTestCompiler()
})

AfterEach(() => cleanup())

Describe('Tao injection runtime', () => {
  Test('renders inject arguments as direct TS values', async () => {
    await testCompileApp(
      `
        app InjectArgs {
            view MainView
        }

        let UserName = "Ro"
        let Count = 3

        view MainView() {
            render Text("Hello")
        }

        view Text(Value text) {
            render inject Value, Name UserName, Count \`\`\`ts
                void TR
                void process.env.NODE_ENV
                const NativeText = RN.Text
                return <NativeText>{Value + " " + Name + " " + Count}</NativeText>
            \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('Hello Ro 3')
      },
    )
  })
})
