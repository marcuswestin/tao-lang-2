import { createAppiumMac2HostController, createAppiumWebDriverClient } from '@appium-driver'
import { HostControlError, MachineResources } from '@host-control'
import { CLI, Errors, FS, Platform, ProcessTree, Repo, type TrackedProcess } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until, withCapturedOutput } from '@shared/test'
import {
  captureMac2FixtureInput,
  captureMac2FixtureSource,
  captureMac2FixtureSourceBeforeLookup,
  mac2SourceProbeFetch,
  resolveMac2FixtureTarget,
} from '../studio-smoke/StudioMac2Fixture'
import { StudioMac2TestRun } from '../studio-tooling-src/StudioMac2TestRun'
import { StudioWdaRegistration } from '../studio-tooling-src/StudioWdaRegistration'

Test(
  'fixed native fixture selectors refuse duplicate global scopes and duplicate controls through exact XPath counts',
  () => {
    const scope = "//XCUIElementTypeWebView[@label='Studio Mac2 acceptance']"
      + "[count(ancestor::XCUIElementTypeApplication//XCUIElementTypeWebView[@label='Studio Mac2 acceptance'])=1]"
      + "[count(.//XCUIElementTypeStaticText[@value='Studio Mac2 acceptance fixture'])=1]"
    Expect(resolveMac2FixtureTarget({ kind: 'accessibility', name: 'mac2-fixture' })).toEqual({
      using: 'xpath',
      value: scope,
    })
    const targets = [
      ['mac2-update', 'XCUIElementTypeButton'],
      ['mac2-input', "XCUIElementTypeTextField[@label='Acceptance text input']"],
      ['mac2-state-waiting', "XCUIElementTypeStaticText[starts-with(@value, 'Acceptance state: ')]"],
      ['mac2-state-clicked', "XCUIElementTypeStaticText[starts-with(@value, 'Acceptance state: ')]"],
      ['mac2-input-typed', "XCUIElementTypeStaticText[starts-with(@value, 'Acceptance input: ')]"],
    ] as const
    for (const [name, nativeTarget] of targets) {
      Expect(resolveMac2FixtureTarget({ kind: 'accessibility', name })).toEqual({
        using: 'xpath',
        value: `${scope}[count(.//${nativeTarget})=1]//${nativeTarget}`,
      })
    }
    Expect(() => resolveMac2FixtureTarget({ kind: 'accessibility', name: 'mac2-input', occurrence: 1 })).toThrow(
      'unique',
    )
    Expect(() => resolveMac2FixtureTarget({ kind: 'accessibility', name: 'mac2-click-state' })).toThrow(
      'no native target',
    )
    Expect(() => resolveMac2FixtureTarget({ kind: 'tag', value: 'Button' })).toThrow('unique')
  },
)

Test(
  'fixed native input proof polls stable old values until published results and propagates native refusals',
  async () => {
    const root = await mkTestDir('tao-mac2-native-input-contract-')
    const calls: string[] = []
    let clicked = false
    let typed = ''
    let screenshots = 0
    let released = false
    let fault = 'none'
    let stateReadsAfterClick = 0
    let resultReadsAfterType = 0
    const host = createAppiumMac2HostController({
      capabilities: { 'appium:automationName': 'Mac2', platformName: 'mac' },
      target: { appId: 'org.tao.fixture.only' },
      resolveTarget: resolveMac2FixtureTarget,
      desktopLeases: {
        acquire: async () => ({
          generation: 'native-fixture-generation',
          assertCurrent: async () => {
            if (fault === 'ownership' && clicked) {
              Errors.throwHostEnvironment('Owned fixture generation rotated before result publication.')
            }
          },
          release: async () => {
            released = true
          },
        }),
      },
      client: createAppiumWebDriverClient({
        request: async request => {
          calls.push(`${request.method} ${request.path}`)
          let value: unknown
          if (request.path === '/session') {
            value = { sessionId: 'fixture-session' }
          } else if (request.path.endsWith('/execute/sync')) {
            Expect(request.body).toEqual({
              script: 'macos: queryAppState',
              args: [{ bundleId: 'org.tao.fixture.only' }],
            })
            value = 4
          } else if (request.path.endsWith('/elements')) {
            const locator = request.body as { using: string; value: string }
            Expect(locator.using).toBe('xpath')
            Expect(locator.value).toContain(
              "count(ancestor::XCUIElementTypeApplication//XCUIElementTypeWebView[@label='Studio Mac2 acceptance'])=1",
            )
            const id = locator.value.endsWith('//XCUIElementTypeButton')
              ? 'button'
              : locator.value.endsWith("//XCUIElementTypeTextField[@label='Acceptance text input']")
              ? 'input'
              : locator.value.endsWith("//XCUIElementTypeStaticText[starts-with(@value, 'Acceptance state: ')]")
              ? 'state'
              : locator.value.endsWith("//XCUIElementTypeStaticText[starts-with(@value, 'Acceptance input: ')]")
              ? 'typed'
              : 'fixture'
            // Native AX still exposes the old stable node before it publishes the final text. A final-text selector
            // would return an empty collection on its first poll, which the real controller deliberately refuses.
            const unpublishedFinal = locator.value.includes("@value='Acceptance state: clicked'")
              || locator.value.includes("@value='Acceptance input: Mac2 typed this'")
            value = unpublishedFinal || (fault === 'duplicate-fixture' && id === 'fixture')
                || (fault === 'duplicate-state' && id === 'state' && clicked)
              ? []
              : [{ 'element-6066-11e4-a52e-4f735466cecf': id }]
          } else if (request.path.endsWith('/screenshot')) {
            Expect(request.path).toBe('/session/fixture-session/element/fixture/screenshot')
            screenshots++
            value = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, screenshots]).toString('base64')
          } else if (request.path.endsWith('/text')) {
            if (request.path.includes('/state/')) {
              if (clicked) {
                stateReadsAfterClick++
              }
              value = clicked && stateReadsAfterClick >= 3 ? 'Acceptance state: clicked' : 'Acceptance state: waiting'
            } else if (request.path.includes('/typed/')) {
              if (typed !== '') {
                resultReadsAfterType++
              }
              value = resultReadsAfterType >= 3 ? `Acceptance input: ${typed}` : 'Acceptance input: empty'
            } else {
              value = ''
            }
          } else if (request.path.endsWith('/displayed')) {
            value = true
          } else if (request.path.endsWith('/rect')) {
            value = { x: 56, y: 1527, width: 752, height: 394 }
          } else if (request.path.endsWith('/click')) {
            Expect(request.path).toBe('/session/fixture-session/element/button/click')
            clicked = true
          } else if (request.path.endsWith('/value')) {
            Expect(request.path).toBe('/session/fixture-session/element/input/value')
            Expect(request.body).toEqual({ text: 'Mac2 typed this', value: [...'Mac2 typed this'] })
            typed = 'Mac2 typed this'
          }
          return { status: 200, body: { value } }
        },
      }),
    })
    try {
      const session = await host.openSession({
        artifactRoot: root,
        mode: 'acceptance',
        revision: { build: 'studio-mac2-acceptance-1', source: 'studio-mac2-smoke' },
        target: 'fixture',
      })
      await captureMac2FixtureInput(session, root, 'org.tao.fixture.only')
      Expect(stateReadsAfterClick).toBe(3)
      Expect(resultReadsAfterType).toBe(3)
      const path = FS.resolvePath('appium-mac2/input-proof.json', root)
      const proof = await FS.readJson<{ before: string; after: string }>(path)
      Expect(proof).toMatchObject({
        bundleIdentifier: 'org.tao.fixture.only',
        capture: { route: 'native-xctest-element' },
        clickedState: 'Acceptance state: clicked',
        typedState: 'Acceptance input: Mac2 typed this',
      })
      Expect(await FS.fileMode(path)).toBe(0o600)
      Expect(await FS.fileMode(proof.before)).toBe(0o600)
      Expect(await FS.fileMode(proof.after)).toBe(0o600)
      Expect(calls.filter(call => call.endsWith('/element/fixture/screenshot'))).toHaveLength(2)
      Expect(calls.indexOf('GET /session/fixture-session/element/fixture/screenshot')).toBeLessThan(
        calls.indexOf('POST /session/fixture-session/element/button/click'),
      )
      Expect(calls.lastIndexOf('GET /session/fixture-session/element/fixture/screenshot')).toBeGreaterThan(
        calls.indexOf('POST /session/fixture-session/element/input/value'),
      )
      await session.close(session.descriptor().lease)
      Expect(released).toBe(true)
      Expect(calls.filter(call => call.startsWith('DELETE '))).toEqual(['DELETE /session/fixture-session'])
      for (const failure of ['duplicate-fixture', 'duplicate-state', 'ownership']) {
        fault = failure
        clicked = false
        typed = ''
        screenshots = 0
        released = false
        const artifactRoot = FS.resolvePath(failure, root)
        const refused = await host.openSession({
          artifactRoot,
          mode: 'acceptance',
          revision: { build: 'studio-mac2-acceptance-1', source: 'studio-mac2-smoke' },
          target: 'fixture',
        })
        await Expect(captureMac2FixtureInput(refused, artifactRoot, 'org.tao.fixture.only')).rejects.toThrow(
          failure === 'ownership' ? /generation rotated/ : /could not find occurrence/,
        )
        Expect(typed).toBe('')
        Expect(screenshots).toBe(failure === 'duplicate-fixture' ? 0 : 1)
        Expect(await FS.exists(FS.resolvePath('appium-mac2/input-proof.json', artifactRoot))).toBe(false)
        await refused.close(refused.descriptor().lease)
        Expect(released).toBe(true)
      }
    } finally {
      await host.close()
      await FS.remove(root)
    }
  },
)

Test(
  'fixed Mac2 source diagnostic publishes private owned XML only after its fresh fence and performs no input',
  async () => {
    const root = await mkTestDir('tao-mac2-source-contract-')
    const source = '<?xml version="1.0"?><XCUIElementTypeApplication name="Owned fixture">'
      + '<XCUIElementTypeButton label="Update acceptance state" visible="true" x="1" y="2" width="3" height="4"/>'
      + '<XCUIElementTypeStaticText value="Acceptance state: waiting"/></XCUIElementTypeApplication>'
    try {
      for (const fault of ['none', 'ownership-after-source', 'oversized-source', 'invalid-source']) {
        const artifactRoot = FS.resolvePath(fault, root)
        const operations: unknown[] = []
        let states = 0
        const work = captureMac2FixtureSource(
          {
            executeExternalUi: async operation => {
              operations.push(operation)
              if (operation.kind !== 'executeScript') {
                return Errors.throwUnexpected('Source diagnostic attempted native input.')
              }
              if (operation.script === 'macos: queryAppState') {
                states++
                if (fault === 'ownership-after-source' && states === 2) {
                  return Errors.throwHostEnvironment('Owned fixture generation changed after source capture.')
                }
                return 4
              }
              if (operation.script !== 'macos: source') {
                return Errors.throwUnexpected('Source diagnostic used another operation.')
              }
              return fault === 'oversized-source'
                ? source + ' '.repeat(256 * 1024)
                : fault === 'invalid-source'
                ? {}
                : source
            },
          },
          artifactRoot,
          'org.tao.fixture.only',
        )
        if (fault === 'none') {
          await work
          const xmlPath = FS.resolvePath('appium-mac2/native-source.xml', artifactRoot)
          Expect(await FS.readText(xmlPath)).toBe(source)
          Expect((await FS.entryMetadata(xmlPath))!.mode & 0o777).toBe(0o600)
          const summaryPath = FS.resolvePath('appium-mac2/native-source-summary.json', artifactRoot)
          Expect((await FS.entryMetadata(summaryPath))!.mode & 0o777).toBe(0o600)
          Expect(await FS.readJson(summaryPath)).toMatchObject({
            afterState: 4,
            beforeState: 4,
            bundleIdentifier: 'org.tao.fixture.only',
            inputPerformed: false,
            fixturePresence: { 'Update acceptance state': true, 'Acceptance state: waiting': true },
            elements: [{
              type: 'XCUIElementTypeButton',
              attributes: { label: 'Update acceptance state', visible: 'true', x: '1' },
            }, { type: 'XCUIElementTypeStaticText', attributes: { value: 'Acceptance state: waiting' } }],
          })
        } else {
          await Expect(work).rejects.toThrow(
            fault === 'ownership-after-source' ? /generation changed/ : /artifact contract|invalid source/,
          )
          Expect(await FS.exists(FS.resolvePath('appium-mac2/native-source.xml', artifactRoot))).toBe(false)
        }
        Expect(operations).toEqual([
          { kind: 'executeScript', script: 'macos: queryAppState', args: [{ bundleId: 'org.tao.fixture.only' }] },
          { kind: 'executeScript', script: 'macos: source', args: [{ format: 'xml' }] },
          { kind: 'executeScript', script: 'macos: queryAppState', args: [{ bundleId: 'org.tao.fixture.only' }] },
        ])
      }
      const sourceStarted = Deferred()
      const caller = new AbortController()
      const ownerSignal = Object.assign(caller.signal, { onabort: () => {} })
      let capturedSignal: unknown
      const fetcher = mac2SourceProbeFetch(async (_input, init) => {
        capturedSignal = init?.signal
        sourceStarted.resolve()
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Errors.HostEnvironmentError('Owned source request aborted.')),
            { once: true },
          )
        })
      })
      const pending = fetcher('http://127.0.0.1:47001/session/owned/execute/sync', {
        method: 'POST',
        body: JSON.stringify({ script: 'macos: source', args: [{ format: 'xml' }] }),
        signal: ownerSignal,
      })
      await sourceStarted.promise
      Expect(capturedSignal !== caller.signal).toBe(true)
      caller.abort()
      await Expect(pending).rejects.toThrow('Owned Mac2 source response was cancelled before completion.')
      const cleanupInit = { method: 'DELETE', signal: ownerSignal }
      let unchanged: RequestInit | undefined
      await mac2SourceProbeFetch(async (_input, init) => {
        unchanged = init
        return new Response('{}')
      })('http://127.0.0.1:47001/session/owned', cleanupInit)
      Expect(unchanged === cleanupInit).toBe(true)
    } finally {
      await FS.remove(root)
    }
  },
)

