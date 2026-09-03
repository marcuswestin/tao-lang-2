import { Describe, Expect, Test } from '@shared/test'
import type { StudioSourceActionProposal, StudioSourceActionResult } from '../studio-src/StudioProjectSession'
import type { StudioSketchProjectionResult } from '../studio-src/StudioSketchProjection'
import { StudioSketchSnap, type StudioSketchSnapTransport } from '../studio-src/StudioSketchSnap'

const projection: StudioSketchProjectionResult = {
  needsOverlay: false,
  tree: {
    children: [
      { height: 'hug', id: 'cover', type: 'element', width: 'hug' },
      {
        children: [
          { height: 'hug', id: 'title', type: 'element', width: 'hug' },
          { height: 'hug', id: 'subtitle', type: 'element', width: 'hug' },
        ],
        direction: 'Col',
        gap: 4,
        pad: { bottom: 0, left: 0, right: 0, top: 0 },
        type: 'container',
      },
      { claim: 1, height: 20, id: 'duration', type: 'element', width: 38 },
    ],
    direction: 'Row',
    gap: 12,
    pad: { bottom: 8, left: 12, right: 12, top: 8 },
    type: 'container',
  },
}

const rects = [
  { content: './cover.png', height: 52, id: 'cover', kind: 'Image', width: 52, x: 12, y: 8 },
  { content: 'Night Drive', height: 20, id: 'title', kind: 'Text', width: 90, x: 76, y: 12 },
  { content: 'The Signals', height: 20, id: 'subtitle', kind: 'Text', width: 72, x: 76, y: 36 },
  { content: '3:42', height: 20, id: 'duration', kind: 'Text', width: 38, x: 310, y: 28 },
  { content: 'free', height: 20, id: 'unsnapped', kind: 'Text', width: 40, x: 20, y: 100 },
] as const

