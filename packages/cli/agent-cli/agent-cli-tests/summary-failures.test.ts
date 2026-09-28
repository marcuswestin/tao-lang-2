import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { readSummaryFailures } from '../agent-cli-src/runner/SummaryFailures'

async function writeLaneSummary(root: string, laneDirectory: string, failures: unknown[]): Promise<string> {
  const path = FS.resolvePath(`.artifacts/logs/${laneDirectory}/latest/summary.json`, root)
  await FS.writeJson(path, { failures })
  return path
}

Describe('summary failures', () => {
  Test('ignores a recent shared lane summary when this command did not name it', async () => {
    const root = await mkTestDir('tao-summary-failures-lane-')
    try {
      await writeLaneSummary(root, 'verify-full-sandbox', [{ gate: 'verify-full-sandbox', test: 'x' }])

      const result = await readSummaryFailures({
        output: 'no Summary: line here',
        repositoryRoot: root,
      })

      Expect(result).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })

  Test('returns no evidence when the emitted summary is unreadable, even with a recent shared summary', async () => {
    const root = await mkTestDir('tao-summary-failures-unreadable-')
    try {
      await writeLaneSummary(root, 'dev-test', [{ gate: 'compiler', test: 'should never be read' }])
      await FS.writeText(FS.resolvePath('own-summary.json', root), 'incomplete JSON')

      const result = await readSummaryFailures({
        output: 'Summary: own-summary.json',
        repositoryRoot: root,
      })

      Expect(result).toBeUndefined()
    } finally {
      await FS.remove(root)
    }
  })

  Test('reads the summary named explicitly by the Summary: line', async () => {
    const root = await mkTestDir('tao-summary-failures-named-')
    try {
      const namedPath = await writeLaneSummary(root, 'anywhere', [{ gate: 'board', test: 'named' }])

      const result = await readSummaryFailures({
        output: `Summary: ${FS.relativePath(root, namedPath)}`,
        repositoryRoot: root,
      })

      Expect(result?.failures).toEqual([{ gate: 'board', test: 'named' }])
    } finally {
      await FS.remove(root)
    }
  })
})
