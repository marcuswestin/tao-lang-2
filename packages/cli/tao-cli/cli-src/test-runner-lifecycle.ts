import type { CLI } from '@shared'

/** Bind the final Jest verdict to a drain deadline, independent of later output or diagnostic mode. */
export function testRunnerCompletion(graceMs = 3_000): NonNullable<CLI.CommandSpec['completion']> {
  const pending = { stdout: '', stderr: '' }
  let resources = 'unavailable'
  return {
    graceMs,
    read(stream, chunk) {
      pending[stream] += chunk.toString('utf8')
      const lines = pending[stream].split('\n')
      pending[stream] = lines.pop() ?? ''
      for (const line of lines) {
        const completed = /^Tao test runner completed \(exit (\d+)\); resource kinds: (.*)$/.exec(line)
        if (completed !== null) {
          resources = completed[2] || 'none reported'
          return Number(completed[1])
        }
      }
      return undefined
    },
    diagnostic: () =>
      `Jest did not terminate within ${graceMs}ms after reporting its verdict. `
      + `Last observed resource kinds: ${resources}. Stopping the owned test process tree.`,
  }
}
