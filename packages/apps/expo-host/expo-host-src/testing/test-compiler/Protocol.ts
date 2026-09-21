import { Errors, Text } from '@shared'
import type * as TestCompiler from './TestCompiler'

const WORKER_MESSAGE_LIMIT = 800

/** Protocol serializes JSONL messages for the Tao test compiler worker. */
export const Protocol = {
  lines,
  errorFromFailure,
  failureFromError,
  parseRequest,
  parseResponse,
  pendingLine,
  requestLine,
  responseLine,
} as const

function failureFromError(error: unknown): TestCompiler.Worker.WorkerFailure {
  if (!Errors.isTaoError(error)) {
    return { category: 'unexpected', message: 'Something went wrong while compiling Tao tests.' }
  }
  const category = error instanceof Errors.UserInputError
    ? 'user'
    : error instanceof Errors.UnexpectedBehaviorError
    ? 'unexpected'
    : 'host'
  return { category, message: safeWorkerMessage(Errors.messageOf(error)) }
}

function errorFromFailure(failure: TestCompiler.Worker.WorkerFailure): Errors.TaoError {
  if (failure.category === 'user') {
    return new Errors.UserInputError(failure.message)
  }
  if (failure.category === 'unexpected') {
    return new Errors.UnexpectedBehaviorError(failure.message)
  }
  return new Errors.HostEnvironmentError(failure.message)
}

function safeWorkerMessage(message: string): string {
  const safe = Text.stripAnsi(message).replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/gu, ' ').trim()
  return safe.length <= WORKER_MESSAGE_LIMIT ? safe : `${safe.slice(0, WORKER_MESSAGE_LIMIT - 1)}…`
}

function requestLine(request: TestCompiler.Worker.Request): string {
  return `${JSON.stringify(request)}\n`
}

function responseLine(response: TestCompiler.Worker.Response): string {
  return `${JSON.stringify(response)}\n`
}

function parseRequest(line: string): TestCompiler.Worker.Request {
  return JSON.parse(line) as TestCompiler.Worker.Request
}

function parseResponse(line: string): TestCompiler.Worker.Response {
  return JSON.parse(line) as TestCompiler.Worker.Response
}

function lines(buffer: TestCompiler.Worker.LineBuffer, chunk: string): string[] {
  const lines = `${buffer.pending}${chunk}`.split('\n')
  buffer.pending = lines.pop() ?? ''
  return lines.filter(line => line.trim().length > 0)
}

function pendingLine(buffer: TestCompiler.Worker.LineBuffer): string | undefined {
  const line = buffer.pending
  buffer.pending = ''
  return line.trim().length > 0 ? line : undefined
}
