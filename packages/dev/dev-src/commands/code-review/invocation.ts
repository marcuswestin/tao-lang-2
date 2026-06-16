import {
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
  model?: string
  timeoutSeconds?: number
}): ReviewerInvocation {
  const { reviewer, promptText, effort, model } = params
  switch (reviewer) {
    case 'claude':
      return {
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
      }
    case 'codex':
      return {
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
          `model_reasoning_effort=${mapCodexEffort(effort)}`,
          '-',
        ],
        stdin: promptText,
        outputFormat: 'text',
      }
    case 'agy':
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
          '-p',
          promptText,
        ],
        outputFormat: 'text',
      }
    case 'cursor':
      return {
        command: 'cursor',
        args: [
          'agent',
          '--print',
          '--mode=plan',
          '--sandbox',
          'enabled',
          '--trust',
          '--output-format',
          'text',
          '--model',
          model ?? DEFAULT_CURSOR_MODEL,
          promptText,
        ],
        outputFormat: 'text',
      }
    case 'gemini':
      return {
        command: 'gemini',
        args: [
          '--skip-trust',
          '--approval-mode',
          'plan',
          '--model',
          model ?? DEFAULT_GEMINI_MODEL,
          '--prompt',
          promptText,
        ],
        outputFormat: 'text',
      }
  }
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
    }
  }
  const assembled = assistantText.join('').trim()
  return resultText ?? (assembled.length > 0 ? assembled : undefined)
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
