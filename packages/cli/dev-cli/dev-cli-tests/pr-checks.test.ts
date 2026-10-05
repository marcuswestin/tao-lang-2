import { Describe, Expect, Test } from '@shared/test'
import { PrChecksCommand, type PrChecksDependencies } from '../dev-cli-src/pr/PrChecksCommand'

/**
 * Every seam is a fake: a real run would read a real pull request's checks from GitHub. The scripted
 * `fetch` answers by path and serves the next queued body for check runs, so a poll sequence reads
 * as the list of states GitHub would report; an unexpected path answers 404 rather than inventing data.
 */

const ROOT = '/repo'
const SLUG = 'owner/repo'
const SHA = 'abcdef1234567890'
const PR = { head: { ref: 'feat/example', sha: SHA }, html_url: 'https://github.com/owner/repo/pull/3', number: 3 }

type Run = { conclusion: string | null; id: number; name: string; status: string }

function run(name: string, status: string, conclusion: string | null = null, id = 1): Run {
  return { conclusion, id, name, status }
}

function fakeDependencies(script: {
  annotations?: Record<number, unknown[]>
  checkRuns: Run[][]
  mergeableState?: string
  statuses?: { context: string; state: string }[]
}) {
  const lines: string[] = []
  const requested: string[] = []
  let polls = 0
  let clock = 0
  const respond = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { headers: { etag: `"${polls}"` }, status })
  const dependencies: PrChecksDependencies = {
    env: {},
    fetch: async url => {
      const path = url.replace('https://api.github.com', '')
      requested.push(path)
      if (path.startsWith(`/repos/${SLUG}/pulls?`)) {
        return respond([PR])
      }
      if (path === `/repos/${SLUG}/pulls/3`) {
        return respond({ ...PR, mergeable_state: script.mergeableState ?? 'clean' })
      }
      if (path.startsWith(`/repos/${SLUG}/commits/${SHA}/check-runs`)) {
        const runs = script.checkRuns[Math.min(polls, script.checkRuns.length - 1)]!
        polls += 1
        return respond({ check_runs: runs.map(each => ({ ...each, html_url: `https://ci/${each.id}` })) })
      }
      if (path === `/repos/${SLUG}/commits/${SHA}/status`) {
        return respond({ statuses: (script.statuses ?? []).map(each => ({ ...each, target_url: null })) })
      }
      const annotations = /\/check-runs\/(\d+)\/annotations$/u.exec(path)
      if (annotations !== null) {
        return respond(script.annotations?.[Number(annotations[1])] ?? [])
      }
      return respond({ message: 'Not Found' }, 404)
    },
    now: () => clock,
    run: async (command, spec = {}) => {
      const args = (spec.args ?? []).join(' ')
      const stdout = args === 'remote get-url origin'
        ? `git@github.com:${SLUG}.git\n`
        : args === 'symbolic-ref --quiet --short HEAD'
        ? 'feat/example\n'
        : args === 'rev-parse HEAD'
        ? `${SHA}\n`
        : ''
      return { args: [...(spec.args ?? [])], command, cwd: spec.cwd, exitCode: 0, signal: null, stderr: '', stdout }
    },
    sleep: async ms => {
      clock += ms
    },
    writeLine: line => lines.push(line),
  }
  return { dependencies, lines, requested }
}