Describe('Studio sketch Snap source projection', () => {
  Test('builds deterministic minimal flowed Tao and retains only projected rectangle identities', () => {
    const prepared = StudioSketchSnap.prepare({
      expectedCatalogRevision: 7,
      mergeDirection: 'Row',
      projection,
      rects,
      sketchId: 'playlist-row',
      viewName: 'View4',
    })

    Expect(prepared.projectedRectIds).toEqual(['cover', 'title', 'subtitle', 'duration'])
    Expect(prepared.projectedRectIds).not.toContain('unsnapped')
    Expect(prepared.action).toMatchObject({
      expectedCatalogRevision: 7,
      kind: 'snap-sketch-to-flow',
      mergeDirection: 'Row',
      mergePosition: 'after',
      rectIds: ['cover', 'title', 'subtitle', 'duration'],
      sketchId: 'playlist-row',
      viewName: 'View4',
    })
    Expect(prepared.action.tree).toMatchObject({
      children: [
        { arguments: ['./cover.png'], component: 'Image', rectId: 'cover' },
        { direction: 'Col' },
        { arguments: ['3:42'], component: 'Text', rectId: 'duration' },
      ],
      direction: 'Row',
    })
  })

  Test('uses Placeholder for open or incomplete element kinds without trusting raw Tao source', () => {
    const prepared = StudioSketchSnap.prepare({
      expectedCatalogRevision: 0,
      mergeDirection: 'Row',
      projection: {
        needsOverlay: false,
        tree: { height: 30, id: 'custom', type: 'element', width: 'fill' },
      },
      rects: [{ content: 'Profile', height: 30, id: 'custom', kind: 'Avatar', width: 80, x: 0, y: 0 }],
      sketchId: 'profile',
      viewName: 'View1',
    })

    Expect(prepared.action).not.toHaveProperty('source')
  })

  Test('routes overlap through the existing canonical proposal and preserves the exact diff', async () => {
    const prepared = StudioSketchSnap.prepare({
      expectedCatalogRevision: 7,
      mergeDirection: 'Row',
      projection: { ...projection, needsOverlay: true },
      rects,
      sketchId: 'playlist-row',
      viewName: 'View4',
    })
    const calls: Array<{ action: unknown; route: string }> = []
    const proposal = sourceProposal('canonical server diff')
    const result = await StudioSketchSnap.submit({
      checkpointId: 'snap-playlist-row',
      identity: identity(),
      prepared,
      requestId: 'snap-request',
      transport: {
        async apply(envelope) {
          calls.push({ action: envelope.action, route: 'apply' })
          return sourceResult()
        },
        async propose(envelope) {
          calls.push({ action: envelope.action, route: 'propose' })
          return proposal
        },
      },
    })

    Expect(result).toEqual({
      kind: 'proposal',
      projectedRectIds: ['cover', 'title', 'subtitle', 'duration'],
      proposal,
    })
    Expect(calls).toEqual([{ action: prepared.action, route: 'propose' }])
  })

  Test('uses the identical canonical action for direct apply, proposal, and confirmed mutation', async () => {
    const direct = StudioSketchSnap.prepare({
      expectedCatalogRevision: 7,
      mergeDirection: 'Row',
      projection,
      rects,
      sketchId: 'playlist-row',
      viewName: 'View4',
    })
    const proposed = StudioSketchSnap.prepare({
      expectedCatalogRevision: 7,
      mergeDirection: 'Row',
      projection: { ...projection, needsOverlay: true },
      rects,
      sketchId: 'playlist-row',
      viewName: 'View4',
    })
    const actions: unknown[] = []
    const transport: StudioSketchSnapTransport = {
      async apply(envelope) {
        actions.push(envelope.action)
        return sourceResult()
      },
      async propose(envelope) {
        actions.push(envelope.action)
        return sourceProposal('diff')
      },
    }
    const before = JSON.stringify({ projection, rects })

    const applied = await StudioSketchSnap.submit({
      checkpointId: 'direct',
      identity: identity(),
      prepared: direct,
      requestId: 'direct-request',
      transport,
    })
    const proposalResult = await StudioSketchSnap.submit({
      checkpointId: 'proposal',
      identity: identity(),
      prepared: proposed,
      requestId: 'proposal-request',
      transport,
    })
    const confirmed = await StudioSketchSnap.submit({
      checkpointId: 'proposal',
      confirmed: true,
      identity: identity(),
      prepared: proposed,
      requestId: 'proposal-request',
      transport,
    })

    Expect(applied.kind).toBe('applied')
    Expect(proposalResult.kind).toBe('proposal')
    Expect(confirmed.kind).toBe('applied')
    if (proposalResult.kind === 'proposal' && confirmed.kind === 'applied') {
      Expect(confirmed.result.content).toBe(proposalResult.proposal.content)
    }
    Expect(proposed.action).toEqual(direct.action)
    Expect(actions).toEqual([direct.action, proposed.action, proposed.action])
    Expect(JSON.stringify({ projection, rects })).toBe(before)
  })

  Test('rejects a projection that refers to an unselected or duplicate rectangle', () => {
    Expect(() =>
      StudioSketchSnap.prepare({
        expectedCatalogRevision: 1,
        mergeDirection: 'Row',
        projection: { needsOverlay: false, tree: { height: 10, id: 'missing', type: 'element', width: 10 } },
        rects,
        sketchId: 'playlist-row',
        viewName: 'View4',
      })
    ).toThrow('Studio Snap projection refers to an unknown rectangle: missing')
    Expect(() =>
      StudioSketchSnap.prepare({
        expectedCatalogRevision: 1,
        mergeDirection: 'Row',
        projection: {
          needsOverlay: false,
          tree: {
            children: [
              { height: 'hug', id: 'title', type: 'element', width: 'hug' },
              { height: 'hug', id: 'title', type: 'element', width: 'hug' },
            ],
            direction: 'Row',
            gap: 0,
            pad: { bottom: 0, left: 0, right: 0, top: 0 },
            type: 'container',
          },
        },
        rects,
        sketchId: 'playlist-row',
        viewName: 'View4',
      })
    ).toThrow('A Studio Snap projection cannot contain the same rectangle more than once.')
  })
})

function identity() {
  return {
    appName: 'Playlist',
    path: '@app/View4.tao',
    previewInstanceId: 'preview-1',
    project: '/project',
    sourceVersion: 'source-1',
  }
}

function sourceProposal(diff: string): StudioSourceActionProposal {
  return {
    content: 'canonical content',
    diff,
    edits: [{ end: 1, replacement: 'canonical content', start: 0 }],
    path: '@app/View4.tao',
    proposedSourceVersion: 'source-2',
    requestId: 'snap-request',
    sourceVersion: 'source-1',
  }
}

function sourceResult(): StudioSourceActionResult {
  return {
    checkpoint: { id: 'snap', status: 'committed' },
    compile: {
      causes: ['studio-write'],
      changes: [{ path: '@app/View4.tao', sourceVersion: 'source-2' }],
      compileRevision: 1,
      diagnostics: [],
      message: 'Compiled',
      status: 'compiled',
    },
    content: 'canonical content',
    edits: [{ end: 1, replacement: 'canonical content', start: 0 }],
    path: '@app/View4.tao',
    requestId: 'snap-request',
    sourceVersion: 'source-2',
  }
}
