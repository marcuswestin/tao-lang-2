import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { ReactNode } from 'react'
import { Debug } from '../TaoRuntime-src/TR-debug'
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

  Test('collects finite non-negative render geometry relative to the cell content root', () => {
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
    const replay = replayStudioJourney(
      [{ kind: 'press', selector: 'tag', target: 'openWorkspace' }],
      fake.host,
      { targetTimeoutMs: 100 },
    )
    await new Promise<void>(resolve => setTimeout(resolve, 20))
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

  Test('does not freeze the app clock for a journey with no advance step', async () => {
    const target: StudioPreviewElement = {
      dispatchEvent: () => true,
      getAttribute: name => name === 'data-testid' ? 'target' : null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
    }
    const fake = previewHost([target])
    Clock.beginTest(1234)
    try {
      await replayStudioJourney([{ kind: 'pressDown', selector: 'tag', target: 'target' }], fake.host)
      Expect(Clock.now()).toBe(1234)
    } finally {
      Clock.endTest()
    }
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

  Test('separates normal app interaction from selecting and visual editing', () => {
    const render = renderElement('/project/Main.tao', 12, 28, { height: 30, left: 20, top: 10, width: 80 })
    const fake = previewHost([render])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
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

    fake.dispatchWindow('message', interactionModeMessage('run', fake.parent))
    fake.dispatchDocument('mouseover', pointer)
    fake.dispatchDocument('click', pointer)
    Expect(blocked).toBe(0)
    Expect(fake.messages).toHaveLength(1)
    Expect(fake.overlays).toHaveLength(0)

    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchDocument('mouseover', pointer)
    fake.dispatchDocument('click', pointer)
    Expect(blocked).toBe(3)
    Expect(fake.messages[1]?.message).toMatchObject({ type: 'preview-hover-source' })
    Expect(fake.messages[2]?.message).toMatchObject({ type: 'preview-select-source' })
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('selection')
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

    Expect(fake.messages).toEqual([{
      message: {
        appliedRevision: 7,
        channel: 'tao-studio',
        compileRevision: 7,
        identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
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

  Test('carries complete matrix-cell identity through every preview message', () => {
    const fake = previewHost([])
    const cellConfig: StudioPreviewConfig = {
      ...config,
      cellId: 'cell:phone',
      cellRevision: 2,
      manifestRevision: 'manifest-7',
    }
    const cleanup = mountStudioPreviewBridge(cellConfig, fake.host)

    Expect(fake.messages[0]?.message).toMatchObject({
      identity: {
        appName: 'Demo',
        cellId: 'cell:phone',
        cellRevision: 2,
        compileRevision: 7,
        manifestRevision: 'manifest-7',
        previewInstanceId: 'preview-1',
        project: '/project',
      },
    })
    cleanup()

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
} {
  const documentListeners = new Map<string, Set<Listener>>()
  const windowListeners = new Map<string, Set<Listener>>()
  const messages: PostedMessage[] = []
  const consoleCalls: unknown[][] = []
  const overlays: FakeOverlay[] = []
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
      removeEventListener: (type, listener) => {
        removeListener(windowListeners, type, listener as unknown as Listener)
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
  for (const listener of listeners.get(type) ?? []) {
    listener(event)
  }
}

function listenerCount(listeners: Map<string, Set<Listener>>): number {
  return Array.from(listeners.values()).reduce((count, group) => count + group.size, 0)
}
