// Studio agent chat: the endpoint, and the one conversation a project session holds.

import { FS, Repo } from '@shared'
import type { ToolSet } from 'ai'
import type { StudioProjectSession } from '../StudioProjectSession'
import type { StudioTestRunner } from '../StudioTestRunner'
import { authoringTools, type CodeChangeRequest } from './AgentChatAuthoring'
import { declarationSource } from './AgentChatFacts'
import { chatInstructions, scenarioInstructions } from './AgentChatInstructions'
import { AgentChatProvider } from './AgentChatProvider'
import { type AgentChatApproval, type AgentChatEvent, AgentChatSession, type AgentChatTurn } from './AgentChatSession'
import { type AgentChatToolCall, type AgentChatWorld, readTools } from './AgentChatTools'
import {
  type AgentChatWriteWorld,
  APPROVAL_REQUIRED,
  stageChange,
  type StagedChange,
  writeTools,
} from './AgentChatWrites'
import { type FeatureTestVerdict, featureTestVerdict, type TestRunSummary } from './FeatureVerdict'
import { buildSemanticSnapshot, resolveTarget, type SemanticSnapshot } from './SemanticSnapshot'

type Json = Record<string, unknown>

const RUN_LOG_DIR = '.artifacts/agent-chat/runs'

/**
 * worldFor gives the tools their only view of the project. Everything they can reach passes through here.
 *
 * The snapshot and the file bodies are held for the life of one turn. Rebuilding them per tool call means a
 * full workspace re-parse and graph walk each time, which a chat loop does ten or twenty times a turn; and a
 * turn that re-read the project halfway through would answer from two different versions of it.
 */
function worldFor(session: StudioProjectSession): AgentChatWorld & { invalidate: () => void } {
  let snapshot: Promise<SemanticSnapshot> | undefined
  let files: Promise<readonly { path: string; content: string }[]> | undefined
  return {
    compile: () => {
      const state = session.compileSnapshot()
      return { diagnostics: state.diagnostics, status: state.status }
    },
    files: async () => {
      files ??= (async () =>
        await Promise.all(
          (await session.files()).map(async file => {
            const read = await session.readFile(file.path)
            return { content: read.content, path: file.path, sourceVersion: read.sourceVersion }
          }),
        ))()
      return await files
    },
    invalidate: () => {
      files = undefined
      snapshot = undefined
    },
    testSources: async () => {
      const files = await Promise.all(
        (await session.files())
          .filter(file => file.path.endsWith('.test.tao'))
          .map(async file => ({ content: (await session.readFile(file.path)).content, path: file.path })),
      )
      return files
    },
    snapshot: async () => {
      snapshot ??= (async () => {
        const parsed = await session.agentParse()
        return buildSemanticSnapshot(session.projectRoot, session.appName, parsed.files, parsed.diagnostics)
      })()
      return await snapshot
    },
  }
}

export type AgentChatHistoryEntry =
  | { role: 'user'; text: string }
  | {
    role: 'assistant'
    text: string
    codeChanges?: { granted: boolean; requests: readonly CodeChangeRequest[] }
    message?: string
    pendingApprovals?: readonly (AgentChatApproval & { diff?: string })[]
    status?: AgentChatTurn['status']
    steps?: number
    toolCalls?: readonly AgentChatToolCall[]
    usage?: { inputTokens?: number; outputTokens?: number }
    verdict?: FeatureTestVerdict
    verdicts?: readonly BoundFeatureTestVerdict[]
  }

export type BoundFeatureTestVerdict = FeatureTestVerdict & {
  changeId: string
  beforeVersions: readonly { path: string; sourceVersion: string }[]
  afterVersions: readonly { path: string; sourceVersion: string }[]
  currentVersions: readonly { path: string; sourceVersion: string }[]
  versionStatus: 'current' | 'stale'
}

/**
 * AgentChatConversation is one chat against one project. It is deliberately server-side: the messages, the
 * approval state, and the provider key never travel to the browser.
 */
