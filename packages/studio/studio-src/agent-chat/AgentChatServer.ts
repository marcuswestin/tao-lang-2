// Studio agent chat: the endpoint, and the one conversation a project session holds.

import { FS, Repo } from '@shared'
import type { ToolSet } from 'ai'
import { type FeatureTestVerdict, featureTestVerdict, type TestRunSummary } from '../agent-poc/FeatureVerdict'
import { buildSemanticSnapshot, resolveTarget, type SemanticSnapshot } from '../agent-poc/SemanticSnapshot'
import type { StudioProjectSession } from '../StudioProjectSession'
import type { StudioTestRunner } from '../StudioTestRunner'
import { authoringTools, type CodeChangeRequest } from './AgentChatAuthoring'
import { declarationSource } from './AgentChatFacts'
import { askInstructions, buildInstructions, scenarioInstructions } from './AgentChatInstructions'
import { AgentChatProvider } from './AgentChatProvider'
import { AgentChatSession, type AgentChatTurn } from './AgentChatSession'
import { type AgentChatToolCall, type AgentChatWorld, readTools } from './AgentChatTools'
import {
  type AgentChatWriteWorld,
  APPROVAL_REQUIRED,
  stageChange,
  type StagedChange,
  writeTools,
} from './AgentChatWrites'

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
          (await session.files()).map(async file => ({
            content: (await session.readFile(file.path)).content,
            path: file.path,
          })),
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
        const parsed = await session.agentPocParse()
        return buildSemanticSnapshot(session.projectRoot, session.appName, parsed.files, parsed.diagnostics)
      })()
      return await snapshot
    },
  }
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
  /** The app's tests as they stood before this conversation changed anything. */
  #testBaseline: TestRunSummary | undefined
  #tests: StudioTestRunner | undefined
  #lastVerdict: FeatureTestVerdict | undefined
  #mode: 'ask' | 'build' | 'scenario' = 'ask'
  #codeChangesGranted = false
  #codeChangeRequests: CodeChangeRequest[] = []
  #history: { role: 'user' | 'assistant'; text: string; toolCalls?: readonly AgentChatToolCall[] }[] = []

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

  get history(): readonly { role: 'user' | 'assistant'; text: string; toolCalls?: readonly AgentChatToolCall[] }[] {
    return this.#history
  }

  reset(): void {
    this.#chat = undefined
    this.#calls = []
    this.#history = []
    this.#staged.clear()
    this.#issuedTexts.clear()
  }

  /** The mode decides which tools exist at all. A read-only chat has no write tool to refuse. */
  setMode(mode: 'ask' | 'build' | 'scenario'): void {
    if (mode !== this.#mode) {
      this.#mode = mode
      this.reset()
    }
  }

  get mode(): 'ask' | 'build' | 'scenario' {
    return this.#mode
  }

  /** The requests the agent made to change app code, and whether a person has allowed it. */
  get codeChanges(): { granted: boolean; requests: readonly CodeChangeRequest[] } {
    return { granted: this.#codeChangesGranted, requests: this.#codeChangeRequests }
  }

  /**
   * grantCodeChanges is the person's answer to "this also needs the app to change". It adds the change tools
   * to the conversation already in progress rather than starting a new one, because the conversation is where
   * the request was made and understood.
   */
  grantCodeChanges(): void {
    this.#codeChangesGranted = true
    this.#chat?.replaceTools(this.#toolsFor(), [...APPROVAL_REQUIRED])
  }

  /**
   * The tools a mode actually has. In scenario mode the gate is here and nowhere else: until a person allows
   * it, the tools that change app code do not exist, so the model cannot reach for one whatever it decides.
   */
  #toolsFor(): ToolSet {
    const record = (call: AgentChatToolCall) => this.#calls.push(call)
    const writes = this.#writeWorld()
    if (this.#mode === 'ask') {
      return readTools(this.#reading(), record)
    }
    const all = writeTools(writes, this.#staged, record, this.#issuedTexts)
    if (this.#mode === 'build') {
      return { ...readTools(this.#reading(), record), ...all }
    }
    const landing = Object.fromEntries(
      Object.entries(all).filter(([name]) => (APPROVAL_REQUIRED as readonly string[]).includes(name)),
    )
    return {
      ...readTools(this.#reading(), record),
      ...authoringTools(writes, stageChange(writes, this.#staged), this.#codeChangeRequests, record),
      ...landing,
      // Applying and undoing are needed for an authored scenario or check; changing app code is not, and is
      // withheld until the person answers the agent's request for it.
      ...(this.#codeChangesGranted ? all : {}),
    }
  }

  async send(text: string): Promise<Json> {
    const model = this.#provider.model()
    if (model === undefined) {
      return { availability: this.#provider.availability(), status: 'unavailable' }
    }
    if (this.#chat === undefined) {
      this.#chat = new AgentChatSession({
        ...(this.#mode === 'ask' ? {} : {
          approvalPolicy: call => this.#approvalPolicy(call),
          approvalRequired: APPROVAL_REQUIRED,
        }),
        drain: () => this.#calls.splice(0, this.#calls.length),
        instructions: this.#mode === 'build'
          ? buildInstructions
          : this.#mode === 'scenario'
          ? scenarioInstructions
          : askInstructions,
        model,
        tools: this.#toolsFor(),
      })
    }
    // The project may have changed between turns, so each turn starts from a freshly read one.
    this.#world.invalidate()
    this.#history.push({ role: 'user', text })
    const turn = await this.#chat.send(text)
    return await this.#record(turn)
  }

  /**
   * The read side of the world. Running the app's tests is a read, and it is also how a baseline gets taken:
   * a verdict on a change is only worth anything measured against a run from before it.
   */
  #reading(): AgentChatWorld {
    return {
      ...this.#world,
      runTests: async () => {
        const run = await this.#runTests()
        this.#testBaseline ??= run
        return run
      },
    }
  }

  /** The write side of the world. Every change goes through one Studio mutation that compiles or rolls back. */
  #writeWorld(): AgentChatWriteWorld {
    return {
      ...this.#reading(),
      apply: async change => {
        const result = await this.#session.applyAgentPocFiles({
          edits: change.edits.map(edit => ({ content: edit.after, path: edit.path })),
          expect: change.expect,
          writeId: crypto.randomUUID(),
        })
        // The project just changed, so the next tool call must not answer from the graph it had before.
        this.#world.invalidate()
        return {
          message: result.compile.message,
          rolledBack: result.rolledBack,
          status: result.compile.status,
        }
      },
      sourceVersionOf: async path => (await this.#session.readFile(path)).sourceVersion,
      verdict: async () => {
        const after = await this.#runTests()
        // Without a baseline the verdict says so rather than blaming or excusing this change.
        this.#lastVerdict = featureTestVerdict(this.#testBaseline, after)
        this.#testBaseline = after
        return this.#lastVerdict
      },
      undo: async () => {
        const result = await this.#session.undoAgentPocFiles(crypto.randomUUID())
        this.#world.invalidate()
        return { message: result.compile.message, restored: result.restored, status: result.compile.status }
      },
    }
  }

  async respond(responses: readonly { approvalId: string; approved: boolean }[]): Promise<Json> {
    if (this.#chat === undefined) {
      return { message: 'Nothing is waiting for approval.', status: 'complete' }
    }
    return await this.#record(await this.#chat.respond(responses))
  }

  async #record(turn: AgentChatTurn): Promise<Json> {
    this.#history.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls })
    await this.#log(turn)
    return {
      message: turn.message,
      pendingApprovals: turn.pendingApprovals.map(approval => ({
        ...approval,
        diff: this.#diffFor(approval.input),
      })),
      codeChanges: this.codeChanges,
      ...(this.#lastVerdict === undefined ? {} : { verdict: this.#lastVerdict }),
      status: turn.status,
      steps: turn.steps,
      text: turn.text,
      toolCalls: turn.toolCalls,
      usage: turn.usage,
    }
  }

  /** The test runner belongs to the Studio service, not the session, so the route supplies it per request. */
  useTestRunner(tests: StudioTestRunner | undefined): void {
    this.#tests = tests
  }

  /** runTests reads the app's own tests, and reports nothing rather than throwing when it cannot. */
  async #runTests(): Promise<TestRunSummary | undefined> {
    try {
      return this.#tests === undefined ? undefined : await this.#tests.run()
    } catch {
      return undefined
    }
  }

  /**
   * A person is only asked about a change that exists and can be shown. An applyChange naming nothing is
   * denied here rather than becoming a card with an empty diff, which is how people learn to approve blindly.
   */
  #approvalPolicy(call: { toolName: string; input: unknown }): { denied: string } | undefined {
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
  #diffFor(input: unknown): string | undefined {
    const id = (input as { changeId?: unknown } | undefined)?.changeId
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

function conversationFor(session: StudioProjectSession): AgentChatConversation {
  const existing = conversations.get(session)
  if (existing !== undefined) {
    return existing
  }
  const created = new AgentChatConversation(session, new AgentChatProvider())
  conversations.set(session, created)
  return created
}

/** conversationForTesting drives the real server object with a supplied model and a stub project session. */
export function conversationForTesting(
  session: StudioProjectSession,
  provider: AgentChatProvider,
): { handle: (command: string, body: Json, tests?: StudioTestRunner) => Promise<unknown> } {
  const conversation = new AgentChatConversation(session, provider)
  conversations.set(session, conversation)
  return { handle: async (command, body, tests) => await AgentChat.handle(session, command, body, tests) }
}

export const AgentChat = {
  async handle(
    session: StudioProjectSession,
    command: string,
    body: Json,
    tests?: StudioTestRunner,
  ): Promise<unknown> {
    const conversation = conversationFor(session)
    conversation.useTestRunner(tests)
    if (command === 'availability') {
      return conversation.provider.availability()
    }
    if (command === 'enable') {
      return conversation.provider.enable(body['enabled'] === true)
    }
    if (command === 'reset') {
      conversation.reset()
      return { status: 'reset' }
    }
    if (command === 'mode') {
      const requested = body['mode']
      conversation.setMode(requested === 'build' ? 'build' : requested === 'scenario' ? 'scenario' : 'ask')
      return { mode: conversation.mode }
    }
    if (command === 'grant-code-changes') {
      conversation.grantCodeChanges()
      return conversation.codeChanges
    }
    if (command === 'respond') {
      const responses = Array.isArray(body['responses']) ? body['responses'] : []
      return await conversation.respond(
        responses.map(entry => ({
          approvalId: String((entry as Json)['approvalId'] ?? ''),
          approved: (entry as Json)['approved'] === true,
        })),
      )
    }
    if (command === 'history') {
      return { history: conversation.history }
    }
    if (command === 'names') {
      // The panel turns these into links, so an answer that names a declaration stays checkable.
      conversation.world.invalidate()
      const snapshot = await conversation.world.snapshot()
      return {
        names: [...snapshot.nodes.values()]
          .filter(node => ['action', 'bundle', 'entity', 'field', 'query', 'view'].includes(node.kind))
          .map(node => node.name),
      }
    }
    if (command === 'locate') {
      conversation.world.invalidate()
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
