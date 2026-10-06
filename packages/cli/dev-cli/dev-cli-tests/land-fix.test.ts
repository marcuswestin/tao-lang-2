import { CLI, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { CancelVerifyCommand } from '../dev-cli-src/pr/CancelVerify'
import { LandFixCommand, type LandFixDependencies } from '../dev-cli-src/pr/LandFixCommand'

/**
 * Every seam is a fake, as in `merge-pr.test.ts`: a real run would push `main`. The scripted `run`
 * answers each `git` and `gh` call by its arguments and records it, so a test reads as the calls
 * the command made and the order it made them in.
 */

const ROOT = '/repo'
const MERGED = 'aaaa111122223333'
const FIX = 'bbbb111122223333'
const MAIN = 'cccc111122223333'
const SQUASH = 'dddd111122223333'
const TREE = 'e'.repeat(40)
const COMMIT = 'ffff111122223333'

type Script = {
  branch?: string
  conflict?: boolean
  dirty?: string
  head?: string
  mainHoldsSquash?: boolean
  merged?: boolean
  syncFails?: boolean
}

function fakeDependencies(script: Script = {}) {
  const calls: string[] = []
  const lines: string[] = []
  const written: unknown[] = []
  const head = script.head ?? FIX
  const result = (spec: CLI.CommandSpec, stdout: string, exitCode = 0): CLI.CommandResult => ({
    args: [...(spec.args ?? [])],
    command: '',
    cwd: spec.cwd,
    exitCode,
    signal: null,
    stderr: '',
    stdout,
  })
  const dependencies: LandFixDependencies = {
    now: () => new Date('2026-10-06T01:02:03.456Z'),
    run: async (command, spec = {}) => {
      const args = (spec.args ?? []).join(' ')
      calls.push(`${command} ${args}`)
      if (args === 'symbolic-ref --quiet --short HEAD') {
        return result(spec, `${script.branch ?? 'feat/example'}\n`)
      }
      if (args.startsWith('status')) {
        return result(spec, script.dirty ?? '')
      }
      if (args.startsWith('api repos/{owner}/{repo}/pulls?')) {
        const pr = {
          auto_merge: null,
          base: { ref: 'main' },
          draft: false,
          head: { ref: 'feat/example', sha: MERGED },
          html_url: 'https://github.com/owner/repo/pull/3',
          merge_commit_sha: SQUASH,
          merged_at: script.merged === false ? null : '2026-10-05T00:00:00Z',
          number: 3,
          state: 'closed',
        }
        return result(spec, JSON.stringify([pr]))
      }
      if (args === 'rev-parse HEAD') {
        return result(spec, `${head}\n`)
      }
      if (args === `merge-base --is-ancestor ${MERGED} ${head}`) {
        return result(spec, '', head === FIX ? 0 : 1)
      }
      if (args === `log --format=%s ${MERGED}..${head}`) {
        return result(spec, 'Name the receipt\nFix the canary\n')
      }
      if (args === 'rev-parse origin/main') {
        return result(spec, `${MAIN}\n`)
      }
      if (args === `merge-base --is-ancestor ${SQUASH} ${MAIN}`) {
        return result(spec, '', script.mainHoldsSquash === false ? 1 : 0)
      }
      if (args.startsWith('merge-tree')) {
        return script.conflict === true
          ? result(spec, `${TREE}\nCONFLICT (content): Merge conflict in a.ts\n`, 1)
          : result(spec, `${TREE}\n`)
      }
      if (args.startsWith('commit-tree')) {
        return result(spec, `${COMMIT}\n`)
      }
      return result(spec, '')
    },
    syncLocalMain: async () => {
      calls.push('syncLocalMain')
      if (script.syncFails === true) {
        Errors.throwHostEnvironment('fetch refused')
      }
    },
    writeJson: async (_path, content) => {
      written.push(content)
    },
    writeLine: line => lines.push(line),
  }
  return { calls, dependencies, lines, written }
}

Describe('land-fix', () => {
  Test('merges the fix into fetched origin/main, pushes main and the archive, and writes a receipt', async () => {
    const fake = fakeDependencies()
    const outcome = await LandFixCommand.run({ repositoryRoot: ROOT }, fake.dependencies)
    Expect(outcome.exitCode).toBe(0)
    const fetch = fake.calls.indexOf('git fetch origin main')
    const mergeTree = fake.calls.findIndex(call => call.startsWith('git merge-tree --write-tree'))
    const commitTree = fake.calls.findIndex(call => call.startsWith('git commit-tree'))
    const push = fake.calls.indexOf(
      `git push --force-with-lease=refs/heads/main:${MAIN} origin ${COMMIT}:refs/heads/main`,
    )
    const archive = fake.calls.indexOf(`git push origin ${FIX}:refs/heads/merged/example`)
    Expect(fetch).toBeGreaterThan(-1)
    Expect(mergeTree).toBeGreaterThan(fetch)
    Expect(fake.calls[mergeTree]).toContain(`${MAIN} ${FIX}`)
    Expect(commitTree).toBeGreaterThan(mergeTree)
    Expect(fake.calls[commitTree]).toContain(
      `${TREE} -p ${MAIN} -p ${FIX} -m Fix after #3: Fix the canary\n\n- Name the receipt\n- Fix the canary`,
    )
    Expect(push).toBeGreaterThan(commitTree)
    Expect(archive).toBeGreaterThan(push)
    Expect(fake.calls.indexOf('syncLocalMain')).toBeGreaterThan(archive)
    Expect(fake.written).toEqual([{
      at: '2026-10-06T01:02:03.456Z',
      branch: 'feat/example',
      fixCommits: ['Name the receipt', 'Fix the canary'],
      fixHead: FIX,
      mainAfter: COMMIT,
      mainBefore: MAIN,
      mergedHead: MERGED,
      pullRequest: 3,
    }])
    Expect(outcome.receiptPath).toBe('/repo/.artifacts/logs/land-fix/2026-10-06T01-02-03-456Z.json')
    Expect(fake.calls.some(call => call.startsWith('git merge ') || call.startsWith('git checkout'))).toBe(false)
  })

  Test('still lands, warning, when local main cannot be brought forward afterwards', async () => {
    const fake = fakeDependencies({ syncFails: true })
    const outcome = await LandFixCommand.run({ repositoryRoot: ROOT }, fake.dependencies)
    Expect(outcome.exitCode).toBe(0)
    Expect(fake.lines).toContain('WARN  Could not bring local main up to date (fetch refused); run sync-main.')
    Expect(fake.written).toHaveLength(1)
  })

  Test('refuses a conflict before writing anything, naming the resolution', async () => {
    const fake = fakeDependencies({ conflict: true })
    await Expect(LandFixCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).rejects.toThrow(/run land-fix again/u)
    Expect(fake.lines).toContain('FAIL  feat/example conflicts with origin/main:')
    Expect(fake.calls.some(call => call.startsWith('git commit-tree') || call.startsWith('git push'))).toBe(false)
    Expect(fake.calls).not.toContain('syncLocalMain')
    Expect(fake.written).toEqual([])
  })

  Test(
    'refuses when nothing merged, when HEAD is the merged commit, and when HEAD does not descend from it',
    async () => {
      for (const script of [{ merged: false }, { head: MERGED }, { head: '9999111122223333' }] satisfies Script[]) {
        const fake = fakeDependencies(script)
        await Expect(LandFixCommand.run({ repositoryRoot: ROOT }, fake.dependencies)).rejects.toThrow()
        Expect(fake.calls.some(call => call.startsWith('git push') || call.startsWith('git fetch'))).toBe(false)
      }
    },
  )

  Test('refuses a main that does not yet hold the merge it fixes, and a dirty tree', async () => {
    const stale = fakeDependencies({ mainHoldsSquash: false })
    await Expect(LandFixCommand.run({ repositoryRoot: ROOT }, stale.dependencies)).rejects.toThrow(
      /does not contain #3/u,
    )
    Expect(stale.calls.some(call => call.startsWith('git push'))).toBe(false)
    const dirty = fakeDependencies({ dirty: ' M a.ts\n' })
    await Expect(LandFixCommand.run({ repositoryRoot: ROOT }, dirty.dependencies)).rejects.toThrow(/uncommitted/u)
    Expect(dirty.calls.some(call => call.startsWith('gh'))).toBe(false)
  })
})

Describe('cancel-verify', () => {
  for (const allWorkflows of [false, true]) {
    Test(`cancels only live runs on the requested commit (${allWorkflows ? 'all workflows' : 'Verify'})`, async () => {
      const calls: string[] = []
      const lines: string[] = []
      const outcome = await CancelVerifyCommand.run({ repositoryRoot: ROOT, sha: FIX, allWorkflows }, {
        run: async (command, spec = {}) => {
          const args = (spec.args ?? []).join(' ')
          calls.push(`${command} ${args}`)
          const stdout =
            args.includes(allWorkflows ? 'actions/runs?head_sha=' : 'actions/workflows/verify.yml/runs?head_sha=')
              ? JSON.stringify({
                workflow_runs: [
                  { conclusion: null, head_sha: FIX, html_url: 'u/12', id: 12, status: 'queued' },
                  { conclusion: 'success', head_sha: FIX, html_url: 'u/11', id: 11, status: 'completed' },
                  { conclusion: null, head_sha: MERGED, html_url: 'u/10', id: 10, status: 'in_progress' },
                ],
              })
              : ''
          return { args: [...(spec.args ?? [])], command, cwd: spec.cwd, exitCode: 0, signal: null, stderr: '', stdout }
        },
        writeLine: line => lines.push(line),
      })
      Expect(outcome.cancelled).toBe(1)
      Expect(calls).toContain('gh api --method POST repos/{owner}/{repo}/actions/runs/12/cancel --silent')
      Expect(calls.some(call => call.includes('runs/11/cancel') || call.includes('runs/10/cancel'))).toBe(false)
      Expect(lines[0]).toStartWith(`PASS  Cancelled ${allWorkflows ? 'workflow' : 'Verify'} run 12 (queued)`)
    })
  }
})
