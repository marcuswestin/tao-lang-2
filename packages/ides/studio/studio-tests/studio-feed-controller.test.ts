import { Deferred, Describe, Expect, Test } from '@shared/test'
import { StudioFeedController, StudioFeedTransfer } from '../studio-src/client/StudioFeedController'
import type { StudioFeedItemId } from '../studio-src/StudioFeedInventory'
import type { StudioFeedActionRequest, StudioFeedBrowseResult, StudioFeedState } from '../studio-src/StudioFeedProtocol'

function inventory(): StudioFeedBrowseResult {
  return {
    catalog: { formatVersion: 1, nextViewNumber: 1, revision: 4, sketches: [] },
    canUndo: false,
    draftRevision: 0,
    pending: false,
    inventory: {
      entities: [{
        collection: 'Posts',
        name: 'Post',
        fields: [{ name: 'Title', optional: false, path: 'Title', type: { kind: 'scalar', scalar: 'text' } }],
        sources: [{
          kind: 'generated',
          issues: [],
          truncated: false,
          rows: [{
            fields: { Title: 'Hello' },
            id: 'row:1' as StudioFeedItemId,
            label: 'Example',
            source: { kind: 'generated', row: '1' },
          }],
        }],
      }],
    },
  }
}

Describe('Studio Feed controller', () => {
  Test('disposal ignores a late browse and refuses further Feed requests', async () => {
    const pending = Deferred<StudioFeedBrowseResult>()
    let browses = 0
    let mutations = 0
    let publications = 0
    const received: StudioFeedState[] = []
    const controller = new StudioFeedController({
      browse: async () => {
        browses++
        return await pending.promise
      },
      mutate: async () => {
        mutations++
        return inventory()
      },
      context: () => ({}),
      canMutate: () => true,
      publish: () => publications++,
      receive: state => received.push(state),
      requestId: () => 'disposed',
    })
    const refresh = controller.refresh()
    Expect(publications).toBe(1)
    controller.dispose()
    pending.resolve(inventory())
    await refresh
    await controller.refresh()
    await controller.execute('{"type":"discard"}')
    await controller.drop({ kind: 'entity', entity: 'Post', rowId: 'row:1' }, 'sketch:1')
    Expect(browses).toBe(1)
    Expect(mutations).toBe(0)
    Expect(received).toEqual([])
    Expect(publications).toBe(1)
  })

  Test('browses server rows and sends target-bound draft revisions through the mutation adapter', async () => {
    const requests: StudioFeedActionRequest[] = []
    const received: StudioFeedState[] = []
    let activeSketch = false
    const controller = new StudioFeedController({
      browse: async () => inventory(),
      mutate: async build => {
        const request = build(7)
        requests.push(request)
        return {
          ...inventory(),
          draftRevision: requests.length,
          pending: request.kind !== 'keep',
          rowId: 'row:1',
          sketchId: 'sketch:1',
        }
      },
      context: () => ({
        cellId: 'cell:1',
        focusedScenarioId: 'scenario:1',
        sketchId: activeSketch ? 'sketch:1' : undefined,
      }),
      canMutate: () => true,
      publish() {},
      receive: state => received.push(state),
      requestId: () => 'request:1',
    })
    await controller.refresh()
    await controller.execute('{"type":"select-source","source":"Generated"}')
    Expect(controller.panel().rows[0]?.fields).toEqual([
      { path: ['Title'], label: 'Title', value: 'Hello', presentation: 'text' },
      { path: ['Title'], label: 'Title (image)', value: 'Hello', presentation: 'image' },
    ])
    await controller.execute('{"type":"select-row","rowId":"row:1"}')
    Expect(controller.panel().selectedRowId).toBe('row:1')
    Expect(requests).toHaveLength(0)
    activeSketch = true
    await controller.drop({ kind: 'entity', entity: 'Post', rowId: 'row:1' }, 'sketch:1')
    Expect(requests[0]).toEqual({
      catalogRevision: 7,
      draftRevision: 0,
      requestId: 'request:1',
      kind: 'select',
      rowId: 'row:1',
      sketchId: 'sketch:1',
      cellId: 'cell:1',
    })
    Expect(controller.panel().canKeep).toBe(true)
    await controller.drop(
      { kind: 'field', entity: 'Post', rowId: 'row:1', path: ['Title'], presentation: 'text' },
      'sketch:1',
      'rect:1',
    )
    Expect(requests[1]).toMatchObject({
      kind: 'bind',
      draftRevision: 1,
      rectId: 'rect:1',
      path: ['Title'],
      presentation: 'text',
    })
    await controller.execute('{"type":"keep"}')
    Expect(requests[2]).toMatchObject({ kind: 'keep', draftRevision: 2 })
    Expect(controller.panel().canKeep).toBe(false)
    Expect(received).toHaveLength(5)
  })

  Test('refuses absent rows and field drops without rectangles with visible errors', async () => {
    let writes = 0
    const controller = new StudioFeedController({
      browse: async () => inventory(),
      mutate: async build => {
        build(4)
        writes++
        return inventory()
      },
      context: () => ({}),
      canMutate: () => true,
      publish() {},
      receive() {},
      requestId: () => 'request',
    })
    await controller.refresh()
    await controller.drop({ kind: 'entity', entity: 'Post', rowId: 'missing' }, 'sketch:1')
    Expect(controller.panel().error).toContain('no longer available')
    await controller.drop(
      { kind: 'field', entity: 'Post', rowId: 'row:1', path: ['Title'], presentation: 'text' },
      'sketch:1',
    )
    Expect(controller.panel().error).toContain('rectangle')
    Expect(writes).toBe(0)
    await controller.execute('{"type":"constructor"}')
    Expect(controller.panel().error).toContain('Unsupported')
  })

  Test('parses the two Feed drag shapes and rejects malformed field paths', () => {
    Expect(StudioFeedTransfer.parse('{"kind":"entity","entity":"Post","rowId":"r"}')).toEqual({
      kind: 'entity',
      entity: 'Post',
      rowId: 'r',
    })
    Expect(
      StudioFeedTransfer.parse('{"kind":"field","entity":"Post","rowId":"r","path":["Title"],"presentation":"image"}'),
    ).toMatchObject({ presentation: 'image', path: ['Title'] })
    Expect(() =>
      StudioFeedTransfer.parse('{"kind":"field","entity":"Post","rowId":"r","path":[],"presentation":"text"}')
    ).toThrow('field path')
  })
})

