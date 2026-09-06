import { Assert } from '@shared/core'
import type { StudioLayoutEntry } from '@source-actions'
import type { StudioSourceActionProposal, StudioSourceActionResult } from './StudioProjectSession'
import {
  type StudioCanonicalSourceAction,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
  type StudioSourceActionIdentity,
  studioSourceActionVersion,
} from './StudioProtocol'
import type { StudioSketchRect } from './StudioSketchCatalog'
import type { StudioSketchProjectionNode, StudioSketchProjectionResult } from './StudioSketchProjection'

export type StudioSketchSnapTree = StudioSketchSnapContainer | StudioSketchSnapElement

type StudioSketchSnapContainer = Readonly<{
  children: readonly StudioSketchSnapTree[]
  direction: 'Col' | 'Row'
  layout: readonly StudioLayoutEntry[]
  type: 'container'
}>

type StudioSketchSnapElement = Readonly<{
  arguments: readonly string[]
  component: 'Image' | 'Placeholder' | 'Text'
  content?: string
  layout: readonly StudioLayoutEntry[]
  rectId: string
  type: 'element'
}>

type StudioSketchSnapSourceAction =
  & StudioCanonicalSourceAction
  & Readonly<{
    expectedCatalogRevision: number
    kind: 'snap-sketch-to-flow'
    mergeDirection: 'Col' | 'Row'
    mergePosition: 'after' | 'before'
    rectIds: readonly string[]
    sketchId: string
    tree: StudioSketchSnapTree
    viewName: string
  }>

type StudioSketchSnapMergePlan = Readonly<{
  direction: 'Col' | 'Row'
  position: 'after' | 'before'
}>

type StudioSketchSnapPrepared = Readonly<{
  action: StudioSketchSnapSourceAction
  needsConfirmation: boolean
  projectedRectIds: readonly string[]
}>

export type StudioSketchSnapTransport = Readonly<{
  apply: (envelope: StudioSourceActionEnvelope) => Promise<StudioSourceActionResult>
  propose: (envelope: StudioSourceActionEnvelope) => Promise<StudioSourceActionProposal>
}>

type StudioSketchSnapSubmission =
  | Readonly<{
    kind: 'applied'
    projectedRectIds: readonly string[]
    result: StudioSourceActionResult
  }>
  | Readonly<{
    kind: 'proposal'
    projectedRectIds: readonly string[]
    proposal: StudioSourceActionProposal
  }>

export const StudioSketchSnap = {
  envelope,
  mergePlan,
  prepare,
  submit,
} as const

function mergePlan(
  options: Readonly<{
    existingRectIds: readonly string[]
    projectedRectIds: readonly string[]
    projection: StudioSketchProjectionResult
  }>,
): StudioSketchSnapMergePlan {
  const existing = new Set(options.existingRectIds)
  const projected = new Set(options.projectedRectIds)
  Assert.input(existing.size > 0 && projected.size > 0, 'A partial Studio Snap merge requires both rectangle groups.')
  Assert.input(
    [...existing].every(id => !projected.has(id)),
    'A partial Studio Snap merge cannot classify one rectangle as both existing and new.',
  )
  Assert.input(options.projection.tree.type === 'container', 'A partial Studio Snap merge requires a flow container.')

  const groups = options.projection.tree.children.map(child => {
    const ids = projectionRectIds(child)
    const hasExisting = ids.some(id => existing.has(id))
    const hasProjected = ids.some(id => projected.has(id))
    Assert.input(
      hasExisting !== hasProjected && ids.every(id => existing.has(id) || projected.has(id)),
      'Studio Snap cannot preserve authored source for interleaved rectangle geometry.',
    )
    return hasExisting ? 'existing' : 'projected'
  })
  const runs = groups.filter((group, index) => group !== groups[index - 1])
  Assert.input(
    runs.length === 2 && runs.includes('existing') && runs.includes('projected'),
    'Studio Snap cannot preserve authored source for interleaved rectangle geometry.',
  )
  return {
    direction: options.projection.tree.direction,
    position: runs[0] === 'projected' ? 'before' : 'after',
  }
}

function prepare(
  options: Readonly<{
    expectedCatalogRevision: number
    mergeDirection: 'Col' | 'Row'
    mergePosition?: 'after' | 'before'
    projection: StudioSketchProjectionResult
    rects: readonly StudioSketchRect[]
    sketchId: string
    viewName: string
  }>,
): StudioSketchSnapPrepared {
  Assert.input(options.sketchId.length > 0, 'A Studio Snap action requires a sketch ID.')
  Assert.input(/^View[1-9][0-9]*$/.test(options.viewName), 'A Studio Snap action requires a generated ViewN name.')
  Assert.input(
    Number.isSafeInteger(options.expectedCatalogRevision) && options.expectedCatalogRevision >= 0,
    'A Studio Snap action requires a nonnegative catalog revision.',
  )
  const rects = new Map(options.rects.map(rect => [rect.id, rect]))
  const projectedRectIds: string[] = []
  const tree = snapTree(options.projection.tree, rects, projectedRectIds)
  Assert.input(projectedRectIds.length > 0, 'A Studio Snap action requires at least one projected rectangle.')
  Assert.input(
    new Set(projectedRectIds).size === projectedRectIds.length,
    'A Studio Snap projection cannot contain the same rectangle more than once.',
  )
  const action: StudioSketchSnapSourceAction = {
    expectedCatalogRevision: options.expectedCatalogRevision,
    kind: 'snap-sketch-to-flow',
    mergeDirection: options.mergeDirection,
    mergePosition: options.mergePosition ?? 'after',
    rectIds: projectedRectIds,
    sketchId: options.sketchId,
    tree,
    viewName: options.viewName,
  }
  return {
    action,
    needsConfirmation: options.projection.needsOverlay,
    projectedRectIds,
  }
}

