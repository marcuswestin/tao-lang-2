// Semantic agent proof of concept: drives the on-device Swift helper with the snapshot as its tools.
// Throwaway orchestration; nothing here is a provider abstraction or an agent runtime.
import { CLI, FS, Repo } from '@shared'
import { type SemanticSnapshot, fieldStory, inspect, overview, resolveTarget, trace } from './SemanticSnapshot'

const HELPER_SOURCE = 'packages/studio/studio-src/agent-poc/AgentHelper.swift'
const HELPER_BINARY = '.artifacts/build/agent-poc/agent-helper'
const SWIFT_CACHE = '.artifacts/cache/swift/agent-poc'
const RUN_LOG_DIR = '.artifacts/agent-poc/runs'

type Json = Record<string, unknown>

export type AgentToolSpec = { name: string; description: string; schema: Json }
export type AgentToolCall = { name: string; arguments: Json; resultChars: number; result: string }
export type AgentJob = {
  instructions: string
  prompt: string
  tools: readonly AgentToolSpec[]
  outputSchema?: Json
  maxToolCalls?: number
  call: (name: string, args: Json) => Promise<string>
}
export type AgentRunResult = {
  status: 'ok' | 'failure'
  value?: unknown
  message?: string
  analysis?: string
  notes: string[]
  toolCalls: AgentToolCall[]
  transcript: unknown[]
  elapsedMs: number
  promptChars: number
  toolResultChars: number
  helper: string
}

export async function ensureHelper(): Promise<string> {
  const binary = Repo.resolvePath(HELPER_BINARY)
  const source = Repo.resolvePath(HELPER_SOURCE)
  const moduleCache = Repo.resolvePath(SWIFT_CACHE)
  await FS.mkdir(FS.dirname(binary))
  await FS.mkdir(moduleCache)
  const sourceTime = await FS.modifiedTimeMs(source)
  const binaryTime = (await FS.exists(binary)) ? await FS.modifiedTimeMs(binary) : -1
  if (binaryTime < sourceTime) {
    const compiled = await CLI.run('xcrun', {
      args: ['swiftc', '-parse-as-library', '-O', '-module-cache-path', moduleCache, source, '-o', binary],
    })
    if (compiled.exitCode !== 0) {
      throw new Error(`Agent helper did not compile: ${compiled.stderr.trim() || compiled.stdout.trim()}`)
    }
  }
  return binary
}

export async function runAgentJob(job: AgentJob): Promise<AgentRunResult> {
  const binary = await ensureHelper()
  const started = Date.now()
  const toolCalls: AgentToolCall[] = []
  let buffer = ''
  let done: ((result: AgentRunResult) => void) | undefined
  let stderr = ''
  let analysis: string | undefined
  const notes: string[] = []
  const finished = new Promise<AgentRunResult>(resolve => {
    done = resolve
  })
  const finish = (partial: Partial<AgentRunResult> & Pick<AgentRunResult, 'status'>) =>
    done?.({
      elapsedMs: Date.now() - started,
      helper: binary,
      promptChars: job.instructions.length + job.prompt.length,
      toolCalls,
      toolResultChars: toolCalls.reduce((sum, call) => sum + call.resultChars, 0),
      transcript: [],
      ...(analysis === undefined ? {} : { analysis }),
      notes,
      ...partial,
    })
  // stdin stays open for tool results, so the job line is written after start rather than passed as `stdin`
  // (which the shared wrapper ends immediately).
  const child = CLI.start(binary, {
    stdio: ['pipe', 'pipe', 'pipe'],
    onOutput: (stream, chunk) => {
      if (stream === 'stderr') {
        stderr += String(chunk)
        return
      }
      buffer += String(chunk)
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        void handleLine(line)
      }
    },
  })
  child.writeStdin(JSON.stringify({
    instructions: job.instructions,
    maxToolCalls: job.maxToolCalls ?? 4,
    outputSchema: job.outputSchema,
    prompt: job.prompt,
    tools: job.tools.map(tool => ({ description: tool.description, name: tool.name, schema: tool.schema })),
  }) + '\n')
  async function handleLine(line: string): Promise<void> {
    let message: Json
    try {
      message = JSON.parse(line) as Json
    } catch {
      return
    }
    if (message['type'] === 'tool_call') {
      const name = String(message['name'])
      const args = (message['arguments'] ?? {}) as Json
      let result: string
      try {
        result = await job.call(name, args)
      } catch (error) {
        result = JSON.stringify({ error: String(error) })
      }
      toolCalls.push({ arguments: args, name, result, resultChars: result.length })
      child.writeStdin(JSON.stringify({ id: message['id'], result, type: 'tool_result' }) + '\n')
    } else if (message['type'] === 'final') {
      finish({ status: 'ok', transcript: (message['transcript'] as unknown[]) ?? [], value: message['value'] })
    } else if (message['type'] === 'analysis') {
      analysis = String(message['text'])
    } else if (message['type'] === 'note') {
      notes.push(String(message['text']))
    } else if (message['type'] === 'failure') {
      finish({ message: String(message['message']), status: 'failure', transcript: (message['transcript'] as unknown[]) ?? [] })
    }
  }
  child.onceClose((code, signal) => {
    finish({ message: `Agent helper exited (${code ?? signal}): ${stderr.trim()}`, status: 'failure' })
  })
  child.onceError(error => finish({ message: String(error), status: 'failure' }))
  const result = await finished
  child.kill()
  await logRun(job, result)
  return result
}

