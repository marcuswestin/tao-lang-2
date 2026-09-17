import { type CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { board, parseWorktreePorcelain } from '../dev-src/doctor/Board'
import { GreenTree } from '../dev-src/repository-tests/GreenTree'

/**
 * `board` reads three things it must never mutate: the worktree it is asked about, the shared
 * `~/.cache/tao/machine-lanes` registry, and any `.artifacts/merge` records other worktrees wrote.
 * A test against the real machine would be non-deterministic, so every seam below is a fake: a
 * scripted `git` runner and a scratch registry directory this test owns and removes.
 */

type RouteKey = string
type RouteResult = Partial<CLI.CommandResult>

/** fakeGitRun scripts `git` (and any other command) by exact args and cwd, defaulting to a quiet
 * success so calls this test does not care about (such as GreenTree's `ls-files` reads) behave
 * like an empty, clean tree rather than failing the whole gather. */
function fakeGitRun(routes: Record<RouteKey, RouteResult>): typeof CLI.run {
  return (async (command, spec = {}) => {
    const key = routeKey(command, spec.args ?? [], spec.cwd)
    const override = routes[key]
    return {
      args: [...(spec.args ?? [])],
      command,
      cwd: spec.cwd,
      exitCode: 0,
      signal: null,
      stderr: '',
      stdout: '',
      ...override,
    }
  }) as typeof CLI.run
}

function routeKey(command: string, args: readonly string[], cwd: string | undefined): RouteKey {
  return `${command} ${args.join(' ')}::${cwd ?? ''}`
}

/** A fixed, quiet machine reading: the real host may be running a dozen other lanes at once, and
 * the verdict this test asserts on must not depend on that. */
const quietMachine = { cpuCount: () => 8, loadAverage: () => 1 }

function porcelainListing(worktrees: readonly { path: string; head: string; branch?: string }[]): string {
  return worktrees.map(worktree => {
    const lines = [`worktree ${worktree.path}`, `HEAD ${worktree.head}`]
    if (worktree.branch !== undefined) {
      lines.push(`branch refs/heads/${worktree.branch}`)
    } else {
      lines.push('detached')
    }
    return lines.join('\n')
  }).join('\n\n')
}

Describe('board', () => {
  Test('parses git worktree list --porcelain, dropping prunable and bare records', () => {
    const source = [
      'worktree /repo\nHEAD aaa\nbranch refs/heads/main',
      'worktree /repo/.claude/worktrees/feat-x\nHEAD bbb\nbranch refs/heads/feat/x',
      'worktree /repo/stale\nHEAD ccc\nbranch refs/heads/feat/gone\nprunable gitdir file points to non-existent location',
      'worktree /repo\nbare',
    ].join('\n\n')

    const parsed = parseWorktreePorcelain(source)

    Expect(parsed.length).toBe(2)
    Expect(parsed[0]?.branch).toBe('main')
    Expect(parsed[1]?.branch).toBe('feat/x')
  })

  Test('reports a quiet verdict when no other lane or resource is registered', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/quiet', head: 'a'.repeat(40), path: worktreePath }]),
        },
      })

      const report = await board({ ...quietMachine, registryRoot, run })

      Expect(report.verdict).toContain('quiet')
      Expect(report.machine.lanes).toEqual([])
      Expect(report.machine.resources).toEqual([])
      Expect(report.worktrees.length).toBe(1)
      Expect(report.worktrees[0]?.status).toBe('ok')
      Expect(report.worktrees[0]?.clean).toBe(true)
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test('names a peer worktree\'s registered lane and does not attribute it to this checkout', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      await FS.writeJson(FS.resolvePath('peer.lane.json', registryRoot), {
        id: 'peer',
        lane: 'verify',
        maxSlots: 8,
        // A real pid from another worktree would answer to `ps`, but the fake must still be alive
        // for `activeLaneEntries` to count it rather than silently treating it as a crashed lane.
        pid: process.pid,
        repositoryRoot: '/some/other/worktree',
        slots: 4,
        startedAt: new Date().toISOString(),
      })
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/busy', head: 'b'.repeat(40), path: worktreePath }]),
        },
      })

      const report = await board({ ...quietMachine, registryRoot, run })

      Expect(report.machine.lanes.length).toBe(1)
      Expect(report.verdict).toContain('busy')
      Expect(report.verdict).toContain('not only from this checkout')
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test('reports a live named resource lease, and marks a dead one stale', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      await FS.writeJson(FS.resolvePath('resource-landing.lease', registryRoot), {
        command: 'merge-with-main',
        id: 'live-lease',
        name: 'landing',
        pid: process.pid,
        repositoryRoot: worktreePath,
        startedAt: new Date().toISOString(),
      })
      await FS.writeJson(FS.resolvePath('resource-stale-thing.lease', registryRoot), {
        command: 'something-dead',
        id: 'dead-lease',
        name: 'stale-thing',
        pid: 2 ** 30,
        repositoryRoot: worktreePath,
        startedAt: new Date().toISOString(),
      })
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/resources', head: 'c'.repeat(40), path: worktreePath }]),
        },
      })

      const report = await board({ ...quietMachine, registryRoot, run })

      const landing = report.machine.resources.find(resource => resource.owner.name === 'landing')
      const staleThing = report.machine.resources.find(resource => resource.owner.name === 'stale-thing')
      Expect(landing?.live).toBe(true)
      Expect(staleThing?.live).toBe(false)
      Expect(report.verdict).toContain('resource lease')
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test('reports a worktree whose path no longer exists as unreadable, without crashing', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const missingPath = FS.resolvePath('does-not-exist', await mkTestDir('tao-board-parent-'))
    try {
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/gone', head: 'd'.repeat(40), path: missingPath }]),
        },
      })

      const report = await board({ ...quietMachine, registryRoot, run })

      Expect(report.worktrees.length).toBe(1)
      Expect(report.worktrees[0]?.status).toBe('unreadable')
      Expect(report.worktrees[0]?.error).toContain('no longer exists')
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('reports a dirty worktree and its ahead/behind count against main', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      const run = fakeGitRun({
        [routeKey('git', ['rev-list', '--left-right', '--count', 'main...HEAD'], worktreePath)]: {
          stdout: '2\t5\n',
        },
        [routeKey('git', ['status', '--porcelain'], worktreePath)]: {
          stdout: ' M some/file.ts\n',
        },
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/dirty', head: 'e'.repeat(40), path: worktreePath }]),
        },
      })

      const report = await board({ ...quietMachine, registryRoot, run })

      const worktree = report.worktrees[0]
      Expect(worktree?.clean).toBe(false)
      Expect(worktree?.behindMain).toBe(2)
      Expect(worktree?.aheadOfMain).toBe(5)
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test('reads a merge message and a finalize state file without requiring either to exist', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      await FS.writeText(
        FS.resolvePath('.artifacts/merge/feat/with-message.msg', worktreePath),
        'Land the thing\n\n- did the thing',
      )
      await FS.writeJson(FS.resolvePath('.artifacts/merge/feat/with-message.state.json', worktreePath), {
        state: 'verified',
      })
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/with-message', head: 'f'.repeat(40), path: worktreePath }]),
        },
      })

      const report = await board({ ...quietMachine, registryRoot, run })

      const worktree = report.worktrees[0]
      Expect(worktree?.mergeMessagePresent).toBe(true)
      Expect(worktree?.finalize).toEqual({ present: true, readable: true, summary: 'state verified' })
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test('reports a malformed finalize state file as present but unreadable', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      await FS.writeText(
        FS.resolvePath('.artifacts/merge/feat/malformed.state.json', worktreePath),
        '{ this is not valid json',
      )
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/malformed', head: '1'.repeat(40), path: worktreePath }]),
        },
      })

      const report = await board({ ...quietMachine, registryRoot, run })

      Expect(report.worktrees[0]?.finalize).toEqual({ present: true, readable: false })
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test('names the most recently proved verification lane and whether the tree still matches', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/proved', head: '2'.repeat(40), path: worktreePath }]),
        },
      })
      // The tree the fake `run` describes is empty (every git read defaults to no entries), so its
      // hash is exactly what GreenTree.hashTree computes for that same empty tree.
      const currentTreeHash = await GreenTree.hashTree(worktreePath, run)
      await FS.writeJson(FS.resolvePath(GreenTree.STORE_PATH, worktreePath), {
        gates: {},
        lanes: {
          'verify-changed': { at: '2026-01-01T00:00:00.000Z', logRoot: 'old', treeHash: 'stale-hash' },
          'verify': { at: '2026-06-01T00:00:00.000Z', logRoot: 'new', treeHash: currentTreeHash },
        },
        version: 1,
      })

      const report = await board({ ...quietMachine, registryRoot, run })

      Expect(report.worktrees[0]?.verification?.lane).toBe('verify')
      Expect(report.worktrees[0]?.verification?.treeMatchesCurrent).toBe(true)
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test('never writes to the worktree, the registry, or the merge artifacts it reads', async () => {
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      await FS.writeJson(FS.resolvePath('peer.lane.json', registryRoot), {
        id: 'peer',
        lane: 'verify',
        maxSlots: 8,
        pid: 2 ** 30,
        repositoryRoot: worktreePath,
        slots: 2,
        startedAt: new Date().toISOString(),
      })
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/untouched', head: '3'.repeat(40), path: worktreePath }]),
        },
      })
      const registryBefore = (await FS.listDir(registryRoot)).toSorted()
      const worktreeBefore = (await FS.listDir(worktreePath)).toSorted()

      await board({ ...quietMachine, registryRoot, run })

      Expect((await FS.listDir(registryRoot)).toSorted()).toEqual(registryBefore)
      Expect((await FS.listDir(worktreePath)).toSorted()).toEqual(worktreeBefore)
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })
})
