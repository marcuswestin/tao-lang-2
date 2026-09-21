import {
  assertHostLease,
  type HostAction,
  type HostActionReceipt,
  HostControlError,
  type HostController,
  type HostLeaseIdentity,
  type HostObservation,
  type HostObservationRequest,
  type HostPublishRevisionRequest,
  type HostRevision,
  type HostScreenshot,
  type HostSession,
  type HostSessionDescriptor,
  hostSessionTargetLeaseName,
  type HostTarget,
} from '@host-control'
import { Errors, FS, Platform, Switch } from '@shared'
import {
  type Browser,
  type BrowserContext,
  type BrowserType,
  chromium,
  type ElementHandle,
  firefox,
  type LaunchOptions,
  type Locator,
  type Page,
  webkit,
} from 'playwright'

export type PlaywrightBrowserName = 'chromium' | 'firefox' | 'webkit'

export type PlaywrightHostControllerOptions = Readonly<{
  browser?: PlaywrightBrowserName
  launchOptions?: LaunchOptions
}>

const capabilities: HostSessionDescriptor['capabilities'] = Object.freeze([
  'inspect',
  'key',
  'pointer',
  'refreshDocument',
  'screenshot',
  'scroll',
  'textInput',
])

const browserTypes: Readonly<Record<PlaywrightBrowserName, BrowserType>> = {
  chromium,
  firefox,
  webkit,
}

/** createPlaywrightHostController launches the browser that owns every fresh session context. */
export async function createPlaywrightHostController(
  options: PlaywrightHostControllerOptions = {},
): Promise<HostController> {
  const browserName = options.browser ?? 'chromium'
  const browser = await asHostOperation(
    `Could not launch the Playwright ${browserName} browser.`,
    async () => await browserTypes[browserName].launch(options.launchOptions),
  )
  return new OwnedPlaywrightHostController(browser)
}

class OwnedPlaywrightHostController implements HostController {
  readonly #browser: Browser
  readonly #sessions = new Set<PlaywrightHostSession>()
  #closed = false
  #closePromise: Promise<void> | undefined

  constructor(browser: Browser) {
    this.#browser = browser
  }

  async openSession(
    options: Readonly<{
      artifactRoot: string
      mode: HostSessionDescriptor['mode']
      revision: HostRevision
      target: string
    }>,
  ): Promise<HostSession> {
    if (this.#closed) {
      throw new HostControlError('closed', 'The Playwright host controller is closed.')
    }

    const id = Platform.randomUUID()
    const sessionArtifactRoot = FS.resolvePath(`browser-session-${id}`, options.artifactRoot)
    await FS.mkdir(sessionArtifactRoot)
    const context = await asHostOperation(
      `Could not create a Playwright browser context for '${options.target}'.`,
      async () => await this.#browser.newContext(),
    )
    try {
      await asHostOperation(
        `Could not start the Playwright trace for '${options.target}'.`,
        async () => await context.tracing.start({ screenshots: true, snapshots: true }),
      )
      const page = await context.newPage()
      await asHostOperation(
        `Could not open browser target '${options.target}'.`,
        async () => await page.goto(options.target, { waitUntil: 'domcontentloaded' }),
      )
      const session = new PlaywrightHostSession({
        artifactRoot: sessionArtifactRoot,
        context,
        id,
        mode: options.mode,
        onClose: () => this.#sessions.delete(session),
        page,
        revision: options.revision,
        target: options.target,
      })
      this.#sessions.add(session)
      return session
    } catch (error) {
      await context.close().catch(() => {})
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) {
      return await this.#closePromise
    }
    this.#closed = true
    this.#closePromise = this.#closeOwnedResources()
    return await this.#closePromise
  }

  async #closeOwnedResources(): Promise<void> {
    let firstFailure: unknown
    for (const session of [...this.#sessions]) {
      try {
        await session.close(session.descriptor().lease)
      } catch (error) {
        firstFailure ??= error
      }
    }
    try {
      await this.#browser.close()
    } catch (error) {
      firstFailure ??= error
    }
    if (firstFailure !== undefined) {
      throw firstFailure
    }
  }
}

