import { Assert } from '@shared/core'
import type { StudioSketchRect } from './StudioSketchCatalog'

export type StudioSketchProjectionPad = Readonly<{
  bottom: number
  left: number
  right: number
  top: number
}>

export type StudioSketchProjectionElement = Readonly<{
  claim?: 1
  height: number | 'fill' | 'hug'
  id: string
  kind?: string
  type: 'element'
  width: number | 'fill' | 'hug'
}>

export type StudioSketchProjectionContainer = Readonly<{
  children: readonly StudioSketchProjectionNode[]
  claim?: 1
  direction: 'Col' | 'Row'
  gap: number
  pad: StudioSketchProjectionPad
  type: 'container'
}>

export type StudioSketchProjectionNode = StudioSketchProjectionContainer | StudioSketchProjectionElement

export type StudioSketchProjectionInput = Readonly<{
  height: number
  rects: readonly StudioSketchRect[]
  width: number
}>

export type StudioSketchProjectionResult = Readonly<{
  needsOverlay: boolean
  tree: StudioSketchProjectionNode
}>

type Axis = 'x' | 'y'
type Bounds = Readonly<{ bottom: number; left: number; right: number; top: number }>
type Built = Readonly<{ ambiguous: boolean; bounds: Bounds; node: StudioSketchProjectionNode }>

