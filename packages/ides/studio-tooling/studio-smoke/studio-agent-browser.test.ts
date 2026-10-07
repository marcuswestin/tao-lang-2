import { Errors, FS, HCI, Platform, Repo, Time, VerificationTimeouts } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  AgentChatProvider,
  openStudioPreviewSession,
  startStudioSessionServer,
  StudioClientAssets,
  StudioSessionManager,
} from '@studio'
import { StudioCdp } from '../studio-tooling-src/StudioCdp'

const initialSource = `use Text from @tao/ui
app AgentBrowser {
   id "agentbrowser"
   version "1.0.0"
   name "Agent Browser"
   view MainView
}

view MainView() {
   render Text("Before")
}
`

type StreamPart =
  | { delta: string; id: string; type: 'text-delta' }
  | { id: string; type: 'text-end' | 'text-start' }
  | { finishReason: { raw: undefined; unified: string }; type: 'finish'; usage: unknown }
  | { input: string; toolCallId: string; toolName: string; type: 'tool-call' }

type ScriptedTurn = Readonly<{
  call?: Readonly<{ input: unknown; name: string }>
  text?: string
}>

class BrowserAgentModel {
  readonly modelId = 'studio-agent-browser'
  readonly provider = 'tao-test'
  readonly specificationVersion = 'v3'
  readonly supportedUrls = {}
  #calls = 0
  #streaming: ReadableStreamDefaultController<StreamPart> | undefined
  readonly #turns: readonly ScriptedTurn[] = [
    { text: 'controlled-by-the-test' },
    {
      call: {
        input: {
          declaration: 'MainView',
          replacement: 'view MainView() {\n   render Text("Agent")\n}',
        },
        name: 'proposeEdit',
      },
    },
    { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
    { text: 'Applied the agent edit.' },
    { call: { input: {}, name: 'undoLastChange' } },
    { text: 'Undo refused because the source changed.' },
  ]

  get calls(): number {
    return this.#calls
  }

  doStream = async (): Promise<{ stream: ReadableStream<StreamPart> }> => {
    const index = this.#calls++
    const turn = this.#turns[index]
    if (turn === undefined) {
      Errors.throwUnexpected(`Studio agent browser model received unplanned call ${index + 1}.`)
    }
    if (index === 0) {
      return {
        stream: new ReadableStream<StreamPart>({
          start: controller => {
            this.#streaming = controller
            controller.enqueue({ id: 'streaming-answer', type: 'text-start' })
            controller.enqueue({ delta: 'Streaming ', id: 'streaming-answer', type: 'text-delta' })
          },
        }),
      }
    }
    return { stream: immediateStream(turn, index + 1) }
  }

  finishStreaming(): void {
    const controller = this.#streaming
    if (controller === undefined) {
      Errors.throwUnexpected('The Studio agent browser stream has not started.')
    }
    controller.enqueue({ delta: 'complete.', id: 'streaming-answer', type: 'text-delta' })
    controller.enqueue({ id: 'streaming-answer', type: 'text-end' })
    controller.enqueue(finish('stop', 2))
    controller.close()
    this.#streaming = undefined
  }
}

