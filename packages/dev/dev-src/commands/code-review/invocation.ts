import { Switch } from '@shared'
import {
  CODEX_SERVICE_TIER,
  DEFAULT_AGY_MODEL,
  DEFAULT_AGY_TIMEOUT_SECONDS,
  DEFAULT_CURSOR_MODEL,
  DEFAULT_GEMINI_MODEL,
} from './constants'
import type { ReviewEffort, Reviewer, ReviewerInvocation } from './types'
import { isAgyGoogleModel, isRecord, parseJsonObject } from './utils'

/** buildReviewerInvocation maps a normalized reviewer spec to a concrete CLI invocation. */
export function buildReviewerInvocation(params: {
  reviewer: Reviewer
  promptText: string
  effort: ReviewEffort
  debugFile: string
  finalFile?: string
  model?: string
  timeoutSeconds?: number
}): ReviewerInvocation {
  const { reviewer, promptText, effort, model } = params
  return Switch<Reviewer, ReviewerInvocation>(reviewer, {
    claude: () => ({
      command: 'claude',
      args: [
        '-p',
        '--verbose',
        '--effort',
        mapClaudeEffort(effort),
        '--permission-mode',
        'plan',
        '--no-session-persistence',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--include-hook-events',
        '--debug-file',
        params.debugFile,
        ...(model === undefined ? [] : ['--model', model]),
        promptText,
      ],
      outputFormat: 'jsonl',
    }),
    codex: () => ({
      command: 'codex',
      args: [
        'exec',
        '-C',
        '.',
        '--sandbox',
        'read-only',
        '--ephemeral',
        ...(model === undefined ? [] : ['-m', model]),
        '-c',
        `service_tier="${CODEX_SERVICE_TIER}"`,
        '-c',
        `model_reasoning_effort=${mapCodexEffort(effort)}`,
        '--json',
        ...(params.finalFile === undefined ? [] : ['--output-last-message', params.finalFile]),
        '-',
      ],
      stdin: promptText,
      finalPath: params.finalFile,
      outputFormat: 'jsonl',
    }),
    agy: () => {
      if (model !== undefined && !isAgyGoogleModel(model)) {
        throw new Error(`Antigravity reviewer model must be a Google Gemini model, got "${model}".`)
      }
      return {
        command: 'agy',
        args: [
          '--sandbox',
          '--model',
          model ?? DEFAULT_AGY_MODEL,
          '--print-timeout',
          `${params.timeoutSeconds ?? DEFAULT_AGY_TIMEOUT_SECONDS}s`,
          '--log-file',
          params.debugFile,
          '-p',
          promptText,
        ],
        outputFormat: 'text',
      }
    },
    cursor: () => ({
      command: 'cursor',
      args: [
        'agent',
        '--print',
        '--mode=plan',
        '--sandbox',
        'enabled',
        '--trust',
        '--output-format',
        'stream-json',
        '--stream-partial-output',
        '--model',
        model ?? DEFAULT_CURSOR_MODEL,
        promptText,
      ],
      outputFormat: 'jsonl',
    }),
    gemini: () => ({
      command: 'gemini',
      args: [
        '--skip-trust',
        '--approval-mode',
        'plan',
        '--model',
        model ?? DEFAULT_GEMINI_MODEL,
        '--output-format',
        'stream-json',
        '--prompt',
        promptText,
      ],
      outputFormat: 'jsonl',
    }),
  })
}

function mapClaudeEffort(effort: ReviewEffort): string {
  return effort === 'max' ? 'high' : effort
}

function mapCodexEffort(effort: ReviewEffort): string {
  return effort === 'max' ? 'xhigh' : effort
}

/** extractClaudeResultText pulls the final review text out of Claude stream-json output. */
export function extractClaudeResultText(jsonl: string): string | undefined {
  let resultText: string | undefined
  let planText: string | undefined
  const assistantText: string[] = []
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) {
      continue
    }
    const event = parseJsonObject(trimmed)
    if (event === undefined) {
      continue
    }
    if (event['type'] === 'result' && typeof event['result'] === 'string') {
      resultText = event['result']
    } else if (event['type'] === 'assistant') {
      appendAssistantText(event['message'], assistantText)
      planText = exitPlanModeText(event['message']) ?? planText
    }
  }
  const assembled = assistantText.join('').trim()
  // In plan mode the review body is the ExitPlanMode plan; the `result` event is only the closer.
  return planText ?? resultText ?? (assembled.length > 0 ? assembled : undefined)
}

