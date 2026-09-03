import { Describe, Expect, Test } from '@shared/test'
import {
  bestInspectHit,
  measureStudioInspectNodes,
  moveRenderFor,
  resetStudioInspectRegistry,
  siblingRenders,
  type StudioInspectHit,
  studioInspectNodeCount,
  studioInspectRef,
} from '../TaoRuntime-src/TR-studio-device-inspect'
import type { TaoStudioIdentity } from '../TaoRuntime-src/TR-TaoProps'

function identity(start: number, end: number, sourcePath = 'App.tao'): TaoStudioIdentity {
  return { end, kind: 'render', sourcePath, start }
}

function hit(rect: { height: number; width: number; x: number; y: number }, span = 100): StudioInspectHit {
  return { identity: identity(0, span), rect }
}

/** A native component reference, as far as the registry is concerned. */
function measurable(x: number, y: number, width: number, height: number): {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void
} {
  return { measureInWindow: callback => callback(x, y, width, height) }
}

Describe('Studio device inspect hit testing', () => {
  Test('a tap inside nested frames selects the innermost one', () => {
    const screen = hit({ height: 800, width: 400, x: 0, y: 0 })
    const card = hit({ height: 200, width: 360, x: 20, y: 100 })
    const button = hit({ height: 44, width: 120, x: 40, y: 200 })

    const selected = bestInspectHit([screen, card, button], { x: 60, y: 210 })

    Expect(selected).toBe(button)
  })

  Test('order of registration does not decide the winner', () => {
    const screen = hit({ height: 800, width: 400, x: 0, y: 0 })
    const button = hit({ height: 44, width: 120, x: 40, y: 200 })

    const innerFirst = bestInspectHit([button, screen], { x: 60, y: 210 })
    const outerFirst = bestInspectHit([screen, button], { x: 60, y: 210 })

    Expect(innerFirst).toBe(button)
    Expect(outerFirst).toBe(button)
  })

  Test('a tap outside every frame selects nothing', () => {
    const button = hit({ height: 44, width: 120, x: 40, y: 200 })

    Expect(bestInspectHit([button], { x: 300, y: 700 })).toBeUndefined()
  })

  Test('a frame containing the tap wins over a nearer frame that does not', () => {
    const containing = hit({ height: 800, width: 400, x: 0, y: 0 })
    const adjacent = hit({ height: 10, width: 10, x: 300, y: 700 })

    Expect(bestInspectHit([containing, adjacent], { x: 60, y: 210 })).toBe(containing)
  })

  Test('two frames of the same size are separated by the shorter source span', () => {
    const rect = { height: 44, width: 120, x: 40, y: 200 }
    const outer: StudioInspectHit = { identity: identity(0, 400), rect }
    const inner: StudioInspectHit = { identity: identity(10, 90), rect }

    Expect(bestInspectHit([outer, inner], { x: 60, y: 210 })).toBe(inner)
  })

  Test('a tap exactly on a frame edge still selects it', () => {
    const button = hit({ height: 44, width: 120, x: 40, y: 200 })

    Expect(bestInspectHit([button], { x: 40, y: 200 })).toBe(button)
    Expect(bestInspectHit([button], { x: 160, y: 244 })).toBe(button)
  })
})

Describe('Studio device inspect registration', () => {
  Test('one occurrence gets one ref across renders, so React never churns the node', () => {
    resetStudioInspectRegistry()
    const occurrence = identity(10, 40)

    const first = studioInspectRef(occurrence)
    const second = studioInspectRef({ ...occurrence })
    const other = studioInspectRef(identity(50, 80))

    Expect(first).toBe(second)
    Expect(first === other).toBe(false)
  })

  Test('a measurable node is registered and its cleanup releases exactly that node', async () => {
    resetStudioInspectRegistry()
    const ref = studioInspectRef(identity(10, 40))

    const releaseFirst = ref(measurable(0, 0, 100, 50))
    ref(measurable(0, 60, 100, 50))
    Expect(studioInspectNodeCount()).toBe(2)

    const measured = await measureStudioInspectNodes()
    Expect(measured.length).toBe(2)
    Expect(measured.map(entry => entry.rect.y).sort()).toEqual([0, 60])

    Expect(typeof releaseFirst).toBe('function')
    releaseFirst?.()
    Expect(studioInspectNodeCount()).toBe(1)
    Expect((await measureStudioInspectNodes()).map(entry => entry.rect.y)).toEqual([60])
  })

  Test('a node with no measureInWindow registers nothing and needs no cleanup', () => {
    resetStudioInspectRegistry()
    const ref = studioInspectRef(identity(10, 40))

    // react-native-web hands a ref a DOM element. The browser canvas reads identity out of the DOM
    // instead, so registering it here would cost memory for a hit test that never runs.
    Expect(ref({ nodeType: 1, tagName: 'DIV' })).toBeUndefined()
    Expect(ref(null)).toBeUndefined()
    Expect(studioInspectNodeCount()).toBe(0)
  })

  Test('a node that never answers measureInWindow does not hang the hit test', async () => {
    resetStudioInspectRegistry()
    const ref = studioInspectRef(identity(10, 40))
    ref({ measureInWindow: () => {} })
    ref(measurable(0, 0, 100, 50))

    const measured = await measureStudioInspectNodes()

    Expect(measured.length).toBe(1)
    Expect(measured[0]?.rect.height).toBe(50)
  })

  Test('a node measured as having no area is not a hit target', async () => {
    resetStudioInspectRegistry()
    const ref = studioInspectRef(identity(10, 40))
    ref(measurable(0, 0, 0, 0))

    Expect((await measureStudioInspectNodes()).length).toBe(0)
  })
})

