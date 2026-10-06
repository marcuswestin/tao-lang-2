import { jest } from '@jest/globals'
import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { fireEvent, fireEventAsync, render } from '@testing-library/react-native'
import { createElement, Fragment, type ReactElement, useState } from 'react'
import * as RN from 'react-native'
import { registerRuntimeE2ELifecycle, testCompileApp } from './test-compile-app'

registerRuntimeE2ELifecycle()

const nativeControlsSource = `
  use Col, Text, Button, FormButton, Switch, Slider, Spinner, Picker, SegmentedControl, DatePicker from @tao/ui
  app NativePrefixes { id "nativeprefixes" version "1.0.0" name "NativePrefixes" view Main }
  view Main() {
    state Toggle = false
    state Amount = 0.5
    state Choice = "Red"
    state Segment = "One"
    state Day = now
    action Run() { }
    action ChangeToggle(Value boolean) { set Toggle = Value }
    action ChangeAmount(Value number) { set Amount = Value }
    action ChangeChoice(Value text) { set Choice = Value }
    action ChangeSegment(Value text) { set Segment = Value }
    action ChangeDay(Value time) { set Day = Value }
    render Col() {
      #button accessible label "Button occurrence" Button("Visible button", Run)
      #form accessible label "Form occurrence" FormButton("Visible form", Run)
      #switch accessible label "Switch occurrence" Switch(Toggle, ChangeToggle, "Switch default")
      #slider accessible label "Slider occurrence" Slider(Amount, ChangeAmount, "Slider default")
      #spinner accessible label "Spinner occurrence" Spinner
      #picker accessible label "Picker occurrence" Picker(Value: Choice, Change: ChangeChoice, Options: ["Red", "Blue"], Label: "Picker default")
      #segmented accessible label "Segment occurrence" SegmentedControl(Value: Segment, Change: ChangeSegment, Options: ["One", "Two"], Label: "Segment default")
      #date accessible label "Date occurrence" DatePicker(Day, ChangeDay, "Date default")
      #defaultSwitch Switch(false, ChangeToggle, "Unchanged switch")
      #defaultSpinner Spinner
      "Toggle { Toggle }"
      "Amount { Amount }"
      "Choice { Choice }"
      "Segment { Segment }"
    }
  }
`

function nativeHostOverrides(available: boolean): () => void {
  const overrides = [
    jest.spyOn(TR.Hosts, 'Slider').mockReturnValue(available ? RN.View : undefined),
    jest.spyOn(TR.Hosts, 'Picker').mockReturnValue(available ? { Picker: RN.View, Item: RN.Text } : undefined),
    jest.spyOn(TR.Hosts, 'SegmentedControl').mockReturnValue(available ? RN.View : undefined),
    jest.spyOn(TR.Hosts, 'DateTimePicker').mockReturnValue(available ? RN.View : undefined),
  ]
  return () => {
    for (const override of overrides) {
      override.mockRestore()
    }
  }
}

