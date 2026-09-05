import { CLI, FS, Platform } from '@shared'
import type {
  GenerationAvailability,
  GenerationFailure,
  GenerationInput,
  GenerationJsonSchema,
  GenerationProvider,
  GenerationResult,
  GenerationRun,
  JsonValue,
} from './generation-contract'
import { emptyPartials, generationPrompt, parseJsonText } from './generation-prompt'
import { checkGenerationSchema } from './json-schema'

/** AgentCliKind names a coding-agent command line this provider knows how to drive in print mode. */
export type AgentCliKind = 'claude' | 'codex'

export type AgentCliRunSpec = {
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: Record<string, string | undefined>
  readonly stdin?: string
  readonly timeoutMs: number
}

export type AgentCliRunResult = {
  readonly exitCode: number | null
  readonly stderr: string
  readonly stdout: string
  readonly timedOut: boolean
}

/** AgentCliRunner starts the agent command; tests inject one, the CLI uses the shared process wrapper. */
export type AgentCliRunner = (command: string, spec: AgentCliRunSpec) => Promise<AgentCliRunResult>

export type AgentCliGenerationProviderOptions = {
  /** Web fetching may be allowed when the prompt cites URLs the agent should read itself. */
  readonly allowWeb?: boolean
  /** Local image files the agent may open; their directories are granted read access. */
  readonly attachments?: readonly string[]
  readonly command?: string
  readonly cwd?: string
  readonly env?: Record<string, string | undefined>
  readonly kind: AgentCliKind
  readonly run?: AgentCliRunner
  readonly timeoutMs?: number
}

/**
 * AgentCliGenerationProvider drives an installed coding agent in its non-interactive print mode and
 * reads back one schema-checked JSON value. The agent brings its own model and login, so no key is
 * configured here; it also reads images and web pages itself when the prompt points at them.
 */
export class AgentCliGenerationProvider implements GenerationProvider {
  readonly #allowWeb: boolean
  readonly #attachments: readonly string[]
  readonly #command: string
  readonly #cwd: string | undefined
  readonly #env: Record<string, string | undefined> | undefined
  readonly #kind: AgentCliKind
  readonly #run: AgentCliRunner
  readonly #timeoutMs: number

  constructor(options: AgentCliGenerationProviderOptions) {
    this.#allowWeb = options.allowWeb ?? false
    this.#attachments = options.attachments ?? []
    this.#command = options.command ?? options.kind
    this.#cwd = options.cwd
    this.#env = options.env
    this.#kind = options.kind
    this.#run = options.run ?? sharedAgentCliRunner
    this.#timeoutMs = options.timeoutMs ?? 240_000
  }

