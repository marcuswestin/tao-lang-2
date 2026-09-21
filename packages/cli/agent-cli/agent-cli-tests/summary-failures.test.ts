import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { readSummaryFailures } from '../agent-cli-src/runner/SummaryFailures'

async function writeLaneSummary(root: string, laneDirectory: string, failures: unknown[]): Promise<string> {
  const path = FS.resolvePath(`.artifacts/logs/${laneDirectory}/latest/summary.json`, root)
  await FS.writeJson(path, { failures })
  return path
}

Describe('summary failures', () => {
  Test("reads a real lane's summary from its own directory, keyed by the ./agent command", async () => {
    const root = await mkTestDir('tao-summary-failures-lane-')
    try {
      await writeLaneSummary(root, 'verify-full-sandbox', [{ gate: 'verify-full-sandbox', test: 'x' }])

      const result = await readSummaryFailures({
        command: 'verify-full-sandbox',
        output: 'no Summary: line here',
        repositoryRoot: root,
        startedAt: 0,
      })

      Expect(result?.failures).toEqual([{ gate: 'verify-full-sandbox', test: 'x' }])
    } finally {
      await FS.remove(root)
    }
  })

  Test('maps every test* command to the one dev-test lane directory', async () => {
    const root = await mkTestDir('tao-summary-failures-test-')
    try {
      await writeLaneSummary(root, 'dev-test', [{ gate: 'test-file', test: 'x' }])

      for (const command of ['test', 'test-all', 'test-changed', 'test-file', 'test-host', 'test-retry']) {
        const result = await readSummaryFailures({
          command,
          output: '',
          repositoryRoot: root,
          startedAt: 0,
        })
        Expect(result?.failures).toEqual([{ gate: 'test-file', test: 'x' }])
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('never guesses a lane directory for a command that names no real lane', async () => {
    const root = await mkTestDir('tao-summary-failures-no-guess-')
    try {
      // A directory that happens to share the command's own name, the shape the old guess trusted —
      // must never be read for a command this module cannot vouch for as a real lane.
      await writeLaneSummary(root, 'board', [{ gate: 'board', test: 'should never be read' }])

      const result = await readSummaryFailures({
        command: 'board',
        output: '',
        repositoryRoot: root,
        startedAt: 0,
      })

      Expect(result).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })

  Test('still finds a summary named explicitly by the Summary: line, guess or not', async () => {
    const root = await mkTestDir('tao-summary-failures-named-')
    try {
      const namedPath = await writeLaneSummary(root, 'anywhere', [{ gate: 'board', test: 'named' }])

      const result = await readSummaryFailures({
        command: 'board',
        output: `Summary: ${FS.relativePath(root, namedPath)}`,
        repositoryRoot: root,
        startedAt: 0,
      })

      Expect(result?.failures).toEqual([{ gate: 'board', test: 'named' }])
    } finally {
      await FS.remove(root)
    }
  })
})
