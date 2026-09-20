import type { HostAction, HostRevision, HostSession, HostTarget } from '@host-control'
import { Errors } from '@shared'
import { Deferred, Describe, Expect, settle, Test, until } from '@shared/test'
import { StudioElectrobun } from '../dev-src/studio/StudioElectrobun'
import {
  createStudioHostController,
  type StudioHostTransport,
  type StudioHostTransportPublishRevision,
  waitForStudioHostTransport,
} from '../dev-src/studio/StudioHostControl'

const firstRevision: HostRevision = { build: 'build-1', source: 'source-1' }
const secondRevision: HostRevision = { build: 'build-2', source: 'source-2' }
const entry: HostTarget = { kind: 'accessibility', name: 'Studio entry' }
const scopedEntry: HostTarget = {
  kind: 'scoped',
  scope: { kind: 'tag', value: 'workspace' },
  target: entry,
}

function transport(options: { publish?: (request: StudioHostTransportPublishRevision) => Promise<void> } = {}): {
  calls: Array<Record<string, unknown>>
  value: StudioHostTransport
} {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    value: {
      capabilities: ['inspect', 'key', 'pointer', 'refreshDocument', 'scroll', 'textInput'],
      observe: async (target, expectedRevision) => {
        calls.push({ expectedRevision, kind: 'observe', target })
        return {
          accessibilityLabel: target.kind === 'accessibility' ? target.name : undefined,
          bounds: { height: 20, width: 100, x: 12, y: 24 },
          text: 'Current Studio entry',
          visible: true,
        }
      },
      perform: async (action, expectedRevision) => {
        calls.push({ ...action, expectedRevision })
      },
      publishRevision: async request => {
        calls.push({ kind: 'publishRevision', ...request })
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
      { expectedRevision: firstRevision, kind: 'click', target: entry },
      { expectedRevision: firstRevision, kind: 'click', target: entry },
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
      { expectedRevision: firstRevision, kind: 'observe', target: scopedEntry },
      { expectedRevision: firstRevision, kind: 'click', target: scopedEntry },
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
    Expect(fake.calls.at(-1)).toEqual({ expectedRevision: firstRevision, kind: 'click', target: entry })
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

    await host.observe(entry, firstRevision)

    Expect(requests).toEqual([{
      body: { capability: 'capability-1', expectedRevision: firstRevision, operation: 'observe', target: entry },
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

    await host.publishRevision({ expectedCurrentRevision: firstRevision, revision: secondRevision })

    Expect(requests).toEqual([{
      capability: 'capability-1',
      expectedCurrentRevision: firstRevision,
      operation: 'publishRevision',
      revision: secondRevision,
    }])
  })

  Test('materializes a capability-protected semantic endpoint in the Electrobun shell', () => {
    const main = StudioElectrobun.sources({
      outputRoot: '/artifacts/unused',
      previewUrl: 'http://127.0.0.1:8081',
      studioUrl: 'http://127.0.0.1:55101',
    }).main

    Expect(main).toContain('TAO_STUDIO_HOST_CONTROL_PATH')
    Expect(main).toContain("hostname: '127.0.0.1'")
    Expect(main).toContain("url: 'http://127.0.0.1:' + hostControlServer.port + '/host-control'")
    Expect(main).toContain('type: "tao-studio-host-control"')
    Expect(main).toContain('Appium owns physical acceptance')
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