class AgentChatConversation {
  readonly #provider: AgentChatProvider
  readonly #session: StudioProjectSession
  readonly #world: ReturnType<typeof worldFor>
  #chat: AgentChatSession | undefined
  #calls: AgentChatToolCall[] = []
  #staged = new Map<string, StagedChange>()
  #issuedTexts = new Map<string, string>()
  #tests: StudioTestRunner | undefined
  #lastTestRun: TestRunSummary | undefined
  #changeBaselines = new Map<string, {
    run: TestRunSummary | undefined
    beforeVersions: readonly { path: string; sourceVersion: string }[]
    appliedVersions?: readonly { path: string; sourceVersion: string }[]
  }>()
  #turnVerdicts: BoundFeatureTestVerdict[] = []
  #recordedVerdicts = 0
  #mode: 'chat' | 'scenario' = 'chat'
  #codeChangesGranted = false
  #codeChangeRequests: CodeChangeRequest[] = []
  /** How many requests existed when this turn began, so only the new ones raise a card. */
  #requestsBeforeTurn = 0
  #history: AgentChatHistoryEntry[] = []
  #nextChangeNumber = 0
  #lane: Promise<void> = Promise.resolve()
  #generation = 0

  constructor(session: StudioProjectSession, provider: AgentChatProvider) {
    this.#provider = provider
    this.#session = session
    this.#world = worldFor(session)
  }

  get world(): AgentChatWorld & { invalidate: () => void } {
    return this.#world
  }

  get provider(): AgentChatProvider {
    return this.#provider
  }

  get history(): readonly AgentChatHistoryEntry[] {
    return this.#history
  }

  #resetNow(): void {
    this.#chat = undefined
    this.#calls = []
    this.#history = []
    this.#staged.clear()
    this.#issuedTexts.clear()
    // The grant was given in a conversation, for a request made in it. A new conversation has neither.
    this.#codeChangesGranted = false
    this.#codeChangeRequests.length = 0
    this.#requestsBeforeTurn = 0
    this.#changeBaselines.clear()
    this.#turnVerdicts = []
    this.#recordedVerdicts = 0
    this.#nextChangeNumber = 0
  }

  reset(): Promise<void> {
    this.#generation += 1
    return this.#serialize(async () => this.#resetNow())
  }

  /** The mode decides which tools exist at all. A read-only chat has no write tool to refuse. */
  setMode(mode: 'chat' | 'scenario'): Promise<void> {
    if (mode !== this.#mode) {
      // Invalidate a completion already in flight immediately. The actual reset still takes its ordered
      // place behind that turn, so no two operations mutate the conversation at once.
      this.#generation += 1
    }
    return this.#serialize(async () => {
      if (mode !== this.#mode) {
        this.#mode = mode
        this.#resetNow()
      }
    })
  }

  get mode(): 'chat' | 'scenario' {
    return this.#mode
  }

  /** The requests the agent made to change app code, and whether a person has allowed it. */
  get codeChanges(): { granted: boolean; requests: readonly CodeChangeRequest[] } {
    return { granted: this.#codeChangesGranted, requests: this.#codeChangeRequests }
  }

  /** Every stateful command takes one server-owned lane; browser button state is only a convenience. */
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#lane.then(operation, operation)
    this.#lane = run.then(() => {}, () => {})
    return run
  }

  /**
   * grantCodeChanges is the person's answer to "this also needs the app to change". It adds the change tools
   * to the conversation already in progress rather than starting a new one, because the conversation is where
   * the request was made and understood.
   */
  grantCodeChanges(): Promise<void> {
    return this.#serialize(async () => {
      this.#codeChangesGranted = true
      this.#chat?.replaceTools(this.#toolsFor(), [...APPROVAL_REQUIRED])
    })
  }

  /**
   * The tools a mode actually has. In scenario mode the gate is here and nowhere else: until a person allows
   * it, the tools that change app code do not exist, so the model cannot reach for one whatever it decides.
   */
  #toolsFor(): ToolSet {
    const record = (call: AgentChatToolCall) => this.#calls.push(call)
    const writes = this.#writeWorld()
    const issueChangeId = () => `change-${++this.#nextChangeNumber}`
    const stage = stageChange(writes, this.#staged, issueChangeId)
    const all = writeTools(writes, this.#staged, record, this.#issuedTexts, issueChangeId)
    if (this.#mode === 'chat') {
      return { ...readTools(this.#reading(), record), ...all }
    }
    const landing = Object.fromEntries(
      Object.entries(all).filter(([name]) => (APPROVAL_REQUIRED as readonly string[]).includes(name)),
    )
    return {
      ...readTools(this.#reading(), record),
      ...authoringTools(writes, stage, this.#codeChangeRequests, record),
      ...landing,
      // Applying and undoing are needed for an authored scenario or check; changing app code is not, and is
      // withheld until the person answers the agent's request for it.
      ...(this.#codeChangesGranted ? all : {}),
    }
  }

  send(text: string, onEvent?: (event: AgentChatEvent) => void): Promise<Json> {
    const generation = this.#generation
    return this.#serialize(async () => await this.#send(text, generation, onEvent))
  }

  async #send(text: string, generation: number, onEvent?: (event: AgentChatEvent) => void): Promise<Json> {
    const model = this.#provider.model()
    if (model === undefined) {
      return { availability: this.#provider.availability(), status: 'unavailable' }
    }
    if (this.#chat === undefined) {
      this.#chat = new AgentChatSession({
        approvalPolicy: call => this.#approvalPolicy(call),
        approvalRequired: APPROVAL_REQUIRED,
        drain: () => this.#calls.splice(0, this.#calls.length),
        instructions: this.#mode === 'scenario' ? scenarioInstructions : chatInstructions,
        model,
        tools: this.#toolsFor(),
      })
    }
    // The project may have changed between turns, so each turn starts from a freshly read one.
    this.#world.invalidate()
    this.#requestsBeforeTurn = this.#codeChangeRequests.length
    // A verdict belongs to the turn that ran the checks, and history now outlives the turn: without
    // this, every later turn is recorded carrying it and replays the same card on reload. `respond`
    // continues this turn deliberately, so only a new message clears it.
    this.#turnVerdicts = []
    this.#recordedVerdicts = 0
    this.#history.push({ role: 'user', text })
    const turn = await this.#chat.send(text, event => {
      if (generation === this.#generation) {
        onEvent?.(event)
      }
    })
    return await this.#record(turn, generation)
  }

  /**
   * The read side of the world. Running the app's tests is a read, and it is also how a baseline gets taken:
   * a verdict on a change is only worth anything measured against a run from before it.
   */
  #reading(): AgentChatWorld {
    return {
      ...this.#world,
      runTests: async () => {
        return await this.#runTests()
      },
      testStatus: () => this.#lastTestRun,
    }
  }

  /** The write side of the world. Every change goes through one Studio mutation that compiles or rolls back. */
  #writeWorld(): AgentChatWriteWorld {
    return {
      ...this.#reading(),
      apply: async change => {
        // The baseline is taken immediately before this exact write, not whenever the model happened to call
        // runTests earlier. Each applied change in a multi-change turn therefore gets its own attribution.
        const baseline = await this.#runTests()
        this.#changeBaselines.set(change.id, { beforeVersions: change.expect, run: baseline })
        const unique = new Map<string, string>()
        for (const edit of change.edits) {
          unique.set(edit.path, edit.after)
        }
        const fileEdits = [...unique.entries()].map(([path, content]) => ({ content, path }))
        let result: Awaited<ReturnType<StudioProjectSession['applyAgentFiles']>>
        try {
          result = await this.#session.applyAgentFiles({
            edits: fileEdits,
            expect: change.expect,
            writeId: crypto.randomUUID(),
          })
        } catch (error) {
          this.#changeBaselines.delete(change.id)
          throw error
        }
        if (result.rolledBack) {
          this.#changeBaselines.delete(change.id)
        } else {
          this.#changeBaselines.set(change.id, {
            appliedVersions: result.sourceVersions,
            beforeVersions: change.expect,
            run: baseline,
          })
        }
        // The project just changed, so the next tool call must not answer from the graph it had before.
        this.#world.invalidate()
        return {
          message: result.compile.message,
          rolledBack: result.rolledBack,
          status: result.compile.status,
        }
      },
      // From the same read the staged text came from. A fresh read here would report the version of an edit
      // made after the change was computed, and the precondition would then wave that edit through.
      sourceVersionOf: async path =>
        (await this.#world.files()).find(file => file.path === path)?.sourceVersion
          ?? (await this.#session.readFile(path)).sourceVersion,
      verdict: async change => {
        const baseline = this.#changeBaselines.get(change.id)
        const after = await this.#runTests()
        this.#changeBaselines.delete(change.id)
        const currentVersions = await Promise.all(change.expect.map(async expected => ({
          path: expected.path,
          sourceVersion: (await this.#session.readFile(expected.path)).sourceVersion,
        })))
        const appliedVersions = baseline?.appliedVersions ?? currentVersions
        const versionsHeld = appliedVersions.every(applied =>
          currentVersions.some(current =>
            current.path === applied.path && current.sourceVersion === applied.sourceVersion
          )
        )
        const verdict: BoundFeatureTestVerdict = {
          ...(versionsHeld
            ? featureTestVerdict(baseline?.run, after)
            : {
              broke: [],
              detail:
                'Another source edit landed before the run finished, so these results cannot be attributed to this change.',
              heading: 'The source changed while tests ran; this change has no test verdict.',
              repaired: [],
              status: 'unknown' as const,
            }),
          afterVersions: appliedVersions,
          beforeVersions: baseline?.beforeVersions ?? change.expect,
          changeId: change.id,
          currentVersions,
          versionStatus: versionsHeld ? 'current' : 'stale',
        }
        this.#turnVerdicts.push(verdict)
        return verdict
      },
      undo: async () => {
        const result = await this.#session.undoAgentFiles(crypto.randomUUID())
        this.#world.invalidate()
        this.#changeBaselines.clear()
        this.#lastTestRun = undefined
        return { message: result.compile.message, restored: result.restored, status: result.compile.status }
      },
    }
  }

  respond(
    responses: readonly { approvalId: string; approved: boolean }[],
    onEvent?: (event: AgentChatEvent) => void,
  ): Promise<Json> {
    const generation = this.#generation
    return this.#serialize(async () => await this.#respond(responses, generation, onEvent))
  }

  async #respond(
    responses: readonly { approvalId: string; approved: boolean }[],
    generation: number,
    onEvent?: (event: AgentChatEvent) => void,
  ): Promise<Json> {
    if (this.#chat === undefined) {
      return { message: 'Nothing is waiting for approval.', status: 'complete' }
    }
    const turn = await this.#chat.respond(responses, event => {
      if (generation === this.#generation) {
        onEvent?.(event)
      }
    })
    return await this.#record(turn, generation)
  }

  async #record(turn: AgentChatTurn, generation: number): Promise<Json> {
    if (generation !== this.#generation) {
      return {
        message: 'This reply was discarded because the conversation changed while it was running.',
        pendingApprovals: [],
        status: 'failed',
        steps: turn.steps,
        text: '',
        toolCalls: turn.toolCalls,
        usage: turn.usage,
      }
    }
    const pendingApprovals = turn.pendingApprovals.map(approval => ({
      ...approval,
      diff: this.#diffFor(approval),
    }))
    const codeChanges = {
      granted: this.#codeChangesGranted,
      requests: this.#codeChangeRequests.slice(this.#requestsBeforeTurn),
    }
    const verdicts = this.#turnVerdicts.slice(this.#recordedVerdicts)
    this.#recordedVerdicts = this.#turnVerdicts.length
    const verdict = verdicts[verdicts.length - 1]
    this.#history.push({
      role: 'assistant',
      codeChanges,
      message: turn.message,
      pendingApprovals,
      status: turn.status,
      steps: turn.steps,
      text: turn.text,
      toolCalls: turn.toolCalls,
      usage: turn.usage,
      ...(verdict === undefined ? {} : { verdict }),
      ...(verdicts.length === 0 ? {} : { verdicts }),
    })
    await this.#log(turn)
    return {
      codeChanges,
      message: turn.message,
      pendingApprovals,
      status: turn.status,
      steps: turn.steps,
      text: turn.text,
      toolCalls: turn.toolCalls,
      usage: turn.usage,
      ...(verdict === undefined ? {} : { verdict }),
      ...(verdicts.length === 0 ? {} : { verdicts }),
    }
  }

  /** The test runner belongs to the Studio service, not the session, so the route supplies it per request. */
  useTestRunner(tests: StudioTestRunner | undefined): void {
    this.#tests = tests
  }

  /** runTests reads the app's own tests, and reports nothing rather than throwing when it cannot. */
  async #runTests(): Promise<TestRunSummary | undefined> {
    try {
      const run = this.#tests === undefined ? undefined : await this.#tests.run()
      if (run !== undefined) {
        this.#lastTestRun = run
      }
      return run
    } catch {
      return undefined
    }
  }

  /**
   * A person is only asked about a change that exists and can be shown. An applyChange naming nothing is
   * denied here rather than becoming a card with an empty diff, which is how people learn to approve blindly.
   */
  #approvalPolicy(call: { toolName: string; input: unknown }): { denied: string } | undefined {
    if (call.toolName === 'undoLastChange') {
      return this.#session.agentUndoPreview() === undefined
        ? { denied: 'Nothing applied by the agent is available to undo.' }
        : undefined
    }
    if (call.toolName !== 'applyChange') {
      return undefined
    }
    const id = (call.input as { changeId?: unknown } | undefined)?.changeId
    if (typeof id !== 'string' || !this.#staged.has(id)) {
      return { denied: `No change is staged under "${String(id)}", so there is nothing to approve.` }
    }
    return undefined
  }

  /** The diff an approval is really about, so a person approves a change rather than an argument list. */
  #diffFor(approval: AgentChatApproval): string | undefined {
    if (approval.toolName === 'undoLastChange') {
      return this.#session.agentUndoPreview()?.diff
    }
    const id = (approval.input as { changeId?: unknown } | undefined)?.changeId
    return typeof id === 'string' ? this.#staged.get(id)?.edits.map(edit => edit.diff).join('\n\n') : undefined
  }

  /** Every turn is written to disk: a transcript is the only audit trail of what was sent to a hosted model. */
  async #log(turn: AgentChatTurn): Promise<void> {
    try {
      const directory = Repo.resolvePath(RUN_LOG_DIR)
      await FS.mkdir(directory)
      await FS.writeText(
        FS.resolvePath(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, directory),
        JSON.stringify(
          {
            app: this.#session.appName,
            model: this.#provider.modelId,
            status: turn.status,
            steps: turn.steps,
            text: turn.text,
            toolCalls: turn.toolCalls,
            usage: turn.usage,
          },
          null,
          2,
        ),
      )
    } catch {
      // A transcript that cannot be written must not fail the turn the person is waiting on.
    }
  }
}

