import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { act, fireEvent } from '@testing-library/react-native'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

class NativeEvent {
  readonly controls: string[] = []
  preventDefault() {
    this.controls.push('preventDefault')
  }
  stopPropagation() {
    this.controls.push('stopPropagation')
  }
}

Describe('compiled native event controls', () => {
  Test('suppresses a queued controlled global action after its binding view unmounts', async () => {
    const failures: string[] = []
    const stop = TR.Errors.onFailure(report => failures.push(report.message))
    try {
      await testCompileApp(
        `
        use Button from @tao/ui
        app GlobalControl { id "globalcontrol" version "1.0.0" name "GlobalControl" view Main }
        type SaveFailure is one of Executed
        action Save() { fail Executed "Global Save executed." }
        view Main() { render Button("Save") { on press (preventDefault) -> Save } }
      `,
        async screen => {
          const release = Deferred()
          const blocker = TR.Action(async () => await release.promise).jsValue.invoke()
          const event = new NativeEvent()
          try {
            fireEvent.press(screen.getByText('Save'), event)
            Expect(event.controls).toEqual(['preventDefault'])
            await act(async () => {
              await Promise.resolve()
            })
            screen.unmount()
            await act(async () => {
              release.resolve()
              await blocker
              await TR.Action(() => {}).jsValue.invoke()
            })
            Expect(failures).toEqual([])
          } finally {
            release.resolve()
            await blocker
          }
        },
      )
    } finally {
      stop()
    }
  })

  Test('forwards Button, FormButton and submit events before their ordinary Tao bodies leave the queue', async () => {
    await testCompileApp(
      `
      use Col, Text, Button, FormButton, TextInput from @tao/ui
      app NativeControls { id "nativecontrols" version "1.0.0" name "NativeControls" view Main }
      view Main() {
        state Count = 0
        state Draft = ""
        action Save() { set Count = Count + 1 }
        render Col() {
          #button Button("Save") { on press (preventDefault) -> Save }
          #form FormButton("Save form") { on press (stopPropagation) -> Save }
          #input TextInput(Value: Draft, Label: "Draft") { on submit (preventDefault, stopPropagation) -> Save }
          Text("saved:{Count}")
        }
      }
    `,
      async screen => {
        const release = Deferred()
        const blocker = TR.Action(async () => await release.promise).jsValue.invoke()
        const button = new NativeEvent()
        const form = new NativeEvent()
        const submit = new NativeEvent()
        try {
          fireEvent.press(screen.getByTestId('button'), button)
          fireEvent.press(screen.getByTestId('form'), form)
          fireEvent(screen.getByLabelText('Draft'), 'submitEditing', submit)
          Expect(button.controls).toEqual(['preventDefault'])
          Expect(form.controls).toEqual(['stopPropagation'])
          Expect(submit.controls).toEqual(['preventDefault', 'stopPropagation'])
          Expect(screen.getByText('saved:0')).toBeDefined()
          await act(async () => {
            await Promise.resolve()
            Expect(screen.getByText('saved:0')).toBeDefined()
            release.resolve()
            await blocker
            await TR.Action(() => {}).jsValue.invoke()
          })
          Expect(screen.getByText('saved:3')).toBeDefined()
          Expect(button.controls).toEqual(['preventDefault'])
          Expect(form.controls).toEqual(['stopPropagation'])
          Expect(submit.controls).toEqual(['preventDefault', 'stopPropagation'])
        } finally {
          release.resolve()
          await blocker
        }
      },
    )
  })
})
