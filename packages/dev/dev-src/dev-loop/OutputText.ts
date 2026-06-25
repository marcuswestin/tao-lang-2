type PendingLineBuffer = {
  pending: string
}

const ANSI_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g

/** OutputText owns terminal-output normalization and small formatting helpers for dev-loop output. */
export const OutputText = {
  appendCompleteLines,
  flushPendingLine,
  formatElapsed,
  sanitize,
  stripAnsi,
}

function appendCompleteLines(buffer: PendingLineBuffer, output: string, onLine: (line: string) => void): void {
  const lines = `${buffer.pending}${sanitize(output)}`.split('\n')
  buffer.pending = lines.pop() ?? ''
  for (const line of lines) {
    onLine(line)
  }
}

function flushPendingLine(buffer: PendingLineBuffer, onLine: (line: string) => void): void {
  if (buffer.pending.length === 0) {
    return
  }
  onLine(buffer.pending)
  buffer.pending = ''
}

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1_000) {
    return `${elapsedMs}ms`
  }
  return `${(elapsedMs / 1_000).toFixed(1)}s`
}

function sanitize(output: string): string {
  return stripAnsi(output)
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '')
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}
