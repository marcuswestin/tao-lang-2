import type { HostAction, HostRevision, HostSession, HostTarget } from '@host-control'
import { Errors } from '@shared'
import { Deferred, Describe, Expect, settle, Test, until } from '@shared/test'
import { StudioElectrobun } from '../studio-tooling-src/StudioElectrobun'
import { hostControlScript, hostControlWindowMatches } from '../studio-tooling-src/StudioElectrobunAppSource'
import {
  createStudioHostController,
  type StudioHostProjectBinding,
  type StudioHostTransport,
  type StudioHostTransportPublishRevision,
  waitForStudioHostTransport,
} from '../studio-tooling-src/StudioHostControl'

const firstRevision: HostRevision = { build: 'build-1', source: 'source-1' }
const secondRevision: HostRevision = { build: 'build-2', source: 'source-2' }
const projectBinding: StudioHostProjectBinding = {
  projectSessionId: 'project-a',
  windowId: 1,
  windowToken: 'window-one',
}
const entry: HostTarget = { kind: 'accessibility', name: 'Studio entry' }
const scopedEntry: HostTarget = {
  kind: 'scoped',
  scope: { kind: 'tag', value: 'workspace' },
  target: entry,
}

function transport(options: {
  bindProject?: () => Promise<StudioHostProjectBinding>
  publish?: (request: StudioHostTransportPublishRevision) => Promise<void>
} = {}): {
  calls: Array<Record<string, unknown>>
  value: StudioHostTransport
} {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    value: {
      capabilities: ['inspect', 'key', 'pointer', 'refreshDocument', 'scroll', 'textInput'],
      bindProject: options.bindProject ?? (async () => projectBinding),
      observe: async (binding, target, expectedRevision) => {
        calls.push({ binding, expectedRevision, kind: 'observe', target })
        return {
          accessibilityLabel: target.kind === 'accessibility' ? target.name : undefined,
          bounds: { height: 20, width: 100, x: 12, y: 24 },
          elementId: 'rendered-entry',
          text: 'Current Studio entry',
          visible: true,
        }
      },
      perform: async (binding, action, expectedRevision) => {
        calls.push({ ...action, binding, expectedRevision })
      },
      publishRevision: async (binding, request) => {
        calls.push({ binding, kind: 'publishRevision', ...request })
        await options.publish?.(request)
      },
    },
  }
}

async function open(
  value: StudioHostTransport,
  mode: 'acceptance' | 'development' = 'development',
): Promise<HostSession> {
  return await createStudioHostController(value).openSession({
    artifactRoot: '/artifacts/unused-by-semantic-studio-control',
    mode,
    revision: firstRevision,
    target: 'studio-project',
  })
}

function click(session: HostSession, observation: Awaited<ReturnType<HostSession['observe']>>): HostAction {
  return {
    expectedRevision: firstRevision,
    kind: 'click',
    lease: session.descriptor().lease,
    observation,
  }
}

