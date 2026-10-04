import { Describe, Test } from '@shared/test'
import { ExpectScreen, registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Tao text stdlib runtime', () => {
  Test('imports and executes CountWords and Join through @tao/text', async () => {
    await testCompileApp(
      `
        use CountWords, Join from @tao/text

        app TextStdlib { view Main }

        view Main() {
          let Count = CountWords(" one two　three ")
          let Joined = Join(["one", "two"], " | ")
          render Native(Count: Count, Joined: Joined)
        }

        view Native(Count number, Joined text) {
          render inject Count, Joined \`\`\`ts
            return <RN.Text>{Count + ":" + Joined}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('3:one | two')
      },
    )
  })
})