Test(
  'fixed source-before-lookup diagnostics record actual missing matches but propagate ownership and transport failures',
  async () => {
    const root = await mkTestDir('tao-mac2-source-lookup-')
    const source =
      '<?xml version="1.0"?><XCUIElementTypeApplication><XCUIElementTypeWebView label="Studio Mac2 acceptance">'
      + '<XCUIElementTypeStaticText value="1" title="Studio Mac2 acceptance fixture"><XCUIElementTypeStaticText value="Studio Mac2 acceptance fixture"/></XCUIElementTypeStaticText>'
      + '<XCUIElementTypeButton label=""/><XCUIElementTypeTextField label="Acceptance text input"/>'
      + '<XCUIElementTypeStaticText value="Acceptance state: waiting"/><XCUIElementTypeStaticText value="Acceptance input: empty"/>'
      + '</XCUIElementTypeWebView></XCUIElementTypeApplication>'
    try {
      for (const fault of ['ownership-after-lookup', 'found', 'missing', 'transport-failure', 'foreign-target-error']) {
        const artifactRoot = FS.resolvePath(fault, root)
        const calls: string[] = []
        let lookedUp = false
        const host = createAppiumMac2HostController({
          capabilities: { 'appium:automationName': 'Mac2', platformName: 'mac' },
          target: { appId: 'org.tao.fixture.only' },
          resolveTarget: resolveMac2FixtureTarget,
          desktopLeases: {
            acquire: async () => ({
              generation: 'source-lookup-generation',
              assertCurrent: async () => {
                if (fault === 'ownership-after-lookup' && lookedUp) {
                  Errors.throwHostEnvironment('Owned source lookup generation rotated.')
                }
              },
              release: async () => {},
            }),
          },
          client: createAppiumWebDriverClient({
            request: async request => {
              calls.push(`${request.method} ${request.path}`)
              let value: unknown
              if (request.path === '/session') {
                value = { sessionId: 'source-lookup-session' }
              } else if (request.path.endsWith('/execute/sync')) {
                const operation = request.body as { script: string; args: unknown[] }
                Expect(['macos: source', 'macos: queryAppState']).toContain(operation.script)
                value = operation.script === 'macos: source' ? source : 3
              } else if (request.path.endsWith('/elements')) {
                // The exact owned XML must be published before this single real controller lookup.
                Expect(await FS.readText(FS.resolvePath('appium-mac2/native-source.xml', artifactRoot))).toBe(source)
                Expect(request.body).toEqual(resolveMac2FixtureTarget({ kind: 'accessibility', name: 'mac2-fixture' }))
                lookedUp = true
                if (fault === 'transport-failure') {
                  return Errors.throwHostEnvironment('Appium Mac2 could not find occurrence 1 of the requested target.')
                }
                value = fault === 'found' ? [{ 'element-6066-11e4-a52e-4f735466cecf': 'fixture' }] : []
              } else if (request.path.endsWith('/displayed')) {
                value = true
              } else if (request.path.endsWith('/rect')) {
                value = { x: 56, y: 1527, width: 752, height: 394 }
              } else if (request.path.endsWith('/text')) {
                value = ''
              }
              return { status: 200, body: { value } }
            },
          }),
        })
        try {
          const session = await host.openSession({
            artifactRoot,
            mode: 'acceptance',
            revision: { build: 'studio-mac2-acceptance-1', source: 'studio-mac2-smoke' },
            target: 'fixed source diagnostic',
          })
          const diagnosticSession = fault === 'foreign-target-error'
            ? {
              executeExternalUi: session.executeExternalUi.bind(session),
              observe: async (request: Parameters<typeof session.observe>[0]) => {
                try {
                  return await session.observe(request)
                } catch {
                  return await Promise.reject(
                    new HostControlError(
                      'host',
                      'Appium Mac2 could not find occurrence 1 of the requested target.',
                      { target: { kind: 'accessibility', name: 'foreign-target' } },
                    ),
                  )
                }
              },
            }
            : session
          const work = captureMac2FixtureSourceBeforeLookup(diagnosticSession, artifactRoot, 'org.tao.fixture.only')
          const path = FS.resolvePath('appium-mac2/native-source-lookup.json', artifactRoot)
          if (fault === 'found' || fault === 'missing') {
            await work
            Expect(await FS.fileMode(path)).toBe(0o600)
            Expect(await FS.readJson(path)).toMatchObject({
              afterLookupState: 3,
              diagnosticOnly: true,
              physicalAcceptance: false,
              inputPerformed: false,
              fixtureAttributeCounts: {
                'Studio Mac2 acceptance': 1,
                'Studio Mac2 acceptance fixture': 2,
                'Update acceptance state': 0,
                'Acceptance text input': 1,
                'Acceptance state: waiting': 1,
                'Acceptance input: empty': 1,
              },
              lookup: { outcome: fault, target: 'mac2-fixture' },
            })
            Expect(calls.filter(call => call.endsWith('/execute/sync'))).toHaveLength(4)
          } else {
            await Expect(work).rejects.toThrow(
              fault === 'ownership-after-lookup' ? /generation rotated/ : fault === 'transport-failure'
                ? /request.*did not complete/
                : /could not find occurrence/,
            )
            Expect(await FS.exists(path)).toBe(false)
          }
          Expect(calls.filter(call => call.endsWith('/elements'))).toHaveLength(1)
          Expect(calls.some(call => /\/click$|\/value$|\/screenshot$|\/activate_app$/.test(call))).toBe(false)
          await session.close(session.descriptor().lease)
        } finally {
          await host.close()
        }
      }
    } finally {
      await FS.remove(root)
    }
  },
)

Test('owned Mac2 source response keeps cancellation through stalled and oversized streaming bodies', async () => {
  const endpoint = 'http://127.0.0.1:47001/session/owned/execute/sync'
  const request = { method: 'POST', body: JSON.stringify({ script: 'macos: source', args: [{ format: 'xml' }] }) }
  for (const trigger of ['deadline', 'caller']) {
    const caller = new AbortController()
    const deadline = new AbortController()
    const readStarted = Deferred()
    let cancelled = false
    let finished = false
    const pending = mac2SourceProbeFetch(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: () => {
            readStarted.resolve()
          },
          cancel: () => {
            cancelled = true
            // The transport must settle without awaiting an uncooperative platform cancellation acknowledgement.
            return new Promise<void>(() => {})
          },
        }, { highWaterMark: 0 }),
        { status: 200 },
      ), () => deadline.signal)(endpoint, {
        ...request,
        signal: Object.assign(caller.signal, { onabort: () => {} }),
      })
    void pending.then(() => {
      finished = true
    }, () => {
      finished = true
    })
    try {
      await readStarted.promise
      if (trigger === 'deadline') {
        deadline.abort()
      } else {
        caller.abort()
      }
      await until(() => finished, {
        description: `owned source body ${trigger} cancellation after headers`,
        // budget-ok: Injected cancellation is synchronous; this detects a reader that incorrectly loses its deadline after headers.
        timeoutMs: 500,
      })
      await Expect(pending).rejects.toThrow('Owned Mac2 source response was cancelled before completion.')
      Expect(cancelled).toBe(true)
    } finally {
      caller.abort()
      deadline.abort()
      void pending.catch(() => {})
    }
  }
  const deadline = new AbortController()
  let cancelled = false
  let transportAborted = false
  let chunks = 0
  await Expect(
    mac2SourceProbeFetch(async (_input, init) => {
      init?.signal?.addEventListener('abort', () => {
        transportAborted = true
      }, { once: true })
      return new Response(
        new ReadableStream<Uint8Array>({
          pull: stream => {
            if (chunks++ < 2) {
              stream.enqueue(new Uint8Array(700 * 1024))
            } else {
              stream.close()
            }
          },
          cancel: () => {
            cancelled = true
          },
        }, { highWaterMark: 0 }),
      )
    }, () => deadline.signal)(endpoint, request),
  ).rejects.toThrow('1 MiB transport body limit')
  Expect(cancelled).toBe(true)
  Expect(transportAborted).toBe(true)
  const original = new Response('{"value":"fixture"}', {
    status: 302,
    statusText: 'Found',
    headers: { 'content-type': 'application/json', location: '/owned-destination' },
  })
  const completed = await mac2SourceProbeFetch(async () => original, () => deadline.signal)(endpoint, request)
  Expect(completed.status).toBe(302)
  Expect(completed.statusText).toBe('Found')
  Expect(completed.headers.get('location')).toBe('/owned-destination')
  Expect(completed.redirected).toBe(original.redirected)
  Expect(await completed.text()).toBe('{"value":"fixture"}')
})