const conversations = new WeakMap<StudioProjectSession, AgentChatConversation>()

function conversationFor(
  session: StudioProjectSession,
  secrets?: Readonly<Record<string, string>>,
): AgentChatConversation {
  const existing = conversations.get(session)
  if (existing !== undefined) {
    return existing
  }
  // The decrypted secrets are read here rather than from the process environment, so a key reaches the chat
  // without reaching the bundler, the preview runtime, or anything else Studio starts.
  const created = new AgentChatConversation(
    session,
    new AgentChatProvider(secrets === undefined ? process.env : { ...process.env, ...secrets }),
  )
  conversations.set(session, created)
  return created
}

/** conversationForTesting drives the real server object with a supplied model and a stub project session. */
export function conversationForTesting(
  session: StudioProjectSession,
  provider: AgentChatProvider,
): {
  handle: (command: string, body: Json, tests?: StudioTestRunner) => Promise<unknown>
  send: (message: string, onEvent: (event: AgentChatEvent) => void) => Promise<unknown>
} {
  const conversation = new AgentChatConversation(session, provider)
  conversations.set(session, conversation)
  return {
    handle: async (command, body, tests) => await AgentChat.handle(session, command, body, tests),
    send: async (message, onEvent) => await conversation.send(message, onEvent),
  }
}