Describe('mounted render occurrence accessibility labels', () => {
  Test('rejects labeled fragments and unproven injected component roots', () => {
    let layout: TR.TaoVisualLayout | undefined
    function CaptureLayout() {
      layout = TR.VisualLayout({ accessibilityLabel: 'Library' })
      return null
    }
    render(createElement(CaptureLayout))
    const fragment = createElement(Fragment, null, createElement(RN.View))
    const custom = createElement(() => createElement(RN.View))
    const message =
      'An accessibility label on an injected visual requires a supported native root; fragments and custom component roots cannot receive it.'
    Expect(layout).toBeDefined()
    Expect(() => TR.VisualNativeRoot(layout, fragment)).toThrow(message)
    Expect(() => TR.VisualNativeRoot(layout, custom)).toThrow(message)
    Expect(() => TR.VisualNativeRoot(layout, null)).toThrow(message)
    Expect(TR.VisualNativeRoot(undefined, fragment)).toBe(fragment)
  })

  Test(
    'keeps compiled native Button and FormButton occurrence labels reactive in the outline and native tree',
    async () => {
      await testCompileApp(
        `
      use Col, Button, FormButton from @tao/ui
      app OutlinePrefixes { id "outlineprefixes" version "1.0.0" name "OutlinePrefixes" view Main }
      view Main() {
        state Name = "First name"
        action Rename() { set Name = "Second name" }
        render Col() {
          #button accessible label (Name + " button") Button("Visible button", Rename)
          #form accessible label (Name + " form") FormButton("Visible form", Rename)
        }
      }
    `,
        async screen => {
          const labels = () =>
            TR.Interaction.Outline.read().nodes
              .filter(node => node.kind === 'action' && node.provenance['occurrence'])
              .map(node => node.label)
          Expect(labels()).toEqual(['First name button', 'First name form'])
          Expect(screen.getByTestId('button').props.accessibilityLabel).toBe('First name button')
          Expect(screen.getByTestId('form').props.accessibilityLabel).toBe('First name form')
          await fireEventAsync.press(screen.getByTestId('button'))
          Expect(labels()).toEqual(['Second name button', 'Second name form'])
          Expect(screen.getByTestId('button').props.accessibilityLabel).toBe('Second name button')
          Expect(screen.getByTestId('form').props.accessibilityLabel).toBe('Second name form')
          Expect(screen.getByText('Visible button')).toBeDefined()
          Expect(screen.getByText('Visible form')).toBeDefined()
        },
      )
    },
  )

  Test('compiles reactive state aliases on bare views and dynamic and literal labels on quotations', async () => {
    await testCompileApp(
      `
      use Col, Text, Button from @tao/ui
      app Prefixes { id "prefixes" version "1.0.0" name "Prefixes" view Main }
      view Main() {
        state Name = "First"
        let Alias = Name
        action Rename() { set Name = "Second" }
        render Col() {
          #custom accessible label (Alias) LabelTarget
          #grouped accessible label (Alias + " quoted") "Quoted content"
          #literal a11y label "Literal label" "Literal content"
          #sibling "Sibling content"
          Button("Rename", Rename)
        }
      }
      view LabelTarget() {
        render Col() {
          #nested "Nested content"
        }
      }
    `,
      async screen => {
        const root = screen.getByTestId('custom')
        Expect(root.props.accessibilityLabel).toBe('First')
        Expect(screen.getByTestId('grouped').props.accessibilityLabel).toBe('First quoted')
        Expect(screen.getByTestId('literal').props.accessibilityLabel).toBe('Literal label')
        Expect(screen.getByTestId('nested').props.accessibilityLabel).toBeUndefined()
        Expect(screen.getByTestId('sibling').props.accessibilityLabel).toBeUndefined()
        await fireEventAsync.press(screen.getByRole('button', { name: 'Rename' }))
        Expect(screen.getByTestId('custom')).toBe(root)
        Expect(screen.getByTestId('custom').props.accessibilityLabel).toBe('Second')
        Expect(screen.getByTestId('grouped').props.accessibilityLabel).toBe('Second quoted')
        Expect(screen.getByTestId('literal').props.accessibilityLabel).toBe('Literal label')
        Expect(screen.getByTestId('nested').props.accessibilityLabel).toBeUndefined()
        Expect(screen.getByText('Quoted content')).toBeDefined()
        Expect(screen.queryByText('First')).toBeNull()
        Expect(screen.queryByText('Second')).toBeNull()
      },
    )
  })

  Test(
    'compiles native adapter labels into actual controls while preserving defaults and change handlers',
    async () => {
      const restore = nativeHostOverrides(true)
      try {
        await testCompileApp(nativeControlsSource, async screen => {
          for (
            const [tag, label] of [
              ['button', 'Button occurrence'],
              ['form', 'Form occurrence'],
              ['slider', 'Slider occurrence'],
              ['spinner', 'Spinner occurrence'],
              ['picker', 'Picker occurrence'],
              ['segmented', 'Segment occurrence'],
              ['date', 'Date occurrence'],
            ]
          ) {
            Expect(screen.getByTestId(tag!).props.accessibilityLabel).toBe(label)
            Expect(screen.getAllByLabelText(label!)).toHaveLength(1)
          }
          Expect(screen.getByTestId('switch').props.accessibilityLabel).toBeUndefined()
          Expect(screen.getAllByLabelText('Switch occurrence')).toHaveLength(1)
          Expect(screen.getByText('Switch default').props.children).toBe('Switch default')
          Expect(screen.getByText('Visible button').props.children).toBe('Visible button')
          Expect(screen.getByText('Visible form').props.children).toBe('Visible form')
          Expect(screen.getByLabelText('Unchanged switch').props.accessibilityLabel).toBe('Unchanged switch')
          Expect(screen.getByTestId('defaultSpinner').props.accessibilityLabel).toBe('Loading')
          Expect(screen.getByTestId('spinner').props.accessibilityRole).toBe('progressbar')
          const outlineLabels = TR.Interaction.Outline.read().nodes.map(node => node.label)
          for (
            const label of [
              'Button occurrence',
              'Form occurrence',
              'Switch occurrence',
              'Slider occurrence',
              'Picker occurrence',
              'Segment occurrence',
              'Date occurrence',
            ]
          ) {
            Expect(outlineLabels).toContain(label)
          }
          await fireEventAsync(screen.getByLabelText('Switch occurrence'), 'valueChange', true)
          await fireEventAsync(screen.getByTestId('slider'), 'valueChange', 0.8)
          await fireEventAsync(screen.getByTestId('picker'), 'valueChange', 'Blue')
          await fireEventAsync(screen.getByTestId('segmented'), 'valueChange', 'Two')
          await fireEventAsync(screen.getByTestId('date'), 'change', {}, new Date('2024-01-02T00:00:00.000Z'))
          Expect(screen.getByText('Toggle true')).toBeDefined()
          Expect(screen.getByText('Amount 0.8')).toBeDefined()
          Expect(screen.getByText('Choice Blue')).toBeDefined()
          Expect(screen.getByText('Segment Two')).toBeDefined()
          Expect(screen.getByTestId('date').props.value.getTime()).toBe(1704153600000)
        })
      } finally {
        restore()
      }
    },
  )

  Test('keeps one occurrence label on each compiled portable region and distinct child action names', async () => {
    const restore = nativeHostOverrides(false)
    try {
      await testCompileApp(nativeControlsSource, async screen => {
        for (
          const [tag, label] of [
            ['slider', 'Slider occurrence'],
            ['picker', 'Picker occurrence'],
            ['segmented', 'Segment occurrence'],
            ['date', 'Date occurrence'],
          ]
        ) {
          Expect(screen.getByTestId(tag!).props.accessibilityLabel).toBe(label)
          Expect(screen.getAllByLabelText(label!)).toHaveLength(1)
        }
        Expect(screen.getByLabelText('Decrease Slider default').props.accessibilityRole).toBe('button')
        Expect(screen.getByLabelText('Increase Slider default').props.accessibilityRole).toBe('button')
        Expect(screen.getByLabelText('Previous Date default').props.accessibilityRole).toBe('button')
        Expect(screen.getByLabelText('Next Date default').props.accessibilityRole).toBe('button')
        Expect(screen.getByRole('button', { name: 'Red' })).toBeDefined()
        Expect(screen.getByRole('button', { name: 'One' })).toBeDefined()
        const outlineLabels = TR.Interaction.Outline.read().nodes.map(node => node.label)
        for (const label of ['Slider occurrence', 'Picker occurrence', 'Segment occurrence', 'Date occurrence']) {
          Expect(outlineLabels).toContain(label)
        }
        await fireEventAsync.press(screen.getByLabelText('Increase Slider default'))
        await fireEventAsync.press(screen.getByRole('button', { name: 'Blue' }))
        await fireEventAsync.press(screen.getByRole('button', { name: 'Two' }))
        Expect(screen.getByText('Amount 0.6')).toBeDefined()
        Expect(screen.getByText('Choice Blue')).toBeDefined()
        Expect(screen.getByText('Segment Two')).toBeDefined()
      })
    } finally {
      restore()
    }
  })

  Test('updates native labels reactively without changing visible text or leaking to children and siblings', () => {
    function CustomView({ __tao }: { __tao?: TR.TaoProps }): ReactElement {
      return TR.Views.View({
        __tao: TR.ViewTaoProps({ accessibilityLabel: 'Local root', testTag: 'root' }, __tao),
        children: TR.Views.Text({ __tao: TR.ViewTaoProps({}, __tao, false), tag: 'nested', children: 'Nested' }),
      })
    }
    function App(): ReactElement {
      const [name, setName] = useState('First')
      const caller = { accessibilityLabel: name }
      return createElement(
        RN.View,
        null,
        TR.Views.Text({ __tao: TR.ViewTaoProps({}, caller), tag: 'heading', children: 'Visible heading' }),
        createElement(CustomView, { __tao: caller }),
        TR.Views.Text({ tag: 'sibling', children: 'Sibling' }),
        TR.Views.Pressable({ title: 'Rename', action: { invoke: () => setName('Second') } }),
      )
    }
    const screen = render(createElement(App))
    const rootBefore = screen.getByTestId('root')
    Expect(screen.getByTestId('heading').props.accessibilityLabel).toBe('First')
    Expect(rootBefore.props.accessibilityLabel).toBe('Local root')
    Expect(screen.getByTestId('nested').props.accessibilityLabel).toBeUndefined()
    Expect(screen.getByTestId('sibling').props.accessibilityLabel).toBeUndefined()
    fireEvent.press(screen.getByLabelText('Rename'))
    Expect(screen.getByTestId('heading').props.accessibilityLabel).toBe('Second')
    Expect(screen.getByText('Visible heading').props.children).toBe('Visible heading')
    Expect(screen.getByTestId('root')).toBe(rootBefore)
    Expect(screen.getByTestId('root').props.accessibilityLabel).toBe('Local root')
    Expect(screen.getByTestId('nested').props.accessibilityLabel).toBeUndefined()
  })

  Test('preserves control defaults and overrides accessible names without replacing visible titles or roles', () => {
    const label = { accessibilityLabel: 'Occurrence' }
    const screen = render(createElement(
      RN.View,
      null,
      TR.Views.Pressable({ title: 'Save', tag: 'button-default' }),
      TR.Views.Pressable({ __tao: label, title: 'Publish', tag: 'button-explicit' }),
      TR.Views.Checkbox({ label: 'Agree', value: true, tag: 'checkbox-default' }),
      TR.Views.Checkbox({ __tao: label, label: 'Consent', value: false, tag: 'checkbox-explicit' }),
      TR.Views.TextInput({ __tao: label, label: 'Title', value: 'Draft', id: 'input' }),
      TR.Views.Spinner({ tag: 'spinner-default' }),
      TR.Views.Spinner({ __tao: label, tag: 'spinner-explicit' }),
      TR.Views.Progress({ value: 0.5, tag: 'progress-default' }),
      TR.Views.Progress({ __tao: label, value: 0.5, tag: 'progress-explicit' }),
      TR.Views.Image({ __tao: label, source: 'image.png', label: 'Original image', tag: 'image' }),
    ))
    Expect(screen.getByTestId('button-default').props.accessibilityLabel).toBe('Save')
    Expect(screen.getByTestId('button-explicit').props.accessibilityLabel).toBe('Occurrence')
    Expect(screen.getByTestId('button-explicit').props.accessibilityRole).toBe('button')
    Expect(screen.getByText('Publish').props.children).toBe('Publish')
    Expect(screen.getByTestId('checkbox-default').props.accessibilityLabel).toBe('Agree')
    Expect(screen.getByTestId('checkbox-explicit').props.accessibilityLabel).toBe('Occurrence')
    Expect(screen.getByTestId('checkbox-explicit').props.accessibilityRole).toBe('checkbox')
    Expect(screen.getByText('Consent').props.children).toBe('Consent')
    Expect(screen.getByTestId('input').props.accessibilityLabel).toBe('Occurrence')
    Expect(screen.getByTestId('input').props.value).toBe('Draft')
    Expect(screen.getByText('Title').props.children).toBe('Title')
    Expect(screen.getByTestId('spinner-default').props.accessibilityLabel).toBe('Loading')
    Expect(screen.getByTestId('spinner-explicit').props.accessibilityLabel).toBe('Occurrence')
    Expect(screen.getByTestId('progress-default').props.accessibilityLabel).toBe('Progress')
    Expect(screen.getByTestId('progress-explicit').props.accessibilityLabel).toBe('Occurrence')
    Expect(screen.getByTestId('image').props.accessibilityRole).toBe('image')
    Expect(screen.getByTestId('image').props.accessibilityLabel).toBe('Occurrence')
  })

  Test('labels an injected native Button without adding a wrapper and preserves an existing Studio wrapper', () => {
    function Injected({ accessibilityLabel, studio }: {
      accessibilityLabel?: string
      studio?: TR.TaoProps['studio']
    }): ReactElement {
      const layout = TR.VisualLayout({ accessibilityLabel, studio })
      return TR.VisualNativeRoot(
        layout,
        createElement(RN.Button, {
          accessibilityLabel: 'Default title',
          onPress: () => undefined,
          testID: 'native-button',
          title: 'Visible native title',
        }),
      ) as ReactElement
    }
    const screen = render(createElement(Injected))
    const nativeBefore = screen.getByTestId('native-button')
    const viewCount = screen.UNSAFE_getAllByType(RN.View).length
    Expect(nativeBefore.props.accessibilityLabel).toBe('Default title')
    screen.rerender(createElement(Injected, { accessibilityLabel: 'Native occurrence' }))
    Expect(screen.getByTestId('native-button')).toBe(nativeBefore)
    Expect(screen.UNSAFE_getAllByType(RN.View).length).toBe(viewCount)
    Expect(screen.getByTestId('native-button').props.accessibilityLabel).toBe('Native occurrence')
    Expect(screen.getByText('Visible native title').props.children).toBe('Visible native title')
    const plainTree = screen.toJSON()
    screen.rerender(createElement(Injected, {
      accessibilityLabel: 'Native occurrence',
      studio: { end: 20, kind: 'render', sourcePath: '/project/Labels.tao', start: 1 },
    }))
    const studioTree = screen.toJSON() as { children?: unknown[]; props: Record<string, unknown>; type: string }
    Expect(studioTree.type).toBe('View')
    Expect(studioTree.props['accessibilityLabel']).toBeUndefined()
    Expect(studioTree.props['dataSet']).toBeDefined()
    Expect(JSON.stringify(studioTree.children)).toBe(JSON.stringify([plainTree]))
    Expect(screen.getByTestId('native-button').props.accessibilityLabel).toBe('Native occurrence')
  })

  Test('keeps an injected row wrapper for scroll ownership and puts the label only on its native child', () => {
    const capabilities: { scrollIntoView?(): void } = {}
    function InjectedRow(): ReactElement {
      const layout = TR.VisualLayout({
        accessibilityLabel: 'Row occurrence',
        interaction: { row: { capabilities, identity: 'rows/first', label: 'First row' } },
      })
      return TR.VisualNativeRoot(
        layout,
        createElement(RN.Button, {
          onPress: () => undefined,
          testID: 'row-button',
          title: 'Visible row title',
        }),
      ) as ReactElement
    }
    const screen = render(createElement(InjectedRow))
    const tree = screen.toJSON() as { children?: unknown[]; props: Record<string, unknown>; type: string }
    Expect(tree.type).toBe('View')
    Expect(tree.children).toHaveLength(1)
    Expect(tree.props['accessibilityLabel']).toBeUndefined()
    Expect(typeof tree.props['onLayout']).toBe('function')
    Expect(typeof capabilities.scrollIntoView).toBe('function')
    Expect(screen.getByTestId('row-button').props.accessibilityLabel).toBe('Row occurrence')
    Expect(screen.getByText('Visible row title').props.children).toBe('Visible row title')
  })
})