/** Deterministic FS-D11 rectangle-to-flow inference. Input order never affects its canonical tree. */
export const StudioSketchProjection = {
  project(input: StudioSketchProjectionInput): StudioSketchProjectionResult {
    Assert.input(input.width > 0 && input.height > 0, 'A sketch projection requires positive bounds.')
    Assert.input(input.rects.length > 0, 'A sketch projection requires at least one rectangle.')
    const ids = new Set<string>()
    for (const rect of input.rects) {
      Assert.input(!ids.has(rect.id), `A sketch projection rectangle id must be unique: ${rect.id}`)
      Assert.input(
        [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0,
        `A sketch projection rectangle must have finite positive geometry: ${rect.id}`,
      )
      ids.add(rect.id)
    }
    const frame: Bounds = { bottom: input.height, left: 0, right: input.width, top: 0 }
    const built = build(input.rects, frame, true)
    const tree: StudioSketchProjectionNode = built.node.type === 'element'
      ? {
        children: [built.node],
        direction: 'Col',
        gap: 0,
        pad: edgePad(built.bounds, frame),
        type: 'container',
      }
      : built.node
    return { needsOverlay: built.ambiguous, tree }
  },

  signature(node: StudioSketchProjectionNode): string {
    if (node.type === 'element') {
      return `${node.id}:${node.kind ?? 'Element'}(${node.width}x${node.height}${node.claim === 1 ? ',claim=1' : ''})`
    }
    const pad = node.pad
    const claim = node.claim === 1 ? ',claim=1' : ''
    return `${node.direction}(gap=${node.gap},pad=${pad.top}/${pad.right}/${pad.bottom}/${pad.left}${claim})[${
      node.children.map(child => StudioSketchProjection.signature(child)).join(',')
    }]`
  },
} as const

function build(rects: readonly StudioSketchRect[], frame: Bounds, root: boolean): Built {
  if (rects.length === 1) {
    const rect = rects[0]!
    return { ambiguous: false, bounds: rectBounds(rect), node: element(rect, frame) }
  }
  const xGroups = groups(rects, 'x')
  const yGroups = groups(rects, 'y')
  const axis = chooseAxis(xGroups, yGroups, frame)
  if (axis === undefined) {
    const forced = forcedAxis(rects)
    return container(rects.map(rect => build([rect], frame, false)), forced, frame, root, true)
  }
  const partitions = axis === 'x' ? xGroups : yGroups
  const children = partitions.map(partition => build(partition, frame, false))
  return container(children, axis, frame, root, children.some(child => child.ambiguous))
}

function container(
  children: readonly Built[],
  axis: Axis,
  frame: Bounds,
  root: boolean,
  ambiguous: boolean,
): Built {
  const ordered = [...children].sort((left, right) =>
    compareBounds(left.bounds, right.bounds, axis) || firstId(left.node).localeCompare(firstId(right.node))
  )
  const distances = ordered.slice(1).map((child, index) =>
    start(child.bounds, axis) - end(ordered[index]!.bounds, axis)
  )
  const gap = median(distances.map(distance => Math.max(0, distance)))
  const widest = distances.reduce((best, value, index) => value > best.value ? { index, value } : best, {
    index: -1,
    value: Number.NEGATIVE_INFINITY,
  })
  const claimedIndex = widest.value > gap ? widest.index : -1
  const nodes = ordered.map((child, index) =>
    index === claimedIndex ? { ...child.node, claim: 1 as const } : child.node
  )
  const allBounds = union(ordered.map(child => child.bounds))
  return {
    ambiguous,
    bounds: allBounds,
    node: {
      children: nodes,
      direction: axis === 'x' ? 'Row' : 'Col',
      gap,
      pad: root ? edgePad(allBounds, frame) : zeroPad,
      type: 'container',
    },
  }
}

function element(rect: StudioSketchRect, frame: Bounds): StudioSketchProjectionElement {
  const hugs = rect.kind === 'Text' || rect.kind === 'Image'
  return {
    height: hugs ? 'hug' : touches(rect.y, rect.y + rect.height, frame.top, frame.bottom) ? 'fill' : round(rect.height),
    id: rect.id,
    kind: rect.kind,
    type: 'element',
    width: hugs ? 'hug' : touches(rect.x, rect.x + rect.width, frame.left, frame.right) ? 'fill' : round(rect.width),
  }
}

function groups(rects: readonly StudioSketchRect[], axis: Axis): readonly (readonly StudioSketchRect[])[] {
  const ordered = [...rects].sort((left, right) => compareRects(left, right, axis))
  const result: StudioSketchRect[][] = []
  let edge = Number.NEGATIVE_INFINITY
  for (const rect of ordered) {
    const rectStart = axis === 'x' ? rect.x : rect.y
    const rectEnd = rectStart + (axis === 'x' ? rect.width : rect.height)
    if (result.length === 0 || rectStart >= edge) {
      result.push([rect])
      edge = rectEnd
    } else {
      result.at(-1)!.push(rect)
      edge = Math.max(edge, rectEnd)
    }
  }
  return result
}

function chooseAxis(
  xGroups: readonly (readonly StudioSketchRect[])[],
  yGroups: readonly (readonly StudioSketchRect[])[],
  frame: Bounds,
): Axis | undefined {
  const xClean = xGroups.length > 1
  const yClean = yGroups.length > 1
  if (xClean !== yClean) {
    return xClean ? 'x' : 'y'
  }
  if (!xClean) {
    return undefined
  }
  const xScore = separationScore(xGroups, 'x') / (frame.right - frame.left)
  const yScore = separationScore(yGroups, 'y') / (frame.bottom - frame.top)
  return xScore >= yScore ? 'x' : 'y'
}

function separationScore(partitions: readonly (readonly StudioSketchRect[])[], axis: Axis): number {
  return partitions.slice(1).reduce(
    (total, partition, index) => total + start(bounds(partition), axis) - end(bounds(partitions[index]!), axis),
    0,
  )
}

function forcedAxis(rects: readonly StudioSketchRect[]): Axis {
  const centersX = rects.map(rect => rect.x + rect.width / 2)
  const centersY = rects.map(rect => rect.y + rect.height / 2)
  return Math.max(...centersX) - Math.min(...centersX) >= Math.max(...centersY) - Math.min(...centersY) ? 'x' : 'y'
}

function compareRects(left: StudioSketchRect, right: StudioSketchRect, axis: Axis): number {
  const primary = axis === 'x' ? left.x - right.x : left.y - right.y
  const secondary = axis === 'x' ? left.y - right.y : left.x - right.x
  return primary || secondary || left.id.localeCompare(right.id)
}

function compareBounds(left: Bounds, right: Bounds, axis: Axis): number {
  return start(left, axis) - start(right, axis)
    || start(left, axis === 'x' ? 'y' : 'x') - start(right, axis === 'x' ? 'y' : 'x')
}

function firstId(node: StudioSketchProjectionNode): string {
  return node.type === 'element' ? node.id : firstId(node.children[0]!)
}

function bounds(rects: readonly StudioSketchRect[]): Bounds {
  return union(rects.map(rectBounds))
}

function rectBounds(rect: StudioSketchRect): Bounds {
  return { bottom: rect.y + rect.height, left: rect.x, right: rect.x + rect.width, top: rect.y }
}

function union(items: readonly Bounds[]): Bounds {
  return {
    bottom: Math.max(...items.map(item => item.bottom)),
    left: Math.min(...items.map(item => item.left)),
    right: Math.max(...items.map(item => item.right)),
    top: Math.min(...items.map(item => item.top)),
  }
}

function start(value: Bounds, axis: Axis): number {
  return axis === 'x' ? value.left : value.top
}

function end(value: Bounds, axis: Axis): number {
  return axis === 'x' ? value.right : value.bottom
}

function edgePad(content: Bounds, frame: Bounds): StudioSketchProjectionPad {
  return {
    bottom: round(Math.max(0, frame.bottom - content.bottom)),
    left: round(Math.max(0, content.left - frame.left)),
    right: round(Math.max(0, frame.right - content.right)),
    top: round(Math.max(0, content.top - frame.top)),
  }
}

function touches(first: number, second: number, edgeFirst: number, edgeSecond: number): boolean {
  return Math.abs(first - edgeFirst) <= 1 && Math.abs(second - edgeSecond) <= 1
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0
  }
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return round(ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

const zeroPad: StudioSketchProjectionPad = { bottom: 0, left: 0, right: 0, top: 0 }
