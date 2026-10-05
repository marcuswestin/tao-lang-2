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
/** LANDING is a run meant to land, which passes `--auto-merge`; a run without it only runs CI. */
const LANDING = { autoMerge: true, repositoryRoot: ROOT }

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
    [routeKey('git', ['push', '--set-upstream', 'origin', branch], ROOT)]: {},
  }
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
    [enableAutoMergeKey(prNumber)]: {},
  }
}

function fakeDependencies(
  routes: Record<string, RouteResult>,
  overrides: Partial<OpenPrDependencies> = {},
  branch = BRANCH,
): { calls: string[]; dependencies: OpenPrDependencies; followed: number[] } {
  const calls: string[] = []
  const followed: number[] = []
  const dependencies: OpenPrDependencies = {
    exists: async path => path === messageFile(branch),
    followChecks: async options => {
      calls.push('followChecks')
      followed.push(options.pr ?? 0)
      return { exitCode: 0 }
    },
    readText: async path =>
      path === messageFile(branch) ? `${SUBJECT}\n\n${BODY}\n` : Errors.throwUnexpected(`unexpected read: ${path}`),
    run: fakeRun(routes, calls),
    sleep: async () => {},
    writeLine: () => {},
    ...overrides,
  }
  return { calls, dependencies, followed }
}

