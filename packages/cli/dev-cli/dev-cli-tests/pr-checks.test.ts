import { type CLI, Errors } from '@shared'
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
type WorkflowRun = { conclusion: string | null; head_sha: string; html_url: string; status: string }

function run(name: string, status: string, conclusion: string | null = null, id = 1): Run {
  return { conclusion, id, name, status }
}

function fakeDependencies(script: {
  annotations?: Record<number, unknown[]>
  auth?: Partial<CLI.CommandResult>
  checkRuns: Run[][]
  env?: Readonly<Record<string, string | undefined>>
  mergeableState?: string
  statuses?: { context: string; state: string }[]
  workflowRuns?: WorkflowRun[][]
}) {
  const lines: string[] = []
  const requested: string[] = []
  const requestHeaders: Record<string, string>[] = []
  const commandCalls: { command: string; spec: CLI.CommandSpec }[] = []
  let polls = 0
  let workflowPolls = 0
  let clock = 0
  const respond = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { headers: { etag: `"${polls}"` }, status })
  const dependencies: PrChecksDependencies = {
    env: script.env ?? {},
    fetch: async (url, init) => {
      const path = url.replace('https://api.github.com', '')
      requested.push(path)
      requestHeaders.push(init.headers)
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
      if (path.startsWith(`/repos/${SLUG}/actions/workflows/verify.yml/runs`)) {
        const runs = script.workflowRuns?.[Math.min(workflowPolls, (script.workflowRuns?.length ?? 1) - 1)] ?? []
        workflowPolls += 1
        return respond({ workflow_runs: runs })
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
      commandCalls.push({ command, spec })
      const args = (spec.args ?? []).join(' ')
      const stdout = args === 'remote get-url origin'
        ? `git@github.com:${SLUG}.git\n`
        : args === 'symbolic-ref --quiet --short HEAD'
        ? 'feat/example\n'
        : args === 'rev-parse HEAD'
        ? `${SHA}\n`
        : ''
      return {
        args: [...(spec.args ?? [])],
        command,
        cwd: spec.cwd,
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout,
        ...(command === 'gh' && args === 'auth token' ? script.auth : {}),
      }
    },
    sleep: async ms => {
      clock += ms
    },
    writeLine: line => lines.push(line),
  }
  return {
    commandCalls,
    dependencies,
    elapsedMs: () => clock,
    lines,
    pollCount: () => polls,
    requested,
    requestHeaders,
  }
}

