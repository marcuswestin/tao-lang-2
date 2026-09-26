import { type CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { execute, formatReclaimReport, reclaim } from '../dev-cli-src/doctor/Reclaim'
import type { ThreadAssociation, ThreadAssociationInventory } from '../dev-cli-src/doctor/ThreadAssociations'

/**
 * Every seam here is a fake, for the same reason `board`'s tests fake theirs and for one more: this
 * is the only command in the repository that removes a worktree, so a test that reached the real
 * `git worktree remove` could delete another agent's checkout. No test below lets a real removal
 * run — the scripted runner records the attempt instead.
 *
 * The cases that matter are the refusals. A command that removes the right things on a quiet
 * machine but also removes a worktree that went back to work is worse than no command at all, so
 * the liveness re-check and the unreadable-registry case are tested as carefully as the happy path.
 */

type RouteResult = Partial<CLI.CommandResult>

function fakeGitRun(routes: Record<string, RouteResult>, calls?: string[]): typeof CLI.run {
  return (async (command, spec = {}) => {
    const key = routeKey(command, spec.args ?? [], spec.cwd)
    calls?.push(key)
    return {
      args: [...(spec.args ?? [])],
      command,
      cwd: spec.cwd,
      exitCode: 0,
      signal: null,
      stderr: '',
      stdout: '',
      ...routes[key],
    }
  }) as typeof CLI.run
}

function routeKey(command: string, args: readonly string[], cwd: string | undefined): string {
  return `${command} ${args.join(' ')}::${cwd ?? ''}`
}

function porcelainListing(worktrees: readonly { branch?: string; head: string; path: string }[]): string {
  return worktrees.map(worktree =>
    [
      `worktree ${worktree.path}`,
      `HEAD ${worktree.head}`,
      worktree.branch === undefined ? 'detached' : `branch refs/heads/${worktree.branch}`,
    ].join('\n')
  ).join('\n\n')
}

const HEAD = 'a'.repeat(40)
const PRIMARY = '/repo/primary'

/** scenario builds one machine: a primary checkout, the worktree asking, and one candidate. */
async function scenario(options: {
  association?: ThreadAssociation
  calls?: string[]
  candidateClean?: boolean
  /** Where the candidate worktree lives. Pass an existing one to build a second registry over the
   * same machine, which is how the "went busy between report and action" case is staged. */
  candidatePath?: string
  containingRefs?: string
  /** Write a live lane owned by this process against the candidate, making it provably busy. */
  laneOnCandidate?: boolean
  removeResult?: RouteResult
}) {
  const registryRoot = await mkTestDir('reclaim-registry')
  const candidate = options.candidatePath ?? FS.resolvePath('candidate', await mkTestDir('reclaim-worktrees'))
  await FS.mkdir(candidate)
  const asking = Repo.getRoot()
  if (options.laneOnCandidate === true) {
    await FS.writeJson(FS.resolvePath('candidate.lane.json', registryRoot), {
      lane: 'verify',
      maxSlots: 1,
      // This process, so the registry's own liveness check sees a lane that is genuinely running.
      pid: Platform.runtimeProcess.pid,
      repositoryRoot: candidate,
      slots: 1,
      startedAt: new Date().toISOString(),
    })
  }
  const run = fakeGitRun({
    [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
      stdout: porcelainListing([
        { branch: 'main', head: HEAD, path: PRIMARY },
        { branch: 'feat/asking', head: HEAD, path: asking },
        { head: HEAD, path: candidate },
      ]),
    },
    [routeKey('git', ['status', '--porcelain'], candidate)]: {
      stdout: options.candidateClean === false ? ' M src/thing.ts\n' : '',
    },
    [
      routeKey('git', [
        'for-each-ref',
        `--contains=${HEAD}`,
        '--format=%(refname:short)',
        'refs/heads/main',
        'refs/remotes/origin/main',
        'refs/remotes/origin/merged',
      ], candidate)
    ]: { stdout: options.containingRefs ?? 'origin/merged/some-task\n' },
    [routeKey('git', ['worktree', 'remove', candidate], Repo.getRoot())]: options.removeResult ?? {},
  }, options.calls)
  const associations = async (paths: readonly string[]): Promise<ThreadAssociationInventory> => ({
    byPath: new Map(paths.map(path => [
      path,
      path === candidate && options.association !== undefined
        ? [options.association]
        : [],
    ])),
    coverage: ['fixture association index'],
  })
  return { associations, candidate, registryRoot, run }
}

const attachedTask: ThreadAssociation = {
  createdAt: '2026-09-19T18:28:58.000Z',
  description: 'Improve testing and merge scheduling',
  id: '01a0baed-bea6-7cd3-a354-0eee871a9a15',
  label: 'NEXT',
  lastActivity: 'User: identify the task sending continuation messages',
  lastActivityAt: '2026-09-20T16:59:37.000Z',
  provider: 'Codex',
  title: 'Improve Tao testing and merges',
}

Describe('reclaim', () => {
  Test('reports a clean, idle, preserved worktree as reclaimable with its evidence', async () => {
    const { associations, candidate, registryRoot, run } = await scenario({})

    const report = await reclaim({ associations, registryRoot, run })

    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('reclaimable')
    Expect(row?.evidence).toEqual(['clean', 'idle', 'contained in origin/merged/some-task'])
  })

  Test('never reclaims the worktree it is running in, or the primary checkout', async () => {
    const { associations, registryRoot, run } = await scenario({})

    const report = await reclaim({ associations, registryRoot, run })

    const byPath = new Map(report.worktrees.map(worktree => [worktree.path, worktree]))
    Expect(byPath.get(Repo.getRoot())?.verdict).toBe('live')
    Expect(byPath.get(PRIMARY)?.verdict).toBe('live')
  })

  Test('a worktree holding a lane is live, not reclaimable', async () => {
    const { associations, candidate, registryRoot, run } = await scenario({ laneOnCandidate: true })

    const report = await reclaim({ associations, registryRoot, run })

    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('live')
    Expect(row?.evidence).toEqual(['holds a lane, a resource lease, or the landing lock'])
  })

  Test('uncommitted changes make a worktree live', async () => {
    const { associations, candidate, registryRoot, run } = await scenario({ candidateClean: false })

    const report = await reclaim({ associations, registryRoot, run })

    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('live')
    Expect(row?.evidence).toEqual(['uncommitted changes'])
  })

  Test('a commit no preserved ref contains is unclassified, never reclaimable', async () => {
    const { associations, candidate, registryRoot, run } = await scenario({ containingRefs: '' })

    const report = await reclaim({ associations, registryRoot, run })

    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('unclassified')
    Expect(row?.evidence.at(-1)).toContain('reachable from neither main nor any origin/merged/* ref')
  })

  Test('execute removes a reclaimable worktree', async () => {
    const calls: string[] = []
    const { associations, candidate, registryRoot, run } = await scenario({ calls })
    const report = await reclaim({ associations, registryRoot, run })

    const removals = await execute(report, { associations, registryRoot, run })

    Expect(removals).toEqual([{ outcome: 'removed', path: candidate }])
    Expect(calls).toContain(routeKey('git', ['worktree', 'remove', candidate], Repo.getRoot()))
  })

  Test('execute refuses a worktree that took a lane after the report was gathered', async () => {
    const calls: string[] = []
    const first = await scenario({ calls })
    const report = await reclaim({ associations: first.associations, registryRoot: first.registryRoot, run: first.run })
    Expect(report.worktrees.some(worktree => worktree.verdict === 'reclaimable')).toBe(true)

    // The machine goes busy between the report and the action — the case a five-minute-old snapshot
    // gets wrong, and the reason the liveness signals are re-read per item.
    const busy = await scenario({ calls, candidatePath: first.candidate, laneOnCandidate: true })
    const removals = await execute(report, {
      associations: busy.associations,
      registryRoot: busy.registryRoot,
      run: busy.run,
    })

    Expect(removals).toEqual([
      { outcome: 'skipped-now-live', path: first.candidate, reason: 'took a lane since the report' },
    ])
    Expect(calls).not.toContain(routeKey('git', ['worktree', 'remove', first.candidate], Repo.getRoot()))
  })

  Test('a sandbox denial is reported as needing an unsandboxed shell, not as a git failure', async () => {
    const { associations, candidate, registryRoot, run } = await scenario({
      removeResult: { exitCode: 1, stderr: "fatal: failed to delete '<path>': Operation not permitted" },
    })
    const report = await reclaim({ associations, registryRoot, run })

    const removals = await execute(report, { associations, registryRoot, run })

    Expect(removals[0]?.path).toBe(candidate)
    Expect(removals[0]?.outcome).toBe('failed')
    Expect(removals[0]?.reason).toContain('unsandboxed shell')
    Expect(removals[0]?.reason).toContain('nothing was deleted')
  })

  Test('a clean worktree attached to a Codex task is live and retains task details in the report', async () => {
    const { associations, candidate, registryRoot, run } = await scenario({ association: attachedTask })

    const report = await reclaim({ associations, registryRoot, run })
    const row = report.worktrees.find(worktree => worktree.path === candidate)

    Expect(row?.verdict).toBe('live')
    Expect(row?.associations).toEqual([attachedTask])
    Expect(row?.evidence).toContain('still associated with an agent task')
    const rendered = formatReclaimReport(report)
    Expect(rendered).toContain('Branch: detached at')
    Expect(rendered).toContain('Agent task: Codex 01a0baed-bea6-7cd3-a354-0eee871a9a15')
    Expect(rendered).toContain('Title: Improve Tao testing and merges')
    Expect(rendered).toContain('Description: Improve testing and merge scheduling')
    Expect(rendered).toContain('App label: NEXT; created: 2026-09-19T18:28:58.000Z')
  })

  Test('execute rechecks task attachment before removal', async () => {
    const calls: string[] = []
    const first = await scenario({ calls })
    const report = await reclaim({ associations: first.associations, registryRoot: first.registryRoot, run: first.run })
    const attached = await scenario({ association: attachedTask, calls, candidatePath: first.candidate })

    const removals = await execute(report, {
      associations: attached.associations,
      registryRoot: attached.registryRoot,
      run: attached.run,
    })

    Expect(removals).toEqual([
      { outcome: 'skipped-now-live', path: first.candidate, reason: 'still associated with an agent task' },
    ])
    Expect(calls).not.toContain(routeKey('git', ['worktree', 'remove', first.candidate], Repo.getRoot()))
  })
})