Test(
  'Feed applies the active sketch cell only when the dropped target matches and proposes collection loops',
  async () => {
    const requests: StudioFeedActionRequest[] = []
    const controller = new StudioFeedController({
      browse: async () => inventory(),
      mutate: async build => {
        requests.push(build(4))
        return { ...inventory(), pending: true, draftRevision: requests.length }
      },
      context: () => ({ cellId: 'cell:active', sketchId: 'sketch:active' }),
      canMutate: () => true,
      publish() {},
      receive() {},
      requestId: () => 'request',
    })
    await controller.refresh()
    await controller.drop({ kind: 'entity', entity: 'Post', rowId: 'row:1' }, 'sketch:other')
    Expect(requests[0]).not.toHaveProperty('cellId')
    await controller.drop({ kind: 'entity', entity: 'Post', rowId: 'row:1' }, 'sketch:active')
    Expect(requests[1]).toMatchObject({ cellId: 'cell:active', sketchId: 'sketch:active' })
    await controller.drop({ kind: 'collection', entity: 'Post', rowId: 'row:1', path: ['Comments'] }, 'sketch:active')
    Expect(requests[2]).toMatchObject({ kind: 'loop', path: ['Comments'], draftRevision: 2 })
    Expect(controller.panel().notice).toContain('Keep applies')
    Expect(StudioFeedTransfer.parse('{"kind":"collection","entity":"Post","rowId":"row:1","path":["Comments"]}'))
      .toEqual({ kind: 'collection', entity: 'Post', rowId: 'row:1', path: ['Comments'] })
  },
)

