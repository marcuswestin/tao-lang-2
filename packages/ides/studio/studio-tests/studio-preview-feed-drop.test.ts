import { Errors } from '@shared/core'
import { Describe, Expect, Test, testOverrideSlot, until } from '@shared/test'
import { studioPreviewMessageListener } from '../studio-src/client/app/StudioPreviewWiring'
import { StudioSketchFeedTarget } from '../studio-src/client/matrix/StudioMatrixSketches'
import { handlePreviewMessage } from '../studio-src/client/matrix/StudioPreviewBridge'
import { postDesignPadding } from '../studio-src/client/matrix/StudioPreviewBridge'
import type { StudioPreviewConnection } from '../studio-src/client/matrix/StudioPreviewConnection'
import { StudioApiClient, type StudioHandshake } from '../studio-src/client/StudioApiClient'
import {
  type StudioDesignPaddingUpdate,
  type StudioPreviewFeedDropMessage,
  studioProtocolChannel,
  studioProtocolVersion,
} from '../studio-src/StudioProtocol'
import type { StudioSketchCatalogSnapshot } from '../studio-src/StudioSketchCatalog'

const mutableStudioApiClient = StudioApiClient as unknown as {
  previewPaint: typeof StudioApiClient.previewPaint
}
const previewPaintSlot = testOverrideSlot({
  read: () => mutableStudioApiClient.previewPaint,
  write: (value: typeof mutableStudioApiClient.previewPaint) => {
    mutableStudioApiClient.previewPaint = value
  },
})
const previewLayoutMeasurementsSlot = testOverrideSlot({
  read: () => StudioApiClient.previewLayoutMeasurements,
  write: value => {
    ;(StudioApiClient as { previewLayoutMeasurements: typeof value }).previewLayoutMeasurements = value
  },
})

