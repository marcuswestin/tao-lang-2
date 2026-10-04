import { Describe, Expect, Test } from '@shared/test'
import React from 'react'
import { Dev } from '../TaoRuntime-src/dev-runtime/TR-dev'

/** Exercises `Dev.processCreateReactElementArgs` directly, without rendering, so this file stays native-free. */
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

  Test('draws with whichever layout-neutral channel the author left free', () => {
    Dev.setMode({ layoutBounds: true })
    try {
      const bounds = (style: object): any => {
        const args: any[] = ['View', { style }]
        Dev.processCreateReactElementArgs(args)
        return args[1].style === style ? undefined : args[1].style.at(-1)
      }
      // An author border, background or shadow leaves the outline free, and an outline never moves layout.
      Expect(bounds({ borderWidth: 1, backgroundColor: '#fff', shadowRadius: 4 })).toMatchObject({
        outlineOffset: -0.5,
        outlineWidth: 0.5,
      })
      Expect(bounds({ borderWidth: 1 }).borderWidth).toBeUndefined()
      Expect(bounds({ outlineWidth: 2 }).boxShadow).toMatch(/^inset 0 0 0 0\.5px #[0-9a-f]{6}$/u)
      Expect(bounds({ outlineWidth: 2, boxShadow: '0 1px 2px black' })).toBeUndefined()
    } finally {
      Dev.setMode({ enabled: false })
    }
  })

  Test('does not treat a style it appended earlier as an author bounding-box style when forwarded inward', () => {
    Dev.setMode({ layoutBounds: true })
    try {
      const outerArgs: any[] = ['View', { style: { margin: 4 } }]
      Dev.processCreateReactElementArgs(outerArgs)
      const outerStyle = outerArgs[1].style
      Expect(Array.isArray(outerStyle)).toBe(true)
      Expect(outerStyle).toHaveLength(2)

      // A component forwarding `{...props}` into an inner `createElement` call carries the outer
      // element's style — including the overlay style this module just appended — along with it.
      const forwardedProps = { ...outerArgs[1] }
      const innerArgs: any[] = ['Text', forwardedProps]
      Dev.processCreateReactElementArgs(innerArgs)

      Expect(innerArgs[1]).not.toBe(forwardedProps)
      Expect(innerArgs[1].style).toHaveLength(outerStyle.length + 1)
    } finally {
      Dev.setMode({ enabled: false })
    }
  })
})
