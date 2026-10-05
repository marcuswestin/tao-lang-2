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

/** cleanFeatureBranchRoutes is every call `open-pr` makes before it reaches gh, all answering with a
 * clean, pushable `feat/example` three commits ahead of `main`. */
function cleanFeatureBranchRoutes(): Record<string, RouteResult> {
  return {
    [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: `${BRANCH}\n` },
    [routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)]: { stdout: '' },
    [routeKey('git', ['merge-base', 'main', 'HEAD'], ROOT)]: { stdout: 'basesha0000\n' },
    [routeKey('git', ['rev-list', '--count', 'basesha0000..HEAD'], ROOT)]: { stdout: '3\n' },
    [routeKey('gh', ['auth', 'status'], ROOT)]: {},
    [MERGED_LIST_KEY]: { stdout: '[]' },
    [routeKey('git', ['rev-parse', 'HEAD'], ROOT)]: { stdout: `${HEAD_SHA}\n` },
    [routeKey('git', ['push', '--set-upstream', 'origin', BRANCH], ROOT)]: {},
  }
}

const PR_LIST_KEY = routeKey(
  'gh',
  ['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number,url', '--limit', '1'],
  ROOT,
)
const MERGED_LIST_KEY = routeKey(
  'gh',
  ['pr', 'list', '--head', BRANCH, '--state', 'merged', '--json', 'number,url', '--limit', '1'],
  ROOT,
)
const SUBJECT = 'Add the example workflow'
const BODY = '- one detail\n- another'
const MESSAGE_FILE = `${ROOT}/.artifacts/merge/${BRANCH}.msg`

function enableAutoMergeKey(prNumber: number): string {
  return routeKey(
    'gh',
    ['pr', 'merge', String(prNumber), '--auto', '--squash', '--subject', SUBJECT, '--body', BODY],
    ROOT,
  )
}

/** autoMergeRoutes answers the auto-merge read as off, and accepts turning it on with the message. */
function autoMergeRoutes(prNumber: number): Record<string, RouteResult> {
  return {
    [routeKey('gh', ['pr', 'view', String(prNumber), '--json', 'autoMergeRequest'], ROOT)]: {
      stdout: '{"autoMergeRequest":null}',
    },
    [enableAutoMergeKey(prNumber)]: {},
  }
}

/** openedPullRequestRoutes is `cleanFeatureBranchRoutes` for a branch with no open pull request, whose
 * `gh pr create` opens `prNumber` titled and described by the reviewed merge message. */
function openedPullRequestRoutes(prNumber: number): Record<string, RouteResult> {
  return {
    ...cleanFeatureBranchRoutes(),
    ...autoMergeRoutes(prNumber),
    [PR_LIST_KEY]: { stdout: '[]' },
    [routeKey('gh', ['pr', 'create', '--base', 'main', '--head', BRANCH, '--title', SUBJECT, '--body', BODY], ROOT)]: {
      stdout: `https://github.com/tao/tao/pull/${prNumber}\n`,
    },
  }
}

function headViewKey(prNumber: number): string {
  return routeKey('gh', ['pr', 'view', String(prNumber), '--json', 'headRefOid,mergeable,statusCheckRollup'], ROOT)
}

/** headView is `gh pr view` answering for the pull request's head with `checkCount` checks on it. */
function headView(headRefOid: string, checkCount: number, mergeable = 'MERGEABLE'): RouteResult {
  const statusCheckRollup = Array.from({ length: checkCount }, (_, index) => ({ name: `check-${index}` }))
  return { stdout: JSON.stringify({ headRefOid, mergeable, statusCheckRollup }) }
}

function fakeDependencies(
  routes: Record<string, RouteResult>,
  overrides: Partial<OpenPrDependencies> = {},
): { calls: string[]; dependencies: OpenPrDependencies } {
  const calls: string[] = []
  const dependencies: OpenPrDependencies = {
    exists: async path => path === MESSAGE_FILE,
    readText: async path =>
      path === MESSAGE_FILE ? `${SUBJECT}\n\n${BODY}\n` : Errors.throwUnexpected(`unexpected read: ${path}`),
    run: fakeRun(routes, calls),
    sleep: async () => {},
    writeLine: () => {},
    ...overrides,
  }
  return { calls, dependencies }
}