Describe('open-pr', () => {
  Test('without --auto-merge, follows CI on the pushed head through the gh login', async () => {
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
    Expect(calls).toContain(createKey())
    Expect(calls.some(call => call.startsWith('gh pr merge') || call.includes('/ccr/auto_merge'))).toBe(false)
    Expect(followed).toEqual([2])
    Expect(expectedHead).toBe(HEAD_SHA)
    Expect(ghAuth).toBe(true)
  })

  Test('reports a failed CI-only check without a landing instruction', async () => {
    const routes = openedPullRequestRoutes(2)
    delete routes[enableAutoMergeKey(2)]
    const { calls, dependencies } = fakeDependencies(routes, {
      followChecks: async () => ({ exitCode: 1 }),
    })

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(calls).toContain(createKey())
    Expect(calls.some(call => call.startsWith('gh pr merge') || call.includes('/ccr/auto_merge'))).toBe(false)
    Expect(result.lines.some(line => line.startsWith('NEXT'))).toBe(false)
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

    const result = await OpenPrCommand.run(LANDING, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(counts).toEqual([])
    Expect(sleeps).toEqual([5_000, 5_000])
    Expect(followed).toEqual([2])
    Expect(result.lines.at(-1)).toStartWith('NEXT  Run merge-pr')
    // Auto-merge goes on once checks exist on the head, so Verify is pending when GitHub reads it.
    const autoMerge = calls.indexOf(enableAutoMergeKey(2))
    Expect(autoMerge).toBeGreaterThan(calls.lastIndexOf(checkCountKey()))
    Expect(autoMerge).toBeLessThan(calls.indexOf('followChecks'))
  })

  Test('fails, without following, when no checks ever appear on the pushed commit', async () => {
    const routes = openedPullRequestRoutes(2)
    routes[checkCountKey()] = { stdout: '{"total_count":0}' }
    const { calls, dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run(LANDING, dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(result.lines.some(line => line.startsWith('FAIL  No checks appeared on headsha1'))).toBe(true)
    Expect(result.lines.some(line => line.includes('Actions may be disabled'))).toBe(true)
    Expect(calls.some(call => call === 'followChecks' || call.startsWith('gh pr merge'))).toBe(false)
  })

  Test('names a conflict with main as the reason no checks appeared', async () => {
    // The second real run: GitHub creates no pull_request workflow run for a pull request that
    // conflicts with its base, so blaming disabled Actions sent the reader the wrong way.
    const routes = openedPullRequestRoutes(2)
    routes[viewKey(2)] = { stdout: JSON.stringify(pull(2, { mergeable_state: 'dirty' })) }
    routes[checkCountKey()] = { stdout: '{"total_count":0}' }
    const { dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run(LANDING, dependencies)

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
    await Expect(OpenPrCommand.run(LANDING, dependencies)).rejects.toThrow('HEAD is detached')
  })

  Test('refuses a branch that is not feat/, claude/, or codex/', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: 'chore/tidy\n' },
    })
    await Expect(OpenPrCommand.run(LANDING, dependencies))
      .rejects.toThrow('not a feat/<name>, claude/<name>, codex/<name> branch')
  })

  Test('opens a pull request for the branch a cloud agent session was assigned', async () => {
    const branch = 'claude/example-x1'
    const { calls, dependencies } = fakeDependencies(openedPullRequestRoutes(5, branch), {}, branch)

    const result = await OpenPrCommand.run(LANDING, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls).toContain(routeKey('git', ['push', '--set-upstream', 'origin', branch], ROOT))
    Expect(calls).toContain(createKey(branch))
  })

  Test('refuses an uncommitted worktree', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: `${BRANCH}\n` },
      [routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)]: { stdout: ' M dirty.ts\n' },
    })
    await Expect(OpenPrCommand.run(LANDING, dependencies))
      .rejects.toThrow('uncommitted changes')
  })

  Test('refuses a branch with no commits beyond its main merge base', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: `${BRANCH}\n` },
      [routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)]: { stdout: '' },
      [routeKey('git', ['merge-base', 'main', 'HEAD'], ROOT)]: { stdout: 'basesha0000\n' },
      [routeKey('git', ['rev-list', '--count', 'basesha0000..HEAD'], ROOT)]: { stdout: '0\n' },
    })
    await Expect(OpenPrCommand.run(LANDING, dependencies))
      .rejects.toThrow('no commits beyond its main merge base')
  })

  Test('prints a plain remedy, not a stack trace, when gh is not installed', async () => {
    const routes = cleanFeatureBranchRoutes()
    routes[routeKey('gh', ['api', 'user', '--jq', '.login'], ROOT)] = {
      error: new Errors.HostEnvironmentError('spawn gh ENOENT'),
      exitCode: null,
    }
    const { dependencies } = fakeDependencies(routes)
    await Expect(OpenPrCommand.run(LANDING, dependencies))
      .rejects.toThrow('gh is not installed')
  })

  Test('prints a plain remedy, not a stack trace, when gh is unauthenticated', async () => {
    const routes = cleanFeatureBranchRoutes()
    routes[routeKey('gh', ['api', 'user', '--jq', '.login'], ROOT)] = { exitCode: 4, stderr: 'gh auth login' }
    const { dependencies } = fakeDependencies(routes)
    await Expect(OpenPrCommand.run(LANDING, dependencies))
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

    const result = await OpenPrCommand.run(LANDING, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(result.lines.some(line => line.startsWith('PASS  Reusing #7'))).toBe(true)
    // The message may have changed since the pull request opened, and it is what the squash commit says.
    Expect(calls).toContain(editKey(7))
    Expect(calls.some(call => call.includes('--method POST') || call.startsWith('gh pr merge'))).toBe(false)
    Expect(result.lines).toContain('PASS  Auto-merge is already on for #7 with the merge message.')
    Expect(followed).toEqual([7])
    Expect(result.lines.at(-1)).toStartWith('NEXT  Run merge-pr')
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

    const result = await OpenPrCommand.run(LANDING, dependencies)

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

    const result = await OpenPrCommand.run(LANDING, dependencies)

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

    const result = await OpenPrCommand.run(LANDING, dependencies)

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

    const result = await OpenPrCommand.run(LANDING, dependencies)

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

    const result = await OpenPrCommand.run(LANDING, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(result.lines).toContain(
      'NOTE  Auto-merge stays off for #2 (gh said: auto-merge is not allowed for this repository;'
        + ' the host route said: gh: Not Found (HTTP 404)); merge-pr merges it with the merge message once Verify passes.',
    )
    Expect(followed).toEqual([2])
  })

  Test('without --auto-merge, follows the checks and leaves auto-merge off', async () => {
    // A push that only wants CI must never land by itself.
    const { calls, dependencies, followed } = fakeDependencies(openedPullRequestRoutes(2))

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls.some(call => call.startsWith('gh pr merge') || call.includes('auto_merge'))).toBe(false)
    Expect(result.lines).toContain(
      'PASS  Auto-merge is off for #2; this run only runs CI. Pass --auto-merge to land it.',
    )
    Expect(followed).toEqual([2])
    Expect(result.lines.at(-1)).toBe(
      'NEXT  Nothing lands from this run. To land #2, run open-pr --auto-merge, or merge-pr.',
    )
  })

  Test('without --auto-merge, turns off auto-merge an earlier run left on', async () => {
    const routes = cleanFeatureBranchRoutes()
    const reused = pull(7, { auto_merge: { commit_message: BODY, commit_title: SUBJECT, merge_method: 'squash' } })
    routes[listKey('open')] = { stdout: JSON.stringify([reused]) }
    routes[editKey(7)] = {}
    routes[viewKey(7)] = { stdout: JSON.stringify(reused) }
    routes[checkCountKey()] = { stdout: '{"total_count":1}' }
    routes[routeKey('gh', ['pr', 'merge', '7', '--disable-auto'], ROOT)] = {}
    const { calls, dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls).toContain(routeKey('gh', ['pr', 'merge', '7', '--disable-auto'], ROOT))
    Expect(calls.some(call => call.includes('--auto --squash'))).toBe(false)
    Expect(result.lines).toContain(
      'PASS  Turned auto-merge off for #7; this run only runs CI. Pass --auto-merge to land it.',
    )
  })

  Test('refuses, before pushing, a branch that already merged', async () => {
    // Pushing a merged branch again opened a second, empty pull request that auto-merge also landed.
    const routes = cleanFeatureBranchRoutes()
    routes[listKey('closed')] = {
      stdout: JSON.stringify([pull(3), pull(4, { merged_at: '2026-10-01T00:00:00Z' })]),
    }
    const { calls, dependencies } = fakeDependencies(routes)

    await Expect(OpenPrCommand.run(LANDING, dependencies)).rejects.toThrow('already merged as #4')
    Expect(calls.some(call => call.startsWith('git push'))).toBe(false)
  })

  Test('opens a pull request titled by the merge message and fails when a check fails', async () => {
    const { dependencies } = fakeDependencies(openedPullRequestRoutes(42), {
      followChecks: async () => ({ exitCode: 1 }),
    })

    const result = await OpenPrCommand.run(LANDING, dependencies)

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
      await Expect(OpenPrCommand.run(LANDING, dependencies)).rejects.toThrow(reason)
      Expect(calls.some(call => call.startsWith('git push'))).toBe(false)
    }
  })
})