async function fixture() {
  const root = await mkTestDir('tao-mac2-isolation-')
  const wdaSource = FS.resolvePath('installed WDA', root)
  await FS.writeText(FS.resolvePath('WebDriverAgentMac.xcodeproj/project.pbxproj', wdaSource), 'pinned source')
  await FS.writeText(FS.resolvePath('WebDriverAgentRunner/Runner.m', wdaSource), 'runner source')
  const xcodebuild = FS.resolvePath('original-xcodebuild', root)
  await FS.writeText(xcodebuild, 'source test executable')
  const registryRoot = FS.resolvePath('registry', root)
  return {
    root,
    wdaSource,
    registryRoot,
    async prepare(id: string, scenario = 'normal', registrationOnly?: 'deny' | 'grant') {
      const calls: { command: string; options: CLI.CommandSpec }[] = []
      const http: string[] = []
      const signals: string[] = []
      const lifecycle: string[] = []
      const artifacts = FS.resolvePath(id, root)
      const pid = 12001
      const identity = { command: 'xcodebuild', pid, startedAt: 'kernel-start-1' }
      const detachedPeer = { command: 'registered runner', pid: 12002, startedAt: 'detached-kernel-start' }
      const runnerIdentity = scenario === 'held-starting-record' ? detachedPeer : identity
      const startingPublication = Deferred()
      const resumeStartingPublication = Deferred()
      let startingHeld = false
      let captureEntered = false
      let captureListenerChecked = false
      const publishedStates: string[] = []
      const publicationEnteredStates: string[] = []
      let alive = false
      let helperAlive = false
      let xcodeExit: number | null = null
      let xcodeSignal: 'SIGTERM' | 'SIGKILL' | null = null
      let xcodeError: Error | undefined
      const helperIdentity = { command: 'registration helper', pid: 12003, startedAt: 'helper-kernel-start' }
      let bound = false
      let registered = false
      let registrationFailure: unknown
      let register: (() => Promise<void>) | undefined
      let clock = 0
      let disposed = false
      let identityReads = 0
      let kernelUnknown = false
      let listener: ReturnType<typeof Bun.serve> | undefined
      let port: number | undefined
      let holdStatus = false
      let replaced = false
      let statusEntered: (() => void) | undefined
      let releaseStatus: (() => void) | undefined
      const heldStatus = new Promise<void>(resolve => {
        releaseStatus = resolve
      })
      const statusStarted = new Promise<void>(resolve => {
        statusEntered = resolve
      })
      const foreignRequests: string[] = []
      let redirectLocation: string | undefined
      let redirectStatus = 302
      let processOutput: CLI.CommandSpec['onOutput']
      const run = await StudioMac2TestRun.prepare({
        artifactRoot: artifacts,
        registryRoot,
        wdaSource,
        xcodebuild,
        registrationOnly,
        persistRecord: scenario === 'held-starting-record'
          ? async (note, value) => {
            const snapshot = value as { state: string }
            publicationEnteredStates.push(snapshot.state)
            if (snapshot.state === 'starting') {
              startingHeld = true
              startingPublication.resolve()
              await resumeStartingPublication.promise
            }
            await FS.writeJson(note, value, { mode: 0o600 })
            publishedStates.push(snapshot.state)
          }
          : undefined,
        registration: async options => {
          if (scenario.endsWith('-xcode-live-helper')) {
            helperAlive = true
            options.captureHelper(helperIdentity)
          }
          register = async () => {
            if (scenario.endsWith('-xcode-live-helper')) {
              await Promise.resolve()
              alive = false
              if (scenario === 'exited-xcode-live-helper') {
                xcodeExit = 0
              }
              if (scenario === 'sigterm-xcode-live-helper') {
                xcodeSignal = 'SIGTERM'
              }
              if (scenario === 'sigkill-xcode-live-helper') {
                xcodeSignal = 'SIGKILL'
              }
              if (scenario === 'errored-xcode-live-helper') {
                xcodeError = new Errors.HostEnvironmentError('Unprinted process error details')
              }
              return
            }
            if (scenario === 'held-starting-record') {
              await startingPublication.promise
              captureEntered = true
            }
            if (scenario === 'unregistered-owned-listener') {
              bound = true
              return
            }
            if (scenario === 'missing-registration') {
              return
            }
            if (scenario === 'pre-registration-death') {
              await Promise.resolve()
              alive = false
              return
            }
            const captured = scenario === 'wrong-registration-identity'
              ? { ...identity, startedAt: 'wrong-kernel-start' }
              : runnerIdentity
            await options.capture({
              identity: captured,
              bundleDigest: 'built-runner-digest',
              bundlePath: FS.resolvePath('Build/Products/WebDriverAgentRunner.xctest', options.derivedData),
              signedChannelRule: scenario === 'unsigned-registration' ? false as unknown as true : true,
              signedXcodeBaseline: true,
              signedBaselineDigest: Platform.sha256Hex(['(allow hid-control)\n(allow signal)\n']),
            })
            if (scenario === 'replayed-registration') {
              await options.capture({
                identity,
                bundleDigest: 'replay',
                bundlePath: options.derivedData,
                signedChannelRule: true,
                signedXcodeBaseline: true,
                signedBaselineDigest: Platform.sha256Hex(['(allow hid-control)\n(allow signal)\n']),
              })
            }
            if (scenario === 'lost-acknowledgement') {
              registrationFailure = new Errors.HostEnvironmentError('Registration acknowledgement was lost')
              return
            }
            registered = true
            bound = options.registrationOnly === undefined
          }
          return {
            acknowledged: () => registered,
            assertHealthy: () => {
              if (registrationFailure !== undefined) {
                throw registrationFailure
              }
            },
            close: async () => {
              lifecycle.push('registration-closed')
            },
            disable: async () => {
              helperAlive = false
              lifecycle.push('registration-disabled')
            },
            redact: text => text,
            sourceDigest: 'pinned-runner-source-digest',
            bootstrapDigest: 'private-patched-bootstrap-digest',
            runnerEnvironment: { TEST_RUNNER_USE_PORT: String(options.port), TEST_RUNNER_USE_HOST: '127.0.0.1' },
          }
        },
        writeLog: scenario.endsWith('log-failure')
          ? async () => Errors.throwHostEnvironment('Injected log write failure')
          : undefined,
        now: () => clock,
        sleep: async milliseconds => {
          // Missing registration never changes in this fixture; jump its synthetic readiness budget.
          clock += scenario === 'missing-registration' || scenario.endsWith('-xcode-live-helper')
            ? 240_000
            : milliseconds
        },
        identities: pids => {
          if (kernelUnknown) {
            Errors.throwHostEnvironment('Kernel process inspection unavailable')
          }
          identityReads++
          return new Map(
            pids.flatMap(value =>
              value === helperIdentity.pid && helperAlive
                ? [[value, helperIdentity]]
                : (value === pid || (scenario === 'held-starting-record' && value === detachedPeer.pid)) && alive
                ? [[
                  value,
                  scenario === 'reused-pid' && identityReads > 2
                    ? { ...identity, startedAt: 'new-kernel-start' }
                    : value === detachedPeer.pid
                    ? detachedPeer
                    : identity,
                ]]
                : []
            ),
          )
        },
        descendants: () => alive ? [identity] : [],
        signalTracked: (_processes, signal) => {
          signals.push(signal)
          if (scenario === 'kernel-inspection-unavailable') {
            kernelUnknown = true
            return
          }
          if (scenario !== 'survivor' && scenario !== 'reused-pid') {
            alive = false
            if (scenario === 'startup-redirect') {
              listener?.stop(true)
            }
          }
        },
        fetch: async (url, init) => {
          http.push(String(url))
          if (scenario === 'startup-redirect') {
            return await globalThis.fetch(url, init as RequestInit)
          }
          if (holdStatus && String(url).endsWith('/status')) {
            statusEntered?.()
            await heldStatus
          }
          if (replaced && init?.method !== undefined && init.method !== 'GET') {
            return await globalThis.fetch(url, { method: init.method })
          }
          if (redirectLocation !== undefined && init?.method !== undefined) {
            return new Response(null, { status: 302, headers: { location: redirectLocation } })
          }
          return new Response('{}', { status: 200 })
        },
        inspect: async (command, options) => {
          const args = [...(options?.args ?? [])]
          let stdout = ''
          let exitCode = 0
          if (args.some(arg => arg.startsWith('-iTCP:'))) {
            if (startingHeld && captureEntered && !registered) {
              captureListenerChecked = true
            }
            if (scenario === 'startup-log-failure' && alive) {
              return Errors.throwHostEnvironment('Owned startup listener inspection failed')
            }
            port = Number(args.find(arg => arg.startsWith('-iTCP:'))!.slice(6))
            if (
              replaced || scenario === 'foreign-before-start' || (scenario === 'foreign-after-start' && alive)
              || (scenario === 'reused-pid' && alive)
            ) {
              listener ??= Bun.serve({
                hostname: '127.0.0.1',
                port,
                fetch: request => {
                  foreignRequests.push(request.method)
                  return new Response('{}')
                },
              })
              stdout = scenario === 'reused-pid' ? `p${pid}\n` : 'p77777\n'
            } else if (alive && bound) {
              if (scenario === 'startup-redirect') {
                listener ??= Bun.serve({
                  hostname: '127.0.0.1',
                  port,
                  fetch: () => new Response(null, { status: redirectStatus, headers: { location: redirectLocation! } }),
                })
              }
              stdout = `p${runnerIdentity.pid}\n`
            }
          } else if (scenario === 'inspection-unavailable') {
            exitCode = 1
          }
          return { command, args, error: undefined, exitCode, signal: null, stderr: '', stdout }
        },
        start: (command, options = {}) => {
          processOutput = options.onOutput
          // Failed assertions must never dump the inherited process environment.
          const env = Object.fromEntries(
            ['TEST_RUNNER_USE_PORT', 'TEST_RUNNER_USE_HOST']
              .filter(key => options.env?.[key] !== undefined).map(key => [key, options.env![key]]),
          )
          calls.push({ command, options: { ...options, env } })
          alive = true
          void register!().catch(error => {
            registrationFailure = error
          })
          return {
            command,
            args: [...(options.args ?? [])],
            pid,
            get exitCode() {
              return xcodeExit
            },
            get signalCode() {
              return xcodeSignal
            },
            get error() {
              return xcodeError
            },
            closeOutput: async () => {},
            dispose: () => {
              disposed = true
            },
            endStdin: () => {},
            kill: () => false,
            onceClose: () => {},
            onceError: () => {},
            waitForClose: async () => ({ exitCode: 0, signal: null }),
            writeStdin: () => true,
          }
        },
      })
      return {
        run,
        calls,
        http,
        signals,
        lifecycle,
        emitOutput: (text: string) => processOutput?.('stderr', Buffer.from(text)),
        startingHeld: () => startingHeld,
        captureEntered: () => captureEntered,
        captureListenerChecked: () => captureListenerChecked,
        acknowledged: () => registered,
        clock: () => clock,
        publishedStates,
        publicationEnteredStates,
        resumeStartingPublication: () => resumeStartingPublication.resolve(),
        disposed: () => disposed,
        closeForeignListener: () => listener?.stop(true),
        foreignRequests,
        statusStarted,
        holdStatus: () => {
          holdStatus = true
        },
        replaceWda: () => {
          replaced = true
          listener ??= Bun.serve({
            hostname: '127.0.0.1',
            port: run.systemPort,
            fetch: request => {
              foreignRequests.push(request.method)
              return new Response('{}')
            },
          })
        },
        redirectBackend: (location: string, status = 302) => {
          redirectLocation = location
          redirectStatus = status
        },
        releaseStatus: () => {
          releaseStatus?.()
        },
      }
    },
  }
}

Test('adds exactly one canonical socket exception while preserving the copied runner sandbox entries', () => {
  const original =
    '<plist><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.network.client</key><true/><key>com.apple.security.network.server</key><true/><key>keep-original</key><string>value</string></dict></plist>'
  const patched = StudioWdaRegistration.runnerEntitlements(original, '/private/tmp/tao-wda-Ab1234/s')
  Expect(patched).toBe(
    '<plist><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.network.client</key><true/><key>com.apple.security.network.server</key><true/><key>keep-original</key><string>value</string><key>com.apple.security.temporary-exception.sbpl</key>\n<array><string>(allow network-outbound (literal "/private/tmp/tao-wda-Ab1234/s"))</string></array>\n</dict></plist>',
  )
  for (
    const path of [
      '/tmp/tao-wda-Ab1234/s',
      '/private/tmp/tao-wda-Ab1234/',
      '/private/tmp/tao-wda-Ab1234/s")) (allow default)',
      '/private/tmp/tao-wda-Ab1234/s\n',
    ]
  ) {
    Expect(() => StudioWdaRegistration.runnerEntitlements(original, path)).toThrow(
      'canonical invocation-private socket',
    )
  }
  Expect(() => StudioWdaRegistration.runnerEntitlements(patched, '/private/tmp/tao-wda-other1/s')).toThrow(
    'reviewed sandbox bootstrap',
  )
})