Describe('open-pr', () => {
  Test('waits for the opened pull request’s checks before watching any', async () => {
    // What the first real runs met: `gh pr checks` asked straight after the push, before GitHub had
    // created the workflow run, answered "no checks reported". The run appeared seconds later.
    const routes = openedPullRequestRoutes(2)
    routes[headViewKey(2)] = {}
    routes[routeKey('gh', ['pr', 'checks', '--help'], ROOT)] = { stdout: '  --watch  Watch checks\n' }
    routes[routeKey('gh', ['pr', 'checks', '2', '--watch'], ROOT)] = {}
    routes[routeKey('gh', ['pr', 'checks', '2', '--json', 'name,state,link,bucket'], ROOT)] = {
      stdout: JSON.stringify([{ bucket: 'pass', link: 'https://ci/1', name: 'unit', state: 'SUCCESS' }]),
    }
    const views = [headView(HEAD_SHA, 0), headView(HEAD_SHA, 0), headView(HEAD_SHA, 1)]
    const { calls, dependencies } = fakeDependencies(routes)
    const sleeps: number[] = []
    dependencies.sleep = async ms => {
      sleeps.push(ms)
    }
    const run = dependencies.run
    dependencies.run = (async (command, spec = {}) => {
      if (routeKey(command, spec.args ?? [], spec.cwd) === headViewKey(2)) {
        const view = views.shift()!
        return { ...(await run(command, spec)), ...view }
      }
      return await run(command, spec)
    }) as OpenPrRunner

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(views).toEqual([])
    Expect(sleeps).toEqual([5_000, 5_000])
    Expect(calls.lastIndexOf(headViewKey(2))).toBeLessThan(
      calls.indexOf(routeKey('gh', ['pr', 'checks', '2', '--watch'], ROOT)),
    )
    Expect(result.lines).toContain('PASS  All 1 check(s) succeeded.')
    Expect(result.lines.at(-1)).toStartWith('NEXT  Run merge-pr')
    // Auto-merge goes on once checks exist on the head, so Verify is pending when GitHub reads it.
    const autoMerge = calls.indexOf(enableAutoMergeKey(2))
    Expect(autoMerge).toBeGreaterThan(calls.lastIndexOf(headViewKey(2)))
    Expect(autoMerge).toBeLessThan(calls.indexOf(routeKey('gh', ['pr', 'checks', '2', '--watch'], ROOT)))
  })

  Test('fails, without watching, when no checks ever appear on the pushed commit', async () => {
    const routes = openedPullRequestRoutes(2)
    routes[headViewKey(2)] = headView(HEAD_SHA, 0)
    const { calls, dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(result.lines.some(line => line.startsWith('FAIL  No checks appeared on headsha1'))).toBe(true)
    Expect(result.lines.some(line => line.includes('Actions may be disabled'))).toBe(true)
    Expect(calls.some(call => call.startsWith('gh pr checks') || call.startsWith('gh pr merge'))).toBe(false)
  })

  Test('names a conflict with main as the reason no checks appeared', async () => {
    // The second real run: GitHub creates no pull_request workflow run for a pull request that
    // conflicts with its base, so blaming disabled Actions sent the reader the wrong way.
    const routes = openedPullRequestRoutes(2)
    routes[headViewKey(2)] = headView(HEAD_SHA, 0, 'CONFLICTING')
    const { dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

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
    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)).rejects.toThrow('HEAD is detached')
  })

  Test('refuses a branch that is not feat/<name>', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: 'chore/tidy\n' },
    })
    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('not a feat/<name> branch')
  })

  Test('refuses an uncommitted worktree', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: `${BRANCH}\n` },
      [routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)]: { stdout: ' M dirty.ts\n' },
    })
    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('uncommitted changes')
  })

  Test('refuses a branch with no commits beyond its main merge base', async () => {
    const { dependencies } = fakeDependencies({
      [routeKey('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], ROOT)]: { stdout: `${BRANCH}\n` },
      [routeKey('git', ['status', '--porcelain=v1', '--untracked-files=all'], ROOT)]: { stdout: '' },
      [routeKey('git', ['merge-base', 'main', 'HEAD'], ROOT)]: { stdout: 'basesha0000\n' },
      [routeKey('git', ['rev-list', '--count', 'basesha0000..HEAD'], ROOT)]: { stdout: '0\n' },
    })
    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('no commits beyond its main merge base')
  })

  Test('prints a plain remedy, not a stack trace, when gh is not installed', async () => {
    const routes = cleanFeatureBranchRoutes()
    routes[routeKey('gh', ['auth', 'status'], ROOT)] = {
      error: new Errors.HostEnvironmentError('spawn gh ENOENT'),
      exitCode: null,
    }
    const { dependencies } = fakeDependencies(routes)
    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('gh is not installed')
  })

  Test('prints a plain remedy, not a stack trace, when gh is unauthenticated', async () => {
    const routes = cleanFeatureBranchRoutes()
    routes[routeKey('gh', ['auth', 'status'], ROOT)] = { exitCode: 1, stderr: 'not logged in to any accounts' }
    const { dependencies } = fakeDependencies(routes)
    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies))
      .rejects.toThrow('gh auth login')
  })

  Test('reuses an existing pull request and watches the checks its push started', async () => {
    // Verify runs on every push to an open pull request, so a reused one is watched like a new one.
    const routes = cleanFeatureBranchRoutes()
    routes[PR_LIST_KEY] = { stdout: JSON.stringify([{ number: 7, url: 'https://github.com/tao/tao/pull/7' }]) }
    routes[routeKey('gh', ['pr', 'edit', '7', '--title', SUBJECT, '--body', BODY], ROOT)] = {}
    routes[routeKey('gh', ['pr', 'view', '7', '--json', 'autoMergeRequest'], ROOT)] = {
      stdout: JSON.stringify({
        autoMergeRequest: { commitBody: BODY, commitHeadline: SUBJECT, mergeMethod: 'SQUASH' },
      }),
    }
    routes[headViewKey(7)] = headView(HEAD_SHA, 1)
    routes[routeKey('gh', ['pr', 'checks', '--help'], ROOT)] = { stdout: 'Show CI status.\n' }
    routes[routeKey('gh', ['pr', 'checks', '7', '--json', 'name,state,link,bucket'], ROOT)] = {
      stdout: JSON.stringify([{ bucket: 'pass', link: 'https://ci/1', name: 'Verify', state: 'SUCCESS' }]),
    }
    const { calls, dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(result.lines.some(line => line.startsWith('PASS  Reusing #7')))
      .toBe(true)
    // The message may have changed since the pull request opened, and it is what the squash commit says.
    Expect(calls).toContain(routeKey('gh', ['pr', 'edit', '7', '--title', SUBJECT, '--body', BODY], ROOT))
    Expect(calls.some(call => call.startsWith('gh pr create') || call.startsWith('gh pr merge'))).toBe(false)
    Expect(result.lines).toContain('PASS  Auto-merge is already on for #7 with the merge message.')
    Expect(result.lines).toContain('PASS  All 1 check(s) succeeded.')
    Expect(result.lines.at(-1)).toStartWith('NEXT  Run merge-pr')
  })

  Test('re-enables auto-merge that carries an older merge message', async () => {
    // GitHub's own squash message appends ` (#N)` and wraps the description at 72 columns, and
    // auto-merge keeps the message it was enabled with, so a stale one is replaced, not kept.
    const routes = cleanFeatureBranchRoutes()
    routes[PR_LIST_KEY] = { stdout: JSON.stringify([{ number: 7, url: 'https://github.com/tao/tao/pull/7' }]) }
    routes[routeKey('gh', ['pr', 'edit', '7', '--title', SUBJECT, '--body', BODY], ROOT)] = {}
    routes[routeKey('gh', ['pr', 'view', '7', '--json', 'autoMergeRequest'], ROOT)] = {
      stdout: JSON.stringify({ autoMergeRequest: { commitBody: null, commitHeadline: null, mergeMethod: 'SQUASH' } }),
    }
    routes[routeKey('gh', ['pr', 'merge', '7', '--disable-auto'], ROOT)] = {}
    routes[enableAutoMergeKey(7)] = {}
    routes[headViewKey(7)] = headView(HEAD_SHA, 1)
    routes[routeKey('gh', ['pr', 'checks', '--help'], ROOT)] = { stdout: 'Show CI status.\n' }
    routes[routeKey('gh', ['pr', 'checks', '7', '--json', 'name,state,link,bucket'], ROOT)] = {
      stdout: JSON.stringify([{ bucket: 'pass', link: 'https://ci/1', name: 'Verify', state: 'SUCCESS' }]),
    }
    const { calls, dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(calls.indexOf(routeKey('gh', ['pr', 'merge', '7', '--disable-auto'], ROOT)))
      .toBeLessThan(calls.indexOf(enableAutoMergeKey(7)))
    Expect(calls.indexOf(enableAutoMergeKey(7))).toBeGreaterThan(-1)
  })

  Test('refuses, before pushing, a branch that already merged', async () => {
    // Pushing a merged branch again opened a second, empty pull request that auto-merge also landed.
    const routes = cleanFeatureBranchRoutes()
    routes[MERGED_LIST_KEY] = { stdout: JSON.stringify([{ number: 4, url: 'https://github.com/tao/tao/pull/4' }]) }
    const { calls, dependencies } = fakeDependencies(routes)

    await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)).rejects.toThrow('already merged as #4')
    Expect(calls.some(call => call.startsWith('git push'))).toBe(false)
  })

  Test('opens a pull request titled by the merge message and fails when a check fails', async () => {
    const routes = openedPullRequestRoutes(42)
    routes[headViewKey(42)] = headView(HEAD_SHA, 2)
    routes[routeKey('gh', ['pr', 'checks', '--help'], ROOT)] = { stdout: 'Show CI status.\n\n  --watch   watch\n' }
    routes[routeKey('gh', ['pr', 'checks', '42', '--watch'], ROOT)] = { exitCode: 1 }
    routes[routeKey('gh', ['pr', 'checks', '42', '--json', 'name,state,link,bucket'], ROOT)] = {
      stdout: JSON.stringify([
        { bucket: 'pass', link: 'https://ci/1', name: 'unit', state: 'SUCCESS' },
        { bucket: 'fail', link: 'https://ci/2', name: 'integration', state: 'FAILURE' },
      ]),
    }
    const { dependencies } = fakeDependencies(routes)

    const result = await OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(1)
    Expect(result.lines.some(line => line.includes('Opened pull request #42'))).toBe(true)
    Expect(result.lines.some(line => line === 'FAIL  integration: https://ci/2')).toBe(true)
  })

  Test('refuses, before pushing, without a reviewed merge message', async () => {
    for (
      const [overrides, reason] of [
        [{ exists: async () => false }, 'Write and review the merge message first'],
        [{ readText: async () => `DRAFT: ${SUBJECT}\n\n${BODY}\n` }, "remove its 'DRAFT: ' prefix"],
      ] satisfies [Partial<OpenPrDependencies>, string][]
    ) {
      const { calls, dependencies } = fakeDependencies(cleanFeatureBranchRoutes(), overrides)
      await Expect(OpenPrCommand.run({ repositoryRoot: ROOT }, dependencies)).rejects.toThrow(reason)
      Expect(calls.some(call => call.startsWith('git push'))).toBe(false)
    }
  })

  Test('polls gh pr checks --json on an interval when this gh has no --watch flag', async () => {
    const routes = openedPullRequestRoutes(3)
    routes[headViewKey(3)] = headView(HEAD_SHA, 1)
    routes[routeKey('gh', ['pr', 'checks', '--help'], ROOT)] = { stdout: 'Show CI status.\n' } // no --watch
    const { dependencies } = fakeDependencies(routes)
    const fetchKey = routeKey('gh', ['pr', 'checks', '3', '--json', 'name,state,link,bucket'], ROOT)
    const responses = [
      JSON.stringify([{ bucket: 'pending', link: 'https://ci/1', name: 'unit', state: 'PENDING' }]),
      JSON.stringify([{ bucket: 'pass', link: 'https://ci/1', name: 'unit', state: 'SUCCESS' }]),
    ]
    let fetchCount = 0
    const sleeps: number[] = []
    dependencies.run = (async (command, spec = {}) => {
      const key = routeKey(command, spec.args ?? [], spec.cwd)
      if (key === fetchKey) {
        const stdout = responses[Math.min(fetchCount, responses.length - 1)]!
        fetchCount += 1
        return { args: [...(spec.args ?? [])], command, cwd: spec.cwd, exitCode: 0, signal: null, stderr: '', stdout }
      }
      return await fakeRun(routes)(command, spec)
    }) as OpenPrRunner
    dependencies.sleep = async ms => {
      sleeps.push(ms)
    }

    const result = await OpenPrCommand.run({ pollIntervalMs: 5_000, repositoryRoot: ROOT }, dependencies)

    Expect(result.exitCode).toBe(0)
    Expect(fetchCount).toBe(2)
    Expect(sleeps).toEqual([5_000])
    Expect(result.lines.some(line => line.includes('no `--watch` flag'))).toBe(true)
  })
})