Test('Studio agent streams, serializes turns, and refuses stale undo in Chrome', async () => {
  const artifactParent = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? Repo.resolvePath('.artifacts/studio-smoke')
  await FS.mkdir(artifactParent)
  const projectRoot = await mkTestDir('tao-studio-agent-browser-', { location: 'host' })
  const sourcePath = FS.resolvePath('AgentBrowser.tao', projectRoot)
  const model = new BrowserAgentModel()
  const provider = new AgentChatProvider({}, model as never)
  let browser: StudioCdp | undefined
  let preview: Awaited<ReturnType<typeof openStudioPreviewSession>> | undefined
  let studio: Awaited<ReturnType<typeof startStudioSessionServer>> | undefined
  let manager: StudioSessionManager | undefined
  try {
    await FS.writeText(sourcePath, initialSource)
    await FS.mkdir(FS.resolvePath('.tao', projectRoot))
    preview = await openStudioPreviewSession({
      entryPath: sourcePath,
      previewRuntimeRoot: FS.resolvePath(`agent-runtime-${Platform.runtimeProcess.pid}`, artifactParent),
      projectRoot,
    })
    const compiled = await preview.session.compileInitial()
    Expect(compiled.status).toBe('compiled')
    manager = new StudioSessionManager()
    const current = manager.add({ session: preview.session })
    // Match StudioDev's readiness boundary: build the real shell before starting UI assertions.
    HCI.logProcessInfo('studio', 'Preparing the browser client for the agent journey.')
    await StudioClientAssets.bundle()
    HCI.logProcessInfo('studio', 'Browser client ready for the agent journey.')
    studio = await startStudioSessionServer(manager, {
      agentProvider: provider,
      hostname: '127.0.0.1',
      port: smokePort(),
    })
    const availabilityResponse = await fetch(
      `${studio.url}/sessions/${encodeURIComponent(current.sessionId)}/api/agent-chat/availability`,
      {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    )
    Expect(availabilityResponse.ok).toBe(true)
    Expect(await availabilityResponse.json()).toMatchObject({ configured: true, enabled: false })

    browser = await StudioCdp.launchChrome({ artifactRoot: artifactParent })
    await browser.setViewport(1_440, 900)
    await browser.goto(`${studio.url}/sessions/${encodeURIComponent(current.sessionId)}`)
    try {
      await browser.waitFor(`document.querySelector('.chat-cloud:not(:disabled)') instanceof HTMLInputElement`, {
        timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity,
      })
    } catch (cause) {
      const page = await browser.evaluate<{ url: string; state: string; text: string }>(
        '({ url: location.href, state: document.readyState, text: document.body.innerText })',
      )
      Errors.throwHostEnvironment(
        `Studio chat did not become ready: ${JSON.stringify({ page, browser: browser.browserFailures() })}`,
        { cause },
      )
    }
    Expect(await browser.evaluate<number>(`document.querySelectorAll('.studio-preview iframe').length`)).toBe(0)
    Expect(await browser.evaluate<boolean>(`document.querySelector('[data-tao-studio-draw-canvas]') !== null`)).toBe(
      true,
    )
    // Studio opens with the agent minimized.
    Expect(await browser.evaluate<string>(`document.querySelector('.studio-agent-panel')?.dataset.minimized ?? ''`))
      .toBe('true')
    await browser.click('.studio-agent-collapse')
    await browser.waitFor(`document.querySelector('.studio-agent-panel')?.getAttribute('data-minimized') === 'false'`)
    // The panel animates its width and height as it expands, so the switch keeps moving after it
    // first becomes hit-testable; a click resolved during that motion lands beside it and the toggle
    // never fires. Wait for the switch to report the same box twice before clicking.
    await browser.waitFor(`(() => {
      const cloud = document.querySelector('.chat-cloud')
      if (!(cloud instanceof HTMLInputElement) || cloud.disabled) return false
      const rect = cloud.getBoundingClientRect()
      const box = [rect.left, rect.top, rect.width, rect.height].join(',')
      const settled = window.__taoSmokeCloudBox === box
      window.__taoSmokeCloudBox = box
      return settled && rect.width > 0 && rect.height > 0
        && document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === cloud
    })()`)
    await browser.click('.chat-cloud')
    try {
      await browser.waitFor(`document.querySelector('.chat-status')?.getAttribute('data-state') === 'on'`)
    } catch (cause) {
      const panel = await browser.evaluate<string>(`JSON.stringify({
        checked: document.querySelector('.chat-cloud')?.checked,
        disabled: document.querySelector('.chat-cloud')?.disabled,
        status: document.querySelector('.chat-status')?.textContent,
        state: document.querySelector('.chat-status')?.getAttribute('data-state'),
      })`)
      Errors.throwHostEnvironment(
        `Studio chat did not turn on after the cloud toggle: ${
          JSON.stringify({ panel, console: browser.consoleErrors(), browser: browser.browserFailures() })
        }`,
        { cause },
      )
    }

    await sendPrompt(browser, 'Answer slowly.')
    await browser.waitFor(`(() => {
      const message = document.querySelector('.studio-agent-message[data-role="agent"][aria-live="off"]')
      return message?.querySelector('.studio-agent-text')?.textContent === 'Streaming '
        && document.querySelector('.chat-input')?.disabled === true
        && document.querySelector('.chat-send')?.disabled === true
    })()`)
    // A model or tool may produce no bytes for longer than Bun's ten-second idle limit.
    // Keep this real HTTP stream quiet long enough to prove the per-request lifetime override.
    await Time.sleep(16_000)
    Expect(await browser.evaluate<boolean>(`document.querySelector('.chat-input')?.disabled === true`)).toBe(true)
    Expect(model.calls).toBe(1)
    Expect(await browser.evaluate<string>("document.querySelector('.chat-announcer')?.textContent ?? ''")).toBe('')
    await browser.evaluate(`(() => {
      const announcer = document.querySelector('.chat-announcer')
      window.__taoAgentAnnouncements = []
      new MutationObserver(() => {
        const text = announcer?.textContent ?? ''
        if (text !== '') window.__taoAgentAnnouncements.push(text)
      }).observe(announcer, { childList: true, characterData: true, subtree: true })
      return true
    })()`)
    // A disabled production button receives the physical pointer but cannot start another server turn.
    await browser.click('.chat-send')
    Expect(model.calls).toBe(1)
    Expect(
      await browser.evaluate<number>('document.querySelectorAll(\'.studio-agent-message[data-role="you"]\').length'),
    )
      .toBe(1)

    model.finishStreaming()
    await browser.waitFor(`document.querySelector('.chat-input')?.disabled === false
      && document.querySelector('.chat-announcer')?.textContent === 'Streaming complete.'`)
    Expect(await browser.evaluate<string[]>(`window.__taoAgentAnnouncements ?? []`)).toEqual([
      'Streaming complete.',
    ])
    Expect(
      await browser.evaluate<number>(
        `[...document.querySelectorAll('.studio-agent-message[data-role="agent"] .studio-agent-text')]
          .filter(element => element.textContent === 'Streaming complete.').length`,
      ),
    ).toBe(1)

    await sendPrompt(browser, 'Change MainView to say Agent.')
    await waitForApproval(browser, 'The agent wants to change your app', () => model.calls)
    const applyDiff = await currentApprovalDiff(browser)
    Expect(applyDiff).toContain('Text("Before")')
    Expect(applyDiff).toContain('Text("Agent")')
    await browser.click('.studio-agent-card-actions button[data-variant="primary"]')
    await waitForSource(sourcePath, source => source.includes('Text("Agent")'))
    await browser.waitFor(`document.querySelector('.chat-input')?.disabled === false
      && document.querySelector('.chat-log')?.textContent?.includes('Applied the agent edit.') === true`)

    await sendPrompt(browser, 'Undo that agent change.')
    await waitForApproval(browser, 'The agent wants to change your app', () => model.calls)
    const undoDiff = await currentApprovalDiff(browser)
    Expect(undoDiff).toContain('-   render Text("Agent")')
    Expect(undoDiff).toContain('+   render Text("Before")')

    // The manual edit is a real CodeMirror save between previewing and approving the reverse diff.
    await browser.click('.studio-agent-collapse')
    await browser.waitFor(`document.querySelector('.studio-agent-panel')?.getAttribute('data-minimized') === 'true'`)
    await browser.click('[data-preset="code"]')
    await browser.waitFor(`document.querySelector('.studio-editor .cm-content')?.checkVisibility() === true`)
    const appliedSource = await FS.readText(sourcePath)
    const manualSource = appliedSource.replace('Text("Agent")', 'Text("Manual")')
    await browser.click('.cm-content')
    await browser.pressShortcut('a')
    await browser.insertText(manualSource)
    await browser.pressShortcut('s')
    await waitForSource(sourcePath, source => source === manualSource)
    await browser.click('.studio-rail-button[data-panel="agent"]')
    await browser.waitFor(`document.querySelector('.studio-agent-panel')?.getAttribute('data-minimized') === 'false'`)
    // Observe the actual click target, as for the cloud switch above. An animation query can
    // report no animations before the browser starts the expansion transition.
    await browser.waitFor(`(() => {
      const button = document.querySelector('.studio-agent-card-actions button[data-variant="primary"]')
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false
      const rect = button.getBoundingClientRect()
      const box = [rect.left, rect.top, rect.width, rect.height].join(',')
      const settled = window.__taoSmokeApprovalBox === box
      window.__taoSmokeApprovalBox = box
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return settled && rect.width > 0 && rect.height > 0 && button.contains(hit)
    })()`)
    await browser.click('.studio-agent-card-actions button[data-variant="primary"]')
    try {
      await browser.waitFor(`document.querySelector('.chat-input')?.disabled === false
        && document.querySelector('.chat-log')?.textContent?.includes('Undo refused because the source changed.') === true`)
    } catch (cause) {
      const state = await browser.evaluate(`({
        busy: document.querySelector('.chat-input')?.disabled,
        approval: document.querySelector('.studio-agent-card-actions')?.textContent,
        chat: document.querySelector('.chat-log')?.textContent,
      })`)
      Errors.throwHostEnvironment(
        `Studio stale undo did not finish: ${
          JSON.stringify({ state, calls: model.calls, browser: browser.browserFailures() })
        }`,
        { cause },
      )
    }

    Expect(await FS.readText(sourcePath)).toBe(manualSource)
    Expect(
      await browser.evaluate<string>("document.querySelector('.studio-agent-tools:last-of-type')?.textContent ?? ''"),
    ).toContain('Studio source changed before the edit was applied')
    Expect(model.calls).toBe(6)
    Expect(browser.browserFailures()).toEqual([])
    Expect(browser.consoleErrors()).toEqual([])
    await browser.captureScreenshot('studio-agent-versioned-undo')
  } finally {
    await browser?.close()
    studio?.stop()
    await manager?.closeAll()
    await preview?.close()
    await FS.remove(projectRoot)
  }
}, 180_000)

function immediateStream(turn: ScriptedTurn, call: number): ReadableStream<StreamPart> {
  return new ReadableStream<StreamPart>({
    start(controller) {
      if (turn.call !== undefined) {
        controller.enqueue({
          input: JSON.stringify(turn.call.input),
          toolCallId: `call-${call}`,
          toolName: turn.call.name,
          type: 'tool-call',
        })
        controller.enqueue(finish('tool-calls', 1))
      } else {
        const id = `text-${call}`
        controller.enqueue({ id, type: 'text-start' })
        controller.enqueue({ delta: turn.text ?? '', id, type: 'text-delta' })
        controller.enqueue({ id, type: 'text-end' })
        controller.enqueue(finish('stop', 1))
      }
      controller.close()
    },
  })
}

function finish(reason: string, outputTokens: number): StreamPart {
  return {
    finishReason: { raw: undefined, unified: reason },
    type: 'finish',
    usage: {
      inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 1, total: 1 },
      outputTokens: { reasoning: undefined, text: outputTokens, total: outputTokens },
      totalTokens: outputTokens + 1,
    },
  }
}