  async availability(): Promise<GenerationAvailability> {
    try {
      const result = await this.#run(this.#command, { args: ['--version'], env: this.#childEnv(), timeoutMs: 15_000 })
      if (result.exitCode !== 0) {
        return { status: 'unavailable', reason: `${this.#command} --version exited with ${result.exitCode}.` }
      }
      return { status: 'available' }
    } catch (error) {
      return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  generate<Value extends JsonValue = JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
  ): GenerationRun<Value> {
    return { partials: emptyPartials(), final: this.#generate<Value>(schema, inputs, guide) }
  }

  async #generate<Value extends JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
  ): Promise<GenerationResult<Value>> {
    const prompt = agentPrompt(inputs, guide, this.#attachments)
    try {
      const value = this.#kind === 'claude'
        ? await this.#generateWithClaude(schema, prompt)
        : await this.#generateWithCodex(schema, prompt)
      if (value.status === 'failure') {
        return value
      }
      const issues = checkGenerationSchema(schema, value.value)
      return issues.length === 0
        ? { status: 'success', value: value.value as Value }
        : failure('schema_mismatch', `${this.#label()} returned a value outside the requested schema.`, issues)
    } catch (error) {
      return failure('provider_error', error instanceof Error ? error.message : String(error))
    }
  }

  async #generateWithClaude(schema: GenerationJsonSchema, prompt: string): Promise<GenerationResult<JsonValue>> {
    const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--no-session-persistence']
    const tools = [...(this.#attachments.length > 0 ? ['Read'] : []), ...(this.#allowWeb ? ['WebFetch'] : [])]
    if (tools.length > 0) {
      args.push('--allowedTools', ...tools)
    }
    const directories = [...new Set(this.#attachments.map(path => FS.dirname(path)))]
    if (directories.length > 0) {
      args.push('--add-dir', ...directories)
    }
    const result = await this.#run(this.#command, {
      args,
      cwd: this.#cwd,
      env: this.#childEnv(),
      stdin: prompt,
      timeoutMs: this.#timeoutMs,
    })
    if (result.timedOut) {
      return failure('cancelled', `${this.#label()} did not answer within ${this.#timeoutMs} ms.`)
    }
    const envelope = parseJsonText(result.stdout)
    if (!isObject(envelope)) {
      return failure('provider_error', trimmedOr(result.stderr, `${this.#label()} printed no JSON result.`))
    }
    if (envelope['is_error'] === true) {
      return failure(
        'provider_error',
        trimmedOr(String(envelope['result'] ?? ''), `${this.#label()} reported an error.`),
      )
    }
    const structured = envelope['structured_output']
    if (structured !== undefined && structured !== null) {
      return { status: 'success', value: structured }
    }
    const fromText = typeof envelope['result'] === 'string' ? parseJsonText(envelope['result']) : undefined
    return fromText === undefined
      ? failure('provider_error', `${this.#label()} answered without JSON.`)
      : { status: 'success', value: fromText }
  }

  async #generateWithCodex(schema: GenerationJsonSchema, prompt: string): Promise<GenerationResult<JsonValue>> {
    const scratch = await FS.mkTmpDir('tao-create-codex-')
    try {
      const schemaPath = FS.resolvePath('schema.json', scratch)
      const outputPath = FS.resolvePath('answer.txt', scratch)
      await FS.writeText(schemaPath, JSON.stringify(schema))
      const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--output-schema', schemaPath]
      args.push('--output-last-message', outputPath)
      for (const attachment of this.#attachments) {
        args.push('--image', attachment)
      }
      args.push('-')
      const result = await this.#run(this.#command, {
        args,
        cwd: this.#cwd ?? scratch,
        env: this.#childEnv(),
        stdin: prompt,
        timeoutMs: this.#timeoutMs,
      })
      if (result.timedOut) {
        return failure('cancelled', `${this.#label()} did not answer within ${this.#timeoutMs} ms.`)
      }
      if (result.exitCode !== 0) {
        return failure('provider_error', trimmedOr(result.stderr, `${this.#label()} exited with ${result.exitCode}.`))
      }
      const answer = await FS.exists(outputPath) ? await FS.readText(outputPath) : result.stdout
      const value = parseJsonText(answer)
      return value === undefined
        ? failure('provider_error', `${this.#label()} answered without JSON.`)
        : { status: 'success', value }
    } finally {
      await FS.remove(scratch).catch(() => undefined)
    }
  }

  #childEnv(): Record<string, string | undefined> {
    return agentChildEnv(this.#env ?? Platform.runtimeProcess.env)
  }

  #label(): string {
    return this.#kind === 'claude' ? 'Claude Code' : 'Codex'
  }
}

function agentPrompt(inputs: readonly GenerationInput[], guide: string, attachments: readonly string[]): string {
  const files = attachments.length === 0
    ? ''
    : `\n\nLook at these files before answering; they are part of the request:\n${attachments.join('\n')}`
  return `${generationPrompt(inputs, guide)}${files}\n\nAnswer with the JSON value only, no prose, no code fence.`
}

/**
 * agentChildEnv is the environment the agent child receives: the parent's, minus the markers a running
 * session sets, so the child does not refuse to start as a nested session. The markers are set to
 * undefined rather than deleted: the spawn merges this record over the parent's environment, so a
 * deleted key would come straight back while an undefined one is dropped.
 */
export function agentChildEnv(base: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...base, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined }
}

const KILL_GRACE_MS = 2_000

/** sharedAgentCliRunner runs the agent through the shared process wrapper with a hard timeout. */
export async function sharedAgentCliRunner(command: string, spec: AgentCliRunSpec): Promise<AgentCliRunResult> {
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const started = CLI.start(command, {
    args: [...spec.args],
    cwd: spec.cwd,
    env: spec.env,
    stdin: spec.stdin,
    stdio: 'pipe',
    onOutput: (stream, chunk) => (stream === 'stdout' ? stdout : stderr).push(chunk),
  })
  let timedOut = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
    timedOut = true
    started.kill('SIGTERM')
    killTimer = setTimeout(() => started.kill('SIGKILL'), KILL_GRACE_MS)
  }, spec.timeoutMs)
  try {
    const closed = await started.waitForClose()
    await started.closeOutput()
    return {
      exitCode: closed.exitCode,
      stderr: Buffer.concat(stderr).toString('utf8'),
      stdout: Buffer.concat(stdout).toString('utf8'),
      timedOut,
    }
  } finally {
    clearTimeout(timer)
    if (killTimer !== undefined) {
      clearTimeout(killTimer)
    }
  }
}

function isObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimmedOr(text: string, fallback: string): string {
  return text.trim().length > 0 ? text.trim() : fallback
}

function failure(code: GenerationFailure['code'], message: string, issues?: readonly string[]): GenerationFailure {
  return issues === undefined ? { status: 'failure', code, message } : { status: 'failure', code, message, issues }
}
