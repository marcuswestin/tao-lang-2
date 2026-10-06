import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { ReactNode } from 'react'
import { Debug } from '../TaoRuntime-src/TR-debug'
import { DesignControls } from '../TaoRuntime-src/TR-design'
import { HostEnvironmentError, UnexpectedBehaviorError, UserInputError } from '../TaoRuntime-src/TR-errors'
import { registerRuntimeCaptureDomain } from '../TaoRuntime-src/TR-runtime-capture'
import {
  collectStudioPreviewLayoutMeasurements,
  mountStudioPreviewBridge,
  publishStudioJourneyReplayResult,
  publishStudioScheme,
  replayStudioJourney,
  resolvedStudioStyle,
  StudioPreview,
  type StudioPreviewConfig,
  type StudioPreviewElement,
  type StudioPreviewHost,
} from '../TaoRuntime-src/TR-studio-preview'
import { parseTaoStudioFeedDrop, taoStudioFeedMime } from '../TaoRuntime-src/TR-studio-protocol'
import { Clock } from '../TaoRuntime-src/TR-units'

Describe('Studio cell publication bootstrap', () => {
  Test('bounds reloads per publication and clears a successful recovery', () => {
    const original = 'http://127.0.0.1:8081/?taoStudioCell=1'
    let current = original
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const retry = StudioPreview.Bootstrap.nextPublicationReload(current, 8)
      Expect(retry?.attempt).toBe(attempt)
      current = retry!.url
    }
    Expect(StudioPreview.Bootstrap.nextPublicationReload(current, 8)).toBe(undefined)
    Expect(StudioPreview.Bootstrap.nextPublicationReload(current, 9)?.attempt).toBe(1)
    Expect(StudioPreview.Bootstrap.clearPublicationRetry(current)).toBe(original)
    Expect(
      StudioPreview.Bootstrap.nextPublicationReload(
        StudioPreview.Bootstrap.clearPublicationRetry(current),
        8,
      )?.attempt,
    ).toBe(1)
  })

  Test('bounds server catch-up polling with a capped delay', () => {
    Expect(StudioPreview.Bootstrap.olderRetryDelay(1)).toBe(200)
    Expect(StudioPreview.Bootstrap.olderRetryDelay(5)).toBe(1_000)
    Expect(StudioPreview.Bootstrap.olderRetryDelay(30)).toBe(1_000)
    Expect(StudioPreview.Bootstrap.olderRetryDelay(31)).toBe(undefined)
  })

  Test('requests a fresh iframe bundle when the registered cell is newer than its publication', () => {
    const reloads: number[] = []
    const publication = { appName: 'Demo', compileRevision: 3, project: '/demo' }
    const runtime = { identity: { ...publication, compileRevision: 4 } }
    const outcome = StudioPreview.Bootstrap.reconcile(runtime, publication, revision => reloads.push(revision))
    Expect(outcome).toBe('newer')
    Expect(reloads).toEqual([4])
  })

  Test('applies only a matching cell and does not reload for an older response', () => {
    const reloads: number[] = []
    const publication = { appName: 'Demo', compileRevision: 4, project: '/demo' }
    const reconcile = (revision: number) =>
      StudioPreview.Bootstrap.reconcile(
        { identity: { ...publication, compileRevision: revision } },
        publication,
        newer => reloads.push(newer),
      )
    Expect(reconcile(3)).toBe('older')
    Expect(reconcile(4)).toBe('matched')
    Expect(reloads).toEqual([])
  })
})

type Listener = (event: unknown) => void