/** A column of three rows inside one card, the shape a person reorders on a phone. */
function columnLayout(): {
  card: StudioInspectHit
  first: StudioInspectHit
  second: StudioInspectHit
  third: StudioInspectHit
} {
  return {
    card: { identity: identity(0, 500), rect: { height: 300, width: 300, x: 0, y: 0 } },
    first: { identity: identity(10, 60), rect: { height: 80, width: 280, x: 10, y: 10 } },
    second: { identity: identity(70, 120), rect: { height: 80, width: 280, x: 10, y: 100 } },
    third: { identity: identity(130, 180), rect: { height: 80, width: 280, x: 10, y: 190 } },
  }
}

Describe('Studio device inspect sibling ordering', () => {
  Test('siblings are the renders sharing a parent, ordered by position in the source', () => {
    const { card, first, second, third } = columnLayout()

    // Screen order here is deliberately the reverse of source order for the last two.
    const shuffled = [third, card, first, second]
    const siblings = siblingRenders(shuffled, second)

    Expect(siblings.map(hit => hit.identity.start)).toEqual([10, 70, 130])
  })

  Test('a render laid out beside its siblings still orders by source, not by screen position', () => {
    const card: StudioInspectHit = { identity: identity(0, 500), rect: { height: 100, width: 300, x: 0, y: 0 } }
    const left: StudioInspectHit = { identity: identity(90, 140), rect: { height: 80, width: 90, x: 10, y: 10 } }
    const right: StudioInspectHit = { identity: identity(20, 70), rect: { height: 80, width: 90, x: 110, y: 10 } }

    Expect(siblingRenders([card, left, right], left).map(hit => hit.identity.start)).toEqual([20, 90])
  })

  Test('a render with no containing frame has no siblings to reorder against', () => {
    const alone: StudioInspectHit = { identity: identity(10, 60), rect: { height: 80, width: 280, x: 10, y: 10 } }

    Expect(siblingRenders([alone], alone)).toEqual([])
  })

  Test('a render in another file is not a sibling even inside the same frame', () => {
    const { card, first } = columnLayout()
    const foreign: StudioInspectHit = {
      identity: identity(70, 120, 'Other.tao'),
      rect: { height: 80, width: 280, x: 10, y: 100 },
    }

    Expect(siblingRenders([card, first, foreign], first).map(hit => hit.identity.sourcePath)).toEqual(['App.tao'])
  })

  Test('one occurrence rendered repeatedly counts once', () => {
    const { card, first, second } = columnLayout()
    const repeated: StudioInspectHit = { identity: second.identity, rect: { height: 80, width: 280, x: 10, y: 190 } }

    Expect(siblingRenders([card, first, second, repeated], first).length).toBe(2)
  })
})

Describe('Studio device inspect move actions', () => {
  Test('moving up lands the render before the sibling above it in the source', () => {
    const { card, first, second, third } = columnLayout()

    Expect(moveRenderFor([card, first, second, third], second, 'up')).toEqual({
      beforeId: 'App.tao:10:60',
      draggedId: 'App.tao:70:120',
      kind: 'move-render',
    })
  })

  Test('moving down lands the render after the sibling below it in the source', () => {
    const { card, first, second, third } = columnLayout()

    Expect(moveRenderFor([card, first, second, third], second, 'down')).toEqual({
      afterId: 'App.tao:130:180',
      draggedId: 'App.tao:70:120',
      kind: 'move-render',
    })
  })

  Test('the first render cannot move up and the last cannot move down', () => {
    const { card, first, second, third } = columnLayout()
    const hits = [card, first, second, third]

    Expect(moveRenderFor(hits, first, 'up')).toBeUndefined()
    Expect(moveRenderFor(hits, third, 'down')).toBeUndefined()
  })

  Test('a render with no siblings has no move in either direction', () => {
    const { card, first } = columnLayout()

    Expect(moveRenderFor([card, first], first, 'up')).toBeUndefined()
    Expect(moveRenderFor([card, first], first, 'down')).toBeUndefined()
  })
})