/**
 * streamTurn runs one turn and reports it as newline-delimited JSON: `text` and `tool` events while the model
 * works, then one `done` carrying exactly the payload the non-streaming command returns. The panel therefore
 * prints as the answer arrives and still renders approvals, verdicts and usage from a single final object.
 */
export function streamTurn(
  session: StudioProjectSession,
  command: string,
  body: Json,
  tests?: StudioTestRunner,
  secrets?: Readonly<Record<string, string>>,
): ReadableStream<Uint8Array> {
  const conversation = conversationFor(session, secrets)
  conversation.useTestRunner(tests)
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (value: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
      try {
        const onEvent = (event: AgentChatEvent) => write(event)
        const message = String(body['message'] ?? '').trim()
        const result = command === 'respond'
          ? await conversation.respond(approvalResponses(body), onEvent)
          : message === ''
          ? { message: 'Ask a question first.', status: 'failed' }
          : await conversation.send(message, onEvent)
        write({ turn: result, type: 'done' })
      } catch (error) {
        // A turn that fails mid-stream still has to end with something the panel can render.
        write({
          turn: { message: String(error instanceof Error ? error.message : error), status: 'failed' },
          type: 'done',
        })
      } finally {
        controller.close()
      }
    },
  })
}

function approvalResponses(body: Json): { approvalId: string; approved: boolean }[] {
  const responses = Array.isArray(body['responses']) ? body['responses'] : []
  return responses.map(entry => ({
    approvalId: String((entry as Json)['approvalId'] ?? ''),
    approved: (entry as Json)['approved'] === true,
  }))
}