Describe('pr-checks', () => {
  Test('reuses the existing CLI login once across authenticated check polling', async () => {
    const env = Object.freeze({})
    const fake = fakeDependencies({
      auth: { stdout: 'fixture-login-token\n' },
      checkRuns: [[run('Verify', 'in_progress')], [run('Verify', 'completed', 'success')]],
      env,
    })

    const result = await PrChecksCommand.run(
      { ghAuth: true, pr: 3, repositoryRoot: ROOT, wait: true },
      fake.dependencies,
    )

    Expect(result.exitCode).toBe(0)
    Expect(fake.commandCalls.filter(call => call.command === 'gh')).toEqual([
      { command: 'gh', spec: { args: ['auth', 'token'], cwd: ROOT, stdio: 'pipe' } },
    ])
    Expect(fake.requestHeaders.map(headers => headers['Authorization'])).toEqual([
      'Bearer fixture-login-token',
      'Bearer fixture-login-token',
      'Bearer fixture-login-token',
      'Bearer fixture-login-token',
      'Bearer fixture-login-token',
      'Bearer fixture-login-token',
      'Bearer fixture-login-token',
    ])
    Expect(fake.dependencies.env).toBe(env)
    Expect(env).toEqual({})
    Expect(result.lines.some(line => line.includes('fixture-login-token'))).toBe(false)
  })

  Test('prefers nonempty environment tokens without reading the CLI login', async () => {
    for (
      const env of [
        { GH_TOKEN: 'fixture-gh-token', GITHUB_TOKEN: 'fixture-github-token' },
        { GH_TOKEN: '', GITHUB_TOKEN: 'fixture-github-token' },
      ]
    ) {
      const fake = fakeDependencies({ checkRuns: [[run('Verify', 'completed', 'success')]], env })

      const result = await PrChecksCommand.run({ ghAuth: true, pr: 3, repositoryRoot: ROOT }, fake.dependencies)

      Expect(result.exitCode).toBe(0)
      Expect(fake.commandCalls.some(call => call.command === 'gh')).toBe(false)
      Expect(fake.requestHeaders.map(headers => headers['Authorization'])).toEqual(
        env.GH_TOKEN === ''
          ? [
            'Bearer fixture-github-token',
            'Bearer fixture-github-token',
            'Bearer fixture-github-token',
            'Bearer fixture-github-token',
          ]
          : [
            'Bearer fixture-gh-token',
            'Bearer fixture-gh-token',
            'Bearer fixture-gh-token',
            'Bearer fixture-gh-token',
          ],
      )
    }
  })

  Test('redacts failed or missing CLI authentication and makes no API requests', async () => {
    for (
      const auth of [
        { exitCode: 4, stderr: 'fixture-private-error', stdout: 'fixture-private-token' },
        { error: new Errors.HostEnvironmentError('fixture-private-error'), exitCode: null },
        { stdout: '' },
      ] satisfies Partial<CLI.CommandResult>[]
    ) {
      const fake = fakeDependencies({ auth, checkRuns: [[run('Verify', 'completed', 'success')]] })

      const message = await PrChecksCommand.run({ ghAuth: true, pr: 3, repositoryRoot: ROOT }, fake.dependencies)
        .then(() => 'unexpected success', error => Errors.messageOf(error))

      Expect(message).toBe('GitHub CLI authentication is unavailable. Run `gh auth login` and retry.')
      Expect(fake.requested).toEqual([])
      Expect(fake.lines).toEqual([])
    }
  })

  Test('keeps public check observation unauthenticated when CLI authentication is omitted', async () => {
    const fake = fakeDependencies({ checkRuns: [[run('Verify', 'completed', 'success')]] })

    const result = await PrChecksCommand.run({ pr: 3, repositoryRoot: ROOT }, fake.dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(fake.commandCalls.some(call => call.command === 'gh')).toBe(false)
    Expect(fake.requestHeaders.map(headers => headers['Authorization'])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  Test('redacts a credential subprocess rejection before making API requests', async () => {
    const fake = fakeDependencies({ checkRuns: [[run('Verify', 'completed', 'success')]] })
    const originalRun = fake.dependencies.run
    fake.dependencies.run = async (command, spec) =>
      command === 'gh' ? Errors.throwHostEnvironment('fixture-private-error') : originalRun(command, spec)

    const message = await PrChecksCommand.run({ ghAuth: true, pr: 3, repositoryRoot: ROOT }, fake.dependencies)
      .then(() => 'unexpected success', error => Errors.messageOf(error))

    Expect(message).toBe('GitHub CLI authentication is unavailable. Run `gh auth login` and retry.')
    Expect(fake.requested).toEqual([])
    Expect(fake.lines).toEqual([])
  })

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
      '/repos/owner/repo/actions/workflows/verify.yml/runs?head_sha=abcdef1234567890&per_page=100',
      '/repos/owner/repo/commits/abcdef1234567890/status',
      '/repos/owner/repo/commits/abcdef1234567890/check-runs?per_page=100',
      '/repos/owner/repo/actions/workflows/verify.yml/runs?head_sha=abcdef1234567890&per_page=100',
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
        [
          run('Verify', 'in_progress', null, 3),
          run('Partition 1/2', 'in_progress', null, 1),
          run('Partition 2/2', 'queued', null, 2),
        ],
        [
          run('Verify', 'in_progress', null, 3),
          run('Partition 1/2', 'completed', 'success', 1),
          run('Partition 2/2', 'in_progress', null, 2),
        ],
        [
          run('Verify', 'completed', 'success', 3),
          run('Partition 1/2', 'completed', 'success', 1),
          run('Partition 2/2', 'completed', 'success', 2),
        ],
      ],
      workflowRuns: [
        [{ conclusion: null, head_sha: SHA, html_url: 'https://ci/workflow/1', status: 'in_progress' }],
        [{ conclusion: null, head_sha: SHA, html_url: 'https://ci/workflow/1', status: 'in_progress' }],
        [{ conclusion: 'success', head_sha: SHA, html_url: 'https://ci/workflow/1', status: 'completed' }],
      ],
      statuses: [{ context: 'Contributor agreement', state: 'success' }],
    })
    const result = await PrChecksCommand.run({ repositoryRoot: ROOT, wait: true }, fake.dependencies)
    Expect(result.exitCode).toBe(0)
    Expect(fake.lines.filter(line => line.startsWith('PASS  Partition'))).toEqual([
      'PASS  Partition 1/2',
      'PASS  Partition 2/2',
    ])
    Expect(fake.lines.at(-1)).toBe('PASS  All 4 check(s) succeeded.')
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
      checkRuns: [[
        run('Verify', 'completed', 'success', 3),
        run('Partition 1/2', 'completed', 'success', 1),
        run('Partition 2/2', 'completed', 'failure', 2),
      ]],
    })
    const result = await PrChecksCommand.run({ repositoryRoot: ROOT }, fake.dependencies)
    Expect(result.exitCode).toBe(1)
    Expect(fake.lines).toContain('FAIL  Partition 2/2: https://ci/2')
    Expect(fake.lines).toContain('      Partition 2: unit: formats a list: expected 1 to be 2')
    Expect(fake.lines.some(line => line.includes('exit code'))).toBe(false)
  })

  Test('without --wait, reports running checks once and exits 2', async () => {
    const fake = fakeDependencies({ checkRuns: [[run('Verify', 'in_progress'), run('Partition 1/1', 'in_progress')]] })
    const result = await PrChecksCommand.run({ repositoryRoot: ROOT }, fake.dependencies)
    Expect(result.exitCode).toBe(2)
    Expect(fake.lines.at(-1)).toBe('WAIT  Verify has not completed successfully on this head yet.')
  })

  Test('does not treat a green contributor agreement as Verify while its workflow has no jobs', async () => {
    const fake = fakeDependencies({
      checkRuns: [[]],
      statuses: [{ context: 'Contributor agreement', state: 'success' }],
      workflowRuns: [[{ conclusion: null, head_sha: SHA, html_url: 'https://ci/workflow/queued', status: 'queued' }]],
    })

    const result = await PrChecksCommand.run({ pr: 3, repositoryRoot: ROOT }, fake.dependencies)

    Expect(result.exitCode).toBe(2)
    Expect(result.lines).toContain('PASS  Contributor agreement')
    Expect(result.lines).toContain('WAIT  Verify workflow is queued: https://ci/workflow/queued')
  })

  Test('waits past the no-check window while the current-head Verify workflow is queued', async () => {
    const queued = { conclusion: null, head_sha: SHA, html_url: 'https://ci/workflow/queued', status: 'queued' }
    const running = { conclusion: null, head_sha: SHA, html_url: 'https://ci/workflow/running', status: 'in_progress' }
    const fake = fakeDependencies({
      checkRuns: [[], [], [], [], [run('Verify', 'in_progress')], [run('Verify', 'completed', 'success')]],
      statuses: [{ context: 'Contributor agreement', state: 'success' }],
      workflowRuns: [queued, queued, queued, queued, running, {
        conclusion: 'success',
        head_sha: SHA,
        html_url: 'https://ci/workflow/done',
        status: 'completed',
      }].map(each => [each]),
    })

    const result = await PrChecksCommand.run(
      { intervalMs: 60_000, pr: 3, repositoryRoot: ROOT, wait: true },
      fake.dependencies,
    )

    Expect(result.exitCode).toBe(0)
    Expect(fake.pollCount()).toBe(6)
    Expect(fake.elapsedMs()).toBeGreaterThan(180_000)
    Expect(fake.lines.some(line => line.includes('No checks on'))).toBe(false)
    Expect(fake.lines.at(-1)).toBe('PASS  All 2 check(s) succeeded.')
  })

  Test('keeps a missing Verify verdict pending for a one-shot probe and rejects a status named Verify', async () => {
    const fake = fakeDependencies({
      checkRuns: [[]],
      statuses: [{ context: 'Verify', state: 'success' }],
    })

    const result = await PrChecksCommand.run({ pr: 3, repositoryRoot: ROOT }, fake.dependencies)

    Expect(result.exitCode).toBe(2)
    Expect(result.lines.at(-1)).toBe('WAIT  Verify has not completed successfully on this head yet.')
  })

  Test('requires the Verify check run conclusion to be literal success', async () => {
    for (const conclusion of ['skipped', 'neutral', 'cancelled']) {
      const fake = fakeDependencies({ checkRuns: [[run('Verify', 'completed', conclusion)]] })
      const result = await PrChecksCommand.run({ pr: 3, repositoryRoot: ROOT }, fake.dependencies)
      Expect(result.exitCode).toBe(1)
      Expect(result.lines).toContain('FAIL  Verify: https://ci/1')
    }
  })

  Test('drains pending checks before reporting a failed Verify annotation', async () => {
    const fake = fakeDependencies({
      annotations: { 3: [{ annotation_level: 'failure', message: 'the aggregate gate failed', title: 'Verify' }] },
      checkRuns: [
        [run('Verify', 'completed', 'failure', 3), run('Partition 1/2', 'in_progress', null, 1)],
        [run('Verify', 'completed', 'failure', 3), run('Partition 1/2', 'completed', 'success', 1)],
      ],
      workflowRuns: [
        [{ conclusion: null, head_sha: SHA, html_url: 'https://ci/workflow/1', status: 'in_progress' }],
        [{ conclusion: 'failure', head_sha: SHA, html_url: 'https://ci/workflow/1', status: 'completed' }],
      ],
    })

    const result = await PrChecksCommand.run(
      { intervalMs: 1, pr: 3, repositoryRoot: ROOT, wait: true },
      fake.dependencies,
    )

    Expect(result.exitCode).toBe(1)
    Expect(fake.pollCount()).toBe(2)
    Expect(result.lines).toContain('      Verify: the aggregate gate failed')
  })

  Test('a one-shot probe reports observed Verify failures even while another check is pending', async () => {
    const fake = fakeDependencies({
      annotations: { 3: [{ annotation_level: 'failure', message: 'the aggregate gate failed', title: 'Verify' }] },
      checkRuns: [[run('Verify', 'completed', 'failure', 3), run('Partition 1/2', 'in_progress', null, 1)]],
      workflowRuns: [[{ conclusion: null, head_sha: SHA, html_url: 'https://ci/workflow/1', status: 'in_progress' }]],
    })

    const result = await PrChecksCommand.run({ pr: 3, repositoryRoot: ROOT }, fake.dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(result.lines).toContain('      Verify: the aggregate gate failed')
    Expect(result.lines.some(line => line.startsWith('WAIT'))).toBe(false)
  })

  Test('reports a completed failed workflow that never published the Verify check', async () => {
    const fake = fakeDependencies({
      checkRuns: [[]],
      workflowRuns: [[{
        conclusion: 'cancelled',
        head_sha: SHA,
        html_url: 'https://ci/workflow/cancelled',
        status: 'completed',
      }]],
    })

    const result = await PrChecksCommand.run({ pr: 3, repositoryRoot: ROOT }, fake.dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(result.lines.at(-1)).toBe(
      'FAIL  Verify workflow completed without a Verify check: https://ci/workflow/cancelled',
    )
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
      '/repos/owner/repo/actions/workflows/verify.yml/runs?head_sha=abcdef1234567890&per_page=100',
      '/repos/owner/repo/commits/abcdef1234567890/status',
    ])
  })
})