async function sendPrompt(browser: StudioCdp, prompt: string): Promise<void> {
  await browser.click('.chat-input')
  await browser.insertText(prompt)
  await browser.click('.chat-send')
}

async function waitForApproval(browser: StudioCdp, heading: string, calls: () => number): Promise<void> {
  let last: { ready: boolean; error: string; chat: string; url: string; busy: boolean | undefined } | undefined
  try {
    await browser.waitFor(
      `(() => {
    const cards = [...document.querySelectorAll('.studio-agent-card')]
    return { ready: cards.at(-1)?.querySelector('strong')?.textContent === ${JSON.stringify(heading)}
      && cards.at(-1)?.querySelector('.studio-agent-card-actions button[data-variant="primary"]')
        instanceof HTMLButtonElement,
      error: document.querySelector('.chat-log .studio-agent-line[data-tone="error"]')?.textContent?.slice(-1000) ?? '',
      chat: document.querySelector('.chat-log')?.textContent?.slice(-4000) ?? '',
      url: location.href,
      busy: document.querySelector('.chat-input')?.disabled }
  })()`,
      {
        timeoutMs: 30_000,
        predicate(value) {
          last = value as typeof last
          if (last?.error) {
            Errors.throwHostEnvironment(`Studio approval turn failed: ${last.error}; calls=${calls()}`)
          }
          return last?.ready === true
        },
      },
    )
  } catch (cause) {
    Errors.throwHostEnvironment(
      `Studio approval failed: ${
        JSON.stringify({ last, calls: calls(), browser: browser.browserFailures() }).slice(0, 8_000)
      }`,
      { cause },
    )
  }
}

async function currentApprovalDiff(browser: StudioCdp): Promise<string> {
  return await browser.evaluate<string>(`(() => {
    const cards = [...document.querySelectorAll('.studio-agent-card')]
    return [...(cards.at(-1)?.querySelectorAll('pre') ?? [])].map(element => element.textContent ?? '').join('\\n')
  })()`)
}

async function waitForSource(path: string, predicate: (source: string) => boolean): Promise<void> {
  let last = ''
  const matched = await Time.pollUntil(async () => {
    last = await FS.readText(path)
    return predicate(last)
  }, { intervalMs: 100, timeoutMs: VerificationTimeouts.resolve(30_000) ?? Infinity })
  if (!matched) {
    Errors.throwHostEnvironment(`Timed out waiting for Studio source change; last source:\n${last}`)
  }
}

function smokePort(): number {
  const value = Number(Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_SERVER_PORT'] ?? 42_012)
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    Errors.throwUserInput('TAO_STUDIO_SMOKE_SERVER_PORT must be a valid TCP port.')
  }
  return value
}
