import { Errors } from '@shared/core'
import { Describe, Expect, Test, until } from '@shared/test'
import { studioPreviewMessageListener } from '../studio-src/client/app/StudioPreviewWiring'
import { StudioSketchFeedTarget } from '../studio-src/client/matrix/StudioMatrixSketches'
import { handlePreviewMessage } from '../studio-src/client/matrix/StudioPreviewBridge'
import type { StudioPreviewConnection } from '../studio-src/client/matrix/StudioPreviewConnection'
import type { StudioHandshake } from '../studio-src/client/StudioApiClient'
import {
  type StudioPreviewFeedDropMessage,
  studioProtocolChannel,
  studioProtocolVersion,
} from '../studio-src/StudioProtocol'
import type { StudioSketchCatalogSnapshot } from '../studio-src/StudioSketchCatalog'

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