Test('makes the TestAction environment effective and explicitly forwards every setting to the XCTest runner', () => {
  const scheme =
    '<Scheme><LaunchAction><EnvironmentVariables><EnvironmentVariable key="USE_HOST" value="foreign-host" isEnabled="YES"/></EnvironmentVariables></LaunchAction>'
    + '<TestAction shouldUseLaunchSchemeArgsEnv="YES"><EnvironmentVariables>'
    + '<EnvironmentVariable key = "USE_PORT" value = "${USE_PORT}" isEnabled = "YES"/>'
    + '<EnvironmentVariable key = "USE_HOST" value = "${USE_HOST}" isEnabled = "YES"/>'
    + '<EnvironmentVariable key="KEEP_ME" value="original" isEnabled="YES"/>'
    + '</EnvironmentVariables></TestAction></Scheme>'
  const configured = StudioWdaRegistration.runnerConfiguration(scheme, {
    TAO_WDA_CHANNEL: '/private/fixture-channel',
    TAO_WDA_CAPABILITY: 'fixture-capability',
    TAO_WDA_GENERATION: 'fixture-generation',
    TAO_WDA_PORT: '41000',
    USE_PORT: '41000',
    USE_HOST: '127.0.0.1',
  })
  const testAction = configured.scheme.match(/<TestAction\b[\s\S]*?<\/TestAction>/)![0]
  Expect(testAction).toContain('shouldUseLaunchSchemeArgsEnv="NO"')
  const effective = Object.fromEntries([...testAction.matchAll(/key="([^"]+)" value="([^"]+)" isEnabled="YES"/g)]
    .map(match => [match[1]!, match[2]!]))
  Expect(effective).toEqual({
    TAO_WDA_CHANNEL: '/private/fixture-channel',
    TAO_WDA_CAPABILITY: 'fixture-capability',
    TAO_WDA_GENERATION: 'fixture-generation',
    TAO_WDA_PORT: '41000',
    USE_PORT: '41000',
    USE_HOST: '127.0.0.1',
    KEEP_ME: 'original',
  })
  Expect(configured.runnerEnvironment).toEqual({
    TEST_RUNNER_TAO_WDA_CHANNEL: '/private/fixture-channel',
    TEST_RUNNER_TAO_WDA_CAPABILITY: 'fixture-capability',
    TEST_RUNNER_TAO_WDA_GENERATION: 'fixture-generation',
    TEST_RUNNER_TAO_WDA_PORT: '41000',
    TEST_RUNNER_USE_PORT: '41000',
    TEST_RUNNER_USE_HOST: '127.0.0.1',
  })
  Expect(configured.scheme.match(/<LaunchAction\b[\s\S]*?<\/LaunchAction>/)![0]).toContain('value="foreign-host"')
  for (const key of ['USE_PORT', 'USE_HOST']) {
    const missing = scheme.replace(new RegExp(`<EnvironmentVariable key = "${key}"[^>]*/>`), '')
    Expect(() => StudioWdaRegistration.runnerConfiguration(missing, {})).toThrow('missing enabled port or host')
  }
  Expect(() => StudioWdaRegistration.runnerConfiguration('<Scheme/>', {})).toThrow('exactly one TestAction')
})

const nativeBarrierTest = Platform.hostPlatform === 'darwin' ? Test : Test['skip']

nativeBarrierTest(
  'copied source-probe XPath counters preserve the actual pinned resolver array and report only counts',
  async () => {
    const root = await mkTestDir('tao-mac2-xpath-counters-')
    try {
      const pinned = await FS.readText(Repo.resolvePath(
        'packages/testing/appium-driver/node_modules/appium-mac2-driver/WebDriverAgentMac/WebDriverAgentLib/Utilities/FBXPath.m',
      ))
      const patched = StudioWdaRegistration.sourceLookupXPath(pinned)
      const header = '+ (NSArray *)collectMatchingElementsWithNodes:'
      const method = patched.slice(
        patched.indexOf(header),
        patched.indexOf('+ (NSXMLDocument *)xmlRepresentationWithSnapshot:'),
      )
      const source = FS.resolvePath('counters.m', root)
      const binary = FS.resolvePath('counters', root)
      await FS.writeText(
        source,
        `#import <Foundation/Foundation.h>
#include <stdio.h>
@protocol XCUIElementSnapshot @end
@interface XCUIElement : NSObject @end
static NSString *const kXMLIndexPathKey = @"private_indexPath";
static NSArray *suppliedResult;
static NSSet *receivedHashes;
static NSUInteger calls;
@interface AMSnapshotUtils : NSObject
+ (NSArray *)elementsWithHashes:(NSSet *)hashes rootElement:(XCUIElement *)root rootSnapshot:(id<XCUIElementSnapshot>)snapshot includeOnlyFirstMatch:(BOOL)first;
@end
@implementation AMSnapshotUtils
+ (NSArray *)elementsWithHashes:(NSSet *)hashes rootElement:(XCUIElement *)root rootSnapshot:(id<XCUIElementSnapshot>)snapshot includeOnlyFirstMatch:(BOOL)first {
  calls++; receivedHashes = hashes; return suppliedResult;
}
@end
@interface FBXPath : NSObject
${method.slice(0, method.indexOf('{')).trim()};
@end
@implementation FBXPath
${method}
@end
int main(int argc, char **argv) { @autoreleasepool {
  if (argc != 2) return 2;
  int mode = atoi(argv[1]);
  NSXMLElement *one = [[NSXMLElement alloc] initWithXMLString:@"<n private_indexPath='private-token'/>" error:NULL];
  NSXMLElement *empty = [[NSXMLElement alloc] initWithXMLString:@"<n private_indexPath=''/>" error:NULL];
  NSXMLElement *missing = [[NSXMLElement alloc] initWithXMLString:@"<n/>" error:NULL];
  NSArray *nodes = mode == 0 ? @[] : mode == 2 ? @[missing] : @[one, [one copy], empty, [NSXMLNode textWithStringValue:@"private-text"]];
  suppliedResult = mode == 3 ? nil : mode == 1 ? [@[@"first", @"second"] mutableCopy] : [@[] mutableCopy];
  NSArray *actual = [FBXPath collectMatchingElementsWithNodes:nodes rootElement:nil rootSnapshot:nil includeOnlyFirstMatch:NO];
  if (mode == 0 ? calls != 0 || actual.count != 0 : calls != 1 || actual != suppliedResult) return 3;
  if (mode != 0 && receivedHashes.count != (mode == 2 ? 0 : 2)) return 4;
  puts("identity-preserved");
  return 0;
} }
`,
      )
      await CLI.mustRun('/usr/bin/clang', { args: ['-Werror', source, '-framework', 'Foundation', '-o', binary] })
      for (
        const [mode, counts] of [[0, 'xml=0 hashes=0 resolved=0'], [1, 'xml=4 hashes=1 resolved=2'], [
          2,
          'xml=1 hashes=0 resolved=0',
        ], [3, 'xml=4 hashes=1 resolved=0']] as const
      ) {
        const evaluation = await CLI.mustRun(binary, { args: [String(mode)] })
        Expect(evaluation.stdout).toBe('identity-preserved\n')
        Expect(evaluation.stderr).toBe(`WDA source lookup counts ${counts}\n`)
      }
      Expect(() => StudioWdaRegistration.sourceLookupXPath(pinned + pinned)).toThrow('reviewed diagnostic anchors')
      Expect(() => StudioWdaRegistration.sourceLookupXPath(pinned.replace('return @[];', 'return nil;'))).toThrow(
        'reviewed diagnostic anchors',
      )
    } finally {
      await FS.remove(root)
    }
  },
)