Describe('pr-checks', () => {
  Test('follows checks on the expected pull request head', async () => {
    const fake = fakeDependencies({
      checkRuns: [[run('Verify', 'in_progress')], [run('Verify', 'completed', 'success')]],
    })
    const result = await PrChecksCommand.run(
      { expectedHead: 'abcdef1234567890', pr: 3, repositoryRoot: ROOT, wait: true },
      fake.dependencies,
    )

    Expect(result.exitCode).toBe(0)
    Expect(fake.requested).toEqual([
      '/repos/owner/repo/pulls/3',
      '/repos/owner/repo/commits/abcdef1234567890/check-runs?per_page=100',
      '/repos/owner/repo/commits/abcdef1234567890/status',
      '/repos/owner/repo/commits/abcdef1234567890/check-runs?per_page=100',
      '/repos/owner/repo/commits/abcdef1234567890/status',
    ])
    Expect(fake.lines.at(-1)).toBe('PASS  All 1 check(s) succeeded.')
  })

  Test('refuses a changed pull request head before reading or following checks', async () => {
    const fake = fakeDependencies({ checkRuns: [[run('Verify', 'completed', 'success')]] })
    const result = await PrChecksCommand.run(
      { expectedHead: 'abcdef1234567891', pr: 3, repositoryRoot: ROOT, wait: true },
      fake.dependencies,
    )

    Expect(result.exitCode).toBe(1)
    Expect(fake.requested).toEqual(['/repos/owner/repo/pulls/3'])
    Expect(fake.lines).toEqual([
      'FAIL  Pull request #3 changed head: expected abcdef1234567891, actual abcdef1234567890;'
      + ' refusing to follow checks for a different commit.',
    ])
  })

  Test('follows running checks to a pass, announcing each as it concludes', async () => {
    const fake = fakeDependencies({
      checkRuns: [
        [run('Partition 1/2', 'in_progress', null, 1), run('Partition 2/2', 'queued', null, 2)],
        [run('Partition 1/2', 'completed', 'success', 1), run('Partition 2/2', 'in_progress', null, 2)],
        [run('Partition 1/2', 'completed', 'success', 1), run('Partition 2/2', 'completed', 'success', 2)],
      ],
      statuses: [{ context: 'Contributor agreement', state: 'success' }],
    })
    const result = await PrChecksCommand.run({ repositoryRoot: ROOT, wait: true }, fake.dependencies)
    Expect(result.exitCode).toBe(0)
    Expect(fake.lines.filter(line => line.startsWith('PASS  Partition'))).toEqual([
      'PASS  Partition 1/2',
      'PASS  Partition 2/2',
    ])
    Expect(fake.lines.at(-1)).toBe('PASS  All 3 check(s) succeeded.')
  })

  Test('reports a failure with its informative annotations only', async () => {
    const fake = fakeDependencies({
      annotations: {
        2: [
          { annotation_level: 'failure', message: 'formats a list: expected 1 to be 2', title: 'Partition 2: unit' },
          { annotation_level: 'failure', message: 'Process completed with exit code 1.' },
          { annotation_level: 'warning', message: 'Node.js 20 is deprecated' },
        ],
      },
      checkRuns: [[run('Partition 1/2', 'completed', 'success', 1), run('Partition 2/2', 'completed', 'failure', 2)]],
    })
    const result = await PrChecksCommand.run({ repositoryRoot: ROOT }, fake.dependencies)
    Expect(result.exitCode).toBe(1)
    Expect(fake.lines).toContain('FAIL  Partition 2/2: https://ci/2')
    Expect(fake.lines).toContain('      Partition 2: unit: formats a list: expected 1 to be 2')
    Expect(fake.lines.some(line => line.includes('exit code'))).toBe(false)
  })

  Test('without --wait, reports running checks once and exits 2', async () => {
    const fake = fakeDependencies({ checkRuns: [[run('Partition 1/1', 'in_progress')]] })
    const result = await PrChecksCommand.run({ repositoryRoot: ROOT }, fake.dependencies)
    Expect(result.exitCode).toBe(2)
    Expect(fake.lines.at(-1)).toBe('WAIT  1 check(s) still running: Partition 1/1')
  })

  Test('names a merge conflict as the reason no checks ran', async () => {
    const fake = fakeDependencies({ checkRuns: [[]], mergeableState: 'dirty' })
    const result = await PrChecksCommand.run({ repositoryRoot: ROOT, wait: true }, fake.dependencies)
    Expect(result.exitCode).toBe(1)
    Expect(fake.lines.at(-1)).toContain('conflicts with its base')
  })

  Test('gives up when no checks appear within the window', async () => {
    const fake = fakeDependencies({ checkRuns: [[]] })
    const result = await PrChecksCommand.run(
      { intervalMs: 60_000, repositoryRoot: ROOT, wait: true },
      fake.dependencies,
    )
    Expect(result.exitCode).toBe(1)
    Expect(fake.lines.filter(line => line.startsWith('WAIT'))).toHaveLength(3)
    Expect(fake.lines.at(-1)).toContain('No checks on abcdef12')
  })

  Test('reads a named pull request directly', async () => {
    const fake = fakeDependencies({ checkRuns: [[run('Verify', 'completed', 'success')]] })
    const result = await PrChecksCommand.run({ pr: 3, repositoryRoot: ROOT }, fake.dependencies)
    Expect(result.exitCode).toBe(0)
    Expect(fake.requested).toEqual([
      '/repos/owner/repo/pulls/3',
      '/repos/owner/repo/commits/abcdef1234567890/check-runs?per_page=100',
      '/repos/owner/repo/commits/abcdef1234567890/status',
    ])
  })
})
