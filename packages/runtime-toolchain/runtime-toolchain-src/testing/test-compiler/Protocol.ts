import type * as TestCompiler from './TestCompiler'

/** Protocol serializes JSONL messages for the Tao test compiler worker. */
export const Protocol = {
  lines,
  parseRequest,
  parseResponse,
  pendingLine,
  requestLine,
  responseLine,
} as const

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
