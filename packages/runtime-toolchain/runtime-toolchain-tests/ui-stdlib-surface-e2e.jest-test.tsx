import TR from '@runtime/TR'
import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { fireEvent } from '@testing-library/react-native'
import React from 'react'
import * as RN from 'react-native'
import { compileAndRenderApp, ExpectScreen, registerRuntimeE2ELifecycle } from './test-compile-app'

registerRuntimeE2ELifecycle()

Describe('Expo runtime UI stdlib surfaces', () => {
  Test('renders image, spinner, and clamped progress through the real Runtime Stdlib app', async () => {
    const appPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
    const screen = await compileAndRenderApp(appPath)

    const informativeImage = screen.getByTestId('informativeImage')
    Expect(informativeImage.props).toMatchObject({
      accessibilityLabel: 'Runtime stdlib illustration',
      accessibilityRole: 'image',
      accessible: true,
      source: { uri: './images/runtime-stdlib.png' },
    })

    const decorativeImage = screen.getByTestId('decorativeImage')
    Expect(decorativeImage.props.accessible).toBe(false)
    Expect(decorativeImage.props.accessibilityLabel).toBeUndefined()
    Expect(decorativeImage.props.accessibilityRole).toBeUndefined()

    const spinner = screen.getByTestId('loadingIndicator')
    Expect(spinner.props).toMatchObject({
      accessibilityLabel: 'Loading',
      accessibilityRole: 'progressbar',
      accessibilityState: { busy: true },
      animating: true,
    })

    const progress = screen.getByTestId('completionProgress')
    Expect(progress.props).toMatchObject({
      accessibilityLabel: 'Progress',
      accessibilityRole: 'progressbar',
      accessibilityValue: { max: 1, min: 0, now: 1 },
    })
    const fill = React.Children.toArray(progress.props.children)[0] as React.ReactElement<{ style?: unknown }>
    Expect(RN.StyleSheet.flatten(fill.props.style)).toMatchObject({ width: '100%' })
  })

  Test('wires Checkbox on change and accepts FormButton Icon in the real Forms app', async () => {
    const appPath = Repo.resolvePath('Apps/Test Apps/Forms and Interaction MVP/Forms and Interaction MVP.tao')
    const screen = await compileAndRenderApp(appPath)

    ExpectScreen(screen).toHaveText('Checkbox: unchecked')
    Expect(screen.getByTestId('completed').props.accessibilityState).toMatchObject({ checked: false })

    fireEvent.press(screen.getByTestId('completed'))

    ExpectScreen(screen).toHaveText('Checkbox: checked')
    Expect(screen.getByTestId('completed').props.accessibilityState).toMatchObject({ checked: true })
    ExpectScreen(screen).toHaveText('Save')
  })

  Test('exposes one accessible native Switch label while keeping its visible text', async () => {
    const appPath = Repo.resolvePath('Apps/Test Apps/Native Components/Native Components.tao')
    const screen = await compileAndRenderApp(appPath)

    Expect(screen.getAllByLabelText('Enabled')).toHaveLength(1)
    Expect(screen.getByText('Enabled').props.accessible).toBe(false)
    Expect(
      TR.Interaction.Outline.read().nodes.some(node => node.kind === 'input' && node.label === 'Enabled'),
    ).toBe(true)
  })
})
