import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { Database } from 'bun:sqlite'
import { execute, formatWorktreeStatus, reclaim } from '../dev-cli-src/doctor/Reclaim'
import type { WorktreeThreadInventory } from '../dev-cli-src/doctor/WorktreeThreads'

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

const noThreads = async (paths: readonly string[]): Promise<WorktreeThreadInventory> => ({
  byPath: Object.fromEntries(paths.map(path => [path, []])),
  providers: { claude: 'ok', codex: 'ok', cursor: 'ok' },
})

/** scenario builds one machine: a primary checkout, the worktree asking, and one candidate. */
async function scenario(options: {
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
  return { candidate, registryRoot, run }
}

Describe('reclaim', () => {
  Test('local task indexes match exact worktree paths across the three apps', async () => {
    const home = await mkTestDir('tao-thread-index-')
    const worktree = FS.resolvePath('checkout', home)
    await FS.mkdir(worktree)
    const codexRoot = FS.resolvePath('.codex', home)
    await FS.mkdir(codexRoot)
    const codex = new Database(FS.resolvePath('state_5.sqlite', codexRoot))
    codex.run(
      'CREATE TABLE threads (id TEXT, cwd TEXT, name TEXT, title TEXT, first_user_message TEXT, created_at INTEGER, updated_at INTEGER, created_at_ms INTEGER, updated_at_ms INTEGER, archived INTEGER, thread_source TEXT)',
    )
    codex.run(
      "INSERT INTO threads VALUES ('codex-1', ?, 'Codex title', '', 'Codex description', 1, 2, 1000, 2000, 0, 'user')",
      [worktree],
    )
    codex.close()

    const claudeProject = FS.resolvePath('.claude/projects/project', home)
    await FS.mkdir(claudeProject)
    await FS.writeText(
      FS.resolvePath('claude-1.jsonl', claudeProject),
      JSON.stringify({
        cwd: worktree,
        message: { content: 'Claude description', role: 'user' },
        sessionId: 'claude-1',
        timestamp: '2026-09-25T12:00:00Z',
        type: 'user',
      }) + '\n',
    )
    const cursorRoot = FS.resolvePath('Library/Application Support/Cursor/User/globalStorage', home)
    await FS.mkdir(cursorRoot)
    const cursor = new Database(FS.resolvePath('state.vscdb', cursorRoot))
    cursor.run(
      'CREATE TABLE composerHeaders (composerId TEXT, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, value TEXT)',
    )
    cursor.run('INSERT INTO composerHeaders VALUES (?, ?, ?, ?, ?)', [
      'cursor-1',
      1_790_000_000_000,
      1_790_000_010_000,
      1,
      JSON.stringify({
        name: 'Cursor title',
        subtitle: 'Cursor description',
        workspaceIdentifier: { uri: { fsPath: worktree } },
      }),
    ])
    cursor.close()

    const result = await CLI.run('python3', {
      args: [Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/doctor/worktree_thread_inventory.py')],
      stdin: JSON.stringify({ home, paths: [worktree, `${worktree}-other`] }),
    })
    Expect(result.exitCode).toBe(0)
    const inventory = JSON.parse(result.stdout) as WorktreeThreadInventory
    Expect(inventory.providers).toEqual({ claude: 'ok', codex: 'ok', cursor: 'ok' })
    Expect(inventory.byPath[worktree]?.map(thread => thread.app).toSorted()).toEqual(['claude', 'codex', 'cursor'])
    Expect(inventory.byPath[`${worktree}-other`]).toEqual([])
    Expect(inventory.byPath[worktree]?.find(thread => thread.app === 'cursor')?.archived).toBe(true)
  })
  Test('reports a clean, idle, preserved worktree as reclaimable with its evidence', async () => {
    const { candidate, registryRoot, run } = await scenario({})

    const report = await reclaim({ readThreads: noThreads, registryRoot, run })

    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('reclaimable')
    Expect(row?.evidence).toEqual(['clean', 'idle', 'contained in origin/merged/some-task'])
  })

  Test('never reclaims the worktree it is running in, or the primary checkout', async () => {
    const { registryRoot, run } = await scenario({})

    const report = await reclaim({ readThreads: noThreads, registryRoot, run })

    const byPath = new Map(report.worktrees.map(worktree => [worktree.path, worktree]))
    Expect(byPath.get(Repo.getRoot())?.verdict).toBe('live')
    Expect(byPath.get(PRIMARY)?.verdict).toBe('live')
  })

  Test('a worktree holding a lane is live, not reclaimable', async () => {
    const { candidate, registryRoot, run } = await scenario({ laneOnCandidate: true })

    const report = await reclaim({ readThreads: noThreads, registryRoot, run })

    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('live')
    Expect(row?.evidence).toEqual(['holds a lane, a resource lease, or the landing lock'])
  })

  Test('uncommitted changes make a worktree live', async () => {
    const { candidate, registryRoot, run } = await scenario({ candidateClean: false })

    const report = await reclaim({ readThreads: noThreads, registryRoot, run })

    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('live')
    Expect(row?.evidence).toEqual(['uncommitted changes'])
  })

  Test('a commit no preserved ref contains is unclassified, never reclaimable', async () => {
    const { candidate, registryRoot, run } = await scenario({ containingRefs: '' })

    const report = await reclaim({ readThreads: noThreads, registryRoot, run })

    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('unclassified')
    Expect(row?.evidence.at(-1)).toContain('reachable from neither main nor any origin/merged/* ref')
  })

  Test('an attached task protects an otherwise reclaimable worktree', async () => {
    const { candidate, registryRoot, run } = await scenario({})
    const readThreads = async (paths: readonly string[]): Promise<WorktreeThreadInventory> => ({
      ...await noThreads(paths),
      byPath: {
        [candidate]: [{
          app: 'codex',
          archived: true,
          createdAt: null,
          description: 'Review',
          id: 'task-1',
          lastActivityAt: null,
          path: candidate,
          title: 'Attached task',
        }],
      },
    })
    const report = await reclaim({ readThreads, registryRoot, run })
    const row = report.worktrees.find(worktree => worktree.path === candidate)
    Expect(row?.verdict).toBe('live')
    Expect(row?.threads[0]?.title).toBe('Attached task')
    Expect(formatWorktreeStatus(report)).toContain(
      'codex archived: Attached task — Review; created unknown; active unknown',
    )
  })

  Test('an unreadable installed task index leaves an unmatched worktree unclassified', async () => {
    const { candidate, registryRoot, run } = await scenario({})
    const readThreads = async (paths: readonly string[]): Promise<WorktreeThreadInventory> => ({
      ...await noThreads(paths),
      providers: { claude: 'ok', codex: 'unavailable: database', cursor: 'ok' },
    })
    const report = await reclaim({ readThreads, registryRoot, run })
    Expect(report.worktrees.find(worktree => worktree.path === candidate)?.verdict).toBe('unclassified')
  })

  Test('execute removes a reclaimable worktree', async () => {
    const calls: string[] = []
    const { candidate, registryRoot, run } = await scenario({ calls })
    const report = await reclaim({ readThreads: noThreads, registryRoot, run })

    const removals = await execute(report, { readThreads: noThreads, registryRoot, run })

    Expect(removals).toEqual([{ outcome: 'removed', path: candidate }])
    Expect(calls).toContain(routeKey('git', ['worktree', 'remove', candidate], Repo.getRoot()))
  })

  Test('execute refuses a worktree that took a lane after the report was gathered', async () => {
    const calls: string[] = []
    const first = await scenario({ calls })
    const report = await reclaim({ readThreads: noThreads, registryRoot: first.registryRoot, run: first.run })
    Expect(report.worktrees.some(worktree => worktree.verdict === 'reclaimable')).toBe(true)

    // The machine goes busy between the report and the action — the case a five-minute-old snapshot
    // gets wrong, and the reason the liveness signals are re-read per item.
    const busy = await scenario({ calls, candidatePath: first.candidate, laneOnCandidate: true })
    const removals = await execute(report, { readThreads: noThreads, registryRoot: busy.registryRoot, run: busy.run })

    Expect(removals).toEqual([
      { outcome: 'skipped-now-live', path: first.candidate, reason: 'took a lane since the report' },
    ])
    Expect(calls).not.toContain(routeKey('git', ['worktree', 'remove', first.candidate], Repo.getRoot()))
  })

  Test('execute rechecks tasks and keeps a worktree attached after the report', async () => {
    const calls: string[] = []
    const { candidate, registryRoot, run } = await scenario({ calls })
    const report = await reclaim({ readThreads: noThreads, registryRoot, run })
    const attached = async (paths: readonly string[]): Promise<WorktreeThreadInventory> => ({
      ...await noThreads(paths),
      byPath: {
        [candidate]: [{
          app: 'claude',
          archived: false,
          createdAt: null,
          description: '',
          id: 'task-2',
          lastActivityAt: null,
          path: candidate,
          title: 'New task',
        }],
      },
    })
    const removals = await execute(report, { readThreads: attached, registryRoot, run })
    Expect(removals).toEqual([{ outcome: 'skipped-now-live', path: candidate, reason: 'attached to an agent task' }])
    Expect(calls).not.toContain(routeKey('git', ['worktree', 'remove', candidate], Repo.getRoot()))
  })

  Test('a sandbox denial is reported as needing an unsandboxed shell, not as a git failure', async () => {
    const { candidate, registryRoot, run } = await scenario({
      removeResult: { exitCode: 1, stderr: "fatal: failed to delete '<path>': Operation not permitted" },
    })
    const report = await reclaim({ readThreads: noThreads, registryRoot, run })

    const removals = await execute(report, { readThreads: noThreads, registryRoot, run })

    Expect(removals[0]?.path).toBe(candidate)
    Expect(removals[0]?.outcome).toBe('failed')
    Expect(removals[0]?.reason).toContain('unsandboxed shell')
    Expect(removals[0]?.reason).toContain('nothing was deleted')
  })
})
