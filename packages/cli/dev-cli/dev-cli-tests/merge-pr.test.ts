import { CLI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { MergePrCommand, type MergePrDependencies } from '../dev-cli-src/pr/MergePrCommand'

/**
 * Every seam is a fake: a real run would merge a real pull request. The scripted `run` answers each
 * `git` and `gh` call by its arguments and records it, so a test reads as the calls the command made
 * and the order it made them in.
 */

const ROOT = '/repo'
const SHA = 'abcdef1234567890'
const MESSAGE = 'Merge the example\n\n- Explain the example\n'
const MERGE_CALL = 'api --method PUT repos/{owner}/{repo}/pulls/3/merge'

type Script = {
  branch?: string
  checksExitCode?: number
  dirty?: string
  /** GitHub merged it before this command could: before it ran, or by winning the race to merge. */
  autoMerged?: 'before' | 'race'
  draft?: boolean
  headAfter?: string
  mergeError?: string
  message?: string | undefined
  remoteBranch?: boolean
  verdict?: string | undefined
}

function fakeDependencies(script: Script = {}) {
  const calls: string[] = []
  const lines: string[] = []
  let views = 0
  let merged = script.autoMerged === 'before'
  const result = (spec: CLI.CommandSpec, stdout: string): CLI.CommandResult => ({
    args: [...(spec.args ?? [])],
    command: '',
    cwd: spec.cwd,
    exitCode: 0,
    signal: null,
    stderr: '',
    stdout,
  })
  const dependencies: MergePrDependencies = {
    exists: async () => !('message' in script) || script.message !== undefined,
    followChecks: async () => ({ exitCode: script.checksExitCode ?? 0 }),
    readText: async () => script.message ?? MESSAGE,
    run: async (command, spec = {}) => {
      const args = (spec.args ?? []).join(' ')
      calls.push(`${command} ${args}`)
      if (args === 'symbolic-ref --quiet --short HEAD') {
        return result(spec, `${script.branch ?? 'feat/example'}\n`)
      }
      if (args.startsWith('status')) {
        return result(spec, script.dirty ?? '')
      }
      if (args === 'rev-parse HEAD') {
        return result(spec, `${SHA}\n`)
      }
      if (args.startsWith('api repos/{owner}/{repo}/pulls?') || args === 'api repos/{owner}/{repo}/pulls/3') {
        views += 1
        const pr = {
          auto_merge: null,
          base: { ref: 'main' },
          draft: script.draft ?? false,
          head: { ref: script.branch ?? 'feat/example', sha: views > 1 ? script.headAfter ?? SHA : SHA },
          html_url: 'https://github.com/owner/repo/pull/3',
          merged_at: merged ? '2026-10-05T00:00:00Z' : null,
          number: 3,
          state: merged ? 'closed' : 'open',
        }
        return result(spec, JSON.stringify(args.includes('?') ? [pr] : pr))
      }
      if (args.startsWith('api repos/{owner}/{repo}/commits/')) {
        const verdict = 'verdict' in script ? script.verdict : 'success'
        return result(spec, JSON.stringify({ check_runs: verdict === undefined ? [] : [{ conclusion: verdict }] }))
      }
      if (args.startsWith('ls-remote')) {
        return result(spec, script.remoteBranch === false ? '' : `${SHA}\trefs/heads/feat/example\n`)
      }
      if (args.startsWith(MERGE_CALL)) {
        if (script.autoMerged === 'race') {
          merged = true
          return { ...result(spec, ''), command, exitCode: 1, stderr: 'gh: Pull Request is not mergeable (HTTP 405)' }
        }
        if (script.mergeError !== undefined) {
          return { ...result(spec, ''), command, exitCode: 1, stderr: script.mergeError }
        }
        merged = true
      }
      return result(spec, '')
    },
    writeLine: line => lines.push(line),
  }
  return { calls, dependencies, lines }
}

Describe('merge-pr', () => {
  Test('merges once Verify passed, then archives the head and deletes the remote branch', async () => {
    const fake = fakeDependencies()
    const outcome = await MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)
    Expect(outcome.exitCode).toBe(0)
    const merge = fake.calls.findIndex(call => call.startsWith(`gh ${MERGE_CALL}`))
    const archive = fake.calls.indexOf(`git push origin ${SHA}:refs/heads/merged/example`)
    const deletion = fake.calls.indexOf('git push origin --delete feat/example')
    Expect(fake.calls[merge]).toContain(
      `-f commit_message=- Explain the example -f commit_title=Merge the example -f merge_method=squash -f sha=${SHA}`,
    )
    Expect(merge).toBeGreaterThan(-1)
    Expect(archive).toBeGreaterThan(merge)
    Expect(deletion).toBeGreaterThan(archive)
  })

  Test('marks a draft ready before merging it, and skips a branch GitHub already deleted', async () => {
    const fake = fakeDependencies({ draft: true, remoteBranch: false })
    Expect((await MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).exitCode).toBe(0)
    const ready = fake.calls.indexOf('gh pr ready 3')
    Expect(ready).toBeGreaterThan(-1)
    Expect(fake.calls.findIndex(call => call.startsWith(`gh ${MERGE_CALL}`))).toBeGreaterThan(ready)
    Expect(fake.calls.some(call => call.includes('--delete'))).toBe(false)
    Expect(fake.lines.some(line => line.includes('already deleted feat/example'))).toBe(true)
  })

  Test('archives a pull request auto-merge already merged at this head, without merging it again', async () => {
    const fake = fakeDependencies({ autoMerged: 'before' })
    Expect((await MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).exitCode).toBe(0)
    Expect(fake.calls.some(call => call.startsWith(`gh ${MERGE_CALL}`))).toBe(false)
    Expect(fake.calls).toContain(`git push origin ${SHA}:refs/heads/merged/example`)
  })

  Test('reads a merge refused because auto-merge won the race as merged', async () => {
    const fake = fakeDependencies({ autoMerged: 'race' })
    Expect((await MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).exitCode).toBe(0)
    Expect(fake.calls).toContain(`git push origin ${SHA}:refs/heads/merged/example`)
  })

  Test('prints what gh said when the merge is refused', async () => {
    const fake = fakeDependencies({
      mergeError: 'gh: Head branch was modified. Review and try the merge again. (HTTP 409)',
    })
    await Expect(MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).rejects.toThrow()
    Expect(fake.lines).toContain(
      'FAIL  gh said: gh: Head branch was modified. Review and try the merge again. (HTTP 409)',
    )
  })

  Test('does not merge when a check failed', async () => {
    const fake = fakeDependencies({ checksExitCode: 1 })
    Expect((await MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).exitCode).toBe(1)
    Expect(fake.calls.some(call => call.startsWith(`gh ${MERGE_CALL}`))).toBe(false)
  })

  Test('does not merge without a successful Verify verdict on the head', async () => {
    const fake = fakeDependencies({ verdict: undefined })
    Expect((await MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).exitCode).toBe(1)
    Expect(fake.calls.some(call => call.startsWith(`gh ${MERGE_CALL}`))).toBe(false)
  })

  Test('does not merge when the head moved while the checks ran', async () => {
    const fake = fakeDependencies({ headAfter: '1111111122222222' })
    Expect((await MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).exitCode).toBe(1)
    Expect(fake.calls.some(call => call.startsWith(`gh ${MERGE_CALL}`))).toBe(false)
  })

  Test("merges a cloud agent session's branch, archived under its own prefix", async () => {
    const fake = fakeDependencies({ branch: 'claude/example-x1' })
    Expect((await MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).exitCode).toBe(0)
    Expect(fake.calls).toContain(`git push origin ${SHA}:refs/heads/merged/claude/example-x1`)
  })

  Test('refuses an unreviewed draft message, a dirty tree, and a non-feature branch before any gh call', async () => {
    for (
      const script of [
        { message: `DRAFT: ${MESSAGE}` },
        { message: undefined },
        { dirty: ' M file.ts\n' },
        { branch: 'main' },
      ] satisfies Script[]
    ) {
      const fake = fakeDependencies(script)
      await Expect(MergePrCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).rejects.toThrow()
      Expect(fake.calls.some(call => call.startsWith('gh'))).toBe(false)
    }
  })
})
