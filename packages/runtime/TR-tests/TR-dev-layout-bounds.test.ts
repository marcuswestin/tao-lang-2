import { Describe, Expect, Test } from '@shared/test'
import React from 'react'
import { Dev } from '../TaoRuntime-src/dev-runtime/TR-dev'

/** Exercises `Dev.processCreateReactElementArgs` directly rather than through `createElement`: with layout
 * bounds enabled, `createElement` resolves the host platform on first use, which would pull in the real
 * `react-native` module. Calling the Dev entry point directly keeps this file native-free. */
Describe('Dev.processCreateReactElementArgs', () => {
  Test('never adds a style to a Fragment', () => {
    Dev.setMode({ layoutBounds: true })
    try {
      const props = { children: 'label' }
      const args: any[] = [React.Fragment, props]
      Dev.processCreateReactElementArgs(args)
      Expect(args[1]).toBe(props)
      Expect('style' in args[1]).toBe(false)
    } finally {
      Dev.setMode({ enabled: false })
    }
  })

  Test('does not treat a style it appended earlier as an author bounding-box style when forwarded inward', () => {
    Dev.setMode({ layoutBounds: true })
    try {
      const outerArgs: any[] = ['View', { style: { margin: 4 } }]
      Dev.processCreateReactElementArgs(outerArgs, { platformOS: 'ios' })
      const outerStyle = outerArgs[1].style
      Expect(Array.isArray(outerStyle)).toBe(true)
      Expect(outerStyle).toHaveLength(2)

      // A component forwarding `{...props}` into an inner `createElement` call carries the outer
      // element's style — including the overlay style this module just appended — along with it.
      const forwardedProps = { ...outerArgs[1] }
      const innerArgs: any[] = ['Text', forwardedProps]
      Dev.processCreateReactElementArgs(innerArgs, { platformOS: 'ios' })

      Expect(innerArgs[1]).not.toBe(forwardedProps)
      Expect(innerArgs[1].style).toHaveLength(outerStyle.length + 1)
    } finally {
      Dev.setMode({ enabled: false })
    }
  })
})