Describe('Studio iframe Feed drops', () => {
  Test('routes current field and collection drops to the exact normalized snapped target', async () => {
    const { message, preview, event, handshake } = fixture()
    const calls: unknown[] = []
    let activated = 0
    const actions = {
      focus: () => {
        activated++
      },
      async applySourceAction() {},
      async feedDrop(drop: StudioPreviewFeedDropMessage) {
        calls.push({ ...StudioSketchFeedTarget.resolve(catalog, '/workspace', drop), drop: drop.drop })
      },
      inspect() {},
    }
    await handlePreviewMessage(event(message), preview, handshake, async () => undefined, actions)
    await handlePreviewMessage(
      event({ ...message, drop: { entity: 'Task', kind: 'collection', path: ['Children'], rowId: 'feed_1' } }),
      preview,
      handshake,
      async () => undefined,
      actions,
    )
    Expect(calls).toEqual([
      {
        drop: { entity: 'Task', kind: 'field', path: ['Title'], presentation: 'text', rowId: 'feed_1' },
        rectId: 'r',
        sketchId: 'sketch1',
      },
      {
        drop: { entity: 'Task', kind: 'collection', path: ['Children'], rowId: 'feed_1' },
        rectId: 'r',
        sketchId: 'sketch1',
      },
    ])
    // Switching the focused preview refreshes Feed and would invalidate the drag's row registry.
    Expect(activated).toBe(0)
  })

  Test('rejects stale exact identities and run-mode drops without forwarding mutations', async () => {
    const { message, preview, event, handshake } = fixture()
    const calls: unknown[] = []
    const actions = {
      async applySourceAction() {},
      async feedDrop(drop: StudioPreviewFeedDropMessage) {
        calls.push(drop)
      },
      inspect() {},
    }
    for (
      const identity of [
        { ...message.identity, cellId: 'other' },
        { ...message.identity, cellRevision: 9 },
        { ...message.identity, compileRevision: 9 },
        { ...message.identity, manifestRevision: 'old' },
      ]
    ) {
      await Expect(
        handlePreviewMessage(event({ ...message, identity }), preview, handshake, async () => undefined, actions),
      ).rejects.toThrow('outdated preview')
    }
    preview.interactionMode = 'run'
    await Expect(handlePreviewMessage(event(message), preview, handshake, async () => undefined, actions)).rejects
      .toThrow('Edit mode')
    Expect(calls).toEqual([])
  })

  Test('reports only current child paint acknowledgements for revisions Studio sent', async () => {
    const { preview, handshake } = fixture()
    preview.activated = true
    preview.expectedRevision = 1
    const reports: Array<{ painted?: boolean; revision: number }> = []
    const sent: unknown[] = []
    ;(preview.iframe.contentWindow as unknown as { postMessage(message: unknown, targetOrigin: string): void })
      .postMessage = (message, targetOrigin) => sent.push({ message, targetOrigin })
    const restore = previewPaintSlot.install(async message => {
      reports.push({ painted: message.painted, revision: message.paintRevision })
      return { accepted: true }
    })
    const experimentalHandshake = { ...handshake, previewPaint: true as const }
    const window = preview.iframe.contentWindow
    const identity = { ...preview.cellIdentity!, previewInstanceId: preview.previewInstanceId }
    const padding = (revision: number): StudioDesignPaddingUpdate => ({
      bundleName: 'surface',
      designName: 'Theme',
      sourcePath: '/project/Design.tao',
      entryIndex: 0,
      ownerKind: 'styles',
      oldLiteralRange: { from: 10, to: 12 },
      newLiteralRange: { from: 10, to: 12 },
      oldSpecRange: { from: 5, to: 20 },
      newSpecRange: { from: 5, to: 20 },
      expectedPadding: 12,
      padding: 16,
      revision,
    })
    const painted = (revision: number, acknowledgedIdentity = identity, didPaint = true) =>
      ({
        data: {
          channel: studioProtocolChannel,
          identity: acknowledgedIdentity,
          painted: didPaint,
          paintRevision: revision,
          protocolVersion: studioProtocolVersion,
          type: 'preview-painted',
        },
        origin: preview.origin,
        source: window,
      }) as unknown as MessageEvent
    const handle = (event: MessageEvent) =>
      handlePreviewMessage(
        event,
        preview,
        experimentalHandshake,
        async () => undefined,
        { async applySourceAction() {}, inspect() {} },
      )
    try {
      postDesignPadding(preview, experimentalHandshake, padding(8))
      Expect(sent).toMatchObject([{
        message: { revision: 8, type: 'design-padding' },
        targetOrigin: preview.origin,
      }])
      await handle({ ...painted(8), origin: 'https://wrong.test' } as MessageEvent)
      await handle({ ...painted(8), source: {} } as MessageEvent)
      await handle(painted(8, { ...identity, previewInstanceId: 'old-preview' }))
      await handle(painted(7))
      Expect(reports).toEqual([])
      await handle(painted(8))
      await handle(painted(8))
      postDesignPadding(preview, experimentalHandshake, padding(9))
      await handle(painted(9, identity, false))
      Expect(reports).toEqual([{ painted: true, revision: 8 }, { painted: false, revision: 9 }])
    } finally {
      restore()
    }
  })

  Test('publishes and authenticates whole-app experimental paint acknowledgements', async () => {
    const { preview, handshake } = fixture()
    preview.cellIdentity = undefined
    preview.activated = true
    preview.expectedRevision = 6
    preview.previewInstanceId = 'whole-app-preview'
    const experimentalHandshake = { ...handshake, previewPaint: true as const }
    const sent: unknown[] = []
    const reports: Array<{ painted?: boolean; revision: number }> = []
    const window = preview.iframe.contentWindow
    ;(window as unknown as { postMessage(message: unknown, targetOrigin: string): void }).postMessage = (
      message,
      targetOrigin,
    ) => sent.push({ message, targetOrigin })
    const restore = previewPaintSlot.install(async message => {
      reports.push({ painted: message.painted, revision: message.paintRevision })
      return { accepted: true }
    })
    const identity = {
      appName: 'Garden',
      compileRevision: 6,
      previewInstanceId: 'whole-app-preview',
      project: '/workspace',
    }
    const painted = (ackIdentity = identity) =>
      ({
        data: {
          channel: studioProtocolChannel,
          identity: ackIdentity,
          painted: true,
          paintRevision: 8,
          protocolVersion: studioProtocolVersion,
          type: 'preview-painted',
        },
        origin: preview.origin,
        source: window,
      }) as unknown as MessageEvent
    const receive = (event: MessageEvent) =>
      handlePreviewMessage(event, preview, experimentalHandshake, async () => undefined, {
        async applySourceAction() {},
        inspect() {},
      })
    try {
      postDesignPadding(preview, experimentalHandshake, {
        bundleName: 'surface',
        designName: 'Theme',
        entryIndex: 0,
        expectedPadding: 12,
        newLiteralRange: { from: 10, to: 12 },
        newSpecRange: { from: 5, to: 20 },
        oldLiteralRange: { from: 10, to: 12 },
        oldSpecRange: { from: 5, to: 20 },
        ownerKind: 'styles',
        padding: 16,
        revision: 8,
        sourcePath: '/project/Design.tao',
      })
      Expect(sent).toMatchObject([{
        message: { identity, revision: 8, type: 'design-padding' },
        targetOrigin: preview.origin,
      }])
      await receive(painted({ ...identity, appName: 'Other' }))
      await receive(painted({ ...identity, compileRevision: 5 }))
      await receive({ ...painted(), origin: 'https://wrong.test' } as MessageEvent)
      await receive({ ...painted(), source: {} } as MessageEvent)
      Expect(reports).toEqual([])
      await receive(painted())
      await receive(painted())
      Expect(reports).toEqual([{ painted: true, revision: 8 }])
    } finally {
      restore()
    }
  })

  Test('keeps whole-app layout measurements local and posts complete cell measurements', async () => {
    const { preview: wholeApp, handshake } = fixture()
    wholeApp.cellIdentity = undefined
    wholeApp.expectedRevision = 4
    wholeApp.previewInstanceId = 'whole-app-preview'
    const wholeWindow = wholeApp.iframe.contentWindow!
    const wholeIdentity = {
      appName: 'Garden',
      previewInstanceId: 'whole-app-preview',
      project: '/workspace',
    }
    const wholeMeasurements = {
      channel: studioProtocolChannel,
      identity: wholeIdentity,
      measurements: [{ elementName: 'Text', renderId: 'whole', rect: { height: 20, width: 40, x: 10, y: 30 } }],
      protocolVersion: studioProtocolVersion,
      type: 'preview-layout-measurements',
    }
    const cell = fixture()
    const cellMeasurements = {
      ...wholeMeasurements,
      identity: { ...cell.preview.cellIdentity!, previewInstanceId: cell.preview.previewInstanceId },
      measurements: [{ elementName: 'Text', renderId: 'cell', rect: { height: 25, width: 45, x: 15, y: 35 } }],
    }
    const posts: unknown[] = []
    let localUpdates = 0
    const restore = previewLayoutMeasurementsSlot.install(async message => {
      posts.push(message)
      return { accepted: true }
    })
    const receive = (
      target: StudioPreviewConnection,
      contentWindow: object,
      data: unknown,
    ) =>
      handlePreviewMessage(
        { data, origin: target.origin, source: contentWindow } as MessageEvent,
        target,
        handshake,
        async () => undefined,
        { async applySourceAction() {}, inspect() {}, layoutMeasured: () => localUpdates++ },
      )
    try {
      await receive(wholeApp, wholeWindow, wholeMeasurements)
      Expect(wholeApp.layoutMeasurements).toEqual(wholeMeasurements)
      Expect(localUpdates).toBe(1)
      Expect(posts).toEqual([])
      await receive(cell.preview, cell.preview.iframe.contentWindow!, cellMeasurements)
      Expect(cell.preview.layoutMeasurements).toEqual(cellMeasurements)
      Expect(localUpdates).toBe(2)
      Expect(posts).toEqual([cellMeasurements])
    } finally {
      restore()
    }
  })

  Test('requires matching rectangle, render range, path, version and a unique catalog target', () => {
    const { message } = fixture()
    for (
      const altered of [
        { ...message, studioRectId: undefined },
        { ...message, studioRectId: 'other' },
        { ...message, renderId: '/workspace/@/studio/View1.tao:11:20' },
        { ...message, identity: { ...message.identity, path: '/workspace/@/studio/View2.tao' } },
        { ...message, identity: { ...message.identity, sourceVersion: 'old' } },
      ]
    ) {
      Expect(() => StudioSketchFeedTarget.resolve(catalog, '/workspace', altered)).toThrow()
    }
    Expect(() =>
      StudioSketchFeedTarget.resolve(
        { ...catalog, sketches: [...catalog.sketches, { ...catalog.sketches[0]!, id: 'duplicate' }] },
        '/workspace',
        message,
      )
    ).toThrow('target changed')
  })

  Test('ignores wrong origins and reports rejected connected drops through the existing status element', async () => {
    const { message, preview, event, handshake } = fixture()
    const calls: unknown[] = []
    await handlePreviewMessage(
      { ...event(message), origin: 'https://untrusted.test' } as MessageEvent,
      preview,
      handshake,
      async () => undefined,
      {
        async applySourceAction() {},
        async feedDrop(drop) {
          calls.push(drop)
        },
        inspect() {},
      },
    )
    Expect(calls).toEqual([])
    const status = { dataset: {}, textContent: '' } as unknown as HTMLElement
    const listener = studioPreviewMessageListener(
      {
        focusedPreview: { focus() {} },
        drawer: {},
        handshake,
        inspection: {},
        mutations: {},
        onFeedDrop: async () => Errors.throwUserInput('The snapped rectangle changed.'),
        previews: [preview],
        session: {},
        status,
      } as unknown as Parameters<typeof studioPreviewMessageListener>[0],
    )
    listener(event(message))
    await until(() => status.dataset['state'] === 'error', {
      description: 'the rejected Feed drop to reach the status line',
      intervalMs: 0,
    })
    Expect(status.textContent).toBe('The snapped rectangle changed.')
  })
})

