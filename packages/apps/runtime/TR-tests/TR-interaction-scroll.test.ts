import { Describe, Expect, Test } from '@shared/test'
import { revealMountedRow } from '../TaoRuntime-src/TR-interaction-scroll'

Describe('TR.Interaction scroll reveal', () => {
  Test('scrolls the nearest viewport only enough to reveal a mounted row', () => {
    const viewport = { height: 100, width: 200, x: 0, y: 20 }
    Expect(revealMountedRow(viewport, { height: 20, width: 100, x: 0, y: 180 }, { x: 0, y: 40 }))
      .toEqual({ x: 0, y: 120 })
    Expect(revealMountedRow(viewport, { height: 20, width: 100, x: 0, y: 50 }, { x: 0, y: 40 }))
      .toBeUndefined()
    Expect(revealMountedRow(viewport, { height: 20, width: 100, x: 0, y: -10 }, { x: 0, y: 40 }))
      .toEqual({ x: 0, y: 10 })
  })
})