nativeBarrierTest('fixed fixture XPath counts remain exact on the pinned detached Foundation root', async () => {
  const root = await mkTestDir('tao-mac2-foundation-xpath-')
  try {
    const pinned = await FS.readText(Repo.resolvePath(
      'packages/testing/appium-driver/node_modules/appium-mac2-driver/WebDriverAgentMac/WebDriverAgentLib/Utilities/FBXPath.m',
    ))
    const categoryStart = pinned.indexOf('@interface NSString (FBXPathFixes)')
    const categoryEnd = pinned.indexOf('static NSString *const kXMLIndexPathKey', categoryStart)
    Expect(categoryStart >= 0 && categoryEnd > categoryStart).toBe(true)
    Expect(
      pinned.includes(
        'NSArray<__kindof NSXMLNode *> *matches = [rootElement nodesForXPath:[xpathQuery fb_toFixedXPathQuery]',
      ),
    ).toBe(true)
    const source = FS.resolvePath('xpath.m', root)
    const binary = FS.resolvePath('xpath', root)
    await FS.writeText(
      source,
      `#import <Foundation/Foundation.h>
${pinned.slice(categoryStart, categoryEnd)}
int main(int argc, char **argv) { @autoreleasepool {
  if (argc != 2) return 2;
  NSData *input = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[1]]];
  NSDictionary *request = [NSJSONSerialization JSONObjectWithData:input options:0 error:NULL];
  NSMutableArray *counts = [NSMutableArray array];
  for (NSString *xml in request[@"documents"]) {
    NSXMLDocument *document = [[NSXMLDocument alloc] initWithXMLString:xml options:0 error:NULL];
    NSXMLElement *snapshotRoot = [document.rootElement copy];
    if (!snapshotRoot || snapshotRoot.parent) return 3;
    NSMutableArray *row = [NSMutableArray array];
    for (NSString *query in request[@"queries"]) {
      NSError *error = nil;
      NSArray *matches = [snapshotRoot nodesForXPath:[query fb_toFixedXPathQuery] error:&error];
      if (!matches || error) return 4;
      [row addObject:@(matches.count)];
    }
    [counts addObject:row];
  }
  NSData *output = [NSJSONSerialization dataWithJSONObject:counts options:0 error:NULL];
  fwrite(output.bytes, 1, output.length, stdout);
  return 0;
} }
`,
    )
    await CLI.mustRun('/usr/bin/clang', { args: ['-Werror', source, '-framework', 'Foundation', '-o', binary] })
    // Minimal fixed nodes from the genuine fixture XML; no application menus or unrelated captured content.
    const heading =
      '<XCUIElementTypeStaticText value="1" title="Studio Mac2 acceptance fixture"><XCUIElementTypeStaticText value="Studio Mac2 acceptance fixture"/></XCUIElementTypeStaticText>'
    const button = '<XCUIElementTypeButton label=""/>'
    const input = '<XCUIElementTypeTextField label="Acceptance text input" value=""/>'
    const state = '<XCUIElementTypeStaticText value="Acceptance state: waiting"/>'
    const result = '<XCUIElementTypeStaticText value="Acceptance input: empty"/>'
    const view =
      `<XCUIElementTypeWebView label="Studio Mac2 acceptance">${heading}${button}${input}${state}${result}</XCUIElementTypeWebView>`
    const application = (content: string) =>
      `<XCUIElementTypeApplication><XCUIElementTypeWindow>${content}</XCUIElementTypeWindow></XCUIElementTypeApplication>`
    const oldScope = "//XCUIElementTypeWebView[@label='Studio Mac2 acceptance']"
      + "[count(//XCUIElementTypeWebView[@label='Studio Mac2 acceptance'])=1]"
      + "[count(.//XCUIElementTypeStaticText[@value='Studio Mac2 acceptance fixture'])=1]"
    const queries = [
      oldScope,
      ...['mac2-fixture', 'mac2-update', 'mac2-input', 'mac2-state-waiting', 'mac2-state-clicked', 'mac2-input-typed']
        .map(name => resolveMac2FixtureTarget({ kind: 'accessibility', name }).value),
    ]
    const fixture = FS.resolvePath('queries.json', root)
    await FS.writeJson(fixture, {
      queries,
      documents: [
        application(view),
        application(view + view),
        `<XCUIElementTypeApplication><XCUIElementTypeWindow>${view}</XCUIElementTypeWindow><XCUIElementTypeWindow>${view}</XCUIElementTypeWindow></XCUIElementTypeApplication>`,
        application(view.replace(heading, heading + heading)),
        application(view.replace(button, button + button)),
        application(view.replace(input, input + input)),
        application(view.replace(state, state + state)),
        application(view.replace(result, result + result)),
        application(view.replace('label="Studio Mac2 acceptance"', 'label="Foreign fixture"')),
      ],
    })
    const evaluation = await CLI.mustRun(binary, { args: [fixture] })
    Expect(JSON.parse(evaluation.stdout)).toEqual([
      [0, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 1, 1, 1, 1],
      [0, 1, 1, 0, 1, 1, 1],
      [0, 1, 1, 1, 0, 0, 1],
      [0, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ])
  } finally {
    await FS.remove(root)
  }
})

Test('owned recursive fixture removal unlinks container symlinks while preserving their external targets', async () => {
  const root = await mkTestDir('tao-wda-fixture-removal-')
  try {
    const container = FS.resolvePath('owned-container', root)
    const external = FS.resolvePath('external-target', root)
    const ownership = await StudioWdaRegistration.fixtureOwnership({
      containerPath: container,
      notePath: FS.resolvePath('ownership.json', root),
      details: { invocation: 'source-fixture' },
    })
    await FS.writeText(FS.resolvePath('sentinel.txt', external), 'preserved')
    await FS.mkdir(container)
    await FS.symlink(external, FS.resolvePath('Documents', container))
    await ownership.close()
    Expect(await FS.exists(container)).toBe(false)
    Expect(await FS.readText(FS.resolvePath('sentinel.txt', external))).toBe('preserved')
    Expect(await FS.readJson(FS.resolvePath('ownership.json', root))).toMatchObject({
      state: 'removed-or-not-created',
      symlinksUnlinked: 1,
    })
  } finally {
    await FS.remove(root)
  }
})
for (const code of ['EACCES', 'EPERM']) {
  Test(`fixture baseline retains unknown ownership after strict metadata ${code}`, async () => {
    const root = await mkTestDir('tao-wda-fixture-baseline-')
    const notePath = FS.resolvePath('ownership.json', root)
    try {
      await Expect(StudioWdaRegistration.fixtureOwnership({
        containerPath: FS.resolvePath('unknown-container', root),
        notePath,
        details: { invocation: 'source-baseline' },
        inspect: async () => {
          throw Object.assign(new Errors.HostEnvironmentError(`fixture inspection ${code}`), { code })
        },
      })).rejects.toThrow(`fixture inspection ${code}`)
      const baseline = await FS.readJson<Record<string, unknown>>(notePath)
      Expect(baseline['state']).toBe('retained-baseline-inspection-unavailable')
      Expect(baseline['containerAbsent']).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })
  Test(`fixture cleanup retains its container after strict metadata ${code}`, async () => {
    const root = await mkTestDir('tao-wda-fixture-inspection-')
    const container = FS.resolvePath('owned-container', root)
    const notePath = FS.resolvePath('ownership.json', root)
    const denied = Object.assign(new Errors.HostEnvironmentError(`fixture inspection ${code}`), { code })
    try {
      let inspectFailure = false
      const ownership = await StudioWdaRegistration.fixtureOwnership({
        containerPath: container,
        notePath,
        details: { invocation: 'source-cleanup' },
        inspect: async path => {
          if (inspectFailure && path === container) {
            throw denied
          }
          return await FS.entryMetadata(path)
        },
      })
      await FS.writeText(FS.resolvePath('sentinel.txt', container), 'retained')
      inspectFailure = true
      await Expect(ownership.close()).rejects.toThrow(`fixture inspection ${code}`)
      const retained = await FS.readJson<Record<string, unknown>>(notePath)
      Expect(retained['state']).toBe('retained-container-inspection-unavailable')
      Expect(retained['created']).toBeUndefined()
      Expect(retained['safeNextAction']).toBe(
        'owner-reviewed inspection after child closure; preserve unknown resources',
      )
      Expect(await FS.readText(FS.resolvePath('sentinel.txt', container))).toBe('retained')
    } finally {
      await FS.remove(root)
    }
  })
}
Test(
  'post-spawn fixture publication failure joins the retained real child before container inspection and removal',
  async () => {
    const root = await mkTestDir('tao-wda-fixture-publication-')
    const container = FS.resolvePath('owned-container', root)
    const notePath = FS.resolvePath('ownership.json', root)
    const ready = Deferred()
    const events: string[] = []
    let peer: ReturnType<typeof CLI.start> | undefined
    let identity: TrackedProcess | undefined
    let cleanupInspection = false
    try {
      const ownership = await StudioWdaRegistration.fixtureOwnership({
        containerPath: container,
        notePath,
        details: { invocation: 'source-publication' },
        inspect: async path => {
          if (cleanupInspection && path === container) {
            Expect(peer!.signalCode).toBe('SIGTERM')
            events.push('container-inspected')
          }
          return await FS.entryMetadata(path)
        },
        publish: async record => {
          if (record['state'] === 'peer-started') {
            events.push('publication-failed')
            Errors.throwHostEnvironment('fixture peer publication failed')
          }
          await FS.writeJson(notePath, record)
        },
      })
      await FS.writeText(FS.resolvePath('sentinel.txt', container), 'owned')
      peer = CLI.start(Platform.runtimeProcess.execPath, {
        args: [
          '-e',
          'import { Platform } from "@shared"; Platform.runtimeProcess.stdout.write("READY\\n"); setInterval(() => {}, 1000);',
        ],
        cwd: Repo.resolvePath('packages/ides/studio-tooling'),
        processPolicy: 'test',
        timeoutMs: 10_000,
        stdio: 'pipe',
        onOutput: (_stream, chunk) => {
          if (chunk.toString().includes('READY')) {
            ready.resolve()
          }
        },
      })
      peer.onceClose(() => events.push('child-closed'))
      await ready.promise
      identity = ProcessTree.identities([peer.pid!]).get(peer.pid!)
      await Expect(ownership.captureStarted(peer)).rejects.toThrow('fixture peer publication failed')
      cleanupInspection = true
      await ownership.close()
      Expect(events).toEqual(['publication-failed', 'child-closed', 'container-inspected'])
      Expect(await FS.exists(container)).toBe(false)
      Expect(await FS.readJson(notePath)).toMatchObject({
        peersJoined: true,
        peersClosed: true,
        state: 'removed-or-not-created',
      })
    } finally {
      if (identity !== undefined) {
        ProcessTree.signalTracked([identity], 'SIGTERM')
      }
      if (peer !== undefined) {
        await peer.waitForClose()
      }
      await FS.remove(root)
    }
  },
)
Test(
  'an uncaptured fixture identity joins its real finite child without signalling and retains the container fence',
  async () => {
    const root = await mkTestDir('tao-wda-fixture-unknown-peer-')
    const container = FS.resolvePath('owned-container', root)
    const notePath = FS.resolvePath('ownership.json', root)
    let peer: ReturnType<typeof CLI.start> | undefined
    try {
      const ownership = await StudioWdaRegistration.fixtureOwnership({
        containerPath: container,
        notePath,
        details: { invocation: 'source-unknown' },
      })
      await FS.writeText(FS.resolvePath('sentinel.txt', container), 'retained')
      peer = CLI.start(Platform.runtimeProcess.execPath, {
        args: ['-e', 'import { Platform } from "@shared"; setTimeout(() => Platform.runtimeProcess.exit(0), 100);'],
        cwd: Repo.resolvePath('packages/ides/studio-tooling'),
        processPolicy: 'test',
        timeoutMs: 10_000,
      })
      let joined = false
      const unknown: ReturnType<typeof CLI.start> = {
        ...peer,
        pid: undefined,
        waitForClose: async () => {
          const result = await peer!.waitForClose()
          joined = true
          return result
        },
      }
      await Expect(ownership.captureStarted(unknown)).rejects.toThrow('kernel identity was unavailable')
      await Expect(ownership.close()).rejects.toThrow('peer closure was unproved')
      Expect(joined).toBe(true)
      Expect(peer.signalCode).toBeNull()
      Expect(peer.exitCode).toBe(0)
      Expect(await FS.readText(FS.resolvePath('sentinel.txt', container))).toBe('retained')
      Expect(await FS.readJson(notePath)).toMatchObject({ state: 'retained-peer-closure-unproved' })
    } finally {
      if (peer !== undefined) {
        await peer.waitForClose()
      }
      await FS.remove(root)
    }
  },
)
nativeBarrierTest(
  'native signed entitlement policy accepts only the exact socket and unique pinned Xcode baseline',
  async () => {
    const root = await mkTestDir('tao-wda-signed-policy-')
    const source = FS.resolvePath('policy.c', root)
    const binary = FS.resolvePath('policy', root)
    const helper = Repo.resolvePath('packages/ides/studio-tooling/studio-tooling-src/StudioWdaRegistration.c')
    try {
      await FS.writeText(
        source,
        `#define main wda_controller_main\n#include "${helper}"\n#undef main\nint main(int argc, char **argv) { if (argc != 2) return 2; if (strncmp(argv[1], "message-", 8) == 0) { const char *received = strcmp(argv[1], "message-valid") == 0 ? "generation\\tcapability\\n" : strcmp(argv[1], "message-wrong-generation") == 0 ? "wrong-generation\\tcapability\\n" : "generation\\twrong-capability\\n"; return registration_message_valid(received, "generation\\tcapability\\n") ? 0 : controller_failure("registration-message", 13); } if (strncmp(argv[1], "bundle-", 7) == 0) { const char *root = "/private/tmp/grant/DerivedData"; const char *path = strcmp(argv[1], "bundle-valid") == 0 ? "/private/tmp/grant/DerivedData/Build/Products/WebDriverAgentRunner.xctest/Contents/MacOS/WebDriverAgentRunner" : "/private/tmp/grant/foreign/WebDriverAgentRunner.xctest/Contents/MacOS/WebDriverAgentRunner"; return bundle_candidate(path, strlen(path), root) ? 0 : controller_failure("loaded-bundle", 13); } if (strcmp(argv[1], "digests") == 0) { char a[65], b[65]; baseline_digest(0, a); baseline_digest(1, b); printf("%s\\n%s\\n", a, b); return 0; } if (strcmp(argv[1], "diagnostics") == 0) { security_status("guest", -67050); return controller_failure("loaded-bundle", 13); } CFStringRef text = CFStringCreateWithCString(NULL, argv[1], kCFStringEncodingUTF8); CFDataRef data = CFStringCreateExternalRepresentation(NULL, text, kCFStringEncodingUTF8, 0); CFPropertyListRef value = CFPropertyListCreateWithData(NULL, data, kCFPropertyListImmutable, NULL, NULL); int ok = channel_entitlements(value, "/private/tmp/tao-wda-Ab1234/s"); if (value) CFRelease(value); CFRelease(data); CFRelease(text); return ok ? 0 : 3; }`,
      )
      await CLI.mustRun('/usr/bin/clang', {
        args: [
          '-Werror',
          '-Wno-deprecated-declarations',
          source,
          '-framework',
          'Security',
          '-framework',
          'CoreFoundation',
          '-o',
          binary,
        ],
      })
      const exact =
        '<plist><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.temporary-exception.sbpl</key><array><string>(allow network-outbound (literal "/private/tmp/tao-wda-Ab1234/s"))</string></array></dict></plist>'
      Expect((await CLI.run(binary, { args: [exact] })).exitCode).toBe(0)
      const socket = '<string>(allow network-outbound (literal "/private/tmp/tao-wda-Ab1234/s"))</string>'
      const hid = '<string>(allow hid-control)</string>'
      const signal = '<string>(allow signal)</string>'
      const profile = (rules: string) => exact.replace(socket, rules)
      for (
        const rules of [
          socket + hid + signal,
          socket + signal + hid,
          hid + socket + signal,
          hid + signal + socket,
          signal + hid + socket,
          signal + socket + hid,
        ]
      ) {
        Expect((await CLI.run(binary, { args: [profile(rules)] })).exitCode).toBe(0)
      }
      for (
        const invalid of [
          exact.replace('<true/>', '<false/>'),
          exact.replace('<true/>', '<integer>1</integer>'),
          exact.replace('Ab1234', 'other1'),
          exact.replace('(literal "/private/tmp/tao-wda-Ab1234/s")', '(subpath "/private/tmp")'),
          exact.replace('</array>', '<string>(allow default)</string></array>'),
          '<plist><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>',
          profile(hid + signal),
          profile(socket + socket + signal),
          profile(socket + hid + hid),
          profile(socket + signal + signal),
          profile(socket + hid + signal + '<string>(allow default)</string>'),
          profile(socket + hid + signal + socket),
          profile(socket + hid + '<integer>1</integer>'),
          profile(socket + hid + '<true/>'),
          profile(socket + hid + '<string>(allow Signal)</string>'),
          exact.replace(`<array>${socket}</array>`, socket),
        ]
      ) {
        const result = await CLI.run(binary, { args: [invalid] })
        Expect(result.exitCode).toBe(3)
        Expect(result.stderr).toMatch(
          /^WDA registration failure category=signed-entitlement-policy sandbox=[01] exact-rule=[01] sbpl-type=(array|string|missing|other) count=(-1|[0-9]+) socket-matches=[0-9]+ hid-matches=[0-9]+ signal-matches=[0-9]+\n$/,
        )
        Expect(result.stderr.includes('tao-wda-Ab1234')).toBe(false)
      }
      for (const mode of ['message-valid', 'bundle-valid']) {
        Expect((await CLI.run(binary, { args: [mode] })).exitCode).toBe(0)
      }
      for (const mode of ['message-wrong-generation', 'message-wrong-capability', 'bundle-foreign']) {
        const refusal = await CLI.run(binary, { args: [mode] })
        Expect(refusal.exitCode).toBe(13)
        Expect(refusal.stderr).toBe(
          `WDA registration failure category=${
            mode.startsWith('message-') ? 'registration-message' : 'loaded-bundle'
          }\n`,
        )
      }
      const diagnostic = await CLI.run(binary, { args: ['diagnostics'] })
      Expect(diagnostic.exitCode).toBe(13)
      Expect(diagnostic.stderr).toBe(
        'WDA registration failure category=security-guest status=-67050\n'
          + 'WDA registration failure category=loaded-bundle\n',
      )
      const digests = await CLI.run(binary, { args: ['digests'] })
      Expect(digests.exitCode).toBe(0)
      Expect(digests.stdout).toBe(
        `${Platform.sha256Hex([''])}\n${Platform.sha256Hex(['(allow hid-control)\n(allow signal)\n'])}\n`,
      )
    } finally {
      await FS.remove(root)
    }
  },
)
for (
  const [terminal, expected] of [
    ['SIGTERM', 'WDA registration helper exited before acknowledgement (signal SIGTERM)'],
    ['SIGKILL', 'WDA registration helper exited before acknowledgement (signal SIGKILL)'],
    ['error', 'WDA registration helper failed before acknowledgement (process error)'],
  ]
) {
  nativeBarrierTest(`checks actual registration controller health after helper ${terminal}`, async () => {
    const root = await mkTestDir('tao-wda-helper-health-')
    const bootstrapRoot = FS.resolvePath('copied', root)
    const originalXPath = await FS.readText(Repo.resolvePath(
      'packages/testing/appium-driver/node_modules/appium-mac2-driver/WebDriverAgentMac/WebDriverAgentLib/Utilities/FBXPath.m',
    ))
    const xpathPath = FS.resolvePath('WebDriverAgentLib/Utilities/FBXPath.m', bootstrapRoot)
    await FS.writeText(xpathPath, originalXPath)
    await FS.writeText(
      FS.resolvePath('WebDriverAgentRunner/WebDriverAgentRunner.m', bootstrapRoot),
      '  FBWebServer *webServer = [[FBWebServer alloc] init];',
    )
    await FS.writeText(FS.resolvePath('WebDriverAgentMac.xcodeproj/project.pbxproj', bootstrapRoot), 'fixture project')
    await FS.writeText(
      FS.resolvePath('WebDriverAgentRunner/WebDriverAgentRunner.entitlements', bootstrapRoot),
      '<plist><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>',
    )
    await FS.writeText(
      FS.resolvePath('WebDriverAgentMac.xcodeproj/xcshareddata/xcschemes/WebDriverAgentRunner.xcscheme', bootstrapRoot),
      '<TestAction><EnvironmentVariables><EnvironmentVariable key="USE_PORT" value="${USE_PORT}" isEnabled="YES"/>'
        + '<EnvironmentVariable key="USE_HOST" value="${USE_HOST}" isEnabled="YES"/></EnvironmentVariables></TestAction>',
    )
    const fixtureSource = FS.resolvePath('ready-helper.c', root)
    const fixtureBinary = FS.resolvePath('ready-helper', root)
    await FS.writeText(
      fixtureSource,
      '#include <stdio.h>\n#include <unistd.h>\nint main(void) { puts("READY"); fflush(stdout); for (;;) pause(); }',
    )
    await CLI.mustRun('/usr/bin/clang', { args: ['-Werror', fixtureSource, '-o', fixtureBinary] })
    let processError: Error | undefined
    let disposed = false
    let capturedHelper: TrackedProcess | undefined
    let capturedPeer = false
    let child: ReturnType<typeof CLI.start> | undefined
    let registration: Awaited<ReturnType<typeof StudioWdaRegistration.prepare>> | undefined
    try {
      registration = await StudioWdaRegistration.prepare({
        bootstrapRoot,
        derivedData: FS.resolvePath('DerivedData', root),
        root,
        generation: 'fixture-generation',
        port: 41000,
        registrationOnly: terminal === 'SIGTERM' ? undefined : 'grant',
        ...(terminal === 'error' ? { sourceLookupProbe: true } : {}),
        capture: async () => {
          capturedPeer = true
        },
        captureHelper: value => {
          capturedHelper = value
        },
        startHelper: (_command, options = {}) => {
          child = CLI.start(fixtureBinary, { ...options, args: [] })
          return {
            ...child,
            get exitCode() {
              return child!.exitCode
            },
            get signalCode() {
              return child!.signalCode
            },
            get error() {
              return processError ?? child!.error
            },
            dispose: () => {
              // Keep the fixture's close observer until independent teardown has joined completion.
              disposed = true
            },
          }
        },
      })
      Expect(capturedHelper?.pid).toBe(child!.pid!)
      const copiedXPath = await FS.readText(xpathPath)
      if (terminal === 'error') {
        Expect(copiedXPath).toBe(StudioWdaRegistration.sourceLookupXPath(originalXPath))
        Expect(registration.sourceLookupProvenance).toEqual({
          originalDigest: Platform.sha256Hex([originalXPath]),
          patchedDigest: Platform.sha256Hex([copiedXPath]),
        })
      } else {
        Expect(copiedXPath).toBe(originalXPath)
        Expect(registration.sourceLookupProvenance).toBeUndefined()
      }
      Expect(registration.bootstrapDigest).toBe(Platform.sha256Hex([
        await FS.readFile(FS.resolvePath('WebDriverAgentRunner/WebDriverAgentRunner.m', bootstrapRoot)),
        await FS.readFile(
          FS.resolvePath(
            'WebDriverAgentMac.xcodeproj/xcshareddata/xcschemes/WebDriverAgentRunner.xcscheme',
            bootstrapRoot,
          ),
        ),
        await FS.readFile(FS.resolvePath('WebDriverAgentRunner/WebDriverAgentRunner.entitlements', bootstrapRoot)),
        await FS.readText(Repo.resolvePath('packages/ides/studio-tooling/studio-tooling-src/StudioWdaRegistration.c')),
        ...(terminal === 'error' ? [originalXPath, copiedXPath] : []),
      ]))
      const bootstrap = await FS.readText(FS.resolvePath('WebDriverAgentRunner/WebDriverAgentRunner.m', bootstrapRoot))
      const backend = bootstrap.indexOf('  FBWebServer *webServer = [[FBWebServer alloc] init];')
      Expect(backend >= 0).toBe(true)
      const probeReturn = bootstrap.indexOf(
        '  return; // Fixed registration-only engineering probe; never constructs a backend.',
      )
      if (terminal === 'SIGTERM') {
        Expect(probeReturn).toBe(-1)
      } else {
        Expect(probeReturn > bootstrap.indexOf('if (!tao_wda_register())')).toBe(true)
        Expect(probeReturn < backend).toBe(true)
        const replay = bootstrap.indexOf('if (tao_wda_register())')
        Expect(replay > bootstrap.indexOf('if (!tao_wda_register())')).toBe(true)
        Expect(replay < probeReturn).toBe(true)
        Expect(bootstrap.indexOf('WDA registration-only replay refused') > replay).toBe(true)
      }
      Expect(ProcessTree.sameProcess(ProcessTree.identities([child!.pid!]).get(child!.pid!), capturedHelper!)).toBe(
        true,
      )
      Expect(() => registration!.assertHealthy()).not.toThrow()
      if (terminal === 'error') {
        processError = new Errors.HostEnvironmentError('Unprinted process error details')
      } else {
        ProcessTree.signalTracked([capturedHelper!], terminal as 'SIGTERM' | 'SIGKILL')
        Expect(await child!.waitForClose()).toMatchObject({ exitCode: null, signal: terminal })
        Expect(child!.exitCode).toBeNull()
        Expect(child!.signalCode).toBe(terminal!)
      }
      Expect(() => registration!.assertHealthy()).toThrow(expected!)
      Expect(registration.acknowledged()).toBe(false)
      Expect(capturedPeer).toBe(false)
      await registration.close()
      Expect(disposed).toBe(true)
      Expect(ProcessTree.sameProcess(ProcessTree.identities([child!.pid!]).get(child!.pid!), capturedHelper!)).toBe(
        false,
      )
      Expect((await FS.readJson<{ state: string }>(FS.resolvePath('registration-external-directory.json', root))).state)
        .toBe('removed')
    } finally {
      await registration?.close()
      if (child !== undefined && capturedHelper !== undefined) {
        ProcessTree.signalTracked([capturedHelper], 'SIGKILL')
        await child.waitForClose()
        child.dispose()
      }
      await FS.remove(root)
    }
  })
}
nativeBarrierTest(
  'reports native barrier failure categories without printing registration credentials or paths',
  async () => {
    const root = await mkTestDir('tao-wda-barrier-diagnostic-')
    const source = FS.resolvePath('barrier.c', root)
    const binary = FS.resolvePath('barrier', root)
    const helper = Repo.resolvePath('packages/ides/studio-tooling/studio-tooling-src/StudioWdaRegistration.c')
    try {
      await FS.writeText(
        source,
        `#define TAO_WDA_RUNNER\n#include "${helper}"\nint main(int argc, char **argv) { if (argc > 1) unsetenv(argv[1]); return tao_wda_register() ? 0 : 3; }`,
      )
      await CLI.mustRun('/usr/bin/clang', { args: ['-Werror', source, '-o', binary] })
      const objectiveSource = FS.resolvePath('barrier.m', root)
      await FS.writeText(
        objectiveSource,
        `#import <Foundation/Foundation.h>\n#define TAO_WDA_RUNNER\n#define TAO_WDA_ENV_VALUE(key) [NSProcessInfo.processInfo.environment[@key] UTF8String]\n#include "${helper}"\nint main(void) { return tao_wda_register() ? 0 : 3; }`,
      )
      await CLI.mustRun('/usr/bin/clang', { args: ['-Werror', '-fsyntax-only', objectiveSource] })
      const environment = {
        TAO_WDA_CHANNEL: '/private/do-not-print-channel',
        TAO_WDA_CAPABILITY: 'do-not-print-capability',
        TAO_WDA_GENERATION: 'do-not-print-generation',
        TAO_WDA_PORT: '41000',
        USE_PORT: '41000',
        USE_HOST: '127.0.0.1',
      }
      for (const key of Object.keys(environment)) {
        const result = await CLI.run(binary, { args: [key], env: { ...Platform.runtimeProcess.env, ...environment } })
        Expect(result.exitCode).toBe(3)
        Expect(result.stderr).toBe(`WDA launch registration failure category=missing-${key}\n`)
        Expect(result.stdout).toBe('')
      }
      for (
        const [key, value, category] of [['USE_PORT', '41001', 'port-mismatch'], [
          'USE_HOST',
          'foreign-host',
          'host-mismatch',
        ]]
      ) {
        const result = await CLI.run(binary, {
          env: { ...Platform.runtimeProcess.env, ...environment, [key!]: value! },
        })
        Expect(result.exitCode).toBe(3)
        Expect(result.stderr).toBe(`WDA launch registration failure category=${category}\n`)
      }
      const refused = await CLI.run(binary, {
        env: { ...Platform.runtimeProcess.env, ...environment, TAO_WDA_CHANNEL: FS.resolvePath('absent-socket', root) },
      })
      Expect(refused.exitCode).toBe(3)
      Expect(refused.stderr).toBe(
        'WDA launch registration connect errno=2\nWDA launch registration failure category=channel-connect\n',
      )
    } finally {
      await FS.remove(root)
    }
  },
)

Describe('Mac2 invocation isolation', () => {
  Test(
    'registration-only grant acknowledges durable signed provenance without backend HTTP or forwarding',
    async () => {
      const test = await fixture()
      const state = await test.prepare('run', 'normal', 'grant')
      try {
        const desktop = await state.run.desktopLeases.acquire()
        Expect(await state.run.registrationOnlyReplayComplete()).toBe(false)
        Expect(await FS.exists(FS.resolvePath('run/appium-mac2/wda.log', test.root))).toBe(false)
        const completed = until(() => state.run.registrationOnlyReplayComplete(), {
          description: 'captured owned runner replay marker',
          // budget-ok: This genuine factory fixture emits the split marker synchronously after ACK; a missing marker must fail promptly.
          timeoutMs: 500,
          intervalMs: 1,
        })
        state.emitOutput('WDA registration-only replay ')
        Expect(await state.run.registrationOnlyReplayComplete()).toBe(false)
        state.emitOutput('refused\n')
        Expect(await completed).toBe(true)
        Expect(state.signals).toEqual([])
        Expect(state.http).toEqual([])
        Expect(await FS.readJson(FS.resolvePath('run/appium-mac2/isolation.json', test.root))).toMatchObject({
          state: 'registration-only-acknowledged',
          registration: { signedChannelRule: true, bundleDigest: 'built-runner-digest' },
        })
        const response = await globalThis.fetch(`${state.run.webDriverAgentMacUrl}/status`)
        Expect(response.status).toBe(503)
        Expect(await response.text()).toBe('Owned WDA forwarding is disabled.')
        Expect(state.http).toEqual([])
        await desktop.release()
        Expect(await state.run.registrationOnlyReplayComplete()).toBe(false)
        await state.run.cleanup(true)
        Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      } finally {
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    },
  )
  for (
    const [scenario, message] of [
      [
        'sigterm-xcode-live-helper',
        'recorded Xcode process exited before WDA registration acknowledgement (signal SIGTERM)',
      ],
      [
        'sigkill-xcode-live-helper',
        'recorded Xcode process exited before WDA registration acknowledgement (signal SIGKILL)',
      ],
      [
        'errored-xcode-live-helper',
        'recorded Xcode process failed before WDA registration acknowledgement (process error)',
      ],
    ]
  ) {
    Test(`fails before readiness when ${scenario} while preserving independent rollback`, async () => {
      const test = await fixture()
      const state = await test.prepare('run', scenario)
      try {
        await Expect(state.run.desktopLeases.acquire()).rejects.toThrow(message!)
        Expect(state.clock()).toBe(0)
        Expect(state.http).toEqual([])
        Expect(state.acknowledged()).toBe(false)
        await state.run.cleanup(true)
        Expect(state.lifecycle).toEqual(['registration-disabled', 'registration-closed'])
        Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      } finally {
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    })
  }
  Test(
    'fails immediately when recorded Xcode exits before ACK even while its registration helper survives',
    async () => {
      const test = await fixture()
      const state = await test.prepare('run', 'exited-xcode-live-helper')
      try {
        await Expect(state.run.desktopLeases.acquire()).rejects.toThrow(
          'recorded Xcode process exited before WDA registration acknowledgement (exit 0)',
        )
        Expect(state.clock()).toBe(0)
        Expect(state.http).toEqual([])
        Expect(state.acknowledged()).toBe(false)
        await state.run.cleanup(true)
        Expect(state.lifecycle).toEqual(['registration-disabled', 'registration-closed'])
        Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      } finally {
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    },
  )
  Test('orders the held starting receipt before durable peer registration and acknowledgement', async () => {
    const test = await fixture()
    const state = await test.prepare('run', 'held-starting-record')
    const acquiring = state.run.desktopLeases.acquire()
    void acquiring.catch(() => {})
    let desktop: Awaited<typeof acquiring> | undefined
    try {
      await until(() => state.startingHeld() && state.captureListenerChecked())
      await settle()
      Expect(state.publicationEnteredStates).toEqual(['reserved', 'starting'])
      Expect(state.acknowledged()).toBe(false)
      Expect(state.publishedStates).toEqual(['reserved'])
      state.resumeStartingPublication()
      desktop = await acquiring
      Expect(state.publishedStates).toEqual(['reserved', 'starting', 'registered-before-bind', 'ready'])
      Expect(await FS.readJson(FS.resolvePath('run/appium-mac2/isolation.json', test.root))).toMatchObject({
        state: 'ready',
        processes: [
          { pid: 12001, startedAt: 'kernel-start-1' },
          { pid: 12002, startedAt: 'detached-kernel-start' },
        ],
        registration: { bundleDigest: 'built-runner-digest' },
      })
    } finally {
      state.resumeStartingPublication()
      desktop ??= await acquiring.catch(() => undefined)
      await desktop?.release()
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  Test('refuses startup status redirects before readiness without contacting their destination', async () => {
    const test = await fixture()
    const destinationRequests: string[] = []
    const destination = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: request => {
        destinationRequests.push(request.method)
        return new Response('{}')
      },
    })
    try {
      for (const status of [300, 302, 307, 308, 399]) {
        const state = await test.prepare(`redirect-${status}`, 'startup-redirect')
        state.redirectBackend(`http://127.0.0.1:${destination.port}/foreign`, status)
        try {
          await Expect(state.run.desktopLeases.acquire()).rejects.toThrow('startup refused a backend redirect')
          Expect(state.http).toEqual([`http://127.0.0.1:${state.run.systemPort}/status`])
          Expect(destinationRequests).toEqual([])
          await state.run.cleanup(true)
        } finally {
          state.closeForeignListener()
          await state.run.cleanup(true).catch(() => {})
        }
      }
    } finally {
      destination.stop(true)
      await FS.remove(test.root)
    }
  })

  for (
    const scenario of [
      'wrong-registration-identity',
      'unsigned-registration',
      'replayed-registration',
      'lost-acknowledgement',
      'pre-registration-death',
      'missing-registration',
      'unregistered-owned-listener',
    ]
  ) {
    Test(`rejects ${scenario} without readiness HTTP and independently rolls back`, async () => {
      const test = await fixture()
      const state = await test.prepare('run', scenario)
      try {
        await Expect(state.run.desktopLeases.acquire()).rejects.toThrow(
          /registration|acknowledgement|identity|readiness|ready|signed/,
        )
        Expect(state.http).toEqual([])
        await state.run.cleanup(true)
        Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      } finally {
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    })
  }

  Test('joins concurrent WDA teardown and cleanup before releasing the owned fences', async () => {
    const test = await fixture()
    const state = await test.prepare('run')
    try {
      const desktop = await state.run.desktopLeases.acquire()
      await Promise.all([desktop.release(), desktop.release()])
      await Promise.all([state.run.cleanup(true), state.run.cleanup(true)])
      Expect(state.signals).toEqual(['SIGTERM'])
      Expect(state.lifecycle).toEqual(['registration-disabled', 'registration-closed'])
      Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      Expect(await FS.readJson(FS.resolvePath('run/appium-mac2/isolation.json', test.root)))
        .toMatchObject({ state: 'closed' })
    } finally {
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  Test('refuses Appium traffic after desktop generation changes and retains only its still-owned port', async () => {
    const test = await fixture()
    const state = await test.prepare('run', 'survivor')
    try {
      const desktop = await state.run.desktopLeases.acquire()
      const owner = await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot })
      const replacement = await MachineResources.retain({
        owners: [owner!],
        processes: [],
        quarantined: true,
        reason: 'Source fixture rotates desktop generation',
        registryRoot: test.registryRoot,
      })
      for (const method of ['GET', 'POST', 'DELETE']) {
        const response = await globalThis.fetch(`${state.run.webDriverAgentMacUrl}/session`, { method })
        Expect(response.status).toBe(503)
      }
      Expect(state.http).toEqual([`http://127.0.0.1:${state.run.systemPort}/status`])
      await Expect(desktop.assertCurrent(desktop.generation)).rejects.toThrow()
      await Expect(desktop.release()).rejects.toThrow('shutdown is unproved')
      await Expect(state.run.cleanup(true)).rejects.toThrow('remain fenced')
      Expect((await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))?.id)
        .toBe(replacement.id)
      Expect(
        (await MachineResources.readOwner({
          name: `appium-wda-port-${state.run.systemPort}`,
          registryRoot: test.registryRoot,
        }))?.retention?.quarantined,
      ).toBe(true)
    } finally {
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  Test('preserves record failure and releases the backend fence when frontend rollback also fails', async () => {
    const test = await fixture()
    const artifacts = FS.resolvePath('run', test.root)
    await FS.mkdir(FS.resolvePath('appium-mac2/isolation.json', artifacts))
    const cleanupFailure = new Errors.HostEnvironmentError('Injected frontend cleanup failure')
    let frontendStopped = false
    let port: number | undefined
    try {
      const captured = await withCapturedOutput(async () => {
        await Expect(StudioMac2TestRun.prepare({
          artifactRoot: artifacts,
          registryRoot: test.registryRoot,
          wdaSource: test.wdaSource,
          xcodebuild: FS.resolvePath('original-xcodebuild', test.root),
          startForwarder: options => {
            const file = FS.listDirSync(test.registryRoot).find(name => name.startsWith('resource-appium-wda-port-'))
            port = Number(file!.slice('resource-appium-wda-port-'.length, -'.lease'.length))
            const server = Bun.serve(options)
            const stop = server.stop.bind(server)
            server.stop = closeActiveConnections => {
              stop(closeActiveConnections)
              frontendStopped = true
              throw cleanupFailure
            }
            return server
          },
        })).rejects.toMatchObject({ code: 'EISDIR' })
      })
      Expect(captured.stderr).toContain('Injected frontend cleanup failure')
      Expect(frontendStopped).toBe(true)
      Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      Expect(port).toBeDefined()
      const replacement = Bun.serve({ hostname: '127.0.0.1', port: port!, fetch: () => new Response() })
      replacement.stop(true)
    } finally {
      await FS.remove(test.root)
    }
  })

  Test('rolls back the owned backend listener and machine fence when frontend allocation fails', async () => {
    const test = await fixture()
    const allocationFailure = new Errors.HostEnvironmentError('Injected frontend EMFILE failure')
    let port: number | undefined
    try {
      await Expect(StudioMac2TestRun.prepare({
        artifactRoot: FS.resolvePath('run', test.root),
        registryRoot: test.registryRoot,
        wdaSource: test.wdaSource,
        xcodebuild: FS.resolvePath('original-xcodebuild', test.root),
        startForwarder: () => {
          const file = FS.listDirSync(test.registryRoot).find(name => name.startsWith('resource-appium-wda-port-'))
          Expect(file).toBeDefined()
          port = Number(file!.slice('resource-appium-wda-port-'.length, -'.lease'.length))
          throw allocationFailure
        },
      })).rejects.toBe(allocationFailure)
      Expect(await MachineResources.listOwners({ registryRoot: test.registryRoot })).toEqual([])
      Expect(port).toBeDefined()
      const replacement = Bun.serve({ hostname: '127.0.0.1', port: port!, fetch: () => new Response() })
      replacement.stop(true)
    } finally {
      await FS.remove(test.root)
    }
  })

  Test('refuses backend redirects without handing Appium an unchecked Location', async () => {
    const test = await fixture()
    const state = await test.prepare('run')
    const foreignRequests: string[] = []
    const destination = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: request => {
        foreignRequests.push(request.method)
        return new Response('{}')
      },
    })
    try {
      const desktop = await state.run.desktopLeases.acquire()
      state.redirectBackend(`http://127.0.0.1:${destination.port}/foreign`)
      const result = await globalThis.fetch(`${state.run.webDriverAgentMacUrl}/status`, { redirect: 'manual' })
      Expect(result.status).toBe(503)
      Expect(result.headers.get('location')).toBeNull()
      Expect(foreignRequests).toEqual([])
      await desktop.release()
      await state.run.cleanup(true)
    } finally {
      destination.stop(true)
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  Test('fences Appium internal POST and DELETE after a held status response outlives WDA ownership', async () => {
    const test = await fixture()
    const state = await test.prepare('run')
    try {
      const desktop = await state.run.desktopLeases.acquire()
      await desktop.assertCurrent(desktop.generation)
      state.holdStatus()
      const status = globalThis.fetch(`${state.run.webDriverAgentMacUrl}/status`)
      await state.statusStarted
      state.replaceWda()
      state.releaseStatus()
      Expect((await status).status).toBe(200)
      const statuses: number[] = []
      for (const [method, path] of [['POST', '/session'], ['DELETE', '/session/remote']]) {
        const result = await globalThis.fetch(`${state.run.webDriverAgentMacUrl}${path}`, {
          method,
          body: method === 'POST' ? '{}' : undefined,
        })
        statuses.push(result.status)
      }
      Expect(statuses).toEqual([503, 503])
      Expect(state.foreignRequests).toEqual([])
      Expect(state.http).toEqual([
        `http://127.0.0.1:${state.run.systemPort}/status`,
        `http://127.0.0.1:${state.run.systemPort}/status`,
      ])
      await Expect(desktop.assertCurrent(desktop.generation)).rejects.toThrow('not owned')
      await Expect(desktop.release()).rejects.toThrow('shutdown is unproved')
    } finally {
      state.releaseStatus()
      state.closeForeignListener()
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  for (const scenario of ['startup-log-failure', 'release-log-failure']) {
    Test(`stops WDA and independently owned resources despite ${scenario}`, async () => {
      const test = await fixture()
      const state = await test.prepare('run', scenario)
      const effects: string[] = []
      try {
        const captured = await withCapturedOutput(async () => {
          let primaryFailure: { error: unknown } | undefined
          let desktop: Awaited<ReturnType<typeof state.run.desktopLeases.acquire>> | undefined
          try {
            desktop = await state.run.desktopLeases.acquire()
          } catch (error) {
            primaryFailure = { error }
          }
          const finishing = StudioMac2TestRun.finish({
            closeController: async () => await desktop?.release(),
            cleanupWda: async () => await state.run.cleanup(true),
            primaryFailure,
            stopNative: async () => {
              effects.push('native')
            },
            stopFixtures: () => {
              effects.push('fixtures')
            },
          })
          if (scenario === 'startup-log-failure') {
            Expect(Errors.messageOf(primaryFailure?.error)).toContain('Owned startup listener inspection failed')
            await Expect(finishing).rejects.toBe(primaryFailure!.error)
          } else {
            await finishing
          }
        })
        Expect(captured.stderr).toContain('Injected log write failure')
        Expect(state.signals).toEqual(['SIGTERM'])
        Expect(state.disposed()).toBe(true)
        Expect(effects).toEqual(['native', 'fixtures'])
        Expect(await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
          .toBeUndefined()
        Expect(
          await MachineResources.readOwner({
            name: `appium-wda-port-${state.run.systemPort}`,
            registryRoot: test.registryRoot,
          }),
        ).toBeUndefined()
      } finally {
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    })
  }

  for (const primary of [false, true]) {
    Test(
      `stops native and fixtures after retained WDA cleanup, preserving ${
        primary ? 'the probe' : 'the cleanup'
      } failure`,
      async () => {
        const effects: string[] = []
        const cleanupFailure = new Errors.HostEnvironmentError('WDA shutdown is unproved')
        const probeFailure = new Errors.HostEnvironmentError('Probe failed')
        const captured = await withCapturedOutput(async () => {
          await Expect(StudioMac2TestRun.finish({
            closeController: async () => {
              effects.push('controller')
            },
            cleanupWda: async () => {
              effects.push('wda-retained')
              throw cleanupFailure
            },
            primaryFailure: primary ? { error: probeFailure } : undefined,
            stopNative: async () => {
              effects.push('native-stopped')
            },
            stopFixtures: () => {
              effects.push('fixtures-stopped')
            },
          })).rejects.toBe(primary ? probeFailure : cleanupFailure)
        })
        Expect(effects).toEqual(['controller', 'wda-retained', 'native-stopped', 'fixtures-stopped'])
        if (primary) {
          Expect(captured.stderr).toContain('WDA shutdown is unproved')
        }
      },
    )
  }

  Test('copies the full WDA tree and fences distinct listeners without using the default port', async () => {
    const test = await fixture()
    const first = (await test.prepare('first')).run
    const second = (await test.prepare('second')).run
    try {
      Expect(first.systemPort).not.toBe(10100)
      Expect(second.systemPort).not.toBe(first.systemPort)
      Expect(await FS.readText(FS.resolvePath('WebDriverAgentRunner/Runner.m', first.bootstrapRoot))).toBe(
        'runner source',
      )
      await FS.writeText(FS.resolvePath('WebDriverAgentRunner/Runner.m', first.bootstrapRoot), 'private mutation')
      Expect(await FS.readText(FS.resolvePath('WebDriverAgentRunner/Runner.m', test.wdaSource))).toBe('runner source')
      Expect(
        await MachineResources.tryAcquire({
          name: `appium-wda-port-${first.systemPort}`,
          registryRoot: test.registryRoot,
        }),
      ).toBeUndefined()
      Expect(() => Bun.serve({ hostname: '127.0.0.1', port: first.systemPort, fetch: () => new Response() })).toThrow()
    } finally {
      await first.cleanup(false)
      await second.cleanup(false)
      Expect(
        await MachineResources.readOwner({
          name: `appium-wda-port-${first.systemPort}`,
          registryRoot: test.registryRoot,
        }),
      ).toBeUndefined()
      await FS.remove(test.root)
    }
  })

  Test('starts fixed copied WDA under physical input ownership and attaches only to its proven listener', async () => {
    const test = await fixture()
    const state = await test.prepare('run with spaces')
    try {
      const desktop = await state.run.desktopLeases.acquire()
      Expect(await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
        .toBeDefined()
      Expect(state.calls).toHaveLength(1)
      Expect(state.calls[0]!.command).toBe(await FS.realPath(FS.resolvePath('original-xcodebuild', test.root)))
      Expect(state.calls[0]!.options).toMatchObject({
        args: [
          'build-for-testing',
          'test-without-building',
          '-project',
          FS.resolvePath('WebDriverAgentMac.xcodeproj', state.run.bootstrapRoot),
          '-scheme',
          'WebDriverAgentRunner',
          'COMPILER_INDEX_STORE_ENABLE=NO',
          '-derivedDataPath',
          await FS.realPath(FS.resolvePath('run with spaces/appium-mac2/DerivedData', test.root)),
        ],
        cwd: state.run.bootstrapRoot,
        env: { TEST_RUNNER_USE_PORT: String(state.run.systemPort), TEST_RUNNER_USE_HOST: '127.0.0.1' },
      })
      Expect(state.http).toEqual([`http://127.0.0.1:${state.run.systemPort}/status`])
      Expect(await FS.readJson(FS.resolvePath('run with spaces/appium-mac2/isolation.json', test.root))).toMatchObject({
        state: 'ready',
        processes: [{ pid: 12001, startedAt: 'kernel-start-1' }],
      })
      await desktop.release()
      await state.run.cleanup(true)
      Expect(state.disposed()).toBe(true)
      Expect(state.signals).toEqual(['SIGTERM'])
      Expect(await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
        .toBeUndefined()
      Expect(
        await MachineResources.readOwner({
          name: `appium-wda-port-${state.run.systemPort}`,
          registryRoot: test.registryRoot,
        }),
      ).toBeUndefined()
    } finally {
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  for (const scenario of ['foreign-before-start', 'foreign-after-start', 'reused-pid']) {
    Test(`refuses ${scenario} before any readiness HTTP and retains uncertain fences`, async () => {
      const test = await fixture()
      const state = await test.prepare('run', scenario)
      try {
        await withCapturedOutput(async () => {
          await Expect(state.run.desktopLeases.acquire()).rejects.toThrow(/unowned listener|not owned/)
        })
        Expect(state.http).toEqual([])
        Expect(state.calls).toHaveLength(scenario === 'foreign-before-start' ? 0 : 1)
        Expect(
          (await MachineResources.readOwner({
            name: `appium-wda-port-${state.run.systemPort}`,
            registryRoot: test.registryRoot,
          }))?.retention?.quarantined,
        ).toBe(true)
        Expect(
          (await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
            ?.retention?.quarantined,
        ).toBe(true)
        Expect(await FS.exists(state.run.bootstrapRoot)).toBe(true)
      } finally {
        state.closeForeignListener()
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    })
  }

  for (const scenario of ['survivor', 'inspection-unavailable', 'kernel-inspection-unavailable']) {
    Test(`quarantines both physical input and port and preserves handles/artifacts when ${scenario}`, async () => {
      const test = await fixture()
      const state = await test.prepare('run', scenario)
      try {
        const desktop = await state.run.desktopLeases.acquire()
        await Expect(desktop.release()).rejects.toThrow('shutdown is unproved')
        Expect(state.disposed()).toBe(false)
        Expect(
          (await MachineResources.readOwner({
            name: `appium-wda-port-${state.run.systemPort}`,
            registryRoot: test.registryRoot,
          }))?.retention?.quarantined,
        ).toBe(true)
        Expect(
          (await MachineResources.readOwner({ name: 'macos-physical-input', registryRoot: test.registryRoot }))
            ?.retention?.quarantined,
        ).toBe(true)
        Expect(await FS.exists(state.run.bootstrapRoot)).toBe(true)
        Expect(await FS.readJson(FS.resolvePath('run/appium-mac2/isolation.json', test.root))).toMatchObject({
          state: 'retained',
        })
      } finally {
        await state.run.cleanup(true).catch(() => {})
        await FS.remove(test.root)
      }
    })
  }

  Test('retains the listener fence when the Appium server shutdown remains unproved', async () => {
    const test = await fixture()
    const state = await test.prepare('run')
    try {
      const desktop = await state.run.desktopLeases.acquire()
      await desktop.release()
      await Expect(state.run.cleanup(false)).rejects.toThrow('shutdown is unproved')
      // Keep the owned frontend bound but inert until the owned Appium child is proved stopped.
      Expect((await globalThis.fetch(`${state.run.webDriverAgentMacUrl}/status`)).status).toBe(503)
      Expect(
        (await MachineResources.readOwner({
          name: `appium-wda-port-${state.run.systemPort}`,
          registryRoot: test.registryRoot,
        }))?.retention?.quarantined,
      ).toBe(true)
      Expect(await FS.exists(state.run.bootstrapRoot)).toBe(true)
    } finally {
      await state.run.cleanup(true).catch(() => {})
      await FS.remove(test.root)
    }
  })

  Test('uses the one owned app matching the consent identifier and rejects absent or ambiguous bundles', async () => {
    const test = await fixture()
    try {
      const nativeRoot = FS.resolvePath('electrobun', test.root)
      const bundle = FS.resolvePath('build/dev-macos-arm64/Studio Test-dev.app', nativeRoot)
      await FS.writeText(FS.resolvePath('Contents/Info.plist', bundle), 'owned plist')
      const inspect: typeof CLI.run = async (command, options) => ({
        command,
        args: [...(options?.args ?? [])],
        error: undefined,
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: 'test.bundle\n',
      })
      Expect(await StudioMac2TestRun.appPath(nativeRoot, 'test.bundle', inspect)).toBe(await FS.realPath(bundle))
      await Expect(StudioMac2TestRun.appPath(nativeRoot, 'foreign.bundle', inspect)).rejects.toThrow(
        'exact Studio application',
      )
      await FS.writeText(
        FS.resolvePath('build/dev-macos-arm64/Other-dev.app/Contents/Info.plist', nativeRoot),
        'ambiguous plist',
      )
      await Expect(StudioMac2TestRun.appPath(nativeRoot, 'test.bundle', inspect)).rejects.toThrow(
        'exact Studio application',
      )
    } finally {
      await FS.remove(test.root)
    }
  })
})