function projectionRectIds(node: StudioSketchProjectionNode): string[] {
  return node.type === 'element' ? [node.id] : node.children.flatMap(projectionRectIds)
}

function envelope(
  options: Readonly<{
    checkpointId: string
    identity: StudioSourceActionIdentity
    prepared: StudioSketchSnapPrepared
    requestId: string
  }>,
): StudioSourceActionEnvelope {
  Assert.input(options.requestId.length > 0, 'A Studio Snap source action requires a request ID.')
  Assert.input(options.checkpointId.length > 0, 'A Studio Snap source action requires a checkpoint ID.')
  return {
    action: options.prepared.action,
    channel: studioProtocolChannel,
    checkpoint: { id: options.checkpointId, phase: 'single' },
    identity: options.identity,
    protocolVersion: studioProtocolVersion,
    requestId: options.requestId,
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action',
  }
}

async function submit(
  options: Readonly<{
    checkpointId: string
    confirmed?: boolean
    identity: StudioSourceActionIdentity
    prepared: StudioSketchSnapPrepared
    requestId: string
    transport: StudioSketchSnapTransport
  }>,
): Promise<StudioSketchSnapSubmission> {
  const request = envelope(options)
  if (options.prepared.needsConfirmation && options.confirmed !== true) {
    return {
      kind: 'proposal',
      projectedRectIds: options.prepared.projectedRectIds,
      proposal: await options.transport.propose(request),
    }
  }
  return {
    kind: 'applied',
    projectedRectIds: options.prepared.projectedRectIds,
    result: await options.transport.apply(request),
  }
}

function snapTree(
  node: StudioSketchProjectionNode,
  rects: ReadonlyMap<string, StudioSketchRect>,
  projectedRectIds: string[],
): StudioSketchSnapTree {
  if (node.type === 'container') {
    return {
      children: node.children.map(child => snapTree(child, rects, projectedRectIds)),
      direction: node.direction,
      layout: [
        ...(node.gap === 0 ? [] : [['gap', node.gap] as const]),
        ...padEntries(node.pad),
        ...(node.claim === undefined ? [] : [['claim', node.claim] as const]),
      ],
      type: 'container',
    }
  }
  const rect = rects.get(node.id)
  Assert.input(rect !== undefined, `Studio Snap projection refers to an unknown rectangle: ${node.id}`)
  projectedRectIds.push(rect.id)
  const component = supportedComponent(rect)
  const argument = component === 'Placeholder'
    ? rect.content ?? rect.kind
    : rect.content ?? ''
  return {
    arguments: [argument],
    component,
    ...(rect.content === undefined ? {} : { content: rect.content }),
    layout: dimensionEntries(node.width, node.height, node.claim),
    rectId: rect.id,
    type: 'element',
  }
}

function supportedComponent(rect: StudioSketchRect): StudioSketchSnapElement['component'] {
  if (rect.kind === 'Text') {
    return 'Text'
  }
  if (rect.kind === 'Image' && rect.content !== undefined && rect.content.length > 0) {
    return 'Image'
  }
  return 'Placeholder'
}

function dimensionEntries(
  width: number | 'fill' | 'hug',
  height: number | 'fill' | 'hug',
  claim: 1 | undefined,
): readonly StudioLayoutEntry[] {
  Assert.input(
    (width === 'hug') === (height === 'hug'),
    'Studio Snap can only express hug sizing on both axes in the current Tao layout dialect.',
  )
  return [
    ...(width === 'hug' ? [] : [['width', width] as const]),
    ...(height === 'hug' ? [] : [['height', height] as const]),
    ...(width === 'hug' ? [['hug'] as const] : []),
    ...(claim === undefined ? [] : [['claim', claim] as const]),
  ]
}

function padEntries(
  pad: Readonly<{ bottom: number; left: number; right: number; top: number }>,
): readonly StudioLayoutEntry[] {
  if (pad.top === 0 && pad.right === 0 && pad.bottom === 0 && pad.left === 0) {
    return []
  }
  if (pad.top === pad.right && pad.top === pad.bottom && pad.top === pad.left) {
    return [['pad', pad.top]]
  }
  if (pad.top === pad.bottom && pad.left === pad.right) {
    return [['pad', 'horizontal', pad.left, 'vertical', pad.top]]
  }
  return [['pad', 'top', pad.top, 'right', pad.right, 'bottom', pad.bottom, 'left', pad.left]]
}
