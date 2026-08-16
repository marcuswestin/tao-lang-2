import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

const checkboxApp = `
  app CheckboxApp { view MainView }

  view MainView() {
    state Final = false
    action MarkFinal() {
      set Final = true
    }
    render Stack() {
      #markFinal
      NativeCheckbox(Final, MarkFinal)
    }
  }

  layout Stack() {
    render inject Content @@content, Layout @@layout, Tag @@tag \`\`\`ts
      return TR.Views.View({ children: Content, layout: Layout, tag: Tag })
    \`\`\`
  }

  view NativeCheckbox(Value is boolean, Change is action()) {
    render inject Value, Change, Layout @@layout, Tag @@tag \`\`\`ts
      const style = TR.Layout.resolve({
        parentDirection: Layout?.parentDirection,
        entries: Layout?.layout?.entries ?? [],
      })
      return (
        <RN.Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: Value }}
          onPress={() => Change.invoke()}
          style={[style, Layout?.style]}
          testID={Tag}
        />
      )
    \`\`\`
  }
`

Describe('Expo runtime checkbox test expectations', () => {
  Test('asserts unchecked and checked state on the tagged accessible checkbox', async () => {
    await withTaoFiles(
      'tao-checkbox-runtime-test-',
      {
        'Main.test.tao': `
          use CheckboxApp from ./

          test "Checkbox state" {
            check "changes state" {
              run CheckboxApp
              expect checkbox #markFinal unchecked
              press #markFinal
              expect checkbox #markFinal checked
            }
          }
        `,
        'Main.tao': checkboxApp,
      },
      async paths => {
        await RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)
      },
    )
  })

  Test('reports the represented step when checked state differs', async () => {
    await withTaoFiles(
      'tao-checkbox-runtime-test-',
      {
        'Main.test.tao': `
          use CheckboxApp from ./

          test "Checkbox state" {
            check "reports mismatch" {
              run CheckboxApp
              expect checkbox #markFinal checked
            }
          }
        `,
        'Main.tao': checkboxApp,
      },
      async paths => {
        await Expect(RuntimeTesting.runTaoTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          /Checkbox state > reports mismatch[\s\S]*expect checkbox #markFinal checked expected checked but was unchecked[\s\S]*Main\.test\.tao:/,
        )
      },
    )
  })
})
