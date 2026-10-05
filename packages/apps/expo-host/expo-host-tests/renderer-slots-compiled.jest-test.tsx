import { Describe, Expect, Test } from '@shared/test'
import { fireEventAsync } from '@testing-library/react-native'
import { registerRuntimeE2ELifecycle, testCompileApp, testCompileFiles } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('compiled renderer slots', () => {
  Test(
    'keeps repeated default and named replacement placements independent across fresh arguments and handlers',
    async () => {
      await testCompileApp(
        `
        use Col, Text from @tao/ui
        app CompiledRendererSlots { id "compiled-renderer-slots" version "1.0.0" name "CompiledRendererSlots" view Main }

        view Main() {
          render Col() {
            render Owner("Default") { }
            render Owner("Replacement") { @item: ReplacementRenderer }
          }
        }

        view Owner(Id text) {
          state Current = 0
          action Advance() { set Current += 1 }
          @item(Id text, Value number, Advance action()): DefaultRenderer
          render Col() {
            @item(Id: Id, Value: Current, Advance: Advance)
            @item(Id: Id, Value: Current, Advance: Advance)
          }
        }

        view DefaultRenderer(Id text, Value number, Advance action()) {
          state Count = 0
          action Press() {
            set Count += 1
            do Advance()
          }
          render NativeCounter(Id: Id, Value: Value, Count: Count, Press: Press)
        }

        view ReplacementRenderer(Id text, Value number, Advance action()) {
          state Count = 0
          action Press() {
            set Count += 1
            do Advance()
          }
          render NativeCounter(Id: "replacement:{Id}", Value: Value, Count: Count, Press: Press)
        }

        view NativeCounter(Id text, Value number, Count number, Press action()) {
          render inject Id, Value, Count, Press \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Press.invoke()}>
                <RN.Text>{Id}:{Value}:{Count}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }
      `,
        async screen => {
          Expect(screen.getAllByText('Default:0:0')).toHaveLength(2)
          Expect(screen.getAllByText('replacement:Replacement:0:0')).toHaveLength(2)

          await fireEventAsync.press(screen.getAllByText('Default:0:0')[0]!)
          Expect(screen.getByText('Default:1:1')).toBeDefined()
          Expect(screen.getByText('Default:1:0')).toBeDefined()
          Expect(screen.getAllByText('replacement:Replacement:0:0')).toHaveLength(2)

          await fireEventAsync.press(screen.getByText('Default:1:1'))
          Expect(screen.getByText('Default:2:2')).toBeDefined()
          Expect(screen.getByText('Default:2:0')).toBeDefined()

          await fireEventAsync.press(screen.getAllByText('replacement:Replacement:0:0')[0]!)
          Expect(screen.getByText('replacement:Replacement:1:1')).toBeDefined()
          Expect(screen.getByText('replacement:Replacement:1:0')).toBeDefined()
        },
      )
    },
  )

  Test(
    'an explicit empty fill suppresses the default renderer and does not evaluate its placement argument',
    async () => {
      const globals = globalThis as typeof globalThis & { __rendererSlotEvaluationCounts?: Record<string, number> }
      const previous = globals.__rendererSlotEvaluationCounts
      globals.__rendererSlotEvaluationCounts = {}

      try {
        await testCompileFiles(
          'App.tao',
          {
            'App.tao': `
          use Col, Text from @tao/ui
          app EmptyRendererSlot { id "empty-renderer-slot" version "1.0.0" name "EmptyRendererSlot" view Main }
          function Evaluate(Id text) returns text { return Evaluate(Id) from ./Effect.ts }
          view Main() {
            render Col {
              Owner("empty") { @item: empty }
              Owner("selected")
            }
          }
          view Owner(Id text) {
            @item(Value text): DefaultRenderer
            render Col() { @item(Value: Evaluate(Id)) }
          }
          view DefaultRenderer(Value text) { render Text(Value) }
        `,
            'Effect.ts': `
          export function Evaluate(id: string): string {
            const target = globalThis as typeof globalThis & { __rendererSlotEvaluationCounts?: Record<string, number> }
            const counts = target.__rendererSlotEvaluationCounts!
            counts[id] = (counts[id] ?? 0) + 1
            return id + '-rendered'
          }
        `,
          },
          screen => {
            Expect(screen.queryByText('empty-rendered')).toBeNull()
            Expect(screen.getByText('selected-rendered')).toBeDefined()
            Expect(globals.__rendererSlotEvaluationCounts?.empty).toBeUndefined()
            Expect(globals.__rendererSlotEvaluationCounts?.selected).toBeGreaterThan(0)
          },
        )
      } finally {
        if (previous === undefined) {
          delete globals.__rendererSlotEvaluationCounts
        } else {
          globals.__rendererSlotEvaluationCounts = previous
        }
      }
    },
  )

  Test('refreshes an inline fill capture without remounting its repeated bodies', async () => {
    await testCompileApp(
      `
        use Col, Text from @tao/ui
        app CapturedRendererSlots { id "captured-renderer-slots" version "1.0.0" name "CapturedRendererSlots" view Main }
        view Main() {
          state Current = 0
          action Advance() { set Current += 1 }
          render Owner() {
            @item: { Counter(Value: Current, Advance: Advance) }
          }
        }
        view Owner() {
          @item: Text("default")
          render Col() { @item @item }
        }
        view Counter(Value number, Advance action()) {
          state Count = 0
          action Press() {
            set Count += 1
            do Advance()
          }
          render NativeCounter(Value: Value, Count: Count, Press: Press)
        }
        view NativeCounter(Value number, Count number, Press action()) {
          render inject Value, Count, Press \`\`\`ts
            return (
              <RN.Pressable accessibilityRole="button" onPress={() => Press.invoke()}>
                <RN.Text>captured:{Value}:{Count}</RN.Text>
              </RN.Pressable>
            )
          \`\`\`
        }
      `,
      async screen => {
        Expect(screen.queryByText('default')).toBeNull()
        Expect(screen.getAllByText('captured:0:0')).toHaveLength(2)
        await fireEventAsync.press(screen.getAllByText('captured:0:0')[0]!)
        Expect(screen.getByText('captured:1:1')).toBeDefined()
        Expect(screen.getByText('captured:1:0')).toBeDefined()
        await fireEventAsync.press(screen.getByText('captured:1:1'))
        Expect(screen.getByText('captured:2:2')).toBeDefined()
        Expect(screen.getByText('captured:2:0')).toBeDefined()
      },
    )
  })

  Test('retains the zero argument native named slot projection', async () => {
    await testCompileFiles(
      'App.tao',
      {
        'App.tao': `
          use Text from @tao/ui
          app LegacyNativeSlot { id "legacy-native-slot" version "1.0.0" name "LegacyNativeSlot" view Main }
          view Main() {
            render LegacySlotHost() {
              @toolbar: Text("Toolbar")
              Text("Body")
            }
          }
          view LegacySlotHost() accepts content slots @toolbar from ./LegacySlotHost.tsx
        `,
        'LegacySlotHost.tsx': `
          import * as React from 'react'
          import * as RN from 'react-native'

          type Props = {
            Slots: { '@toolbar'?: React.ReactNode }
            children?: React.ReactNode
          }

          export function LegacySlotHost({ Slots, children }: Props): React.ReactElement {
            return <RN.View>{Slots['@toolbar']}{children}</RN.View>
          }
        `,
      },
      screen => {
        Expect(screen.getByText('Toolbar')).toBeDefined()
        Expect(screen.getByText('Body')).toBeDefined()
      },
    )
  })
})