const catalog: StudioSketchCatalogSnapshot = {
  formatVersion: 1,
  nextViewNumber: 2,
  revision: 1,
  sketches: [{
    height: 100,
    id: 'sketch1',
    name: 'Sketch',
    project: '/workspace',
    rectOrder: ['r'],
    rects: [],
    snapped: [{
      rect: { height: 10, id: 'r', kind: 'Text', width: 30, x: 0, y: 0 },
      target: {
        elementName: 'Text',
        path: '@/studio/./View1.tao',
        renderId: '@/studio/View1.tao:10:20',
        sourceVersion: 'source-1',
        studioRectId: 'r',
        view: 'View1',
      },
    }],
    view: 'View1',
    width: 100,
    x: 0,
    y: 0,
  }],
}

function fixture() {
  const contentWindow = {}
  const preview: StudioPreviewConnection = {
    cellIdentity: {
      appName: 'Garden',
      cellId: 'cell1',
      cellRevision: 0,
      compileRevision: 1,
      manifestRevision: 'manifest1',
      project: '/workspace',
    },
    iframe: { contentWindow } as HTMLIFrameElement,
    interactionMode: 'edit',
    origin: 'http://127.0.0.1:56102',
    previewInstanceId: 'preview1',
  }
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  const message: StudioPreviewFeedDropMessage = {
    channel: studioProtocolChannel,
    drop: { entity: 'Task', kind: 'field', path: ['Title'], presentation: 'text', rowId: 'feed_1' },
    identity: {
      ...preview.cellIdentity!,
      path: '/workspace/@/studio/View1.tao',
      previewInstanceId: 'preview1',
      sourceVersion: 'source-1',
    },
    protocolVersion: studioProtocolVersion,
    renderId: '/workspace/@/studio/View1.tao:10:20',
    studioRectId: 'r',
    type: 'preview-feed-drop',
  }
  const event = (data: StudioPreviewFeedDropMessage) =>
    ({ data, origin: preview.origin, source: contentWindow }) as unknown as MessageEvent
  return { event, handshake, message, preview }
}