export const AgentChat = {
  async handle(
    session: StudioProjectSession,
    command: string,
    body: Json,
    tests?: StudioTestRunner,
    secrets?: Readonly<Record<string, string>>,
  ): Promise<unknown> {
    const conversation = conversationFor(session, secrets)
    conversation.useTestRunner(tests)
    if (command === 'availability') {
      return conversation.provider.availability()
    }
    if (command === 'enable') {
      return conversation.provider.enable(body['enabled'] === true)
    }
    if (command === 'reset') {
      await conversation.reset()
      return { status: 'reset' }
    }
    if (command === 'mode') {
      // `ask` and `build` were separate modes before they merged; an old client may still name either.
      await conversation.setMode(body['mode'] === 'scenario' ? 'scenario' : 'chat')
      return { mode: conversation.mode }
    }
    if (command === 'grant-code-changes') {
      await conversation.grantCodeChanges()
      return conversation.codeChanges
    }
    if (command === 'respond') {
      return await conversation.respond(approvalResponses(body))
    }
    if (command === 'history') {
      return { history: conversation.history, mode: conversation.mode }
    }
    if (command === 'names') {
      // The panel turns these into links, so an answer that names a declaration stays checkable. This must
      // not invalidate: a person clicking a link while a turn runs would drop that turn's snapshot mid-flight.
      const snapshot = await conversation.world.snapshot()
      return {
        names: [...snapshot.nodes.values()]
          .filter(node => ['action', 'bundle', 'entity', 'field', 'query', 'view'].includes(node.kind))
          .map(node => node.name),
      }
    }
    if (command === 'locate') {
      const snapshot = await conversation.world.snapshot()
      const found = resolveTarget(snapshot, String(body['name'] ?? ''))
      if (found === undefined) {
        return { found: false }
      }
      const source = declarationSource(await conversation.world.files(), found)
      return source === undefined ? { found: false } : { found: true, line: source.line, path: source.path }
    }
    if (command === 'send') {
      const text = String(body['message'] ?? '').trim()
      if (text === '') {
        return { message: 'Ask a question first.', status: 'failed' }
      }
      return await conversation.send(text)
    }
    return { error: `Unknown agent chat command: ${command}` }
  },
} as const
