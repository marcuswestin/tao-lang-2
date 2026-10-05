import type TRType from '@runtime/TR'
import { Describe, Expect, Test, testOverrideSlot } from '@shared/test'
import React from 'react'
import { TaoPropsControls } from '../TaoRuntime-src/TR-TaoProps'

const contextSlot = testOverrideSlot<typeof React.useContext>({
  read: () => React.useContext,
  write: value => {
    React.useContext = value
  },
})

function visualLayout(props: TRType.TaoProps): TRType.TaoVisualLayout | undefined {
  const restore = contextSlot.install((() => undefined) as typeof React.useContext)
  try {
    return TaoPropsControls.visualLayout(props)
  } finally {
    restore()
  }
}

Describe('render occurrence accessibility labels', () => {
  Test('prefers local metadata and keeps labels within their caller chain', () => {
    const caller = { accessibilityLabel: 'Caller', testTag: 'caller' }
    const root = { accessibilityLabel: 'Local', callerProps: caller }
    const inherited = { callerProps: caller }
    const sibling = {}
    const native = (props: TRType.TaoProps) =>
      TaoPropsControls.nativePropsWithStyle(
        TaoPropsControls.mergeViewProps({ __tao: props }, {}),
      )

    Expect(native(root)['accessibilityLabel']).toBe('Local')
    Expect(native(inherited)['accessibilityLabel']).toBe('Caller')
    Expect(native(sibling)['accessibilityLabel']).toBeUndefined()
    Expect(native(root)['testID']).toBe('caller')
  })

  Test('carries labels privately through the layout value to injected primitives', () => {
    const layout = visualLayout({ accessibilityLabel: 'Library' })
    Expect(layout).toEqual({})
    Expect(TaoPropsControls.visualNativeProps(layout, 'heading')).toEqual({
      accessibilityLabel: 'Library',
      testID: 'heading',
    })
    const merged = TaoPropsControls.mergeViewProps({ layout }, { nativeProps: { accessibilityLabel: 'Default' } })
    Expect(TaoPropsControls.nativePropsWithStyle(merged)['accessibilityLabel']).toBe('Library')
    Expect(TaoPropsControls.mergeViewProps({ layout: {} }, {}).accessibilityLabel).toBeUndefined()
    Expect(
      TaoPropsControls.mergeViewProps({ __tao: { accessibilityLabel: 'Local' }, layout }, {})
        .accessibilityLabel,
    ).toBe('Local')
    Expect(
      TaoPropsControls.mergeViewProps({ __tao: { accessibilityLabel: '' }, layout }, {})
        .accessibilityLabel,
    ).toBe('')
  })
})
