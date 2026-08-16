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
          let Count = CountWords("  one   two three  ")
          let BlankCount = CountWords("   ")
          let Joined = Join(["one", "two"], " | ")
          let Empty = Join([], ",")
          render Native(Count: Count, BlankCount: BlankCount, Joined: Joined, Empty: Empty)
        }

        view Native(Count is number, BlankCount is number, Joined is text, Empty is text) {
          render inject Count, BlankCount, Joined, Empty \`\`\`ts
            return <RN.Text>{Count + ":" + BlankCount + ":" + Joined + ":" + Empty}</RN.Text>
          \`\`\`
        }
      `,
      screen => {
        ExpectScreen(screen).toHaveText('3:0:one | two:')
      },
    )
  })
})
