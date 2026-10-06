import TR from '@runtime/TR'
import { settleActionRoots } from '@runtime/TR-action-transactions'
import { Deferred, Describe, Expect, MockModule, settle, Test } from '@shared/test'
import { act, fireEvent } from '@testing-library/react-native'
import { registerRuntimeE2ELifecycle, testCompileFiles } from './test-compile-app'

registerRuntimeE2ELifecycle()

let registerCleanup: () => void = () => {}
MockModule('expo-clipboard', () => ({ setStringAsync: () => registerCleanup() }))

Describe('compiled handler lexical cleanup', () => {
  for (const handler of ['event', 'selection'] as const) {
    Test(`joins native cleanup at the ${handler} callback boundary`, async () => {
      const started = Deferred<void>()
      const release = Deferred<void>()
      const events: string[] = []
      registerCleanup = () => {
        events.push('registered')
        TR.Defer(async () => {
          events.push('cleanup')
          started.resolve()
          await release.promise
          events.push('cleaned')
        })
      }
      const body = `do Register() set Selected = ${handler === 'event' ? 'Input' : 'Row'}`
      await testCompileFiles('App.tao', {
        'Native.ts': `
          import { setStringAsync } from 'expo-clipboard'
          export function Register(): void { void setStringAsync('probe') }
        `,
        'App.tao': `
          use Col, Text from @tao/ui
          action Register() from ./Native.ts
          app CleanupProof { id "cleanupproof" version "1.0.0" name "CleanupProof" view Main }
          view Main() {
            state Selected = "Waiting"
            render Col {
              Text(Selected)
              ${
          handler === 'event'
            ? `NativeButton("Run") { on change -> Input { ${body} } }`
            : `loop ["Chosen:selection"] / Row { Text("Run") on select -> { ${body} } }`
        }
            }
          }
          view NativeButton(Title text, Change action(text)) {
            render inject Title, Change \`\`\`ts
              return <RN.Pressable onPress={() => Change.invoke(TR.Value("Chosen:event"))}><RN.Text>{Title}</RN.Text></RN.Pressable>
            \`\`\`
          }
        `,
      }, async screen => {
        let completed = false
        fireEvent.press(screen.getByText('Run'))
        // Row press surfaces intentionally return void; settlement belongs to the real root queue.
        const pending = settleActionRoots().then(() => {
          completed = true
        })
        try {
          await Promise.race([started.promise, pending])
          await settle()
          Expect(events).toEqual(['registered', 'cleanup'])
          Expect(completed).toBe(false)
          screen.getByText('Waiting')
          await act(async () => {
            release.resolve()
            await pending
          })
          Expect(events).toEqual(['registered', 'cleanup', 'cleaned'])
          Expect(completed).toBe(true)
          screen.getByText(`Chosen:${handler}`)
        } finally {
          release.resolve()
          await pending
          registerCleanup = () => {}
        }
      })
    })
  }
})