async function logRun(job: AgentJob, result: AgentRunResult): Promise<void> {
  const dir = Repo.resolvePath(RUN_LOG_DIR)
  await FS.mkdir(dir)
  const file = FS.resolvePath(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, dir)
  await FS.writeText(file, JSON.stringify({ job: { instructions: job.instructions, prompt: job.prompt, tools: job.tools }, result }, null, 2))
}

// ---- The review journey --------------------------------------------------------------------------

export const semanticTools = (snapshot: SemanticSnapshot): { tools: AgentToolSpec[]; call: AgentJob['call'] } => ({
  call: async (name, args) => {
    const target = String(args['target'] ?? '')
    if (name === 'overview') {
      return JSON.stringify(overview(snapshot))
    }
    if (name === 'inspect') {
      return JSON.stringify(inspect(snapshot, target))
    }
    if (name === 'trace') {
      return JSON.stringify(trace(snapshot, target, String(args['relationship'] ?? '')))
    }
    return JSON.stringify({ error: `unknown tool ${name}` })
  },
  tools: [
    {
      description: 'Compact overview of the whole Tao app: entities, views, design bundles, diagnostics.',
      name: 'overview',
      schema: { properties: {}, type: 'object' },
    },
    {
      description: 'Semantic facts about one declaration by id or name (view, entity, field like Document.Final, action, design bundle, scenario).',
      name: 'inspect',
      schema: { properties: { target: { description: 'Id such as view:DocumentEditor or name such as Document.Final', type: 'string' } }, required: ['target'], type: 'object' },
    },
    {
      description: 'Follow one relationship from a declaration: reads, writes, renders, styled-by, covers, invokes.',
      name: 'trace',
      schema: {
        properties: {
          relationship: { enum: ['reads', 'writes', 'renders', 'styled-by', 'covers', 'invokes'], type: 'string' },
          target: { description: 'Declaration id or name', type: 'string' },
        },
        required: ['target', 'relationship'],
        type: 'object',
      },
    },
  ],
})

export const reviewOutputSchema: Json = {
  properties: {
    findings: {
      description: 'Up to three observations about the reviewed view.',
      items: {
        properties: {
          kind: { description: 'fact = restates tool output; inference = your deduction; suggestion = a recommendation', enum: ['fact', 'inference', 'suggestion'], type: 'string' },
          text: { description: 'One sentence', type: 'string' },
          evidence: { description: 'Ids copied verbatim from tool output (view:, bundle:, field:, action:, src: handles)', items: { type: 'string' }, type: 'array' },
        },
        required: ['kind', 'text', 'evidence'],
        type: 'object',
      },
      maxItems: 3,
      type: 'array',
    },
    change: {
      description: 'One typed design change to propose, or operation none.',
      properties: {
        operation: { enum: ['set-design-entry', 'none'], type: 'string' },
        bundle: { description: 'A design bundle name used by this view, copied from stylesUsed, e.g. body', type: 'string' },
        key: { description: 'Entry head to set', enum: ['size', 'line', 'weight', 'pad', 'gap', 'radius'], type: 'string' },
        value: { description: 'A whole number as text, e.g. 18', type: 'string' },
        rationale: { description: 'One sentence', type: 'string' },
      },
      required: ['operation', 'bundle', 'key', 'value', 'rationale'],
      type: 'object',
    },
  },
  required: ['findings', 'change'],
  type: 'object',
}

export type ReviewRequest = { viewName: string; renderId?: string; scenario?: string; focus?: string }