Describe('Studio Electrobun semantic host control', () => {
  Test('keeps concurrent semantic sessions fenced while dispatching named Studio targets', async () => {
    const fake = transport()
    const controller = createStudioHostController(fake.value)
    const [first, second] = await Promise.all([
      controller.openSession({
        artifactRoot: '/artifacts/first',
        mode: 'development',
        revision: firstRevision,
        target: 'one',
      }),
      controller.openSession({
        artifactRoot: '/artifacts/second',
        mode: 'development',
        revision: firstRevision,
        target: 'two',
      }),
    ])
    const [firstObservation, secondObservation] = await Promise.all([
      first.observe({ expectedRevision: firstRevision, target: entry }),
      second.observe({ expectedRevision: firstRevision, target: entry }),
    ])

    Expect(first.descriptor().lease).not.toEqual(second.descriptor().lease)
    Expect(firstObservation).toMatchObject({
      accessibilityLabel: 'Studio entry',
      bounds: { height: 20, width: 100, x: 12, y: 24 },
      text: 'Current Studio entry',
      visible: true,
    })
    await first.perform(click(first, firstObservation))
    await Expect(second.perform(click(first, firstObservation))).rejects.toThrow('no longer current')
    await second.perform(click(second, secondObservation))
    Expect(fake.calls.filter(call => call['kind'] === 'click')).toEqual([
      {
        binding: projectBinding,
        elementId: 'rendered-entry',
        expectedRevision: firstRevision,
        kind: 'click',
        target: entry,
      },
      {
        binding: projectBinding,
        elementId: 'rendered-entry',
        expectedRevision: firstRevision,
        kind: 'click',
        target: entry,
      },
    ])
  })

  Test('serializes a publication before rejecting a concurrent peer action against its replaced document', async () => {
    const visibleDocument = Deferred<void>()
    const fake = transport({ publish: async () => await visibleDocument.promise })
    const controller = createStudioHostController(fake.value)
    const publisher = await controller.openSession({
      artifactRoot: '/artifacts/publisher',
      mode: 'development',
      revision: firstRevision,
      target: 'publisher',
    })
    const peer = await controller.openSession({
      artifactRoot: '/artifacts/peer',
      mode: 'development',
      revision: firstRevision,
      target: 'peer',
    })
    const observation = await peer.observe({ expectedRevision: firstRevision, target: entry })

    const publication = publisher.publishRevision({
      expectedCurrentRevision: firstRevision,
      lease: publisher.descriptor().lease,
      revision: secondRevision,
    })
    await until(
      () => fake.calls.find(call => call['kind'] === 'publishRevision') !== undefined,
      { description: 'the semantic renderer publication to begin' },
    )
    const peerAction = peer.perform(click(peer, observation))
    await settle()
    Expect(fake.calls.filter(call => call['kind'] === 'click')).toEqual([])

    visibleDocument.resolve()
    await publication
    await Expect(peerAction).rejects.toThrow('no longer current')
    Expect(fake.calls).toContainEqual({
      binding: projectBinding,
      expectedCurrentRevision: firstRevision,
      kind: 'publishRevision',
      revision: secondRevision,
    })
    Expect(fake.calls.filter(call => call['kind'] === 'click')).toEqual([])
  })

  Test('preserves a nested target scope for the Electrobun renderer to resolve relative to its parent', async () => {
    const fake = transport()
    const session = await open(fake.value)

    const observation = await session.observe({ expectedRevision: firstRevision, target: scopedEntry })
    await session.perform(click(session, observation))

    Expect(fake.calls).toEqual([
      { binding: projectBinding, expectedRevision: firstRevision, kind: 'observe', target: scopedEntry },
      {
        binding: projectBinding,
        elementId: 'rendered-entry',
        expectedRevision: firstRevision,
        kind: 'click',
        target: scopedEntry,
      },
    ])
  })

  Test('retains the last good visible revision and observation when publication fails', async () => {
    const fake = transport({
      publish: async () => Errors.throwHostEnvironment('The updated preview did not become visible.'),
    })
    const session = await open(fake.value)
    const observation = await session.observe({ expectedRevision: firstRevision, target: entry })

    await Expect(session.publishRevision({
      expectedCurrentRevision: firstRevision,
      lease: session.descriptor().lease,
      revision: secondRevision,
    })).rejects.toThrow('The updated preview did not become visible.')

    Expect(session.descriptor().revision).toEqual(firstRevision)
    await session.perform(click(session, observation))
    Expect(fake.calls.at(-1)).toEqual({
      binding: projectBinding,
      elementId: 'rendered-entry',
      expectedRevision: firstRevision,
      kind: 'click',
      target: entry,
    })
  })

  Test('invalidates an observed target only after a visible development revision is published', async () => {
    const fake = transport()
    const session = await open(fake.value)
    const observation = await session.observe({ expectedRevision: firstRevision, target: entry })

    await session.publishRevision({
      expectedCurrentRevision: firstRevision,
      lease: session.descriptor().lease,
      revision: secondRevision,
    })

    Expect(session.descriptor().revision).toEqual(secondRevision)
    await Expect(session.perform(click(session, observation))).rejects.toThrow('no longer current')
    await Expect(session.observe({ expectedRevision: firstRevision, target: entry })).rejects.toThrow(
      'no longer current',
    )
  })

  Test('keeps acceptance immutable and reserves screenshots and relaunches for Appium Mac2', async () => {
    const session = await open(transport().value, 'acceptance')

    await Expect(session.publishRevision({
      expectedCurrentRevision: firstRevision,
      lease: session.descriptor().lease,
      revision: secondRevision,
    })).rejects.toThrow('Acceptance Studio sessions are immutable')
    await Expect(session.captureScreenshot('studio-window')).rejects.toThrow('Appium Mac2 acceptance transport')
    await Expect(session.perform({
      expectedRevision: firstRevision,
      kind: 'relaunchApplication',
      lease: session.descriptor().lease,
    })).rejects.toThrow('Appium Mac2 acceptance transport')
  })

  Test('reads the tokenized loopback discovery record before making semantic control RPCs', async () => {
    const requests: Array<{ body: unknown; url: string }> = []
    const host = await waitForStudioHostTransport('/artifacts/host-control.json', {
      fetch: async (input, init) => {
        requests.push({ body: JSON.parse(String(init?.body)), url: String(input) })
        return Response.json({ ok: true, value: { text: 'Current Studio entry', visible: true } })
      },
      readJson: async () => ({ capability: 'capability-1', url: 'http://127.0.0.1:47100/host-control', version: 1 }),
    })

    await host.observe(projectBinding, entry, firstRevision)

    Expect(requests).toEqual([{
      body: {
        binding: projectBinding,
        capability: 'capability-1',
        expectedRevision: firstRevision,
        operation: 'observe',
        target: entry,
      },
      url: 'http://127.0.0.1:47100/host-control',
    }])
  })

  Test('carries both sides of a revision fence through the semantic RPC', async () => {
    const requests: unknown[] = []
    const host = await waitForStudioHostTransport('/artifacts/host-control.json', {
      fetch: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return Response.json({ ok: true, value: null })
      },
      readJson: async () => ({ capability: 'capability-1', url: 'http://127.0.0.1:47100/host-control', version: 1 }),
    })

    await host.publishRevision(projectBinding, { expectedCurrentRevision: firstRevision, revision: secondRevision })

    Expect(requests).toEqual([{
      capability: 'capability-1',
      binding: projectBinding,
      expectedCurrentRevision: firstRevision,
      operation: 'publishRevision',
      revision: secondRevision,
    }])
  })

  Test('binds the active project once and carries that identity across later requests', async () => {
    const requests: unknown[] = []
    const host = await waitForStudioHostTransport('/artifacts/host-control.json', {
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { operation: string }
        requests.push(body)
        return Response.json({ ok: true, value: body.operation === 'bindProject' ? projectBinding : null })
      },
      readJson: async () => ({ capability: 'capability-1', url: 'http://127.0.0.1:47100/host-control', version: 1 }),
    })
    const session = await open(host)

    await session.perform({
      expectedRevision: firstRevision,
      key: 'Enter',
      kind: 'key',
      lease: session.descriptor().lease,
    })

    Expect(requests).toEqual([
      { capability: 'capability-1', operation: 'bindProject' },
      {
        action: { key: 'Enter', kind: 'key' },
        binding: projectBinding,
        capability: 'capability-1',
        expectedRevision: firstRevision,
        operation: 'perform',
      },
    ])
  })

  Test('matches a bound project and rejects a closed or repurposed window', () => {
    const first = { id: 1 }
    const second = { id: 2 }
    const windows = new Map([[first.id, first], [second.id, second]])
    const projectWindows = new Set([first, second])
    const windowSessions = new Map([[first.id, 'project-a'], [second.id, 'project-b']])
    const windowTokens = new Map([[first.id, 'window-one'], [second.id, 'window-two']])

    Expect(
      hostControlWindowMatches(
        projectBinding,
        windows.get(projectBinding.windowId),
        projectWindows,
        windowSessions,
        windowTokens,
      ),
    ).toBe(true)
    windowSessions.set(first.id, 'project-c')
    Expect(
      hostControlWindowMatches(
        projectBinding,
        windows.get(projectBinding.windowId),
        projectWindows,
        windowSessions,
        windowTokens,
      ),
    ).toBe(false)
    windowSessions.set(first.id, 'project-a')
    windowTokens.set(first.id, 'replacement-window')
    Expect(
      hostControlWindowMatches(
        projectBinding,
        windows.get(projectBinding.windowId),
        projectWindows,
        windowSessions,
        windowTokens,
      ),
    ).toBe(false)
    windowTokens.set(first.id, 'window-one')
    windows.delete(first.id)
    projectWindows.delete(first)
    Expect(
      hostControlWindowMatches(
        projectBinding,
        windows.get(projectBinding.windowId),
        projectWindows,
        windowSessions,
        windowTokens,
      ),
    ).toBe(false)
  })

  Test('the emitted renderer keeps an observed element through input and rejects a reordered occurrence', () => {
    const renderer = rendererHarness()
    const target: HostTarget = { kind: 'tag', occurrence: 1, value: 'row' }
    const first = renderer.element('First', 'row')
    const second = renderer.element('Second', 'row')
    renderer.order.push(first, second)

    const observed = renderer.run({ operation: 'observe', target })
    const elementId = (observed.result as { elementId: string }).elementId
    renderer.order.reverse()
    const staleClick = renderer.run({ action: { elementId, kind: 'click', target }, operation: 'perform' })
    Expect(staleClick.error).toBe('Studio semantic observation is no longer current.')
    Expect(first.clicks).toBe(0)
    Expect(second.clicks).toBe(0)

    renderer.order.reverse()
    const clicked = renderer.run({ action: { elementId, kind: 'click', target }, operation: 'perform' })
    Expect(clicked.error).toBe(undefined)
    Expect(first.clicks).toBe(1)
    Expect(second.clicks).toBe(0)

    const forScroll = renderer.run({ operation: 'observe', target })
    const scrollId = (forScroll.result as { elementId: string }).elementId
    renderer.order.reverse()
    const staleScroll = renderer.run({
      action: { deltaX: 10, deltaY: 0, kind: 'scroll', observed: { elementId: scrollId, target } },
      operation: 'perform',
    })
    Expect(staleScroll.error).toBe('Studio semantic observation is no longer current.')
    Expect(first.scrolls).toEqual([])

    renderer.order.reverse()
    const typed = renderer.run({
      action: { elementId: scrollId, kind: 'type', target, text: 'Updated' },
      operation: 'perform',
    })
    Expect(typed.error).toBe(undefined)
    Expect(first.value).toBe('Updated')
  })

  Test('the renderer rejects unsupported roles and a changed project document before input', () => {
    const renderer = rendererHarness()
    const input = renderer.element('Search', 'search')
    renderer.order.push(input)
    const roleTarget: HostTarget = { kind: 'accessibility', name: 'Search', role: 'button' }

    const role = renderer.run({ operation: 'observe', target: roleTarget })
    Expect(role.error).toBe('Studio semantic accessibility role targets are unsupported.')

    const target: HostTarget = { kind: 'tag', value: 'search' }
    const observed = renderer.run({ operation: 'observe', target })
    const elementId = (observed.result as { elementId: string }).elementId
    renderer.pathname = '/sessions/project-b'
    const changedProject = renderer.run({ action: { elementId, kind: 'click', target }, operation: 'perform' })
    Expect(changedProject.error).toBe('Studio semantic control project document changed.')
    Expect(input.clicks).toBe(0)
  })

  // REMOVAL CANDIDATE: Static native endpoint/renderer wiring; removal loses integration checks not established by mocked transport sessions.
  Test('emits the native semantic endpoint and renderer wiring', () => {
    const main = StudioElectrobun.sources({
      outputRoot: '/artifacts/unused',
      previewUrl: 'http://127.0.0.1:8081',
      studioUrl: 'http://127.0.0.1:55101',
    }).main

    Expect(main).toContain('TAO_STUDIO_HOST_CONTROL_PATH')
    Expect(main).toContain("hostname: '127.0.0.1'")
    Expect(main).toContain("url: 'http://127.0.0.1:' + hostControlServer.port + '/host-control'")
    Expect(main).toContain('type: "tao-studio-host-control"')
    Expect(main).toContain('await waitForHostControlDocument(window)')
    Expect(main).toContain('serializeHostControlOperation')
    Expect(main).toContain('hostControlOperationChain')
    Expect(main).toContain('expectedCurrentRevision')
    Expect(main).toContain('hostControlRevision = revision')
    Expect(main).toContain('hostControlReadyWindows.add(window.id)')
    Expect(main).toContain("window.webview.executeJavascript('window.location.reload()')")
    Expect(main).toContain('publishRevisionReady')
    Expect(main).toContain('target.kind === "scoped"')
    Expect(main).toContain('targetElement(target.target, targetElement(target.scope, root))')
    Expect(main).toContain('attributeValue(root, "aria-label", target.name)')
    Expect(main).not.toContain('CSS.escape')
  })
})

