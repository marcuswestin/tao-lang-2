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
 * configured here. Named images are copied into an isolated scratch directory before the agent can
 * read them; fetched web-page text is already part of the prompt and does not grant a web tool.
 */
export class AgentCliGenerationProvider implements GenerationProvider {
  readonly #attachments: readonly string[]
  readonly #command: string
  readonly #cwd: string | undefined
  readonly #env: Record<string, string | undefined> | undefined
  readonly #kind: AgentCliKind
  readonly #run: AgentCliRunner
  readonly #timeoutMs: number

  constructor(options: AgentCliGenerationProviderOptions) {
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
      const args = this.#kind === 'codex' ? ['exec', '--help'] : ['--help']
      const result = await this.#run(this.#command, { args, env: this.#childEnv(), timeoutMs: 15_000 })
      if (result.exitCode !== 0) {
        return { status: 'unavailable', reason: `${this.#command} ${args.join(' ')} exited with ${result.exitCode}.` }
      }
      const missing = requiredCliOptions(this.#kind).filter(option =>
        !`${result.stdout}\n${result.stderr}`.includes(option)
      )
      if (missing.length > 0) {
        return {
          status: 'unavailable',
          reason: `${this.#command} does not support the required ${missing.join(', ')} option${
            missing.length === 1 ? '' : 's'
          }.`,
        }
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
    try {
      const value = this.#kind === 'claude'
        ? await this.#generateWithClaude(schema, inputs, guide)
        : await this.#generateWithCodex(schema, agentPrompt(inputs, guide, this.#attachments))
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

  async #generateWithClaude(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
  ): Promise<GenerationResult<JsonValue>> {
    const scratch = await FS.mkTmpDir('tao-create-claude-')
    try {
      const attachments = await stageAttachments(this.#attachments, scratch)
      const tools = attachments.length > 0 ? ['Read'] : ['']
      const args = [
        '-p',
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(schema),
        '--no-session-persistence',
        '--safe-mode',
        '--permission-mode',
        'dontAsk',
        '--tools',
        ...tools,
      ]
      if (attachments.length > 0) {
        args.push('--allowedTools', 'Read')
      }
      const result = await this.#run(this.#command, {
        args,
        cwd: scratch,
        env: this.#childEnv(),
        stdin: agentPrompt(inputs, guide, attachments),
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
    } finally {
      await FS.remove(scratch).catch(() => undefined)
    }
  }

  async #generateWithCodex(schema: GenerationJsonSchema, prompt: string): Promise<GenerationResult<JsonValue>> {
    const scratch = await FS.mkTmpDir('tao-create-codex-')
    try {
      const schemaPath = FS.resolvePath('schema.json', scratch)
      const outputPath = FS.resolvePath('answer.txt', scratch)
      await FS.writeText(schemaPath, JSON.stringify(schema))
      const args = [
        'exec',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--output-schema',
        schemaPath,
      ]
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

function requiredCliOptions(kind: AgentCliKind): readonly string[] {
  return kind === 'claude'
    ? ['--json-schema', '--no-session-persistence', '--safe-mode', '--permission-mode', '--tools']
    : ['--sandbox', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--output-schema', '--output-last-message']
}

async function stageAttachments(attachments: readonly string[], scratch: string): Promise<string[]> {
  const staged: string[] = []
  for (const [index, attachment] of attachments.entries()) {
    const path = FS.resolvePath(`${index + 1}-${FS.basename(attachment)}`, scratch)
    await FS.copyFile(attachment, path)
    staged.push(path)
  }
  return staged
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