type PlaywrightSessionOptions = Readonly<{
  artifactRoot: string
  context: BrowserContext
  id: string
  mode: HostSessionDescriptor['mode']
  onClose: () => void
  page: Page
  revision: HostRevision
  target: string
}>

class PlaywrightHostSession implements HostSession {
  readonly #artifactRoot: string
  readonly #context: BrowserContext
  readonly #id: string
  readonly #lease: HostLeaseIdentity
  readonly #mode: HostSessionDescriptor['mode']
  readonly #onClose: () => void
  readonly #page: Page
  readonly #target: string
  #closed = false
  #closePromise: Promise<void> | undefined
  #currentElement: ElementHandle | undefined
  #currentObservation: HostObservation | undefined
  #operationChain: Promise<void> = Promise.resolve()
  #observationRevision = 0
  #revision: HostRevision
  #screenshotSequence = 0

  constructor(options: PlaywrightSessionOptions) {
    this.#artifactRoot = options.artifactRoot
    this.#context = options.context
    this.#id = options.id
    this.#lease = Object.freeze({
      generation: Platform.randomUUID(),
      name: hostSessionTargetLeaseName({ id: options.id, kind: 'browserContext' }),
    })
    this.#mode = options.mode
    this.#onClose = options.onClose
    this.#page = options.page
    this.#revision = copyRevision(options.revision)
    this.#target = options.target
  }

  descriptor(): HostSessionDescriptor {
    return Object.freeze({
      capabilities,
      driver: 'playwright',
      id: this.#id,
      lease: this.#lease,
      mode: this.#mode,
      revision: this.#revision,
      target: this.#target,
      version: 1,
    })
  }

  async observe(request: HostObservationRequest): Promise<HostObservation> {
    return await this.#serialize(async () => {
      this.#assertOpen()
      assertRevision(this.#revision, request.expectedRevision)
      const target = copyTarget(request.target)
      const locator = locatorFor(this.#page, target)
      return await asHostOperation(
        `Could not inspect browser target ${describeTarget(target)}.`,
        async () => {
          const exists = await locator.count() > 0
          const element = exists ? await locator.elementHandle() : null
          const visible = element !== null && await element.isVisible()
          const observationRevision = this.#advanceObservationRevision()
          const bounds = visible ? await element.boundingBox() : null
          const observation: HostObservation = Object.freeze({
            accessibilityLabel: element === null ? undefined : (await element.getAttribute('aria-label') ?? undefined),
            bounds: bounds === null ? undefined : {
              height: bounds.height,
              width: bounds.width,
              x: bounds.x,
              y: bounds.y,
            },
            id: Platform.randomUUID(),
            lease: this.#lease,
            observationRevision,
            revision: this.#revision,
            sessionId: this.#id,
            target,
            text: element === null ? undefined : (await element.textContent() ?? undefined),
            timestamp: new Date().toISOString(),
            version: 1,
            visible,
          })
          this.#currentElement = element ?? undefined
          this.#currentObservation = observation
          return observation
        },
      )
    })
  }

  async captureScreenshot(name: string): Promise<HostScreenshot> {
    return await this.#serialize(async () => {
      this.#assertOpen()
      const artifactPath = FS.resolvePath(
        `${String(++this.#screenshotSequence).padStart(3, '0')}-${artifactName(name)}.png`,
        this.#artifactRoot,
      )
      await asHostOperation(
        `Could not capture browser screenshot '${name}'.`,
        async () => await this.#page.screenshot({ path: artifactPath }),
      )
      return Object.freeze({
        artifactPath,
        observationRevision: this.#advanceObservationRevision(),
        revision: this.#revision,
        sessionId: this.#id,
        version: 1,
      })
    })
  }

  async perform(action: HostAction): Promise<HostActionReceipt> {
    return await this.#serialize(async () => {
      this.#assertOpen()
      assertHostLease(this.#lease, action.lease)
      assertRevision(this.#revision, action.expectedRevision)
      await Switch.kind<HostAction, Promise<void>>(action, {
        click: async click => {
          const { element, observation } = this.#assertCurrentObservation(click.observation)
          await asHostOperation(
            `Could not click browser target ${describeTarget(observation.target)}.`,
            async () => await element.click(),
          )
        },
        key: async key =>
          await asHostOperation(
            `Could not press browser key '${key.key}'.`,
            async () => await this.#page.keyboard.press(key.key),
          ),
        refreshDocument: async () =>
          await asHostOperation(
            `Could not refresh browser target '${this.#target}'.`,
            async () => {
              await this.#page.reload({ waitUntil: 'domcontentloaded' })
            },
          ),
        relaunchApplication: async () => {
          throw new HostControlError(
            'unsupported',
            'Playwright browser sessions do not support application relaunch.',
            { capability: 'relaunchApplication', sessionId: this.#id },
          )
        },
        scroll: async scroll => {
          if (scroll.observation !== undefined) {
            const { element, observation } = this.#assertCurrentObservation(scroll.observation)
            await asHostOperation(
              `Could not position browser input over ${describeTarget(observation.target)}.`,
              async () => await element.hover(),
            )
          }
          await asHostOperation(
            'Could not scroll the browser document.',
            async () => {
              await this.#page.mouse.wheel(scroll.deltaX, scroll.deltaY)
              await this.#page.evaluate(
                'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
              )
            },
          )
        },
        type: async type => {
          const { element, observation } = this.#assertCurrentObservation(type.observation)
          await asHostOperation(
            `Could not type into browser target ${describeTarget(observation.target)}.`,
            async () => {
              await element.click()
              await element.type(type.text)
            },
          )
        },
      })
      return Object.freeze({
        action: action.kind,
        lease: this.#lease,
        observationRevision: this.#advanceObservationRevision(),
        revision: this.#revision,
        sessionId: this.#id,
        version: 1,
      })
    })
  }

  async publishRevision(request: HostPublishRevisionRequest): Promise<void> {
    await this.#serialize(async () => {
      this.#assertOpen()
      assertHostLease(this.#lease, request.lease)
      assertRevision(this.#revision, request.expectedCurrentRevision)
      if (this.#mode === 'acceptance') {
        throw new HostControlError(
          'unsupported',
          'Acceptance browser sessions are immutable; open a new session for a different revision.',
          { revision: request.revision, sessionId: this.#id },
        )
      }
      this.#advanceObservationRevision()
      await asHostOperation(
        `Could not publish browser revision '${request.revision.build}'.`,
        async () => await this.#page.reload({ waitUntil: 'domcontentloaded' }),
      )
      this.#revision = copyRevision(request.revision)
    })
  }

  async close(lease: HostLeaseIdentity): Promise<void> {
    assertHostLease(this.#lease, lease)
    if (this.#closePromise !== undefined) {
      return await this.#closePromise
    }
    this.#closePromise = this.#serialize(async () => {
      if (this.#closed) {
        return
      }
      this.#closed = true
      let failure: unknown
      try {
        await this.#context.tracing.stop({ path: FS.resolvePath('trace.zip', this.#artifactRoot) })
      } catch (error) {
        failure = error
      }
      try {
        await this.#context.close()
      } catch (error) {
        failure ??= error
      } finally {
        this.#onClose()
      }
      if (failure !== undefined) {
        throw new HostControlError('host', 'Could not close the Playwright browser session.', {
          cause: Errors.messageOf(failure),
          sessionId: this.#id,
        })
      }
    })
    return await this.#closePromise
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new HostControlError('closed', `Browser session '${this.#id}' is closed.`, { sessionId: this.#id })
    }
  }

  #assertCurrentObservation(observation: HostObservation): Readonly<{
    element: ElementHandle
    observation: HostObservation
  }> {
    if (observation.sessionId !== this.#id) {
      throw staleObservation(this.#id, observation)
    }
    assertRevision(this.#revision, observation.revision)
    assertHostLease(this.#lease, observation.lease)
    const current = this.#currentObservation
    const element = this.#currentElement
    if (
      current === undefined
      || element === undefined
      || current.id !== observation.id
      || current.observationRevision !== observation.observationRevision
      || current.observationRevision !== this.#observationRevision
    ) {
      throw staleObservation(this.#id, observation)
    }
    return { element, observation: current }
  }

  #advanceObservationRevision(): number {
    this.#currentElement = undefined
    this.#currentObservation = undefined
    this.#observationRevision += 1
    return this.#observationRevision
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationChain.then(operation, operation)
    this.#operationChain = result.then(() => {}, () => {})
    return await result
  }
}

function locatorFor(root: Page | Locator, target: HostTarget): Locator {
  if (target.kind === 'scoped') {
    return locatorFor(locatorFor(root, target.scope), target.target)
  }
  const occurrence = target.occurrence ?? 1
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new HostControlError('assertion', 'A host target occurrence must be a positive integer.', { target })
  }
  const locator = Switch.kind<HostTarget, Locator>(target, {
    accessibility: accessibility =>
      accessibility.role === undefined
        ? root.getByLabel(accessibility.name, { exact: true })
        : root.getByRole(accessibility.role as Parameters<Page['getByRole']>[0], {
          exact: true,
          name: accessibility.name,
        }),
    scoped: () => {
      throw new HostControlError('assertion', 'A scoped host target must be resolved through its parent target.')
    },
    tag: tag => root.getByTestId(tag.value),
    text: text => root.getByText(text.value, { exact: true }),
  })
  return locator.nth(occurrence - 1)
}

function assertRevision(expected: HostRevision, actual: HostRevision): void {
  if (sameRevision(expected, actual)) {
    return
  }
  throw new HostControlError(
    'staleRevision',
    `Host revision '${actual.build}' at source '${actual.source}' is no longer current.`,
    { actual, expected },
  )
}

function sameRevision(left: HostRevision, right: HostRevision): boolean {
  return left.build === right.build && left.source === right.source
}

function copyRevision(revision: HostRevision): HostRevision {
  return Object.freeze({ build: revision.build, source: revision.source })
}

function copyTarget(target: HostTarget): HostTarget {
  return Switch.kind<HostTarget, HostTarget>(target, {
    accessibility: accessibility =>
      Object.freeze({
        kind: 'accessibility',
        name: accessibility.name,
        occurrence: accessibility.occurrence,
        role: accessibility.role,
      }),
    scoped: scoped =>
      Object.freeze({
        kind: 'scoped',
        scope: copyTarget(scoped.scope),
        target: copyTarget(scoped.target),
      }),
    tag: tag => Object.freeze({ kind: 'tag', occurrence: tag.occurrence, value: tag.value }),
    text: text => Object.freeze({ kind: 'text', occurrence: text.occurrence, value: text.value }),
  })
}

function staleObservation(sessionId: string, observation: HostObservation): HostControlError {
  return new HostControlError(
    'staleObservation',
    `Host observation '${observation.id}' is no longer current for session '${sessionId}'.`,
    { observation, sessionId },
  )
}

function artifactName(name: string): string {
  const withoutExtension = name.trim().replace(/\.png$/iu, '')
  const safe = withoutExtension.replaceAll(/[^a-zA-Z0-9._-]/gu, '_')
  return safe.length > 0 ? safe : 'screenshot'
}

function describeTarget(target: HostTarget): string {
  return Switch.kind<HostTarget, string>(target, {
    accessibility: accessibility => `with accessibility name '${accessibility.name}'`,
    scoped: scoped => `${describeTarget(scoped.target)} within ${describeTarget(scoped.scope)}`,
    tag: tag => `tagged '${tag.value}'`,
    text: text => `with text '${text.value}'`,
  })
}

async function asHostOperation<T>(message: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof HostControlError) {
      throw error
    }
    throw new HostControlError('host', message, { cause: Errors.messageOf(error) })
  }
}
