import { type CLI, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { OpenPrCommand, type OpenPrDependencies, type OpenPrRunner } from '../dev-cli-src/pr/OpenPrCommand'

/**
 * Every seam here is a fake, for the reason `board.test.ts` and `reclaim.test.ts` give theirs: a
 * real run would push a real branch, open a real pull request, and poll a real GitHub Actions run.
 * The scripted `run` below answers `git` and `gh` by their exact args and cwd; a call this test did
 * not expect returns a plain failure rather than a route that silently makes something up, so a
 * routing bug in the command under test fails loudly instead of passing on the wrong data.
 */

const ROOT = '/repo'
const BRANCH = 'feat/example'
const HEAD_SHA = 'headsha1111aaaa'
const PULLS = 'repos/{owner}/{repo}/pulls'

type RouteResult = Partial<CLI.CommandResult>

function routeKey(command: string, args: readonly string[], cwd: string | undefined): string {
  return `${command} ${args.join(' ')}::${cwd ?? ''}`
}

function fakeRun(routes: Record<string, RouteResult>, calls?: string[]): OpenPrRunner {
  return async (command, spec = {}) => {
    const key = routeKey(command, spec.args ?? [], spec.cwd)
    calls?.push(key)
    return {
      args: [...(spec.args ?? [])],
      command,
      cwd: spec.cwd,
      exitCode: key in routes ? 0 : 1,
      signal: null,
      stderr: key in routes ? '' : `unexpected command: ${key}`,
      stdout: '',
      ...routes[key],
    }
  }
}

function listKey(state: 'closed' | 'open', branch = BRANCH): string {
  return routeKey(
    'gh',
    ['api', `${PULLS}?state=${state}&head={owner}:${encodeURIComponent(branch)}&per_page=100`],
    ROOT,
  )
}

function viewKey(prNumber: number): string {
  return routeKey('gh', ['api', `${PULLS}/${prNumber}`], ROOT)
}

function checkCountKey(sha = HEAD_SHA): string {
  return routeKey('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=1`], ROOT)
}

function checkSuitesKey(sha = HEAD_SHA): string {
  return routeKey('gh', ['api', `repos/{owner}/{repo}/commits/${sha}/check-suites?per_page=1`], ROOT)
}

/** pull is GitHub's REST pull request, reduced to what open-pr reads. */
function pull(
  prNumber: number,
  overrides: { auto_merge?: unknown; head?: string; mergeable_state?: string; merged_at?: string | null } = {},
) {
  return {
    auto_merge: overrides.auto_merge ?? null,
    base: { ref: 'main' },
    draft: false,
    head: { ref: BRANCH, sha: overrides.head ?? HEAD_SHA },
    html_url: `https://github.com/tao/tao/pull/${prNumber}`,
    mergeable_state: overrides.mergeable_state ?? 'blocked',
    merged_at: overrides.merged_at ?? null,
    number: prNumber,
    state: overrides.merged_at ? 'closed' : 'open',
  }
}

/** cleanFeatureBranchRoutes is every call `open-pr` makes before it reaches the pull request, all
 * answering with a clean, pushable `feat/example` three commits ahead of `main`. */
function cleanFeatureBranchRoutes(branch = BRANCH): Record<string, RouteResult> {
  return {
    [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: `${branch}\n` },
    [routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)]: { stdout: '' },
    [routeKey('git', ['merge-base', 'main', 'HEAD'], ROOT)]: { stdout: 'basesha0000\n' },
    [routeKey('git', ['rev-list', '--count', 'basesha0000..HEAD'], ROOT)]: { stdout: '3\n' },
    [routeKey('gh', ['api', 'user', '--jq', '.login'], ROOT)]: { stdout: 'someone\n' },
    [listKey('closed', branch)]: { stdout: '[]' },
    [routeKey('git', ['rev-parse', 'HEAD'], ROOT)]: { stdout: `${HEAD_SHA}\n` },
    [inFlightKey('in_progress')]: { stdout: '{"workflow_runs":[]}' },
    [inFlightKey('queued')]: { stdout: '{"workflow_runs":[]}' },
    [routeKey('git', ['push', '--set-upstream', 'origin', branch], ROOT)]: {},
  }
}

/** NOW is the fake clock's start; `fakeDependencies`' default sleep advances it. */
const NOW = Date.parse('2026-10-06T12:00:00Z')
const PUSH_KEY = routeKey('git', ['push', '--set-upstream', 'origin', BRANCH], ROOT)
const FETCH_MAIN_KEY = routeKey('git', ['fetch', 'origin', 'main'], ROOT)
const BRANCH_DIFF_KEY = routeKey('git', ['diff', '--name-only', '--no-renames', 'origin/main...HEAD'], ROOT)

function inFlightKey(status: 'in_progress' | 'queued'): string {
  return routeKey(
    'gh',
    ['api', `repos/{owner}/{repo}/actions/workflows/verify.yml/runs?status=${status}&per_page=50`],
    ROOT,
  )
}

function prFilesKey(prNumber: number, page: number): string {
  return routeKey('gh', ['api', `${PULLS}/${prNumber}/files?per_page=100&page=${page}`], ROOT)
}

/** verifyRun is an in-flight Actions run of Verify, reduced to what admission reads. */
function verifyRun(
  id: number,
  fields: { branch: string; event: string; minutesAgo?: number; pr?: number; status?: string },
) {
  return {
    conclusion: null,
    created_at: new Date(NOW - (fields.minutesAgo ?? 0) * 60_000).toISOString(),
    event: fields.event,
    head_branch: fields.branch,
    head_sha: `sha${id}`,
    html_url: `https://github.com/tao/tao/actions/runs/${id}`,
    id,
    pull_requests: fields.pr === undefined ? [] : [{ number: fields.pr }],
    status: fields.status ?? 'in_progress',
  }
}

/** answerInFlightInTurn answers successive admission polls with `polls` (the last repeating), all as running. */
function answerInFlightInTurn(dependencies: OpenPrDependencies, polls: unknown[][]): void {
  const run = dependencies.run
  dependencies.run = (async (command, spec = {}) => {
    const result = await run(command, spec)
    if (routeKey(command, spec.args ?? [], spec.cwd) !== inFlightKey('in_progress')) {
      return result
    }
    return { ...result, stdout: JSON.stringify({ workflow_runs: polls.length > 1 ? polls.shift() : polls[0] }) }
  }) as OpenPrRunner
}

const SUBJECT = 'Add the example workflow'
const BODY = '- one detail\n- another'

function messageFile(branch = BRANCH): string {
  return `${ROOT}/.artifacts/merge/${branch}.msg`
}

function enableAutoMergeKey(prNumber: number): string {
  return routeKey(
    'gh',
    ['pr', 'merge', String(prNumber), '--auto', '--squash', '--subject', SUBJECT, '--body', BODY],
    ROOT,
  )
}

function hostAutoMergeKey(prNumber: number, method: 'DELETE' | 'PUT'): string {
  const fields = method === 'PUT'
    ? ['-f', `commit_message=${BODY}`, '-f', `commit_title=${SUBJECT}`, '-f', 'merge_method=squash']
    : []
  return routeKey('gh', ['api', '--method', method, `${PULLS}/${prNumber}/ccr/auto_merge`, ...fields, '--silent'], ROOT)
}

/** answerViewsInTurn answers successive reads of the pull request with `pulls`, the last repeating. */
function answerViewsInTurn(dependencies: OpenPrDependencies, prNumber: number, pulls: unknown[]): void {
  const run = dependencies.run
  dependencies.run = (async (command, spec = {}) => {
    const result = await run(command, spec)
    if (routeKey(command, spec.args ?? [], spec.cwd) !== viewKey(prNumber)) {
      return result
    }
    return { ...result, stdout: JSON.stringify(pulls.length > 1 ? pulls.shift() : pulls[0]) }
  }) as OpenPrRunner
}

function createKey(branch = BRANCH): string {
  return routeKey('gh', [
    'api',
    '--method',
    'POST',
    PULLS,
    '-f',
    'base=main',
    '-f',
    `body=${BODY}`,
    '-f',
    `head=${branch}`,
    '-f',
    `title=${SUBJECT}`,
  ], ROOT)
}

function editKey(prNumber: number): string {
  return routeKey(
    'gh',
    ['api', '--method', 'PATCH', `${PULLS}/${prNumber}`, '-f', `body=${BODY}`, '-f', `title=${SUBJECT}`, '--silent'],
    ROOT,
  )
}

const MERGED_AT = '2026-10-06T05:15:04Z'

/** openedPullRequestRoutes is `cleanFeatureBranchRoutes` for a branch with no open pull request,
 * which the REST create opens as `prNumber`, titled and described by the reviewed merge message,
 * with checks on its head and auto-merge off until open-pr turns it on. */
function openedPullRequestRoutes(prNumber: number, branch = BRANCH): Record<string, RouteResult> {
  return {
    ...cleanFeatureBranchRoutes(branch),
    [listKey('open', branch)]: { stdout: '[]' },
    [createKey(branch)]: { stdout: JSON.stringify(pull(prNumber)) },
    [viewKey(prNumber)]: { stdout: JSON.stringify(pull(prNumber)) },
    [checkCountKey()]: { stdout: '{"total_count":2}' },
    [verifyRunsKey()]: { stdout: '{"workflow_runs":[]}' },
    [checkSuitesKey()]: { stdout: '{"total_count":1}' },
    [enableAutoMergeKey(prNumber)]: {},
  }
}

/** mergesAfterChecks answers the pull request as merged once the checks have been followed, the way
 * GitHub does seconds after a green Verify with auto-merge on. */
function mergesAfterChecks(dependencies: OpenPrDependencies, prNumber: number): void {
  const run = dependencies.run
  let followed = false
  const follow = dependencies.followChecks
  dependencies.followChecks = async options => {
    followed = true
    return await follow(options)
  }
  dependencies.run = (async (command, spec = {}) => {
    const result = await run(command, spec)
    return followed && routeKey(command, spec.args ?? [], spec.cwd) === viewKey(prNumber)
      ? { ...result, stdout: JSON.stringify(pull(prNumber, { merged_at: MERGED_AT })) }
      : result
  }) as OpenPrRunner
}

function fakeDependencies(
  routes: Record<string, RouteResult>,
  overrides: Partial<OpenPrDependencies> = {},
  branch = BRANCH,
): { calls: string[]; dependencies: OpenPrDependencies; followed: number[]; sleeps: number[] } {
  const calls: string[] = []
  const followed: number[] = []
  const sleeps: number[] = []
  let clock = NOW
  const dependencies: OpenPrDependencies = {
    exists: async path => path === messageFile(branch),
    followChecks: async options => {
      calls.push('followChecks')
      followed.push(options.pr ?? 0)
      return { exitCode: 0 }
    },
    now: () => clock,
    readText: async path =>
      path === messageFile(branch) ? `${SUBJECT}\n\n${BODY}\n` : Errors.throwUnexpected(`unexpected read: ${path}`),
    refreshNativeBindings: async () => {
      calls.push('refreshNativeBindings')
      return { exitCode: 0 }
    },
    run: fakeRun(routes, calls),
    runComplement: async () => {
      calls.push('runComplement')
      return { exitCode: 0 }
    },
    sleep: async ms => {
      sleeps.push(ms)
      clock += ms
    },
    syncLocalMain: async () => {
      calls.push('syncLocalMain')
    },
    writeLine: () => {},
    ...overrides,
  }
  return { calls, dependencies, followed, sleeps }
}

function verifyRunsKey(sha = HEAD_SHA): string {
  return routeKey('gh', [
    'api',
    `repos/{owner}/{repo}/actions/workflows/verify.yml/runs?head_sha=${sha}&per_page=100`,
  ], ROOT)
}

Describe('open-pr', () => {
  Test('opens and follows CI with auto-merge off by default', async () => {
    const routes = openedPullRequestRoutes(2)
    delete routes[enableAutoMergeKey(2)]
    const { calls, dependencies, followed } = fakeDependencies(routes)
    let expectedHead: string | undefined
    let ghAuth: boolean | undefined
    const follow = dependencies.followChecks
    dependencies.followChecks = async options => {
      expectedHead = options.expectedHead
      ghAuth = options.ghAuth
      return await follow(options)
    }

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls).toContain(routeKey('git', ['push', '--set-upstream', 'origin', BRANCH], ROOT))
    Expect(calls).toContain(createKey())
    Expect(calls.lastIndexOf(viewKey(2))).toBeGreaterThan(calls.lastIndexOf(checkCountKey()))
    Expect(calls.indexOf(viewKey(2), calls.lastIndexOf(checkCountKey()))).toBeLessThan(calls.indexOf('followChecks'))
    Expect(calls.lastIndexOf(viewKey(2))).toBeGreaterThan(calls.indexOf('followChecks'))
    Expect(calls.some(call => call.startsWith('gh pr merge') || call.includes('/ccr/auto_merge'))).toBe(false)
    Expect(followed).toEqual([2])
    Expect(expectedHead).toBe('headsha1111aaaa')
    Expect(ghAuth).toBe(true)
    Expect(result.lines).toContain('PASS  CI succeeded on headsha1 for #2; auto-merge is off.')
    Expect(result.lines.at(-1)).toBe('NEXT  After authorization, run merge-pr to confirm Verify and merge #2.')
  })

  Test('reuses an auto-merge-off pull request when autoMerge is false', async () => {
    const routes = cleanFeatureBranchRoutes()
    routes[listKey('open')] = { stdout: JSON.stringify([pull(7)]) }
    routes[editKey(7)] = {}
    routes[viewKey(7)] = { stdout: JSON.stringify(pull(7)) }
    routes[checkCountKey()] = { stdout: '{"total_count":1}' }
    const { calls, dependencies, followed } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ autoMerge: false, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls.indexOf(viewKey(7))).toBeLessThan(
      calls.indexOf(routeKey('git', ['push', '--set-upstream', 'origin', BRANCH], ROOT)),
    )
    Expect(calls).toContain(editKey(7))
    Expect(calls.some(call => call.includes('--method POST') || call.startsWith('gh pr merge'))).toBe(false)
    Expect(calls.some(call => call.includes('/ccr/auto_merge'))).toBe(false)
    Expect(followed).toEqual([7])
    Expect(result.lines).toContain('PASS  CI succeeded on headsha1 for #7; auto-merge is off.')
    Expect(result.lines.at(-1)).toContain('After authorization, run merge-pr')
  })

  Test('refuses an existing auto-merge-enabled pull request by default before pushing', async () => {
    const routes = cleanFeatureBranchRoutes()
    // Read the current setting rather than trusting the earlier list response.
    routes[listKey('open')] = { stdout: JSON.stringify([pull(7)]) }
    routes[viewKey(7)] = {
      stdout: JSON.stringify(pull(7, { auto_merge: { commit_message: BODY, commit_title: SUBJECT } })),
    }
    // Let an incorrectly ordered implementation reach its later guard so the assertions expose the push itself.
    routes[editKey(7)] = {}
    routes[checkCountKey()] = { stdout: '{"total_count":1}' }
    const { calls, dependencies, followed } = fakeDependencies(routes)

    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('Auto-merge is enabled for #7')

    Expect(calls.some(call => call.startsWith('git push'))).toBe(false)
    Expect(calls.some(call => call.startsWith('gh pr merge') || call.includes('/ccr/auto_merge'))).toBe(false)
    Expect(calls).not.toContain(editKey(7))
    Expect(followed).toEqual([])
  })

  Test('refuses unexpectedly enabled auto-merge before following CI', async () => {
    const routes = openedPullRequestRoutes(2)
    delete routes[enableAutoMergeKey(2)]
    const { calls, dependencies, followed } = fakeDependencies(routes)
    answerViewsInTurn(dependencies, 2, [
      pull(2),
      pull(2, { auto_merge: { commit_message: BODY, commit_title: SUBJECT } }),
    ])

    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('Auto-merge is enabled for #2')

    Expect(calls).toContain(checkCountKey())
    Expect(calls.some(call => call.startsWith('gh pr merge') || call.includes('/ccr/auto_merge'))).toBe(false)
    Expect(followed).toEqual([])
  })

  Test('reports a failed default CI check without a success or landing instruction', async () => {
    const routes = openedPullRequestRoutes(2)
    delete routes[enableAutoMergeKey(2)]
    const { calls, dependencies } = fakeDependencies(routes, {
      followChecks: async () => ({ exitCode: 1 }),
    })

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(calls).toContain(createKey())
    Expect(calls.some(call => call.startsWith('gh pr merge') || call.includes('/ccr/auto_merge'))).toBe(false)
    Expect(result.lines.some(line => line.includes('CI succeeded') || line.startsWith('NEXT'))).toBe(false)
  })

  Test('does not report auto-merge off if its setting changes while following CI', async () => {
    const routes = openedPullRequestRoutes(2)
    delete routes[enableAutoMergeKey(2)]
    const { calls, dependencies, followed } = fakeDependencies(routes)
    answerViewsInTurn(dependencies, 2, [
      pull(2),
      pull(2),
      pull(2, { auto_merge: { commit_message: BODY, commit_title: SUBJECT } }),
    ])

    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('Auto-merge is enabled for #2')

    Expect(followed).toEqual([2])
    Expect(calls.lastIndexOf(viewKey(2))).toBeGreaterThan(calls.indexOf('followChecks'))
    Expect(calls.some(call => call.startsWith('gh pr merge') || call.includes('/ccr/auto_merge'))).toBe(false)
  })

  Test('waits for the opened pull request’s checks before following any', async () => {
    // What the first real runs met: checks asked for straight after the push, before GitHub had
    // created the workflow run, answered "no checks reported". The run appeared seconds later.
    const routes = openedPullRequestRoutes(2)
    const counts = ['{"total_count":0}', '{"total_count":0}', '{"total_count":1}']
    const { calls, dependencies, followed } = fakeDependencies(routes)
    const sleeps: number[] = []
    dependencies.sleep = async ms => {
      sleeps.push(ms)
    }
    const run = dependencies.run
    dependencies.run = (async (command, spec = {}) => {
      if (routeKey(command, spec.args ?? [], spec.cwd) === checkCountKey()) {
        return { ...(await run(command, spec)), stdout: counts.shift()! }
      }
      return await run(command, spec)
    }) as OpenPrRunner
    mergesAfterChecks(dependencies, 2)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(counts).toEqual([])
    Expect(sleeps).toEqual([5_000, 5_000])
    Expect(followed).toEqual([2])
    Expect(result.lines).toContain(`PASS  GitHub merged #2 at ${MERGED_AT}.`)
    Expect(result.lines.at(-1)).toStartWith('NEXT  The archive workflow records merged/<name>')
    // Any check can arm auto-merge; the required Verify check remains the merge gate.
    const autoMerge = calls.indexOf(enableAutoMergeKey(2))
    Expect(autoMerge).toBeGreaterThan(calls.lastIndexOf(checkCountKey()))
    Expect(autoMerge).toBeLessThan(calls.indexOf('followChecks'))
  })

  Test('waits for GitHub’s merge after a green verdict, polling it rather than the archive workflow', async () => {
    // GitHub merged 45 s after Verify concluded on 2026-10-06's landings; the merge is the landing,
    // so the command reports it, and returns without waiting for the archive workflow that follows.
    const { dependencies } = fakeDependencies(openedPullRequestRoutes(2))
    const sleeps: number[] = []
    dependencies.sleep = async ms => {
      sleeps.push(ms)
    }
    const run = dependencies.run
    let views = 0
    dependencies.run = (async (command, spec = {}) => {
      const result = await run(command, spec)
      if (routeKey(command, spec.args ?? [], spec.cwd) !== viewKey(2)) {
        return result
      }
      views += 1
      // Opened, armed, then still unmerged at the first two reads after the verdict.
      return views >= 5
        ? { ...result, stdout: JSON.stringify(pull(2, { merged_at: MERGED_AT })) }
        : result
    }) as OpenPrRunner

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(sleeps).toEqual([5_000, 5_000])
    Expect(result.lines).toContain('Waiting for GitHub to merge #2...')
    Expect(result.lines).toContain(`PASS  GitHub merged #2 at ${MERGED_AT}.`)
    Expect(result.lines.some(line => line.includes('archive') && line.startsWith('WAIT'))).toBe(false)
  })

  Test('names merge-pr when GitHub has not merged within the window after a green verdict', async () => {
    const { dependencies } = fakeDependencies(openedPullRequestRoutes(2))
    const sleeps: number[] = []
    dependencies.sleep = async ms => {
      sleeps.push(ms)
    }

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    // 36 reads of the pull request five seconds apart span the 180 s window.
    Expect(sleeps.filter(ms => ms === 5_000)).toHaveLength(35)
    Expect(result.lines.some(line => line.startsWith('NOTE  GitHub has not merged #2 within 180s'))).toBe(true)
    Expect(result.lines.at(-1)).toStartWith('NEXT  Run merge-pr')
  })

  Test('runs the complement lane beside the checks with auto-merge, and not without it', async () => {
    const withAutoMerge = fakeDependencies(openedPullRequestRoutes(2))
    mergesAfterChecks(withAutoMerge.dependencies, 2)
    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, withAutoMerge.dependencies)
    Expect(result.exitCode).toBe(0)
    Expect(withAutoMerge.calls.indexOf('runComplement')).toBeGreaterThan(
      withAutoMerge.calls.indexOf(enableAutoMergeKey(2)),
    )
    Expect(withAutoMerge.calls.indexOf('runComplement')).toBeLessThan(withAutoMerge.calls.indexOf('followChecks'))
    Expect(result.lines).toContain('PASS  The complement lane passed on headsha1.')

    const routes = openedPullRequestRoutes(2)
    delete routes[enableAutoMergeKey(2)]
    const without = fakeDependencies(routes)
    Expect((await OpenPrCommand.run({ repositoryRoot: ROOT }, without.dependencies)).exitCode).toBe(0)
    Expect(without.calls).not.toContain('runComplement')

    const declined = fakeDependencies(openedPullRequestRoutes(2))
    mergesAfterChecks(declined.dependencies, 2)
    Expect(
      (await OpenPrCommand.run({ autoMerge: true, complement: false, repositoryRoot: ROOT }, declined.dependencies))
        .exitCode,
    ).toBe(0)
    Expect(declined.calls).not.toContain('runComplement')
  })

  Test('cancels Verify and turns auto-merge off when the complement fails before GitHub merged', async () => {
    const routes = openedPullRequestRoutes(2)
    routes[verifyRunsKey()] = {
      stdout: JSON.stringify({
        workflow_runs: [
          {
            conclusion: null,
            head_sha: HEAD_SHA,
            html_url: 'https://github.com/tao/tao/actions/runs/9',
            id: 9,
            status: 'in_progress',
          },
          {
            conclusion: 'cancelled',
            head_sha: HEAD_SHA,
            html_url: 'https://github.com/tao/tao/actions/runs/8',
            id: 8,
            status: 'completed',
          },
        ],
      }),
    }
    const cancelKey = routeKey('gh', [
      'api',
      '--method',
      'POST',
      'repos/{owner}/{repo}/actions/runs/9/cancel',
      '--silent',
    ], ROOT)
    routes[cancelKey] = {}
    const disableKey = routeKey('gh', ['pr', 'merge', '2', '--disable-auto'], ROOT)
    routes[disableKey] = {}
    const { calls, dependencies } = fakeDependencies(routes, {
      followChecks: async () => ({ exitCode: 1 }),
      runComplement: async () => ({ exitCode: 1 }),
    })

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(calls).toContain(cancelKey)
    Expect(calls.some(call => call.includes('actions/runs/8/cancel'))).toBe(false)
    Expect(calls).toContain(disableKey)
    Expect(result.lines).toContain('PASS  Auto-merge is off for #2; this head will not land.')
    Expect(result.lines.at(-1)).toBe(
      'NEXT  Fix the failed gate on this branch and push it with open-pr --auto-merge again.',
    )
  })

  Test('names land-fix when the complement fails after GitHub already merged', async () => {
    const routes = openedPullRequestRoutes(2)
    const { calls, dependencies } = fakeDependencies(routes, { runComplement: async () => ({ exitCode: 1 }) })
    answerViewsInTurn(dependencies, 2, [pull(2), pull(2), pull(2, { merged_at: '2026-10-05T00:00:00Z' })])

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(calls.some(call => call.includes('/cancel') || call.includes('--disable-auto'))).toBe(false)
    Expect(result.lines.at(-1)).toBe(
      'NEXT  GitHub merged #2 before the complement failed: commit the fix on this branch and run land-fix.',
    )
  })

  Test('fails, without following, when no checks ever appear on the pushed commit', async () => {
    const routes = openedPullRequestRoutes(2)
    routes[checkCountKey()] = { stdout: '{"total_count":0}' }
    const { calls, dependencies, sleeps } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    // 36 looks five seconds apart span the 180 s window: on 2026-10-06 GitHub started a run 90 s late.
    Expect(sleeps.filter(ms => ms === 5_000)).toHaveLength(35)
    Expect(result.lines.some(line => line.startsWith('FAIL  No checks appeared on headsha1 within 180s'))).toBe(true)
    // Suites on the commit mean Actions saw the push, so the remedy is to wait for its run, not to push again.
    Expect(result.lines.some(line => line.includes('Actions may be disabled'))).toBe(true)
    Expect(result.lines.some(line => line.includes('--allow-empty'))).toBe(false)
    Expect(calls.some(call => call === 'followChecks' || call.startsWith('gh pr merge'))).toBe(false)
    Expect(calls).not.toContain('runComplement')
  })

  Test(
    'names a lost push event, and the empty commit that replaces it, when the commit has no check suite',
    async () => {
      const routes = openedPullRequestRoutes(2)
      routes[checkCountKey()] = { stdout: '{"total_count":0}' }
      routes[checkSuitesKey()] = { stdout: '{"total_count":0}' }
      const { calls, dependencies } = fakeDependencies(routes)

      const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

      Expect(result.exitCode).toBe(1)
      Expect(result.lines.at(-1)).toBe(
        'FAIL  No checks appeared on headsha1 within 180s of the push, and the commit has no check suite at all:'
          + " the push event never reached Actions. Push a new head with `git commit --allow-empty -m 'Run Verify"
          + " again'` and run open-pr again.",
      )
      Expect(calls).toContain(checkSuitesKey())
      Expect(calls.some(call => call === 'followChecks' || call.startsWith('gh pr merge'))).toBe(false)
    },
  )

  Test('counts a queued Verify run with no check run yet as the checks appearing', async () => {
    // On 2026-10-06 GitHub created the run at the push but its jobs only once runners freed up.
    const routes = openedPullRequestRoutes(2)
    routes[checkCountKey()] = { stdout: '{"total_count":0}' }
    routes[verifyRunsKey()] = {
      stdout: JSON.stringify({
        workflow_runs: [{
          conclusion: null,
          head_sha: HEAD_SHA,
          html_url: 'https://github.com/tao/tao/actions/runs/9',
          id: 9,
          status: 'queued',
        }],
      }),
    }
    const { calls, dependencies, followed, sleeps } = fakeDependencies(routes)
    mergesAfterChecks(dependencies, 2)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(result.lines).toContain(
      'PASS  Verify run 9 exists for headsha1 (queued); GitHub starts its jobs as runners free up.',
    )
    Expect(sleeps).toEqual([])
    Expect(calls.indexOf(enableAutoMergeKey(2))).toBeGreaterThan(calls.indexOf(verifyRunsKey()))
    Expect(calls).toContain('runComplement')
    Expect(followed).toEqual([2])
    Expect(calls).not.toContain(checkSuitesKey())
  })

  Test('refreshes maintained native bindings before the push, only when the complement runs', async () => {
    const landing = fakeDependencies(openedPullRequestRoutes(2))
    mergesAfterChecks(landing.dependencies, 2)
    Expect((await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, landing.dependencies)).exitCode)
      .toBe(0)
    const refresh = landing.calls.indexOf('refreshNativeBindings')
    Expect(refresh).toBeGreaterThan(-1)
    Expect(refresh).toBeLessThan(landing.calls.indexOf(PUSH_KEY))
    Expect(refresh).toBeLessThan(landing.calls.indexOf('runComplement'))

    const routes = openedPullRequestRoutes(2)
    delete routes[enableAutoMergeKey(2)]
    const unattended = fakeDependencies(routes)
    Expect((await OpenPrCommand.run({ repositoryRoot: ROOT }, unattended.dependencies)).exitCode).toBe(0)
    Expect(unattended.calls).not.toContain('refreshNativeBindings')

    const declined = fakeDependencies(openedPullRequestRoutes(2))
    mergesAfterChecks(declined.dependencies, 2)
    await OpenPrCommand.run({ autoMerge: true, complement: false, repositoryRoot: ROOT }, declined.dependencies)
    Expect(declined.calls).not.toContain('refreshNativeBindings')
  })

  Test('refuses before pushing when regenerating bindings changes the worktree or fails', async () => {
    const statusKey = routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)
    const changed = fakeDependencies(openedPullRequestRoutes(2))
    const run = changed.dependencies.run
    changed.dependencies.run = (async (command, spec = {}) => {
      const result = await run(command, spec)
      return routeKey(command, spec.args ?? [], spec.cwd) === statusKey
          && changed.calls.includes('refreshNativeBindings')
        ? { ...result, stdout: ' M packages/native/bindings.ts\n' }
        : result
    }) as OpenPrRunner
    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, changed.dependencies)).rejects.toThrow(
      'Regenerating maintained native bindings changed the worktree; nothing was pushed. Review and commit these'
        + ' paths, then run open-pr again:\n M packages/native/bindings.ts',
    )
    Expect(changed.calls.some(call => call.startsWith('git push'))).toBe(false)

    const failed = fakeDependencies(openedPullRequestRoutes(2), {
      refreshNativeBindings: async () => ({ exitCode: 2 }),
    })
    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, failed.dependencies)).rejects.toThrow(
      'Regenerating maintained native bindings failed (exit 2); nothing was pushed.',
    )
    Expect(failed.calls.some(call => call.startsWith('git push'))).toBe(false)
  })

  Test('brings local main forward once GitHub has merged, and not before or without a merge', async () => {
    const merged = fakeDependencies(openedPullRequestRoutes(2))
    mergesAfterChecks(merged.dependencies, 2)
    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, merged.dependencies)
    Expect(result.exitCode).toBe(0)
    Expect(result.lines.indexOf('Bringing local main up to origin/main...')).toBeGreaterThan(
      result.lines.indexOf(`PASS  GitHub merged #2 at ${MERGED_AT}.`),
    )
    Expect(merged.calls.indexOf('syncLocalMain')).toBeGreaterThan(merged.calls.lastIndexOf(viewKey(2)))

    const unmerged = fakeDependencies(openedPullRequestRoutes(2))
    await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, unmerged.dependencies)
    Expect(unmerged.calls).not.toContain('syncLocalMain')

    const failing = fakeDependencies(openedPullRequestRoutes(2), { followChecks: async () => ({ exitCode: 1 }) })
    mergesAfterChecks(failing.dependencies, 2)
    await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, failing.dependencies)
    Expect(failing.calls).not.toContain('syncLocalMain')
  })

  Test('names a conflict with main as the reason no checks appeared', async () => {
    // The second real run: GitHub creates no pull_request workflow run for a pull request that
    // conflicts with its base, so blaming disabled Actions sent the reader the wrong way.
    const routes = openedPullRequestRoutes(2)
    routes[viewKey(2)] = { stdout: JSON.stringify(pull(2, { mergeable_state: 'dirty' })) }
    routes[checkCountKey()] = { stdout: '{"total_count":0}' }
    const { dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    // Verify runs on every push, so the push that resolves the conflict starts the checks itself.
    Expect(
      result.lines.some(line =>
        line.includes('conflicts with main') && line.includes('Merge main') && line.includes('starts the checks')
      ),
    ).toBe(true)
  })

  Test('refuses a detached HEAD', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { exitCode: 1, stdout: '' },
    })
    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)).rejects.toThrow(
      'HEAD is detached',
    )
  })

  Test('refuses a branch that is not feat/, claude/, or codex/', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: 'chore/tidy\n' },
    })
    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('not a feat/<name>, claude/<name>, codex/<name> branch')
  })

  Test('opens a pull request for the branch a cloud agent session was assigned', async () => {
    const branch = 'claude/example-x1'
    const { calls, dependencies } = fakeDependencies(openedPullRequestRoutes(5, branch), {}, branch)
    mergesAfterChecks(dependencies, 5)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls).toContain(routeKey('git', ['push', '--set-upstream', 'origin', branch], ROOT))
    Expect(calls).toContain(createKey(branch))
  })

  Test('refuses an uncommitted worktree', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: `${BRANCH}\n` },
      [routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)]: { stdout: ' M dirty.ts\n' },
    })
    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('uncommitted changes')
  })

  Test('refuses a branch with no commits beyond its main merge base', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: `${BRANCH}\n` },
      [routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)]: { stdout: '' },
      [routeKey('git', ['merge-base', 'main', 'HEAD'], ROOT)]: { stdout: 'basesha0000\n' },
      [routeKey('git', ['rev-list', '--count', 'basesha0000..HEAD'], ROOT)]: { stdout: '0\n' },
    })
    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('no commits beyond its main merge base')
  })

  Test('prints a plain remedy, not a stack trace, when gh is not installed', async () => {
    const routes = cleanFeatureBranchRoutes()
    routes[routeKey('gh', ['api', 'user', '--jq', '.login'], ROOT)] = {
      error: new Errors.HostEnvironmentError('spawn gh ENOENT'),
      exitCode: null,
    }
    const { dependencies } = fakeDependencies(routes)
    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('gh is not installed')
  })

  Test('prints a plain remedy, not a stack trace, when gh is unauthenticated', async () => {
    const routes = cleanFeatureBranchRoutes()
    routes[routeKey('gh', ['api', 'user', '--jq', '.login'], ROOT)] = { exitCode: 4, stderr: 'gh auth login' }
    const { dependencies } = fakeDependencies(routes)
    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('gh auth login')
  })

  Test('reuses an existing pull request and follows the checks its push started', async () => {
    // Verify runs on every push to an open pull request, so a reused one is watched like a new one.
    const routes = cleanFeatureBranchRoutes()
    const reused = pull(7, { auto_merge: { commit_message: BODY, commit_title: SUBJECT, merge_method: 'squash' } })
    routes[listKey('open')] = { stdout: JSON.stringify([reused]) }
    routes[editKey(7)] = {}
    routes[viewKey(7)] = { stdout: JSON.stringify(reused) }
    routes[checkCountKey()] = { stdout: '{"total_count":1}' }
    const { calls, dependencies, followed } = fakeDependencies(routes)
    mergesAfterChecks(dependencies, 7)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(result.lines.some(line => line.startsWith('PASS  Reusing #7'))).toBe(true)
    // The message may have changed since the pull request opened, and it is what the squash commit says.
    Expect(calls).toContain(editKey(7))
    Expect(calls.some(call => call.includes('--method POST') || call.startsWith('gh pr merge'))).toBe(false)
    Expect(result.lines).toContain('PASS  Auto-merge is already on for #7 with the merge message.')
    Expect(followed).toEqual([7])
    Expect(result.lines).toContain(`PASS  GitHub merged #7 at ${MERGED_AT}.`)
  })

  Test('re-enables auto-merge that carries an older merge message', async () => {
    // GitHub's own squash message appends ` (#N)` and wraps the description at 72 columns, and
    // auto-merge keeps the message it was enabled with, so a stale one is replaced, not kept.
    const routes = cleanFeatureBranchRoutes()
    const reused = pull(7, { auto_merge: { commit_message: null, commit_title: null, merge_method: 'squash' } })
    routes[listKey('open')] = { stdout: JSON.stringify([reused]) }
    routes[editKey(7)] = {}
    routes[viewKey(7)] = { stdout: JSON.stringify(reused) }
    routes[checkCountKey()] = { stdout: '{"total_count":1}' }
    routes[routeKey('gh', ['pr', 'merge', '7', '--disable-auto'], ROOT)] = {}
    routes[enableAutoMergeKey(7)] = {}
    const { calls, dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls.indexOf(routeKey('gh', ['pr', 'merge', '7', '--disable-auto'], ROOT)))
      .toBeLessThan(calls.indexOf(enableAutoMergeKey(7)))
    Expect(calls.indexOf(enableAutoMergeKey(7))).toBeGreaterThan(-1)
  })

  Test('turns stale auto-merge off through the host route where gh pr is refused', async () => {
    const routes = cleanFeatureBranchRoutes()
    const reused = pull(7, { auto_merge: { commit_message: null, commit_title: null, merge_method: 'squash' } })
    routes[listKey('open')] = { stdout: JSON.stringify([reused]) }
    routes[editKey(7)] = {}
    routes[viewKey(7)] = { stdout: JSON.stringify(reused) }
    routes[checkCountKey()] = { stdout: '{"total_count":1}' }
    routes[hostAutoMergeKey(7, 'DELETE')] = {}
    routes[enableAutoMergeKey(7)] = {}
    const { calls, dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls.indexOf(hostAutoMergeKey(7, 'DELETE'))).toBeLessThan(calls.indexOf(enableAutoMergeKey(7)))
    Expect(calls.indexOf(hostAutoMergeKey(7, 'DELETE'))).toBeGreaterThan(-1)
  })

  Test('turns auto-merge on through the host route where gh pr’s GraphQL is refused', async () => {
    // What the first cloud landing met: the proxy refuses GraphQL but serves its own REST route.
    const routes = openedPullRequestRoutes(2)
    routes[enableAutoMergeKey(2)] = { exitCode: 1, stderr: 'HTTP 403: GitHub GraphQL is not available\nmore' }
    routes[hostAutoMergeKey(2, 'PUT')] = {}
    const { calls, dependencies, followed } = fakeDependencies(routes)
    const enabled = pull(2, { auto_merge: { commit_message: BODY, commit_title: SUBJECT, merge_method: 'squash' } })
    // Two reads see auto-merge off (waiting for checks, then deciding); the read-back sees it on.
    answerViewsInTurn(dependencies, 2, [pull(2), pull(2), enabled])

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls).toContain(hostAutoMergeKey(2, 'PUT'))
    Expect(calls).not.toContain(hostAutoMergeKey(2, 'DELETE'))
    Expect(result.lines).toContain(
      'PASS  Auto-merge is on: GitHub squash-merges #2 with the merge message once Verify passes.',
    )
    Expect(followed).toEqual([2])
  })

  Test('turns host auto-merge back off when it did not keep the merge message', async () => {
    // A squash with GitHub's own message appends ` (#N)` and rewraps the bullets, so it must not land.
    const routes = openedPullRequestRoutes(2)
    routes[enableAutoMergeKey(2)] = { exitCode: 1, stderr: 'HTTP 403: GitHub GraphQL is not available' }
    routes[hostAutoMergeKey(2, 'PUT')] = {}
    routes[hostAutoMergeKey(2, 'DELETE')] = {}
    const { calls, dependencies, followed } = fakeDependencies(routes)
    const defaulted = { commit_message: '* one detail', commit_title: `${SUBJECT} (#2)`, merge_method: 'squash' }
    answerViewsInTurn(dependencies, 2, [pull(2), pull(2), pull(2, { auto_merge: defaulted })])

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls.indexOf(hostAutoMergeKey(2, 'DELETE'))).toBeGreaterThan(calls.indexOf(hostAutoMergeKey(2, 'PUT')))
    Expect(result.lines).toContain(
      'NOTE  Auto-merge stays off for #2 (the host route did not keep the merge message);'
        + ' merge-pr merges it with the merge message once Verify passes.',
    )
    Expect(followed).toEqual([2])
  })

  Test('goes on, naming merge-pr, where both gh pr and the host route refuse auto-merge', async () => {
    // Off a cloud agent host the route does not exist; GitHub answers it 404.
    const routes = openedPullRequestRoutes(2)
    routes[enableAutoMergeKey(2)] = { exitCode: 1, stderr: 'auto-merge is not allowed for this repository\nmore' }
    routes[hostAutoMergeKey(2, 'PUT')] = { exitCode: 1, stderr: 'gh: Not Found (HTTP 404)' }
    const { dependencies, followed } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(result.lines).toContain(
      'NOTE  Auto-merge stays off for #2 (gh said: auto-merge is not allowed for this repository;'
        + ' the host route said: gh: Not Found (HTTP 404)); merge-pr merges it with the merge message once Verify passes.',
    )
    Expect(followed).toEqual([2])
  })

  Test('refuses, before pushing, a branch that already merged', async () => {
    // Pushing a merged branch again opened a second, empty pull request that auto-merge also landed.
    const routes = cleanFeatureBranchRoutes()
    routes[listKey('closed')] = {
      stdout: JSON.stringify([pull(3), pull(4, { merged_at: '2026-10-01T00:00:00Z' })]),
    }
    const { calls, dependencies } = fakeDependencies(routes)

    await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)).rejects.toThrow(
      'already merged as #4',
    )
    Expect(calls.some(call => call.startsWith('git push'))).toBe(false)
  })

  Test('opens a pull request titled by the merge message and fails when a check fails', async () => {
    const { dependencies } = fakeDependencies(openedPullRequestRoutes(42), {
      followChecks: async () => ({ exitCode: 1 }),
    })

    const result = await OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(result.lines.some(line => line.includes('Opened pull request #42'))).toBe(true)
    Expect(result.lines.some(line => line.startsWith('NEXT'))).toBe(false)
  })

  Test('refuses, before pushing, without a reviewed merge message', async () => {
    for (
      const [overrides, reason] of [
        [{ exists: async () => false }, 'Write and review the merge message first'],
        [{ readText: async () => `DRAFT: ${SUBJECT}\n\n${BODY}\n` }, "remove its 'DRAFT: ' prefix"],
      ] satisfies [Partial<OpenPrDependencies>, string][]
    ) {
      const { calls, dependencies } = fakeDependencies(cleanFeatureBranchRoutes(), overrides)
      await Expect(OpenPrCommand.run({ autoMerge: true, repositoryRoot: ROOT }, dependencies)).rejects.toThrow(reason)
      Expect(calls.some(call => call.startsWith('git push'))).toBe(false)
    }
  })

  Describe('admission to the Verify runner pool', () => {
    // On 2026-10-06 four agents landing together cancelled 22 of 25 Verify runs: the pool holds two.
    const OTHER_PR = verifyRun(11, { branch: 'feat/other', event: 'pull_request', minutesAgo: 12, pr: 45 })
    const MAIN_PUSH = verifyRun(12, { branch: 'main', event: 'push', minutesAgo: 3 })
    // This branch's own earlier run, which the push replaces through Verify's concurrency group.
    const OWN = verifyRun(10, { branch: BRANCH, event: 'pull_request', minutesAgo: 20, pr: 2 })

    Test('pushes at once when no other Verify run is in flight', async () => {
      const { calls, dependencies, sleeps } = fakeDependencies(openedPullRequestRoutes(2))
      answerInFlightInTurn(dependencies, [[OWN]])

      const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

      Expect(result.exitCode).toBe(0)
      Expect(sleeps).toEqual([])
      Expect(result.lines).toContain('PASS  No other Verify run is in flight; this run gets the whole runner pool.')
      Expect(calls.indexOf(inFlightKey('queued'))).toBeLessThan(calls.indexOf(PUSH_KEY))
      Expect(calls).not.toContain(FETCH_MAIN_KEY)
    })

    Test('waits while two other runs are in flight, then pushes when one finishes', async () => {
      const { calls, dependencies, sleeps } = fakeDependencies(openedPullRequestRoutes(2))
      answerInFlightInTurn(dependencies, [[OWN, OTHER_PR, MAIN_PUSH], [OWN, OTHER_PR, MAIN_PUSH], [MAIN_PUSH]])

      const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

      Expect(result.exitCode).toBe(0)
      Expect(sleeps).toEqual([30_000, 30_000])
      // One line for the wait, not one per poll, since the set did not change.
      Expect(result.lines.filter(line => line.startsWith('WAIT'))).toEqual([
        'WAIT  2 other Verify runs are in flight and the runner pool holds 2: run 11 on feat/other'
        + ' (pull_request #45, 12m old), run 12 on main (push, 3m old); checking every 30s until fewer remain.',
      ])
      Expect(result.lines).toContain(
        'PASS  One other Verify run is in flight (run 12 on main (push, 4m old));'
          + ' this run will share the pool with run 12 at the smaller partition count.',
      )
      Expect(calls.lastIndexOf(inFlightKey('in_progress'))).toBeLessThan(calls.indexOf(PUSH_KEY))
      // A push to main changes no pull request's files, so nothing is compared.
      Expect(calls).not.toContain(FETCH_MAIN_KEY)
    })

    Test('waits for one other lander that changed the same files, naming them', async () => {
      const ours = Array.from({ length: 12 }, (_, index) => `src/a${index}.ts`)
      const routes = openedPullRequestRoutes(2)
      routes[FETCH_MAIN_KEY] = {}
      routes[BRANCH_DIFF_KEY] = { stdout: `${[...ours, 'docs/only-ours.md'].join('\n')}\n` }
      // A full first page means there is another; the second page's rename shares its old path.
      const firstPage = [
        ...ours.slice(0, 11).map(filename => ({ filename })),
        ...Array.from({ length: 89 }, (_, index) => ({ filename: `other/f${index}.ts` })),
      ]
      routes[prFilesKey(45, 1)] = { stdout: JSON.stringify(firstPage) }
      routes[prFilesKey(45, 2)] = {
        stdout: JSON.stringify([{ filename: 'src/renamed.ts', previous_filename: 'src/a11.ts' }]),
      }
      const { calls, dependencies, sleeps } = fakeDependencies(routes)
      answerInFlightInTurn(dependencies, [[OTHER_PR], []])

      const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

      Expect(result.exitCode).toBe(0)
      Expect(sleeps).toEqual([30_000])
      Expect(result.lines).toContain(
        'WAIT  run 11 on feat/other (pull_request #45, 12m old) changed the same files as this branch, and the'
          + ' two would merge untested against each other: src/a0.ts, src/a1.ts, src/a10.ts, src/a11.ts,'
          + ' src/a2.ts, src/a3.ts, src/a4.ts, src/a5.ts, src/a6.ts, src/a7.ts, and 2 more.'
          + ' Waiting for it to finish, checking every 30s.',
      )
      Expect(result.lines).toContain('PASS  No other Verify run is in flight; this run gets the whole runner pool.')
      Expect(calls.indexOf(FETCH_MAIN_KEY)).toBeLessThan(calls.indexOf(BRANCH_DIFF_KEY))
      Expect(calls.indexOf(prFilesKey(45, 2))).toBeLessThan(calls.indexOf(PUSH_KEY))
    })

    Test('shares the pool with one other lander that changed none of the same files', async () => {
      // GitHub names no pull request on a run from a fork, so the run's branch finds it.
      const fromFork = verifyRun(11, { branch: 'feat/other', event: 'pull_request', minutesAgo: 5 })
      const routes = openedPullRequestRoutes(2)
      routes[FETCH_MAIN_KEY] = {}
      routes[BRANCH_DIFF_KEY] = { stdout: 'src/a.ts\n' }
      routes[listKey('open', 'feat/other')] = { stdout: JSON.stringify([pull(45)]) }
      routes[prFilesKey(45, 1)] = { stdout: JSON.stringify([{ filename: 'src/elsewhere.ts' }]) }
      const { calls, dependencies, sleeps } = fakeDependencies(routes)
      answerInFlightInTurn(dependencies, [[fromFork]])

      const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

      Expect(result.exitCode).toBe(0)
      Expect(sleeps).toEqual([])
      Expect(result.lines).toContain(
        'PASS  One other Verify run is in flight (run 11 on feat/other (pull_request, 5m old)) and it changed none'
          + ' of these files; this run will share the pool with run 11 at the smaller partition count.',
      )
      Expect(calls.indexOf(prFilesKey(45, 1))).toBeLessThan(calls.indexOf(PUSH_KEY))
    })

    Test('--jump-queue pushes beside the runs in flight, naming what it skipped', async () => {
      const { calls, dependencies, sleeps } = fakeDependencies(openedPullRequestRoutes(2))
      answerInFlightInTurn(dependencies, [[OTHER_PR, MAIN_PUSH]])

      const result = await OpenPrCommand.run({ jumpQueue: true, repositoryRoot: ROOT }, dependencies)

      Expect(result.exitCode).toBe(0)
      Expect(sleeps).toEqual([])
      Expect(result.lines).toContain(
        'NOTE  --jump-queue: pushing without admission beside run 11 on feat/other (pull_request #45, 12m old),'
          + ' run 12 on main (push, 3m old).',
      )
      Expect(calls).toContain(PUSH_KEY)
      Expect(calls.some(call => call === FETCH_MAIN_KEY || call.includes('/files?'))).toBe(false)
    })

    Test('gives up after 90 minutes without pushing, naming the runs and --jump-queue', async () => {
      const routes = openedPullRequestRoutes(2)
      // A queued run holds its place in the pool as surely as a running one.
      routes[inFlightKey('queued')] = {
        stdout: JSON.stringify({ workflow_runs: [{ ...MAIN_PUSH, status: 'queued' }] }),
      }
      const { calls, dependencies, sleeps } = fakeDependencies(routes)
      answerInFlightInTurn(dependencies, [[OTHER_PR]])

      const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

      Expect(result.exitCode).toBe(1)
      Expect(calls.some(call => call.startsWith('git push'))).toBe(false)
      Expect(sleeps).toHaveLength(180)
      // Every five minutes of an unchanged wait prints a still-waiting line rather than staying silent.
      Expect(result.lines.filter(line => line.startsWith('WAIT  Still waiting for admission'))).toHaveLength(17)
      Expect(result.lines.at(-1)).toBe(
        'FAIL  Waited 90m for admission and run 11 on feat/other (pull_request #45, 102m old), run 12 on main'
          + ' (push, 93m old) still in flight; nothing was pushed. Run open-pr again later, or with --jump-queue'
          + ' to push beside them.',
      )
    })
  })
})