/** extractCodexResultText pulls the final review text out of Codex exec JSONL output. */
export function extractCodexResultText(jsonl: string): string | undefined {
  const texts: string[] = []
  for (const line of jsonl.split('\n')) {
    const event = parseJsonObject(line.trim())
    if (event?.['type'] !== 'item.completed') {
      continue
    }
    const item = isRecord(event['item']) ? event['item'] : undefined
    if (item?.['type'] === 'agent_message' && typeof item['text'] === 'string') {
      texts.push(item['text'])
    }
  }
  const assembled = texts.join('').trim()
  return assembled.length > 0 ? assembled : undefined
}

/** extractCursorResultText pulls the final review text out of Cursor stream-json output. */
export function extractCursorResultText(jsonl: string): string | undefined {
  // In plan mode Cursor delivers the review as a createPlan tool call; `result` is only the preamble.
  return extractCursorPlanText(jsonl) ?? extractGenericJsonlText(jsonl)
}

/** extractGenericJsonlText pulls visible assistant text from stream-json style outputs. */
export function extractGenericJsonlText(jsonl: string): string | undefined {
  let resultText: string | undefined
  const texts: string[] = []
  for (const line of jsonl.split('\n')) {
    const event = parseJsonObject(line.trim())
    if (event === undefined) {
      continue
    }
    if (event['type'] === 'result' && typeof event['result'] === 'string') {
      resultText = event['result']
      continue
    }
    appendVisibleJsonText(event, texts)
  }
  const assembled = texts.join('').trim()
  return resultText ?? (assembled.length > 0 ? assembled : undefined)
}

/** extractReviewerResultText extracts review text from a provider's captured output. */
export function extractReviewerResultText(reviewer: Reviewer, stdout: string, finalText?: string): string | undefined {
  if (finalText !== undefined && finalText.trim().length > 0) {
    return finalText.trim()
  }
  return Switch<Reviewer, string | undefined>(reviewer, {
    agy: () => stdout.trim().length > 0 ? stdout : undefined,
    claude: () => extractClaudeResultText(stdout),
    codex: () => extractCodexResultText(stdout),
    cursor: () => extractCursorResultText(stdout),
    gemini: () => extractGenericJsonlText(stdout),
  })
}

function exitPlanModeText(message: unknown): string | undefined {
  const content = isRecord(message) ? message['content'] : undefined
  if (!Array.isArray(content)) {
    return undefined
  }
  for (const part of content) {
    if (!isRecord(part) || part['type'] !== 'tool_use' || typeof part['name'] !== 'string') {
      continue
    }
    if (!/exit.?plan.?mode/i.test(part['name'])) {
      continue
    }
    const input = isRecord(part['input']) ? part['input'] : undefined
    const plan = input?.['plan']
    if (typeof plan === 'string' && plan.trim().length > 0) {
      return plan.trim()
    }
  }
  return undefined
}

function extractCursorPlanText(jsonl: string): string | undefined {
  let planText: string | undefined
  for (const line of jsonl.split('\n')) {
    const event = parseJsonObject(line.trim())
    if (event === undefined) {
      continue
    }
    planText = planFromToolContainer(event['tool_call']) ?? planFromToolContainer(event['query']) ?? planText
  }
  return planText
}

function planFromToolContainer(container: unknown): string | undefined {
  if (!isRecord(container)) {
    return undefined
  }
  for (const value of Object.values(container)) {
    const args = isRecord(value) ? value['args'] : undefined
    const plan = isRecord(args) ? args['plan'] : undefined
    if (typeof plan === 'string' && plan.trim().length > 0) {
      return plan.trim()
    }
  }
  return undefined
}

function appendAssistantText(message: unknown, into: string[]): void {
  const content = isRecord(message) ? message['content'] : undefined
  if (!Array.isArray(content)) {
    return
  }
  for (const part of content) {
    if (isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string') {
      into.push(part['text'])
    }
  }
}

function appendVisibleJsonText(event: Record<string, unknown>, into: string[]): void {
  const eventType = event['type']
  if (eventType === 'assistant') {
    appendAssistantText(event['message'], into)
  }
  if (eventType === 'item.completed') {
    const item = isRecord(event['item']) ? event['item'] : undefined
    if (item?.['type'] === 'agent_message' && typeof item['text'] === 'string') {
      into.push(item['text'])
    }
  }
  const delta = isRecord(event['delta']) ? event['delta'] : undefined
  if (typeof delta?.['text'] === 'string') {
    into.push(delta['text'])
  }
  if ((eventType === 'content' || eventType === 'message') && typeof event['text'] === 'string') {
    into.push(event['text'])
  }
  if (eventType === 'message' && event['role'] === 'assistant' && typeof event['content'] === 'string') {
    into.push(event['content'])
  }
  if (eventType === 'content' && typeof event['value'] === 'string') {
    into.push(event['value'])
  }
}