type RendererMessage = { error?: string; result?: unknown }

function rendererHarness(): {
  element: (label: string, tag: string) => RendererElement
  order: RendererElement[]
  pathname: string
  run: (request: Record<string, unknown>) => RendererMessage
} {
  const order: RendererElement[] = []
  const messages: RendererMessage[] = []
  let sequence = 0
  const state = { pathname: '/sessions/project-a' }
  const rendererWindow = {
    __electrobunSendToHost: (message: RendererMessage) => messages.push(message),
    location: state,
    scrollBy: (_x: number, _y: number) => {},
  }
  const document = {
    body: {},
    querySelectorAll: (selector: string) =>
      selector === '*' || selector === '[data-testid]' || selector === '[aria-label]' ? order : [],
    readyState: 'complete',
  }
  const run = (request: Record<string, unknown>): RendererMessage => {
    const script = hostControlScript({ projectSessionId: 'project-a', requestId: `request-${++sequence}`, ...request })
    new Function(
      'window',
      'document',
      'crypto',
      'HTMLInputElement',
      'HTMLTextAreaElement',
      'Event',
      'KeyboardEvent',
      script,
    )(
      rendererWindow,
      document,
      { randomUUID: () => `element-${sequence}` },
      RendererElement,
      RendererElement,
      class {},
      class {},
    )
    return messages.at(-1)!
  }
  return {
    element: (label, tag) => new RendererElement(label, tag),
    order,
    get pathname() {
      return state.pathname
    },
    set pathname(value: string) {
      state.pathname = value
    },
    run,
  }
}

class RendererElement {
  children: unknown[] = []
  clicks = 0
  isConnected = true
  scrolls: Array<[number, number]> = []
  textContent: string
  #value = ''
  readonly #tag: string

  constructor(label: string, tag: string) {
    this.textContent = label
    this.#tag = tag
  }

  click(): void {
    this.clicks += 1
  }

  dispatchEvent(_event: unknown): void {}

  get value(): string {
    return this.#value
  }

  set value(value: string) {
    this.#value = value
  }

  getAttribute(name: string): string | null {
    return name === 'data-testid' ? this.#tag : name === 'aria-label' ? this.textContent : null
  }

  getBoundingClientRect(): { height: number; width: number; x: number; y: number } {
    return { height: 20, width: 100, x: 0, y: 0 }
  }

  scrollBy(x: number, y: number): void {
    this.scrolls.push([x, y])
  }
}