Test('Undo Keep is available as one saved unit and Live refreshes only when captured rows change', async () => {
  let browses = 0
  let liveRows = {}
  const requests: StudioFeedActionRequest[] = []
  let controller: StudioFeedController
  controller = new StudioFeedController({
    browse: async () => {
      browses++
      return { ...inventory(), canUndo: true }
    },
    mutate: async build => {
      requests.push(build(4))
      return { ...inventory(), canUndo: false }
    },
    context: () => ({ liveRows }),
    canMutate: () => true,
    publish: () => controller.liveChanged(),
    receive() {},
    requestId: () => 'undo-keep',
  })
  await controller.refresh()
  Expect(controller.panel().canUndo).toBe(true)
  await controller.execute('{"type":"undo"}')
  Expect(requests[0]).toEqual({ kind: 'undo', catalogRevision: 4, draftRevision: 0, requestId: 'undo-keep' })
  Expect(controller.panel().canUndo).toBe(false)
  await controller.execute('{"type":"select-source","source":"Live"}')
  const before = browses
  liveRows = { Post: [{ key: 'one', fields: { Title: 'Captured' } }] }
  controller.liveChanged()
  Expect(browses).toBe(before + 1)
  controller.liveChanged()
  Expect(browses).toBe(before + 1)
})

Test(
  'Discard remains available with dirty edits and invalidates an older browse without overlapping mutations',
  async () => {
    const staleBrowse = Deferred<StudioFeedBrowseResult>()
    const discard = Deferred<StudioFeedState>()
    const requests: StudioFeedActionRequest[] = []
    let browsing = false
    const controller = new StudioFeedController({
      browse: async () => browsing ? staleBrowse.promise : { ...inventory(), pending: true, draftRevision: 1 },
      mutate: async build => {
        requests.push(build(4))
        return await discard.promise
      },
      context: () => ({}),
      canMutate: () => false,
      publish() {},
      receive() {},
      requestId: () => 'discard',
    })
    await controller.refresh()
    browsing = true
    const refresh = controller.refresh()
    const cancelling = controller.execute('{"type":"discard"}')
    Expect(requests).toEqual([{ kind: 'discard', catalogRevision: 4, draftRevision: 1, requestId: 'discard' }])
    await controller.execute('{"type":"discard"}')
    Expect(requests).toHaveLength(1)
    discard.resolve({ ...inventory(), draftRevision: 2 })
    await cancelling
    staleBrowse.resolve({ ...inventory(), pending: true, draftRevision: 1 })
    await refresh
    Expect(controller.panel().canDiscard).toBe(false)
    Expect(controller.panel().loading).toBe(false)
  },
)

Test('Feed drop captures its target cell before queueing and an explicit cell wins for each action', async () => {
  const requests: StudioFeedActionRequest[] = []
  let cellId = 'cell:original'
  const controller = new StudioFeedController({
    browse: async () => inventory(),
    mutate: async build => {
      cellId = 'cell:changed'
      requests.push(build(4))
      return inventory()
    },
    context: () => ({ cellId, sketchId: 'sketch:active' }),
    canMutate: () => true,
    publish() {},
    receive() {},
    requestId: () => 'request',
  })
  await controller.refresh()
  await controller.drop({ kind: 'entity', entity: 'Post', rowId: 'row:1' }, 'sketch:active')
  Expect(requests[0]).toMatchObject({ cellId: 'cell:original' })
  await controller.drop({ kind: 'entity', entity: 'Post', rowId: 'row:1' }, 'sketch:active', undefined, 'cell:explicit')
  await controller.drop(
    { kind: 'field', entity: 'Post', rowId: 'row:1', path: ['Title'], presentation: 'text' },
    'sketch:active',
    'rect',
    'cell:explicit',
  )
  await controller.drop(
    { kind: 'collection', entity: 'Post', rowId: 'row:1', path: ['Comments'] },
    'sketch:active',
    undefined,
    'cell:explicit',
  )
  Expect(requests.slice(1).map(request => 'cellId' in request ? request.cellId : undefined)).toEqual([
    'cell:explicit',
    'cell:explicit',
    'cell:explicit',
  ])
})