/** settled drains the microtask turns a queued action root takes to reach its first gate. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve()
  }
}

type PostedMessage = {
  message: unknown
  targetOrigin: string
}

type FakeOverlay = StudioPreviewElement & {
  attributes: Record<string, string>
  removed: boolean
  remove(): void
  setAttribute(name: string, value: string): void
  style: Record<string, string>
}

const config: StudioPreviewConfig = {
  appName: 'Demo',
  compileRevision: 7,
  parentOrigin: 'http://127.0.0.1:5500',
  previewInstanceId: 'preview-1',
  project: '/project',
  sourceVersions: { '/project/Main.tao': 'version-1' },
}

Describe('Studio preview runtime bridge', () => {
  Test('captures Feed drops on the nearest rendered leaf with trusted source identity and blocks app handlers', () => {
    const leaf = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 80 }, {
      studioRectId: 'title',
    })
    const nested = { ...leaf, closest: () => leaf, getAttribute: () => null }
    const fake = previewHost([leaf])
    const cleanup = mountStudioPreviewBridge({
      ...config,
      cellId: 'cell-1',
      cellRevision: 2,
      manifestRevision: 'manifest-1',
    }, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    let appEvents = 0
    let cancelled = 0
    fake.host.document.addEventListener('drop', () => {
      appEvents += 1
    })
    fake.host.document.addEventListener('pointerdown', () => {
      appEvents += 1
    })
    const drop = { entity: 'Playlist', kind: 'field', path: ['Title'], presentation: 'text', rowId: 'opaque-row' }
    const transfer = { dropEffect: 'none', getData: () => JSON.stringify(drop), types: [taoStudioFeedMime] }
    const event = {
      dataTransfer: transfer,
      preventDefault: () => {
        cancelled += 1
      },
      target: nested,
    }
    fake.dispatchDocument('dragover', event)
    Expect(transfer.dropEffect).toBe('copy')
    fake.dispatchDocument('pointerdown', { target: nested })
    fake.dispatchDocument('drop', event)
    const messages = fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-feed-drop')
    Expect(messages).toEqual([{
      message: {
        channel: 'tao-studio',
        drop,
        identity: {
          appName: 'Demo',
          cellId: 'cell-1',
          cellRevision: 2,
          compileRevision: 7,
          manifestRevision: 'manifest-1',
          occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
          path: '/project/Main.tao',
          previewInstanceId: 'preview-1',
          project: '/project',
          sourceVersion: 'version-1',
        },
        protocolVersion: 1,
        renderId: '/project/Main.tao:10:20',
        studioRectId: 'title',
        type: 'preview-feed-drop',
      },
      targetOrigin: config.parentOrigin,
    }])
    Expect(appEvents).toBe(0)
    Expect(cancelled).toBe(2)
    fake.dispatchDocument('drop', { target: nested, dataTransfer: { ...transfer, types: ['text/plain'] } })
    Expect(appEvents).toBe(1)
    cleanup()
  })

  Test('rejects malformed Feed data, stale source targets, Run mode, and active Space canvas gestures', () => {
    const leaf = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 80 })
    const stale = renderElement('/project/Removed.tao', 10, 20, { height: 20, left: 0, top: 0, width: 80 })
    const fake = previewHost([leaf, stale])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    const payload = { entity: 'Playlist', kind: 'collection', path: ['Tracks'], rowId: 'opaque-row' }
    const event = { target: leaf, dataTransfer: { getData: () => JSON.stringify(payload), types: [taoStudioFeedMime] } }
    for (
      const malformed of [
        'bad json',
        JSON.stringify({ ...payload, path: [] }),
        JSON.stringify({ ...payload, source: 'unsafe' }),
      ]
    ) {
      fake.dispatchDocument('drop', { ...event, dataTransfer: { ...event.dataTransfer, getData: () => malformed } })
    }
    fake.dispatchDocument('drop', { ...event, target: stale })
    fake.dispatchWindow('message', interactionModeMessage('run', fake.parent))
    fake.dispatchDocument('drop', event)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    fake.dispatchDocument('keydown', { key: ' ' })
    fake.dispatchDocument('dragover', event)
    fake.dispatchDocument('drop', event)
    Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-feed-drop')).toEqual([])
    fake.dispatchDocument('keyup', { key: ' ' })
    fake.dispatchDocument('drop', event)
    Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-feed-drop'))
      .toMatchObject([{ message: { drop: payload, renderId: '/project/Main.tao:10:20' } }])
    cleanup()
    Expect(fake.listenerCount()).toBe(0)
  })

  Test('resolves trusted parent Feed drops at iframe coordinates and rejects stale or inactive requests', () => {
    const leaf = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 30, top: 40, width: 80 }, {
      studioRectId: 'title',
    })
    const nested = { ...leaf, closest: () => leaf, getAttribute: () => null }
    const fake = previewHost([leaf])
    const hits: number[][] = []
    Object.assign(fake.host.document, {
      elementFromPoint: (x: number, y: number) => {
        hits.push([x, y])
        return x === 42 && y === 51 ? nested : null
      },
    })
    const cell = { cellId: 'cell-1', cellRevision: 2, compileRevision: 7, manifestRevision: 'manifest-1' }
    const cleanup = mountStudioPreviewBridge({ ...config, ...cell }, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    const message = {
      ...interactionModeMessage('edit', fake.parent),
      data: {
        channel: 'tao-studio',
        protocolVersion: 1,
        type: 'feed-drop-at-point',
        identity: {
          appName: config.appName,
          project: config.project,
          previewInstanceId: config.previewInstanceId,
          ...cell,
        },
        clientX: 42,
        clientY: 51,
        drop: { entity: 'Playlist', kind: 'field', path: ['Title'], presentation: 'text', rowId: 'opaque-row' },
      },
    }
    const drops = () => fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-feed-drop')
    fake.dispatchWindow('message', { ...message, origin: 'https://untrusted.test' })
    fake.dispatchWindow('message', { ...message, source: {} })
    for (
      const identity of [
        { ...message.data.identity, previewInstanceId: 'old-preview' },
        { ...message.data.identity, cellRevision: 1 },
        { ...message.data.identity, compileRevision: 6 },
        { ...message.data.identity, manifestRevision: 'old-manifest' },
      ]
    ) {
      fake.dispatchWindow('message', { ...message, data: { ...message.data, identity } })
    }
    for (
      const fields of [{ clientX: Number.NaN }, { clientY: Infinity }, { drop: { ...message.data.drop, path: [] } }]
    ) {
      fake.dispatchWindow('message', { ...message, data: { ...message.data, ...fields } })
    }
    fake.dispatchWindow('message', interactionModeMessage('run', fake.parent))
    fake.dispatchWindow('message', message)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    fake.dispatchDocument('keydown', { key: ' ' })
    fake.dispatchWindow('message', message)
    fake.dispatchDocument('keyup', { key: ' ' })
    Expect(hits).toEqual([])
    fake.dispatchWindow('message', { ...message, data: { ...message.data, clientX: 999 } })
    Expect(drops()).toEqual([])
    fake.dispatchDocument('click', { target: nested })
    const selections = () =>
      fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-select-source')
    Expect(selections()).toHaveLength(1)
    fake.dispatchWindow('message', message)
    Expect(hits).toEqual([[999, 51], [42, 51]])
    fake.dispatchDocument('click', { target: nested })
    Expect(selections()).toHaveLength(2)
    Expect(drops()).toMatchObject([{
      message: {
        drop: message.data.drop,
        identity: { ...message.data.identity, path: '/project/Main.tao', sourceVersion: 'version-1' },
        renderId: '/project/Main.tao:10:20',
        studioRectId: 'title',
      },
    }])
    cleanup()
  })

  Test('validates bounded Feed transfer payloads without carrying arbitrary fields', () => {
    const valid = {
      entity: 'Playlist',
      kind: 'field',
      path: ['Owner', 'Name'],
      presentation: 'text',
      rowId: 'opaque-row',
    }
    Expect(parseTaoStudioFeedDrop(valid)).toEqual(valid)
    for (
      const patch of [{ path: [] }, { path: ['not.a.path'] }, { rowId: '' }, { presentation: 'html' }, {
        arbitrary: true,
      }]
    ) {
      Expect(parseTaoStudioFeedDrop({ ...valid, ...patch })).toBeUndefined()
    }
  })

  Test('clears a caught preview failure when the reset key changes', () => {
    const child = { type: 'stateful-preview' } as unknown as ReactNode
    const Boundary = StudioPreview.ErrorBoundary
    const instance = new Boundary({ children: child, resetKey: 'revision-7' })
    const failure = new Error('render failed')
    instance.state = {
      ...instance.state,
      ...Boundary.getDerivedStateFromError(failure),
    }

    Expect(instance.render()).toMatchObject({ props: { error: failure } })

    const nextProps = { children: child, resetKey: 'revision-8' }
    const reset = Boundary.getDerivedStateFromProps(nextProps, instance.state)
    Expect(reset).toEqual({ error: undefined, resetKey: 'revision-8' })
    ;(instance as unknown as { props: typeof nextProps }).props = nextProps
    instance.state = { ...instance.state, ...reset }

    Expect(instance.render()).toBe(child)
    Expect(Boundary.getDerivedStateFromProps(nextProps, instance.state)).toBeNull()
  })

  Test('does not reset a caught preview failure until the reset key changes', () => {
    const Boundary = StudioPreview.ErrorBoundary
    const props = { children: 'healthy preview', resetKey: 'revision-7' }
    const instance = new Boundary(props)
    const failure = new Error('render failed')
    instance.state = {
      ...instance.state,
      ...Boundary.getDerivedStateFromError(failure),
    }

    Expect(Boundary.getDerivedStateFromProps(props, instance.state)).toBeNull()
    Expect(instance.render()).toMatchObject({ props: { error: failure } })
  })

  Test('collects finite signed render positions relative to the cell content root', () => {
    const measured = renderElement('/project/Main.tao', 10, 20, {
      height: 40,
      left: 25,
      top: 35,
      width: 80,
    }, { elementName: 'Text', studioRectId: 'art' })
    const outside = renderElement('/project/Main.tao', 30, 40, {
      height: 10,
      left: 5,
      top: 35,
      width: 10,
    }, { elementName: 'Button' })

    Expect(collectStudioPreviewLayoutMeasurements(
      [measured, outside],
      { height: 200, left: 10, top: 20, width: 200 },
    )).toEqual([{
      elementName: 'Text',
      rect: { height: 40, width: 80, x: 15, y: 15 },
      renderId: '/project/Main.tao:10:20',
      studioRectId: 'art',
      viewportRect: { height: 40, width: 80, x: 25, y: 35 },
    }, {
      elementName: 'Button',
      rect: { height: 10, width: 10, x: -5, y: 15 },
      renderId: '/project/Main.tao:30:40',
      viewportRect: { height: 10, width: 10, x: 5, y: 35 },
    }])
  })

  Test('retains a partially clipped nested-scroll row with a stationary body and rejects invalid geometry', () => {
    const row = { height: 20, width: 40, left: -3, top: -5 }
    const rectangles = [row, { ...row, height: -1 }, { ...row, width: -1 }, { ...row, top: Number.NaN }, {
      ...row,
      left: Number.POSITIVE_INFINITY,
    }]
    const elements = rectangles.map((rect, index) =>
      renderElement('/project/Main.tao', index * 10, index * 10 + 5, rect, { elementName: 'Text' })
    )
    Expect(collectStudioPreviewLayoutMeasurements(elements, { height: 200, width: 200, left: 0, top: 0 }))
      .toEqual([{
        elementName: 'Text',
        rect: { height: 20, width: 40, x: -3, y: -5 },
        renderId: '/project/Main.tao:0:5',
        viewportRect: { height: 20, width: 40, x: -3, y: -5 },
      }])
  })

  Test('coalesces layout reporting after apply and resize', async () => {
    const element = renderElement('/project/Main.tao', 10, 20, {
      height: 40,
      left: 25,
      top: 35,
      width: 80,
    }, { elementName: 'Text', studioRectId: 'art' })
    const fake = previewHost([element])
    fake.host.document.body = {
      appendChild: overlay => fake.overlays.push(overlay as FakeOverlay),
      getBoundingClientRect: () => ({ height: 200, left: 10, top: 20, width: 200 }),
    }
    const cleanup = mountStudioPreviewBridge(config, fake.host)

    await Promise.resolve()
    Expect(fake.messages[1]?.message).toMatchObject({
      measurements: [{
        elementName: 'Text',
        rect: { height: 40, width: 80, x: 15, y: 15 },
        renderId: '/project/Main.tao:10:20',
        studioRectId: 'art',
      }],
      type: 'preview-layout-measurements',
    })
    fake.dispatchWindow('resize', {})
    fake.dispatchWindow('resize', {})
    await Promise.resolve()
    Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-layout-measurements'))
      .toHaveLength(2)
    cleanup()
  })

  Test('refreshes viewport geometry on nested and root scroll and before publishing a selection', async () => {
    const rect = { height: 20, width: 40, left: 25, top: 35 }
    const element = renderElement('/project/Main.tao', 10, 20, rect, { elementName: 'Text' })
    const fake = previewHost([element])
    const rootRect = { height: 200, width: 200, left: 10, top: 20 }
    fake.host.document.body = {
      appendChild: overlay => fake.overlays.push(overlay as FakeOverlay),
      getBoundingClientRect: () => rootRect,
    }
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    const layoutMessages = () =>
      fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-layout-measurements')
    await Promise.resolve()
    Expect(layoutMessages()).toHaveLength(1)
    Object.assign(rootRect, { left: -30, top: -50 })
    Object.assign(rect, { left: -15, top: -20 })
    fake.dispatchDocument('scroll', { target: element })
    fake.dispatchDocument('scroll', { target: element })
    await Promise.resolve()
    Expect(layoutMessages()).toHaveLength(2)
    Expect(layoutMessages().at(-1)?.message).toMatchObject({
      measurements: [{
        rect: { height: 20, width: 40, x: 15, y: 30 },
        viewportRect: { height: 20, width: 40, x: -15, y: -20 },
      }],
    })
    Object.assign(rect, { top: 10 })
    fake.dispatchWindow('scroll', {})
    fake.dispatchDocument('scroll', {})
    await Promise.resolve()
    Expect(layoutMessages()).toHaveLength(3)
    Expect(layoutMessages().at(-1)?.message).toMatchObject({
      measurements: [{ viewportRect: { height: 20, width: 40, x: -15, y: 10 } }],
    })
    Object.assign(rect, { left: -5, top: -10 })
    fake.dispatchDocument('scroll', { target: element })
    fake.dispatchDocument('click', { target: element })
    Expect(fake.messages.slice(-2).map(post => (post.message as { type: string }).type))
      .toEqual(['preview-layout-measurements', 'preview-select-source'])
    Expect(layoutMessages()).toHaveLength(4)
    Expect(layoutMessages().at(-1)?.message).toMatchObject({
      measurements: [{
        rect: { height: 20, width: 40, x: 25, y: 40 },
        viewportRect: { height: 20, width: 40, x: -5, y: -10 },
      }],
    })
    await Promise.resolve()
    Expect(layoutMessages()).toHaveLength(4)
    cleanup()
    fake.dispatchDocument('scroll', {})
    fake.dispatchWindow('scroll', {})
    await Promise.resolve()
    Expect(layoutMessages()).toHaveLength(4)
  })

  Test('shift-click groups elements from one file; ⌘G, ⌥⌘G and ⌘Z ask Studio to make a view, group, or undo', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 20 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 30, top: 0, width: 20 })
    const fake = previewHost([first, second])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    const posted = (type: string) => fake.messages.filter(post => (post.message as { type?: string }).type === type)
    const selectG = (modifiers: Record<string, boolean | string>) =>
      fake.dispatchDocument('keydown', {
        code: 'KeyG',
        key: 'g',
        metaKey: true,
        preventDefault: () => {},
        ...modifiers,
      })
    selectG({})
    Expect(posted('preview-canvas-shortcut')).toHaveLength(0)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchDocument('click', { target: first })
    fake.dispatchDocument('click', { shiftKey: true, target: second })
    const selections = posted('preview-select-source').map(post => post.message as { additive?: true })
    Expect(selections.map(message => message.additive)).toEqual([undefined, true])
    const outlines = () => fake.overlays.filter(overlay => !overlay.removed).map(overlay => overlay.attributes)
    Expect(outlines()).toEqual([
      { 'data-tao-studio-overlay': 'selection' },
      { 'data-tao-studio-overlay': 'selection-group' },
    ])
    selectG({})
    // ⌥ types a symbol, so only then does the physical key name the letter.
    selectG({ altKey: true, key: '©' })
    fake.dispatchDocument('keydown', { code: 'KeyZ', key: 'z', metaKey: true, preventDefault: () => {} })
    fake.dispatchDocument('keydown', {
      code: 'KeyZ',
      key: 'z',
      metaKey: true,
      preventDefault: () => {},
      shiftKey: true,
    })
    // Otherwise the letter follows the keyboard layout: Dvorak's physical KeyG types "i".
    selectG({ key: 'i' })
    fake.dispatchDocument('keydown', { code: 'KeyY', key: 'z', metaKey: true, preventDefault: () => {} })
    Expect(posted('preview-canvas-shortcut').map(post => (post.message as { command: string }).command))
      .toEqual(['make-view', 'group', 'undo', 'undo'])
    fake.dispatchDocument('click', { shiftKey: true, target: second })
    Expect(outlines()).toEqual([{ 'data-tao-studio-overlay': 'selection' }])
    fake.dispatchDocument('click', { shiftKey: true, target: first })
    Expect(outlines()).toEqual([{ 'data-tao-studio-overlay': 'selection' }])
    cleanup()
  })

  Test('shows a pointer over selectable elements only while in edit mode', () => {
    const fake = previewHost([])
    const head: FakeOverlay[] = []
    fake.host.document.head = { appendChild: element => head.push(element as FakeOverlay) }
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    const cursors = () => head.filter(element => !element.removed)
    Expect(cursors()).toHaveLength(0)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    Expect(cursors()).toHaveLength(1)
    Expect(cursors()[0]?.textContent).toContain('cursor: pointer')
    fake.dispatchWindow('message', interactionModeMessage('run', fake.parent))
    Expect(cursors()).toHaveLength(0)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    cleanup()
    Expect(cursors()).toHaveLength(0)
  })

  Test('drops its selection outlines when Studio says a plain pick started a selection in another cell', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 20 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 30, top: 0, width: 20 })
    const fake = previewHost([first, second])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    // The single-element outline is hidden rather than removed once nothing is selected.
    const outlines = () =>
      fake.overlays
        .filter(overlay => !overlay.removed && overlay.style['display'] !== 'none')
        .map(overlay => overlay.attributes)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchDocument('click', { target: first })
    fake.dispatchDocument('click', { shiftKey: true, target: second })
    Expect(outlines()).toHaveLength(2)

    // A clear for some other preview instance is not this cell's.
    const clear = clearSelectionMessage(fake.parent)
    fake.dispatchWindow('message', {
      ...clear,
      data: { ...clear.data, identity: { ...clear.data['identity'] as object, previewInstanceId: 'other' } },
    })
    Expect(outlines()).toHaveLength(2)
    fake.dispatchWindow('message', clear)
    Expect(outlines()).toEqual([])

    // With nothing selected, ⌘G has nothing to act on; the next shift-click starts afresh.
    fake.dispatchDocument('keydown', { code: 'KeyG', key: 'g', metaKey: true, preventDefault: () => {} })
    Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-canvas-shortcut'))
      .toHaveLength(0)
    fake.dispatchDocument('click', { shiftKey: true, target: second })
    Expect(outlines()).toEqual([{ 'data-tao-studio-overlay': 'selection' }])
    cleanup()
  })

  Test('forwards Design canvas shortcuts from the focused iframe and claims only those keys', () => {
    const fake = previewHost([])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    const appKeys: string[] = []
    let cancellations = 0
    fake.host.document.addEventListener('keydown', event => appKeys.push(event.key ?? ''))
    const key = {
      key: '0',
      metaKey: true,
      preventDefault: () => {
        cancellations += 1
      },
    }
    fake.dispatchDocument('keydown', key)
    Expect(appKeys).toEqual(['0'])
    Expect(cancellations).toBe(0)
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    appKeys.length = 0
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      for (const value of ['0', '1', '=', '+', '-']) {
        fake.dispatchDocument('keydown', { ...modifier, key: value, preventDefault: key.preventDefault })
      }
    }
    fake.dispatchDocument('keydown', { ...key, key: '+', repeat: true })
    const shifted = { preventDefault: key.preventDefault, shiftKey: true }
    fake.dispatchDocument('keydown', { ...shifted, code: 'Digit1', key: '!' })
    fake.dispatchDocument('keydown', { ...shifted, code: 'Digit2', key: '@' })
    const shortcuts = fake.messages.filter(post =>
      (post.message as { type?: string }).type === 'preview-canvas-shortcut'
    )
    Expect(shortcuts.map(post => (post.message as { command: string }).command))
      .toEqual([
        'fit',
        'reset',
        'zoom-in',
        'zoom-in',
        'zoom-out',
        'fit',
        'reset',
        'zoom-in',
        'zoom-in',
        'zoom-out',
        'zoom-in',
        'zoom-selection',
        'zoom-focused',
      ])
    Expect(shortcuts[0]).toEqual({
      message: {
        channel: 'tao-studio',
        command: 'fit',
        identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
        protocolVersion: 1,
        type: 'preview-canvas-shortcut',
      },
      targetOrigin: 'http://127.0.0.1:5500',
    })
    Expect(cancellations).toBe(13)
    Expect(appKeys).toEqual([])
    fake.dispatchDocument('keydown', { key: '0', preventDefault: key.preventDefault })
    fake.dispatchDocument('keydown', { ...key, key: 's' })
    fake.dispatchDocument('keydown', { ...key, key: 'toString' })
    fake.dispatchDocument('keydown', { ...key, isComposing: true })
    fake.dispatchDocument('keydown', { ...key, taoStudioJourney: true })
    const target = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 20 })
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      fake.dispatchDocument('keydown', { ...key, target: { ...target, tagName } })
    }
    fake.dispatchDocument('keydown', {
      ...key,
      target: { ...target, getAttribute: (name: string) => name === 'role' ? 'textbox' : null },
    })
    for (const editable of ['', 'true', 'plaintext-only']) {
      fake.dispatchDocument('keydown', {
        ...key,
        target: {
          ...target,
          parentElement: { ...target, getAttribute: (name: string) => name === 'contenteditable' ? editable : null },
        },
      })
    }
    Expect(appKeys).toEqual(['0', 's', 'toString', '0', '0', '0', '0', '0', '0', '0', '0', '0'])
    Expect(cancellations).toBe(13)
    Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-canvas-shortcut'))
      .toHaveLength(13)
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(false, fake.parent))
    fake.dispatchDocument('keydown', key)
    Expect(appKeys).toHaveLength(13)
    Expect(cancellations).toBe(13)
    cleanup()
  })

  Test('forwards claimed Space transitions once and leaves startup, typing, and Run layout keys alone', () => {
    const fake = previewHost([])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    let cancellations = 0
    let stopped = 0
    const space = {
      key: ' ',
      preventDefault: () => {
        cancellations += 1
      },
      stopImmediatePropagation: () => {
        stopped += 1
      },
    }
    const panMessages = () =>
      fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-canvas-pan-key')
    fake.dispatchDocument('keydown', space)
    Expect(panMessages()).toEqual([])
    Expect(cancellations).toBe(0)
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    const target = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 20 })
    for (const tagName of ['INPUT']) {
      fake.dispatchDocument('keydown', { ...space, target: { ...target, tagName } })
    }
    for (const editable of ['true']) {
      fake.dispatchDocument('keydown', {
        ...space,
        target: {
          ...target,
          parentElement: { ...target, getAttribute: (name: string) => name === 'contenteditable' ? editable : null },
        },
      })
    }
    fake.dispatchDocument('keydown', { ...space, isComposing: true })
    fake.dispatchDocument('keydown', { ...space, taoStudioJourney: true })
    fake.dispatchDocument('keydown', { ...space, key: 'Enter' })
    Expect(panMessages()).toEqual([])
    Expect(cancellations).toBe(0)
    fake.dispatchDocument('keydown', space)
    fake.dispatchDocument('keydown', { ...space, repeat: true })
    Expect(panMessages()).toEqual([{
      message: {
        channel: 'tao-studio',
        held: true,
        identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
        protocolVersion: 1,
        type: 'preview-canvas-pan-key',
      },
      targetOrigin: 'http://127.0.0.1:5500',
    }])
    Expect(cancellations).toBe(2)
    Expect(stopped).toBe(2)
    fake.dispatchDocument('keyup', space)
    fake.dispatchDocument('keyup', space)
    Expect(panMessages().map(post => (post.message as { held: boolean }).held)).toEqual([true, false])
    Expect(cancellations).toBe(3)
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(false, fake.parent))
    fake.dispatchDocument('keydown', space)
    Expect(cancellations).toBe(3)
    Expect(panMessages()).toHaveLength(2)
    cleanup()
  })

  Test('synchronously shields iframe pointer events while Space is held and preserves journey input', () => {
    const target = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 20 })
    const fake = previewHost([target])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    fake.dispatchDocument('mouseover', { target })
    Expect(fake.messages.at(-1)?.message).toMatchObject({ type: 'preview-hover-source' })
    const hoverOverlay = fake.overlays.at(-1)!
    fake.dispatchDocument('keydown', { key: ' ' })
    Expect(hoverOverlay.style['display']).toBe('none')
    const before = fake.messages.length
    const events = [
      'auxclick',
      'click',
      'contextmenu',
      'dblclick',
      'dragstart',
      'mousedown',
      'mouseenter',
      'mouseleave',
      'mousemove',
      'mouseover',
      'mouseout',
      'mouseup',
      'pointercancel',
      'pointerdown',
      'pointerenter',
      'pointerleave',
      'pointermove',
      'pointerout',
      'pointerover',
      'pointerup',
    ] as const
    const appEvents: string[] = []
    const cancellations: string[] = []
    for (const type of events) {
      fake.host.document.addEventListener(type, () => appEvents.push(type))
      fake.dispatchDocument(type, {
        clientX: 10,
        clientY: 10,
        preventDefault: () => cancellations.push(type),
        target,
      })
    }
    Expect(cancellations).toEqual([...events])
    Expect(appEvents).toEqual([])
    Expect(fake.messages).toHaveLength(before)
    for (const type of events) {
      fake.dispatchDocument(type, { target, taoStudioJourney: true })
    }
    Expect(appEvents).toEqual([...events])
    Expect(cancellations).toEqual([...events])
    fake.dispatchDocument('keyup', { key: ' ' })
    fake.dispatchDocument('mouseover', { target })
    Expect(fake.messages.at(-1)?.message).toMatchObject({ type: 'preview-hover-source' })
    fake.dispatchDocument('click', { target })
    Expect(fake.messages.at(-1)?.message).toMatchObject({ type: 'preview-select-source' })
    fake.dispatchWindow('message', interactionModeMessage('run', fake.parent))
    appEvents.length = 0
    for (const type of events) {
      fake.dispatchDocument(type, { target })
    }
    Expect(appEvents).toEqual([...events])
    cleanup()
  })

  Test('arming Space abandons an edit drag before a later mouseup can commit it', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 10, top: 10, width: 100 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 10, top: 50, width: 100 })
    const third = renderElement('/project/Main.tao', 50, 60, { height: 20, left: 10, top: 90, width: 100 })
    const fake = previewHost([first, second, third])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    fake.dispatchDocument('mousedown', { clientX: 40, clientY: 100, target: third })
    fake.dispatchDocument('mousemove', { clientX: 40, clientY: 40, target: second })
    Expect(fake.overlays.filter(overlay => !overlay.removed)).toHaveLength(2)
    fake.dispatchDocument('keydown', { key: ' ' })
    Expect(fake.overlays.filter(overlay => !overlay.removed)).toHaveLength(0)
    fake.dispatchDocument('keyup', { key: ' ' })
    fake.dispatchDocument('mouseup', { clientX: 40, clientY: 40, target: second })
    Expect(fake.messages.map(post => (post.message as { type: string }).type))
      .toEqual(['preview-applied', 'preview-canvas-pan-key', 'preview-canvas-pan-key'])
    cleanup()
  })

  Test('pans wheel input only while Space is held and keeps modifier zoom available', () => {
    const fake = previewHost([])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    let appWheels = 0
    let cancellations = 0
    fake.host.document.addEventListener('wheel', () => {
      appWheels += 1
    })
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    fake.dispatchDocument('keydown', { key: ' ' })
    const wheel = {
      clientX: 10,
      clientY: 20,
      deltaX: 3,
      deltaY: 5,
      preventDefault: () => {
        cancellations += 1
      },
    }
    fake.dispatchDocument('wheel', wheel)
    Expect(fake.messages.at(-1)?.message).toMatchObject({ type: 'preview-canvas-gesture', deltaY: 5 })
    Expect(appWheels).toBe(0)
    Expect(cancellations).toBe(1)
    const before = fake.messages.length
    fake.dispatchDocument('wheel', { ...wheel, taoStudioJourney: true })
    Expect(appWheels).toBe(1)
    Expect(cancellations).toBe(1)
    Expect(fake.messages).toHaveLength(before)
    fake.dispatchDocument('keyup', { key: ' ' })
    const released = fake.messages.length
    fake.dispatchDocument('wheel', wheel)
    Expect(appWheels).toBe(2)
    Expect(cancellations).toBe(1)
    Expect(fake.messages).toHaveLength(released)
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      fake.dispatchDocument('wheel', { ...wheel, ...modifier })
      Expect(fake.messages.at(-1)?.message).toMatchObject({ type: 'preview-canvas-gesture', deltaY: 5, zoom: true })
    }
    Expect(cancellations).toBe(3)
    Expect(fake.messages).toHaveLength(released + 2)
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(false, fake.parent))
    fake.dispatchDocument('wheel', wheel)
    Expect(appWheels).toBe(5)
    Expect(cancellations).toBe(3)
    cleanup()
  })

  Test('releases held iframe Space on blur, ownership loss, and disposal without duplicate releases', () => {
    const fake = previewHost([])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    const heldStates = () =>
      fake.messages.flatMap(post => {
        const message = post.message as { held?: boolean; type?: string }
        return message.type === 'preview-canvas-pan-key' ? [message.held] : []
      })
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    fake.dispatchDocument('keydown', { key: ' ' })
    fake.dispatchWindow('blur', {})
    fake.dispatchWindow('blur', {})
    Expect(heldStates()).toEqual([true, false])
    fake.dispatchDocument('keydown', { key: ' ' })
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(false, fake.parent))
    fake.dispatchDocument('keyup', { key: ' ' })
    Expect(heldStates()).toEqual([true, false, true, false])
    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    fake.dispatchDocument('keydown', { key: ' ' })
    cleanup()
    Expect(heldStates()).toEqual([true, false, true, false, true, false])
    Expect(fake.listenerCount()).toBe(0)
    fake.dispatchDocument('keydown', { key: ' ' })
    fake.dispatchDocument('keyup', { key: ' ' })
    Expect(heldStates()).toEqual([true, false, true, false, true, false])
  })

  // REMOVAL CANDIDATE: Space-wheel coverage proves ownership gating; this keeps the complete gesture envelope.
  Test('cancels iframe gestures only while the parent advertises Design canvas ownership', () => {
    const fake = previewHost([])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    let cancellations = 0
    const gesture = {
      clientX: 25,
      clientY: 40,
      ctrlKey: true,
      deltaX: 3,
      deltaY: -12,
      preventDefault: () => {
        cancellations += 1
      },
    }
    const initialMessages = fake.messages.length
    fake.dispatchDocument('wheel', gesture)
    Expect(cancellations).toBe(0)
    Expect(fake.messages).toHaveLength(initialMessages)

    fake.dispatchWindow('message', canvasGestureOwnershipMessage(true, fake.parent))
    fake.dispatchDocument('wheel', {
      ...gesture,
    })
    Expect(cancellations).toBe(1)
    Expect(fake.messages.at(-1)).toEqual({
      message: {
        channel: 'tao-studio',
        clientX: 25,
        clientY: 40,
        deltaX: 3,
        deltaY: -12,
        identity: {
          appName: 'Demo',
          previewInstanceId: 'preview-1',
          project: '/project',
        },
        protocolVersion: 1,
        type: 'preview-canvas-gesture',
        zoom: true,
      },
      targetOrigin: config.parentOrigin,
    })

    fake.dispatchWindow('message', canvasGestureOwnershipMessage(false, fake.parent))
    fake.dispatchDocument('wheel', gesture)
    Expect(cancellations).toBe(1)
    Expect(fake.messages).toHaveLength(initialMessages + 1)
    cleanup()
    Expect(fake.listenerCount()).toBe(0)
  })
  Test('replays text steps against the deepest exact match instead of its matching ancestors', async () => {
    const events: string[] = []
    const parent: StudioPreviewElement = {
      dispatchEvent: event => {
        events.push(`parent:${String((event as { type?: string }).type)}`)
        return true
      },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
      textContent: 'Save',
    }
    const leaf: StudioPreviewElement = {
      dispatchEvent: event => {
        events.push(`leaf:${String((event as { type?: string }).type)}`)
        return true
      },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
      parentElement: parent,
      textContent: 'Save',
    }
    const fake = previewHost([parent, leaf])

    await replayStudioJourney([{ kind: 'hover', selector: 'text', target: 'Save' }], fake.host)

    Expect(events).toEqual(['leaf:mouseover', 'leaf:mouseenter'])
  })

  Test('waits for a missing interaction target to appear', async () => {
    const events: string[] = []
    const elements: StudioPreviewElement[] = []
    const fake = previewHost(elements)
    let searches = 0
    fake.host.document.querySelectorAll = () => {
      searches += 1
      return elements
    }
    const replay = replayStudioJourney(
      [{ kind: 'press', selector: 'tag', target: 'openWorkspace' }],
      fake.host,
      { targetTimeoutMs: 100 },
    )
    await Promise.resolve()
    Expect(searches).toBe(1)
    Expect(events).toEqual([])
    elements.push({
      dispatchEvent: event => {
        events.push(String((event as { type?: string }).type))
        return true
      },
      getAttribute: name => name === 'data-testid' ? 'openWorkspace' : null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
    })

    await replay

    Expect(events).toEqual(['click'])
  })

  Test('reports the wait budget when an interaction target never appears', async () => {
    const fake = previewHost([])

    await Expect(replayStudioJourney(
      [{ kind: 'press', selector: 'tag', target: 'missing' }],
      fake.host,
      { targetTimeoutMs: 1 },
    )).rejects.toThrow("expected exactly one tag target 'missing', found 0 after waiting 1ms")
  })

  Test('maps the held-pointer journey to browser phases in exact order', async () => {
    const observed: string[] = []
    const target: StudioPreviewElement = {
      dispatchEvent: event => {
        observed.push(String((event as { type?: string }).type))
        return true
      },
      focus: () => observed.push('focus'),
      getAttribute: name => name === 'data-testid' ? 'revertSave' : null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
    }
    const fake = previewHost([target])

    await replayStudioJourney([
      { kind: 'pressDown', selector: 'tag', target: 'revertSave' },
      { kind: 'advance', milliseconds: 600 },
      { kind: 'pressUp', selector: 'tag', target: 'revertSave' },
      { kind: 'hover', selector: 'tag', target: 'revertSave' },
      { kind: 'focus', tag: 'revertSave' },
    ], fake.host)

    Expect(observed).toEqual(['mousedown', 'mouseup', 'mouseover', 'mouseenter', 'focus'])
  })

  Test('keeps state reached by an advanced held-pointer journey after replay releases the clock', async () => {
    let reached = false
    const target: StudioPreviewElement = {
      dispatchEvent: event => {
        if ((event as { type?: string }).type === 'mousedown') {
          Clock.after(600, () => {
            reached = true
          })
        }
        return true
      },
      getAttribute: name => name === 'data-testid' ? 'hold' : null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
    }
    const fake = previewHost([target])

    await replayStudioJourney([
      { kind: 'pressDown', selector: 'tag', target: 'hold' },
      { kind: 'advance', milliseconds: 600 },
      { kind: 'pressUp', selector: 'tag', target: 'hold' },
    ], fake.host)

    Expect(reached).toBe(true)
  })

  Test('publishes the runtime-resolved Scheme with complete provenance', () => {
    const fake = previewHost([])
    publishStudioScheme(config, {
      capability: 'reactive-browser',
      requested: 'system',
      resolved: 'dark',
      source: 'system',
    }, fake.host)

    Expect(fake.messages).toContainEqual({
      message: Expect['objectContaining']({
        scheme: {
          capability: 'reactive-browser',
          requested: 'system',
          resolved: 'dark',
          source: 'system',
        },
        type: 'preview-scheme-changed',
      }),
      targetOrigin: config.parentOrigin,
    })
  })

  Test('publishes authenticated exact-cell journey replay outcomes', () => {
    const fake = previewHost([])
    const cellConfig: StudioPreviewConfig = {
      ...config,
      cellId: 'cell:phone',
      cellRevision: 2,
      manifestRevision: 'manifest-7',
    }

    publishStudioJourneyReplayResult(cellConfig, 'settled', undefined, fake.host)
    publishStudioJourneyReplayResult(cellConfig, 'failed', new Error('Save was not found.'), fake.host)
    publishStudioJourneyReplayResult(config, 'settled', undefined, fake.host)

    Expect(fake.messages.map(post => post.message)).toEqual([
      {
        channel: 'tao-studio',
        identity: {
          appName: 'Demo',
          cellId: 'cell:phone',
          cellRevision: 2,
          compileRevision: 7,
          manifestRevision: 'manifest-7',
          previewInstanceId: 'preview-1',
          project: '/project',
        },
        protocolVersion: 1,
        type: 'preview-journey-replay-settled',
      },
      {
        channel: 'tao-studio',
        error: 'Save was not found.',
        identity: {
          appName: 'Demo',
          cellId: 'cell:phone',
          cellRevision: 2,
          compileRevision: 7,
          manifestRevision: 'manifest-7',
          previewInstanceId: 'preview-1',
          project: '/project',
        },
        protocolVersion: 1,
        type: 'preview-journey-replay-failed',
      },
    ])
  })

  Test('routes Studio debugger commands into the controller and forwards its events back', async () => {
    Debug.Reset()
    const fake = previewHost([])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    const identity = {
      appName: config.appName,
      previewInstanceId: config.previewInstanceId,
      project: config.project,
    }
    const send = (rest: Record<string, unknown>, override?: Record<string, unknown>) =>
      fake.dispatchWindow('message', {
        data: {
          channel: 'tao-studio',
          identity: { ...identity, ...override },
          protocolVersion: 1,
          type: 'debug-command',
          ...rest,
        },
        origin: config.parentOrigin,
        source: fake.parent,
      })

    // Break needs no breakpoint: the next statement any action reaches is where it stops.
    send({ command: 'break' })
    let ran = false
    const pending = TR.Action(async () => {
      await Debug.At({ action: 'Bump', path: '0' }, {})
      ran = true
    }, { name: 'Bump' }).jsValue.invoke()
    await settled()

    Expect(Debug.Paused()?.step.path).toBe('0')
    Expect(ran).toBe(false)
    const paused = fake.messages
      .map(post => post.message as { event?: { kind?: string }; type?: string })
      .filter(message => message.type === 'preview-debug' && message.event?.kind === 'paused')
    Expect(paused).toHaveLength(1)

    // A command naming another project belongs to another preview and must not release this pause.
    send({ command: 'continue' }, { project: '/elsewhere' })
    await settled()
    Expect(Debug.Paused()?.step.path).toBe('0')

    send({ command: 'continue' })
    await pending
    Expect(ran).toBe(true)
    Expect(Debug.Paused()).toBeUndefined()
    Expect(Debug.Journal().at(-1)).toMatchObject({ action: 'Bump', outcome: 'committed' })

    // Configure arrives the same way, and its breakpoint stops the action it names.
    send({ actions: ['Later'], command: 'configure' })
    const later = TR.Action(async () => {
      await Debug.At({ action: 'Later', path: '0' }, {})
    }, { name: 'Later' }).jsValue.invoke()
    await settled()
    Expect(Debug.Paused()?.step).toEqual({ action: 'Later', path: '0' })
    send({ command: 'continue' })
    await later

    cleanup()
    Debug.Reset()
  })

  Test('runs the app before any mode message and enables visual editing only after choosing Edit', () => {
    const render = renderElement('/project/Main.tao', 12, 28, { height: 30, left: 20, top: 10, width: 80 })
    const fake = previewHost([render])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    const appEvents: string[] = []
    for (const type of ['mouseover', 'click', 'mousedown', 'mousemove', 'mouseup'] as const) {
      fake.host.document.addEventListener(type, () => appEvents.push(type))
    }
    let blocked = 0
    const pointer = {
      preventDefault: () => {
        blocked += 1
      },
      stopImmediatePropagation: () => {
        blocked += 1
      },
      stopPropagation: () => {
        blocked += 1
      },
      target: render,
    }

    fake.dispatchDocument('mouseover', pointer)
    fake.dispatchDocument('click', pointer)
    fake.dispatchDocument('mousedown', { ...pointer, clientX: 30, clientY: 20 })
    fake.dispatchDocument('mousemove', { ...pointer, clientX: 30, clientY: 70 })
    fake.dispatchDocument('mouseup', { ...pointer, clientX: 30, clientY: 70 })
    Expect(blocked).toBe(0)
    Expect(appEvents).toEqual(['mouseover', 'click', 'mousedown', 'mousemove', 'mouseup'])
    Expect(fake.messages).toHaveLength(1)
    Expect(fake.overlays).toHaveLength(0)

    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    appEvents.length = 0
    fake.dispatchDocument('mouseover', pointer)
    fake.dispatchDocument('click', pointer)
    Expect(blocked).toBe(3)
    Expect(fake.messages[1]?.message).toMatchObject({ type: 'preview-hover-source' })
    Expect(fake.messages[2]?.message).toMatchObject({ type: 'preview-select-source' })
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('selection')
    Expect(appEvents).toEqual(['mouseover'])

    fake.dispatchWindow('message', interactionModeMessage('run', fake.parent))
    appEvents.length = 0
    fake.dispatchDocument('mouseover', pointer)
    fake.dispatchDocument('click', pointer)
    Expect(blocked).toBe(3)
    Expect(appEvents).toEqual(['mouseover', 'click'])
    Expect(fake.messages).toHaveLength(3)
    Expect(fake.overlays.filter(overlay => !overlay.removed)).toHaveLength(0)
    cleanup()
  })

  Test('records ordered semantic interactions, coalesces input, and redacts sensitive text', () => {
    const button = journeyElement({ 'aria-label': 'Save', 'data-testid': 'save' })
    const title = journeyElement({ 'aria-label': 'Title' }, '')
    const password = journeyElement({ 'aria-label': 'Password', type: 'password' }, '')
    const fake = previewHost([button, title, password])
    const cellConfig: StudioPreviewConfig = {
      ...config,
      cellId: 'cell:phone',
      cellRevision: 2,
      manifestRevision: 'manifest-7',
    }
    const cleanup = mountStudioPreviewBridge(cellConfig, fake.host)
    fake.dispatchWindow('message', journeyRecordingMessage(cellConfig, fake.parent, true))

    fake.dispatchDocument('click', { target: button })
    title.value = 'D'
    fake.dispatchDocument('input', { target: title })
    title.value = 'Draft'
    fake.dispatchDocument('input', { target: title })
    fake.dispatchDocument('keydown', { key: 'Enter', target: title })
    password.value = 'secret'
    fake.dispatchDocument('input', { target: password })
    fake.dispatchDocument('blur', { target: password })
    fake.dispatchDocument('click', { taoStudioJourney: true, target: button })
    fake.dispatchWindow('message', journeyRecordingMessage(cellConfig, fake.parent, false))

    const recorded = fake.messages
      .map(post => post.message as { sequence?: number; step?: unknown; type?: string })
      .filter(message => message.type === 'preview-journey-step-recorded')
    Expect(recorded).toEqual([
      {
        channel: 'tao-studio',
        identity: Expect['objectContaining']({ cellId: 'cell:phone', cellRevision: 2 }),
        protocolVersion: 1,
        recordingId: 'recording-1',
        sequence: 1,
        step: { kind: 'press', selector: 'tag', target: 'save' },
        type: 'preview-journey-step-recorded',
      },
      {
        channel: 'tao-studio',
        identity: Expect['objectContaining']({ cellId: 'cell:phone', cellRevision: 2 }),
        protocolVersion: 1,
        recordingId: 'recording-1',
        sequence: 2,
        step: { kind: 'enter', redacted: false, selector: 'label', target: 'Title', value: 'Draft' },
        type: 'preview-journey-step-recorded',
      },
      {
        channel: 'tao-studio',
        identity: Expect['objectContaining']({ cellId: 'cell:phone', cellRevision: 2 }),
        protocolVersion: 1,
        recordingId: 'recording-1',
        sequence: 3,
        step: { kind: 'submit', selector: 'label', target: 'Title' },
        type: 'preview-journey-step-recorded',
      },
      {
        channel: 'tao-studio',
        identity: Expect['objectContaining']({ cellId: 'cell:phone', cellRevision: 2 }),
        protocolVersion: 1,
        recordingId: 'recording-1',
        sequence: 4,
        step: { kind: 'enter', redacted: true, selector: 'label', target: 'Password', value: '' },
        type: 'preview-journey-step-recorded',
      },
    ])
    Expect(fake.messages.at(-1)?.message).toMatchObject({ sequence: 4, status: 'stopped' })
    cleanup()
  })

  Test('records Enter only for deliberate single-line submission', () => {
    const title = journeyElement({ 'aria-label': 'Title' }, '', 'INPUT')
    const notes = journeyElement({ 'aria-label': 'Notes' }, '', 'TEXTAREA')
    const save = journeyElement({ 'aria-label': 'Save' }, undefined, 'BUTTON')
    const fake = previewHost([title, notes, save])
    const cellConfig: StudioPreviewConfig = {
      ...config,
      cellId: 'cell:phone',
      cellRevision: 2,
      manifestRevision: 'manifest-7',
    }
    const cleanup = mountStudioPreviewBridge(cellConfig, fake.host)
    fake.dispatchWindow('message', journeyRecordingMessage(cellConfig, fake.parent, true))

    fake.dispatchDocument('keydown', { isComposing: true, key: 'Enter', target: title })
    fake.dispatchDocument('keydown', { key: 'Enter', repeat: true, target: title })
    fake.dispatchDocument('keydown', { key: 'Enter', target: notes })
    fake.dispatchDocument('keydown', { key: 'Enter', target: save })
    fake.dispatchDocument('click', { target: save })
    fake.dispatchDocument('keydown', { key: 'Enter', target: title })

    Expect(
      fake.messages
        .map(post => post.message as { step?: unknown; type?: string })
        .filter(message => message.type === 'preview-journey-step-recorded')
        .map(message => message.step),
    ).toEqual([
      { kind: 'press', selector: 'label', target: 'Save' },
      { kind: 'submit', selector: 'label', target: 'Title' },
    ])
    cleanup()
  })

  Test('fails closed for ambiguous selectors and invalidates recording when its preview unmounts', () => {
    const first = journeyElement({ 'aria-label': 'Duplicate' })
    const second = journeyElement({ 'aria-label': 'Duplicate' })
    const fake = previewHost([first, second])
    const cellConfig: StudioPreviewConfig = {
      ...config,
      cellId: 'cell:phone',
      cellRevision: 2,
      manifestRevision: 'manifest-7',
    }
    const cleanup = mountStudioPreviewBridge(cellConfig, fake.host)
    fake.dispatchWindow(
      'message',
      journeyRecordingMessage(
        { ...cellConfig, cellRevision: 1 },
        fake.parent,
        true,
      ),
    )
    fake.dispatchDocument('click', { target: first })
    Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-journey-step-recorded'))
      .toEqual([])

    fake.dispatchWindow('message', journeyRecordingMessage(cellConfig, fake.parent, true))
    fake.dispatchDocument('click', { target: first })
    cleanup()
    const recorded = fake.messages
      .map(post => post.message as { type?: string })
      .filter(message => message.type === 'preview-journey-step-recorded')
    Expect(recorded.at(-1)).toMatchObject({
      sequence: 1,
      step: {
        action: 'press',
        kind: 'unresolved',
        reason: 'No unique Tao tag, accessibility label, placeholder, or visible text identifies this target.',
      },
      type: 'preview-journey-step-recorded',
    })
    Expect(fake.messages.at(-1)?.message).toMatchObject({ sequence: 1, status: 'invalidated' })
    Expect(fake.messages.some(post => (post.message as { event?: { kind?: string } }).event?.kind === 'reset')).toBe(
      true,
    )
  })

  Test('captures fixture data only for an exact trusted parent request', async () => {
    const fake = previewHost([])
    const fixture = {
      accounts: [],
      creates: [{ entity: 'Story', fields: { Title: 'Captured' }, name: 'Story1' }],
    } as const
    const cleanup = mountStudioPreviewBridge(config, fake.host, async () => fixture)
    const request = {
      channel: 'tao-studio',
      identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
      protocolVersion: 1,
      requestId: 'capture-1',
      type: 'capture-fixture',
    }

    fake.dispatchWindow('message', { data: request, origin: 'https://attacker.invalid', source: fake.parent })
    fake.dispatchWindow('message', { data: request, origin: config.parentOrigin, source: fake.parent })
    await Promise.resolve()

    Expect(fake.messages).toHaveLength(2)
    Expect(fake.messages[1]).toEqual({
      message: {
        channel: 'tao-studio',
        fixture,
        identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
        protocolVersion: 1,
        requestId: 'capture-1',
        type: 'preview-fixture-captured',
      },
      targetOrigin: config.parentOrigin,
    })
    cleanup()
  })

  Test('preserves Tao error taxonomy when runtime capture fails across the preview protocol', async () => {
    const failures = [
      { error: new UserInputError('invalid capture'), message: 'invalid capture' },
      { error: new HostEnvironmentError('capture host unavailable'), message: 'capture host unavailable' },
      { error: new UnexpectedBehaviorError('capture invariant failed'), message: 'capture invariant failed' },
      { error: 'unknown capture failure', message: 'unknown capture failure' },
    ] as const
    const expectedNames = [
      'UserInputError',
      'HostEnvironmentError',
      'UnexpectedBehaviorError',
      'UnexpectedBehaviorError',
    ] as const

    for (const [index, failure] of failures.entries()) {
      const fake = previewHost([])
      const unregister = registerRuntimeCaptureDomain({
        capture: () => {
          throw failure.error
        },
        domain: `capture-failure-${index}`,
        version: 1,
      })
      const cleanup = mountStudioPreviewBridge(config, fake.host)
      try {
        fake.dispatchWindow('message', {
          data: {
            channel: 'tao-studio',
            identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
            protocolVersion: 1,
            requestId: `runtime-capture-${index}`,
            type: 'capture-runtime',
          },
          origin: config.parentOrigin,
          source: fake.parent,
        })
        await settled()
        Expect(fake.messages.at(-1)?.message).toMatchObject({
          error: failure.message,
          errorName: expectedNames[index],
          requestId: `runtime-capture-${index}`,
          type: 'preview-runtime-capture-failed',
        })
      } finally {
        cleanup()
        unregister()
      }
    }
  })

  Test('forwards bounded preview console records and restores the console on cleanup', () => {
    const fake = previewHost([])
    const original = fake.host.console?.log
    const cleanup = mountStudioPreviewBridge(config, fake.host)

    fake.host.console?.log?.('loaded', { count: 2 })

    Expect(fake.consoleCalls).toEqual([['loaded', { count: 2 }]])
    Expect(fake.messages.at(-1)?.message).toMatchObject({
      arguments: ['loaded', { count: 2 }],
      level: 'log',
      type: 'preview-console',
    })
    cleanup()
    Expect(fake.host.console?.log).toBe(original)
  })

  Test('reports applied revisions and maps pointer identity back to trusted Studio source messages', () => {
    const render = renderElement('/project/Main.tao', 12, 28, { height: 30, left: 20, top: 10, width: 80 })
    const fake = previewHost([render])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))

    Expect(fake.messages).toEqual([{
      message: {
        appliedRevision: 7,
        channel: 'tao-studio',
        compileRevision: 7,
        identity: { appName: 'Demo', compileRevision: 7, previewInstanceId: 'preview-1', project: '/project' },
        protocolVersion: 1,
        type: 'preview-applied',
      },
      targetOrigin: 'http://127.0.0.1:5500',
    }])

    fake.dispatchDocument('mouseover', { target: render })
    Expect(fake.messages[1]).toEqual({
      message: {
        channel: 'tao-studio',
        identity: {
          appName: 'Demo',
          occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
          path: '/project/Main.tao',
          previewInstanceId: 'preview-1',
          project: '/project',
          sourceVersion: 'version-1',
        },
        protocolVersion: 1,
        range: { end: 28, start: 12 },
        type: 'preview-hover-source',
      },
      targetOrigin: 'http://127.0.0.1:5500',
    })
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('hover')

    fake.dispatchDocument('click', { target: render })
    Expect(fake.messages[2]?.message).toEqual({
      channel: 'tao-studio',
      identity: {
        appName: 'Demo',
        occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
        path: '/project/Main.tao',
        previewInstanceId: 'preview-1',
        project: '/project',
        sourceVersion: 'version-1',
      },
      protocolVersion: 1,
      range: { end: 28, start: 12 },
      type: 'preview-select-source',
    })
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('selection')

    cleanup()
    Expect(fake.overlays[0]?.removed).toBe(true)
    Expect(fake.listenerCount()).toBe(0)
    fake.dispatchDocument('click', { target: render })
    Expect(fake.messages.length).toBe(4)
    Expect(fake.messages.at(-1)?.message).toMatchObject({ event: { kind: 'reset' }, type: 'preview-debug' })
  })

  Test('a click on a repeated row keeps that row, not the first, through measurement and the source echo', () => {
    const list = renderElement('/project/Main.tao', 0, 100, { height: 200, left: 0, top: 0, width: 100 })
    const row = (top: number) => {
      const card = renderElement('/project/Main.tao', 20, 60, { height: 50, left: 0, top, width: 100 })
      const title = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 10, top: top + 10, width: 80 }, {
        elementName: 'Text',
      })
      Object.assign(card, { parentElement: list })
      Object.assign(title, { parentElement: card })
      return title
    }
    const [firstTitle, secondTitle, thirdTitle] = [row(0), row(60), row(120)]
    const fake = previewHost([list, firstTitle!, secondTitle!, thirdTitle!])
    fake.host.document.body = {
      appendChild: overlay => fake.overlays.push(overlay as FakeOverlay),
      getBoundingClientRect: () => ({ height: 200, left: 0, top: 0, width: 100 }),
    }
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchDocument('click', { target: secondTitle })

    const measured = fake.messages.filter(post =>
      (post.message as { type?: string }).type === 'preview-layout-measurements'
    )
      .at(-1)?.message as { measurements: Array<{ renderId: string; viewportRect: { y: number } }> }
    const titles = measured.measurements.filter(item => item.renderId === '/project/Main.tao:30:40')
    Expect(titles).toHaveLength(1)
    Expect(titles[0]).toMatchObject({ viewportRect: { height: 20, width: 80, x: 10, y: 70 } })

    // Studio reveals the clicked title in the editor and echoes its range back as a highlight.
    fake.dispatchWindow('message', {
      data: highlightMessage('version-1'),
      origin: config.parentOrigin,
      source: fake.parent,
    })
    const outline = fake.overlays.find(overlay => !overlay.removed)
    Expect(outline?.attributes['data-tao-studio-overlay']).toBe('source')
    Expect(outline?.style).toMatchObject({ top: '70px' })
    cleanup()
  })

  Test('accepts source highlights only from the configured parent and current source version', () => {
    const broad = renderElement('/project/Main.tao', 0, 100, { height: 90, left: 5, top: 6, width: 120 })
    const precise = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 25, top: 36, width: 50 })
    const fake = previewHost([broad, precise])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    const highlight = highlightMessage('version-1')

    fake.dispatchWindow('message', { data: highlight, origin: 'https://attacker.example', source: fake.parent })
    fake.dispatchWindow('message', {
      data: highlightMessage('obsolete'),
      origin: config.parentOrigin,
      source: fake.parent,
    })
    fake.dispatchWindow('message', { data: highlight, origin: config.parentOrigin, source: {} })
    Expect(fake.overlays.length).toBe(0)

    fake.dispatchWindow('message', { data: highlight, origin: config.parentOrigin, source: fake.parent })
    Expect(fake.overlays.length).toBe(1)
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('source')
    Expect(fake.overlays[0]?.style).toMatchObject({
      display: 'block',
      height: '20px',
      left: '25px',
      top: '36px',
      width: '50px',
    })

    fake.dispatchWindow('message', {
      data: { ...highlight, range: undefined },
      origin: config.parentOrigin,
      source: fake.parent,
    })
    Expect(fake.overlays[0]?.style['display']).toBe('none')

    cleanup()
  })

  Test('stays inert for an incomplete matrix-cell identity', () => {
    const invalid = previewHost([])
    mountStudioPreviewBridge({ ...config, cellId: 'partial' }, invalid.host)()
    Expect(invalid.messages).toEqual([])
  })

  Test('turns one render drag into one versioned semantic move action', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 10, top: 10, width: 100 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 10, top: 50, width: 100 })
    const third = renderElement('/project/Main.tao', 50, 60, { height: 20, left: 10, top: 90, width: 100 })
    const fake = previewHost([first, second, third])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))

    fake.dispatchDocument('mousedown', { clientX: 40, clientY: 100, target: third })
    fake.dispatchDocument('mousemove', { clientX: 40, clientY: 40, target: second })
    fake.dispatchDocument('mouseup', { clientX: 40, clientY: 40, preventDefault() {}, target: second })

    Expect(fake.messages[1]).toMatchObject({
      message: {
        action: {
          afterId: '/project/Main.tao:10:20',
          beforeId: '/project/Main.tao:30:40',
          draggedId: '/project/Main.tao:50:60',
          kind: 'move-render',
        },
        channel: 'tao-studio',
        checkpoint: { phase: 'single' },
        identity: {
          appName: 'Demo',
          occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
          path: '/project/Main.tao',
          previewInstanceId: 'preview-1',
          project: '/project',
          sourceVersion: 'version-1',
        },
        protocolVersion: 1,
        sourceActionVersion: 2,
        type: 'source-action',
      },
      targetOrigin: 'http://127.0.0.1:5500',
    })
    Expect((fake.messages[1]?.message as { requestId?: string }).requestId).toMatch(/^preview-preview-1-\d+$/)
    Expect(fake.overlays.filter(overlay => overlay.attributes['data-tao-studio-drag-overlay']).length).toBe(2)
    Expect(fake.overlays.filter(overlay => overlay.removed).length).toBe(2)

    cleanup()
  })

  Test('disarms an abandoned drag before a later mouseup can emit a ghost move', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 10, top: 10, width: 100 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 10, top: 50, width: 100 })
    const third = renderElement('/project/Main.tao', 50, 60, { height: 20, left: 10, top: 90, width: 100 })
    const fake = previewHost([first, second, third])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))

    fake.dispatchDocument('mousedown', { clientX: 40, clientY: 100, target: third })
    fake.dispatchDocument('mousemove', { clientX: 40, clientY: 40, target: second })
    fake.dispatchDocument('mouseleave', {})
    fake.dispatchDocument('mouseup', { clientX: 40, clientY: 40, target: second })

    Expect(fake.messages).toHaveLength(1)
    Expect(fake.overlays.filter(overlay => overlay.removed)).toHaveLength(2)
    cleanup()
  })

  Test('emits edge-anchor moves when only one sibling remains', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 10, top: 10, width: 100 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 10, top: 50, width: 100 })

    const beforeFake = previewHost([first, second])
    const cleanupBefore = mountStudioPreviewBridge(config, beforeFake.host)
    beforeFake.dispatchWindow('message', interactionModeMessage('edit', beforeFake.parent))
    beforeFake.dispatchDocument('mousedown', { clientX: 40, clientY: 60, target: second })
    beforeFake.dispatchDocument('mousemove', { clientX: 40, clientY: 0, target: first })
    beforeFake.dispatchDocument('mouseup', { clientX: 40, clientY: 0, preventDefault() {}, target: first })
    Expect(beforeFake.messages[1]).toMatchObject({
      message: {
        action: {
          beforeId: '/project/Main.tao:10:20',
          draggedId: '/project/Main.tao:30:40',
          kind: 'move-render',
        },
        type: 'source-action',
      },
    })
    cleanupBefore()

    const afterFake = previewHost([first, second])
    const cleanupAfter = mountStudioPreviewBridge(config, afterFake.host)
    afterFake.dispatchWindow('message', interactionModeMessage('edit', afterFake.parent))
    afterFake.dispatchDocument('mousedown', { clientX: 40, clientY: 20, target: first })
    afterFake.dispatchDocument('mousemove', { clientX: 40, clientY: 100, target: second })
    afterFake.dispatchDocument('mouseup', { clientX: 40, clientY: 100, preventDefault() {}, target: second })
    Expect(afterFake.messages[1]).toMatchObject({
      message: {
        action: {
          afterId: '/project/Main.tao:30:40',
          draggedId: '/project/Main.tao:10:20',
          kind: 'move-render',
        },
        type: 'source-action',
      },
    })
    cleanupAfter()
  })

  Test('stays inert without an exact trusted web origin', () => {
    const fake = previewHost([])
    const cleanup = mountStudioPreviewBridge({ ...config, parentOrigin: '*' }, fake.host)

    Expect(fake.messages.length).toBe(0)
    Expect(fake.listenerCount()).toBe(0)
    Expect(fake.overlays.length).toBe(0)
    cleanup()
  })
})

Test('reads bounded resolved CSS from the matching committed browser node', () => {
  const target = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 20 })
  const other = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 0, top: 0, width: 20 })
  const { host } = previewHost([other, target])
  host.window.getComputedStyle = element => ({
    getPropertyValue: property => element === target && property === 'color' ? ' rgb(3, 4, 5) ' : '',
  })
  Expect(resolvedStudioStyle(host, { end: 20, kind: 'render', sourcePath: '/project/Main.tao', start: 10 }))
    .toEqual({ color: 'rgb(3, 4, 5)' })
})

Test('does not attribute one repeated row style to every instance', () => {
  const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 0, top: 0, width: 20 })
  const second = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 20, top: 0, width: 20 })
  const { host } = previewHost([first, second])
  host.window.getComputedStyle = element => ({
    getPropertyValue: property => property === 'color' ? element === first ? 'red' : 'blue' : '',
  })
  Expect(resolvedStudioStyle(host, { end: 20, kind: 'render', sourcePath: '/project/Main.tao', start: 10 }))
    .toBeUndefined()
})

function renderElement(
  sourcePath: string,
  start: number,
  end: number,
  rect: { height: number; left: number; top: number; width: number },
  studio: { elementName?: string; studioRectId?: string } = {},
): StudioPreviewElement {
  const identity = JSON.stringify({ end, kind: 'render', ownerName: 'MainView', sourcePath, start, ...studio })
  const element: StudioPreviewElement = {
    closest: () => element,
    getAttribute: name => name === 'data-tao-studio' ? identity : null,
    getBoundingClientRect: () => rect,
  }
  return element
}

function highlightMessage(sourceVersion: string): Record<string, unknown> {
  return {
    channel: 'tao-studio',
    identity: {
      appName: config.appName,
      path: '/project/Main.tao',
      previewInstanceId: config.previewInstanceId,
      project: config.project,
      sourceVersion,
    },
    protocolVersion: 1,
    range: { end: 36, start: 35 },
    type: 'highlight-source',
  }
}

function interactionModeMessage(mode: 'edit' | 'run', parent: StudioPreviewHost['parent']): {
  data: Record<string, unknown>
  origin: string
  source: StudioPreviewHost['parent']
} {
  return {
    data: {
      channel: 'tao-studio',
      identity: {
        appName: config.appName,
        previewInstanceId: config.previewInstanceId,
        project: config.project,
      },
      mode,
      protocolVersion: 1,
      type: 'set-interaction-mode',
    },
    origin: config.parentOrigin,
    source: parent,
  }
}

function clearSelectionMessage(parent: StudioPreviewHost['parent']): {
  data: Record<string, unknown>
  origin: string
  source: StudioPreviewHost['parent']
} {
  return {
    data: {
      channel: 'tao-studio',
      identity: {
        appName: config.appName,
        previewInstanceId: config.previewInstanceId,
        project: config.project,
      },
      protocolVersion: 1,
      type: 'clear-selection',
    },
    origin: config.parentOrigin,
    source: parent,
  }
}

function canvasGestureOwnershipMessage(owned: boolean, parent: StudioPreviewHost['parent']): {
  data: Record<string, unknown>
  origin: string
  source: StudioPreviewHost['parent']
} {
  return {
    data: {
      channel: 'tao-studio',
      identity: {
        appName: config.appName,
        previewInstanceId: config.previewInstanceId,
        project: config.project,
      },
      owned,
      protocolVersion: 1,
      type: 'set-canvas-gestures',
    },
    origin: config.parentOrigin,
    source: parent,
  }
}

function journeyRecordingMessage(
  previewConfig: StudioPreviewConfig,
  parent: StudioPreviewHost['parent'],
  active: boolean,
): { data: Record<string, unknown>; origin: string; source: StudioPreviewHost['parent'] } {
  return {
    data: {
      active,
      channel: 'tao-studio',
      identity: {
        appName: previewConfig.appName,
        cellId: previewConfig.cellId,
        cellRevision: previewConfig.cellRevision,
        compileRevision: previewConfig.compileRevision,
        manifestRevision: previewConfig.manifestRevision,
        previewInstanceId: previewConfig.previewInstanceId,
        project: previewConfig.project,
      },
      protocolVersion: 1,
      recordingId: 'recording-1',
      type: 'set-journey-recording',
    },
    origin: previewConfig.parentOrigin,
    source: parent,
  }
}

function journeyElement(
  attributes: Readonly<Record<string, string>>,
  value?: string,
  tagName = value === undefined ? 'BUTTON' : 'INPUT',
): StudioPreviewElement {
  return {
    getAttribute: name => attributes[name] ?? null,
    getBoundingClientRect: () => ({ height: 20, left: 0, top: 0, width: 100 }),
    tagName,
    ...(value === undefined ? {} : { value }),
  }
}

function previewHost(renderElements: StudioPreviewElement[]): {
  consoleCalls: unknown[][]
  dispatchDocument(type: string, event: unknown): void
  dispatchWindow(type: string, event: unknown): void
  host: StudioPreviewHost
  listenerCount(): number
  messages: PostedMessage[]
  overlays: FakeOverlay[]
  parent: StudioPreviewHost['parent']
  flushAnimationFrame(): void
  pendingAnimationFrames(): number
} {
  const documentListeners = new Map<string, Set<Listener>>()
  const windowListeners = new Map<string, Set<Listener>>()
  const messages: PostedMessage[] = []
  const consoleCalls: unknown[][] = []
  const overlays: FakeOverlay[] = []
  const animationFrames = new Map<number, (timestamp: number) => void>()
  let nextAnimationFrameId = 0
  const parent = {
    postMessage: (message: unknown, targetOrigin: string) => messages.push({ message, targetOrigin }),
  }
  const host: StudioPreviewHost = {
    console: {
      log: (...arguments_) => consoleCalls.push(arguments_),
    },
    document: {
      addEventListener: (type, listener) => {
        addListener(documentListeners, type, listener as unknown as Listener)
      },
      body: { appendChild: overlay => overlays.push(overlay as FakeOverlay) },
      createElement: () => {
        const overlay: FakeOverlay = {
          attributes: {},
          getAttribute: name => overlay.attributes[name] ?? null,
          getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
          removed: false,
          remove: () => {
            overlay.removed = true
          },
          setAttribute: (name, value) => {
            overlay.attributes[name] = value
          },
          style: {},
        }
        return overlay
      },
      querySelectorAll: () => renderElements,
      removeEventListener: (type, listener) => {
        removeListener(documentListeners, type, listener as unknown as Listener)
      },
    },
    parent,
    window: {
      addEventListener: (type, listener) => {
        addListener(windowListeners, type, listener as unknown as Listener)
      },
      cancelAnimationFrame: id => animationFrames.delete(id),
      removeEventListener: (type, listener) => {
        removeListener(windowListeners, type, listener as unknown as Listener)
      },
      requestAnimationFrame: callback => {
        nextAnimationFrameId += 1
        animationFrames.set(nextAnimationFrameId, callback)
        return nextAnimationFrameId
      },
    },
  }
  return {
    consoleCalls,
    dispatchDocument: (type, event) => dispatch(documentListeners, type, event),
    dispatchWindow: (type, event) => dispatch(windowListeners, type, event),
    host,
    listenerCount: () => listenerCount(documentListeners) + listenerCount(windowListeners),
    messages,
    overlays,
    parent,
    flushAnimationFrame: () => {
      const callbacks = Array.from(animationFrames.values())
      animationFrames.clear()
      for (const callback of callbacks) {
        callback(0)
      }
    },
    pendingAnimationFrames: () => animationFrames.size,
  }
}

function addListener(listeners: Map<string, Set<Listener>>, type: string, listener: Listener): void {
  const group = listeners.get(type) ?? new Set<Listener>()
  group.add(listener)
  listeners.set(type, group)
}

function removeListener(listeners: Map<string, Set<Listener>>, type: string, listener: Listener): void {
  listeners.get(type)?.delete(listener)
}

function dispatch(listeners: Map<string, Set<Listener>>, type: string, event: unknown): void {
  let stopped = false
  const dispatched = typeof event === 'object' && event !== null
    ? {
      ...event,
      stopImmediatePropagation() {
        stopped = true
        ;(event as { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.()
      },
    }
    : event
  for (const listener of listeners.get(type) ?? []) {
    listener(dispatched)
    if (stopped) {
      break
    }
  }
}

function listenerCount(listeners: Map<string, Set<Listener>>): number {
  return Array.from(listeners.values()).reduce((count, group) => count + group.size, 0)
}

Test('keeps the editing bridge active without an applied-publication claim in the speed experiment', () => {
  const fake = previewHost([])
  const cleanup = mountStudioPreviewBridge({ ...config, publicationChecks: false }, fake.host)
  Expect(fake.listenerCount()).not.toBe(0)
  Expect(fake.messages.some(post => (post.message as { type?: string }).type === 'preview-applied')).toBe(false)
  Expect(fake.messages.some(post => (post.message as { type?: string }).type === 'preview-mounted')).toBe(true)
  Expect(fake.messages.find(post => (post.message as { type?: string }).type === 'preview-mounted'))
    .toMatchObject({
      message: {
        appliedRevision: config.compileRevision,
        compileRevision: config.compileRevision,
        identity: { compileRevision: config.compileRevision, previewInstanceId: config.previewInstanceId },
      },
    })
  cleanup()
})

Test('acknowledges the whole-app revision with its preview instance', () => {
  const fake = previewHost([])
  const cleanup = mountStudioPreviewBridge(config, fake.host)
  Expect(fake.messages.find(post => (post.message as { type?: string }).type === 'preview-applied'))
    .toMatchObject({
      message: {
        appliedRevision: config.compileRevision,
        compileRevision: config.compileRevision,
        identity: { compileRevision: config.compileRevision, previewInstanceId: config.previewInstanceId },
      },
    })
  cleanup()
})

Test('reports child paint only after two child frames and cancels it on cleanup', () => {
  const fake = previewHost([])
  const cleanup = mountStudioPreviewBridge(config, fake.host)
  const painted = () => fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-painted')
  Expect(painted()).toEqual([])
  fake.flushAnimationFrame()
  Expect(painted()).toEqual([])
  Expect(fake.pendingAnimationFrames()).toBe(1)
  fake.flushAnimationFrame()
  Expect(painted()).toMatchObject([{
    message: {
      identity: { compileRevision: config.compileRevision, previewInstanceId: config.previewInstanceId },
      painted: true,
      paintRevision: config.compileRevision,
    },
    targetOrigin: config.parentOrigin,
  }])
  cleanup()

  const cancelled = previewHost([])
  const stopBeforePaint = mountStudioPreviewBridge(config, cancelled.host)
  stopBeforePaint()
  Expect(cancelled.pendingAnimationFrames()).toBe(0)
  cancelled.flushAnimationFrame()
  Expect(cancelled.pendingAnimationFrames()).toBe(0)
  Expect(cancelled.messages.some(post => (post.message as { type?: string }).type === 'preview-painted')).toBe(false)
})

Test('reports rejected design padding without paint and ignores out-of-order design revisions', () => {
  const designName = 'StudioPaintHandshakeTheme'
  const sourcePath = '/project/StudioPaintHandshakeTheme.tao'
  const source = { end: 20, kind: 'style' as const, member: 'surface', path: sourcePath, start: 1 }
  DesignControls.Declaration(
    {
      bundles: { surface: DesignControls.Spec([['pad', 12]], source) },
      name: designName,
      tokens: {},
    },
    'test.studio.preview.paint-handshake',
    { epoch: 1, path: sourcePath, sourceEpochs: {} },
  )
  const fake = previewHost([])
  const experimentalConfig = { ...config, publicationChecks: false }
  const cleanup = mountStudioPreviewBridge(experimentalConfig, fake.host)
  const sendPadding = (
    revision: number,
    bundleName: string,
    identity = {
      appName: config.appName,
      compileRevision: config.compileRevision,
      previewInstanceId: config.previewInstanceId,
      project: config.project,
    },
    origin = config.parentOrigin,
    source = fake.parent,
    malformed = false,
  ) =>
    fake.dispatchWindow('message', {
      data: {
        bundleName,
        channel: 'tao-studio',
        designName,
        expectedPadding: 12,
        identity,
        padding: 20,
        sourcePath,
        entryIndex: malformed ? 'zero' : 0,
        ownerKind: 'styles',
        oldLiteralRange: { from: 10, to: 12 },
        newLiteralRange: { from: 10, to: 12 },
        oldSpecRange: { from: 1, to: 20 },
        newSpecRange: { from: 1, to: 20 },
        protocolVersion: 1,
        revision,
        type: 'experimental-design-padding',
      },
      origin,
      source,
    })
  sendPadding(9, 'missing')
  sendPadding(10, 'surface', undefined, config.parentOrigin, fake.parent, true)
  Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-painted'))
    .toMatchObject([
      { message: { painted: false, paintRevision: 9 } },
      { message: { painted: false, paintRevision: 10 } },
    ])
  sendPadding(11, 'surface')
  sendPadding(8, 'surface')
  sendPadding(12, 'surface', {
    appName: config.appName,
    compileRevision: 12,
    previewInstanceId: config.previewInstanceId,
    project: config.project,
  })
  sendPadding(13, 'surface', undefined, 'https://wrong.test')
  Expect(fake.pendingAnimationFrames()).toBe(2)
  fake.flushAnimationFrame()
  fake.flushAnimationFrame()
  Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-painted'))
    .toMatchObject([
      { message: { painted: false, paintRevision: 9 } },
      { message: { painted: false, paintRevision: 10 } },
      { message: { painted: true, paintRevision: config.compileRevision } },
      { message: { painted: true, paintRevision: 11 } },
    ])
  cleanup()
})