export async function reviewView(snapshot: SemanticSnapshot, request: ReviewRequest): Promise<AgentRunResult & { packet: Json }> {
  const view = resolveTarget(snapshot, request.viewName)
  const packet: Json = view === undefined ? { error: `Unknown view ${request.viewName}` } : inspect(snapshot, view.id, 1600)
  if (request.renderId !== undefined) {
    const render = snapshot.nodes.get(request.renderId)
    if (render !== undefined) {
      packet['selectedRender'] = { id: render.id, target: render.detail?.['target'], layout: render.detail?.['layout'], tag: render.detail?.['tag'] }
      packet['selectedRenderStyles'] = snapshot.edges.filter(e => e.from === render.id && e.rel === 'styled-by').map(e =>
        `${e.to} [${((snapshot.nodes.get(e.to)?.detail as Json)['entries'] as string[]).join(', ')}] (${e.origin})`
      )
    }
  }
  if (request.scenario !== undefined) {
    packet['activeScenario'] = request.scenario
  }
  const { call, tools } = semanticTools(snapshot)
  const result = await runAgentJob({
    call,
    instructions: [
      'You are reviewing one screen of a Tao app. Tao supplies facts about the project; you interpret them.',
      'The packet in the prompt already describes the selected view. You may call inspect or trace at most twice more, for example inspect a design bundle to see where else it is used. Never repeat a call. Then answer.',
      'Label each finding: fact when it restates tool output, inference when you deduce something, suggestion when you recommend. Every finding cites evidence ids copied verbatim from the packet or tool output.',
      'For the change, pick a bundle from stylesUsed and a numeric key it already has, or answer none.',
      request.focus === undefined ? '' : `Focus: ${request.focus}`,
    ].filter(Boolean).join(' '),
    maxToolCalls: 3,
    outputSchema: reviewOutputSchema,
    prompt: `Review this view and propose at most one design change.\n\nPacket:\n${JSON.stringify(packet)}`,
    tools,
  })
  return { ...result, packet }
}

/** askQuestion runs one benchmark question with semantic tools, or with a raw-source baseline. */
export async function askQuestion(
  snapshot: SemanticSnapshot,
  question: string,
  mode: 'semantic' | 'source',
  sourceFiles: readonly { path: string; content: string }[],
): Promise<AgentRunResult> {
  const outputSchema: Json = {
    properties: {
      answer: { description: 'The answer in at most three sentences', type: 'string' },
      facts: { description: 'Evidence ids or file:offset handles supporting the answer', items: { type: 'string' }, type: 'array' },
      confidence: { enum: ['high', 'medium', 'low'], type: 'string' },
    },
    required: ['answer', 'facts', 'confidence'],
    type: 'object',
  }
  if (mode === 'semantic') {
    const { call, tools } = semanticTools(snapshot)
    return await runAgentJob({
      call,
      instructions: 'Answer questions about a Tao app using the tools. Start with overview, then inspect or trace the declarations the question names. Cite the evidence ids the tools return. Say when the tools do not support the question.',
      outputSchema,
      prompt: question,
      tools,
    })
  }
  return await runAgentJob({
    call: async (name, args) => {
      if (name === 'list_files') {
        return JSON.stringify(sourceFiles.map(file => `${file.path} (${file.content.length} chars)`))
      }
      if (name === 'read_file') {
        const file = sourceFiles.find(candidate => candidate.path === String(args['path']))
        return file === undefined ? 'no such file' : file.content.slice(0, 6000)
      }
      if (name === 'search') {
        const needle = String(args['text'] ?? '')
        const hits: string[] = []
        for (const file of sourceFiles) {
          file.content.split('\n').forEach((line, index) => {
            if (needle.length > 0 && line.includes(needle)) {
              hits.push(`${file.path}:${index + 1}: ${line.trim()}`)
            }
          })
        }
        return hits.slice(0, 40).join('\n') || 'no matches'
      }
      return 'unknown tool'
    },
    instructions: 'Answer questions about a Tao app by listing, searching, and reading its source files. Cite file:line handles.',
    outputSchema,
    prompt: question,
    tools: [
      { description: 'List the project source files.', name: 'list_files', schema: { properties: {}, type: 'object' } },
      { description: 'Search all source files for a text fragment.', name: 'search', schema: { properties: { text: { type: 'string' } }, required: ['text'], type: 'object' } },
      { description: 'Read one source file (first 6000 characters).', name: 'read_file', schema: { properties: { path: { type: 'string' } }, required: ['path'], type: 'object' } },
    ],
  })
}

export { fieldStory }
