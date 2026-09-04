import { CLI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { TestSelection } from '../dev-src/repository-tests/TestSelection'

Describe('changed test selection', () => {
  Test('resolves an explicit ref directly and includes tracked and untracked paths', async () => {
    const calls: string[] = []
    const run: typeof CLI.run = async (command, spec) => {
      const args = [...spec?.args ?? []]
      calls.push(args.join(' '))
      const joined = args.join(' ')
      const stdout = joined === 'rev-parse --verify topic^{commit}'
        ? 'abc123\n'
        : joined === 'diff --name-only abc123'
        ? 'packages/parser/parser-src/Parser.ts\n'
        : joined === 'ls-files --others --exclude-standard'
        ? 'Apps/New.tao\n'
        : joined === 'rev-list --merges --count abc123..HEAD'
        ? '1\n'
        : joined === 'log -1 --format=%cI abc123..HEAD'
        ? '2026-09-03T12:00:00Z\n'
        : joined === 'log -1 --merges --format=%cI abc123..HEAD'
        ? '2026-09-02T12:00:00Z\n'
        : ''
      return { args, command, cwd: spec?.cwd, error: undefined, exitCode: 0, signal: null, stderr: '', stdout }
    }

    const selection = await TestSelection.changedSelection('topic', '/repo', run)

    Expect(selection.reference).toBe('abc123')
    Expect(selection.changedPaths).toEqual(['Apps/New.tao', 'packages/parser/parser-src/Parser.ts'])
    Expect(selection.hasMergeCommit).toBe(true)
    Expect(selection.newestCommitAt).toBe('2026-09-03T12:00:00Z')
    Expect(selection.newestMergeAt).toBe('2026-09-02T12:00:00Z')
    Expect(calls.some(call => call.startsWith('merge-base'))).toBe(false)
  })

  Test('Tao Apps runs only for Apps and Tao source changes', () => {
    Expect(TestSelection.selectsTaoApps(['packages/dev/x.ts'])).toBe(false)
    Expect(TestSelection.selectsTaoApps(['Apps/WordFlower/Design.tao'])).toBe(true)
    Expect(TestSelection.selectsTaoApps(['Docs/example.tao'])).toBe(true)
  })

  Test('performance checks run for their suite and language-service changes', () => {
    Expect(TestSelection.selectsPerformanceChecks(['packages/dev/dev-src/dev.ts'])).toBe(false)
    Expect(TestSelection.selectsPerformanceChecks(['packages/dev/performance-checks/a.ts'])).toBe(true)
    Expect(TestSelection.selectsPerformanceChecks(['packages/parser/parser-src/a.ts'])).toBe(true)
  })
})
