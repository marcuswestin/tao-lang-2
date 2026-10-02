import { type MachineResourceOwner, MachineResources } from '@host-control'
import { type CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { GreenTree } from '@verification/GreenTree'
import { board, formatBoardReport, parseWorktreePorcelain } from '../dev-cli-src/doctor/Board'

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
      'worktree /repo/worktrees/feat-x\nHEAD bbb\nbranch refs/heads/feat/x',
      'worktree /repo/stale\nHEAD ccc\nbranch refs/heads/feat/gone\nprunable gitdir file points to non-existent location',
      'worktree /repo\nbare',
    ].join('\n\n')

    const parsed = parseWorktreePorcelain(source)

    Expect(parsed.length).toBe(2)
    Expect(parsed[0]?.branch).toBe('main')
    Expect(parsed[1]?.branch).toBe('feat/x')
  })

  Test('says what a landing is spending the lock on, not only who took it and when', async () => {
    // A lock waiting on an agent between commands used to look exactly like a lock running a
    // 15-minute host lane. The phase breakdown is the whole difference, and it is why `board` is
    // what a person reads before deciding a lock is wedged.
    const registryRoot = await mkTestDir('tao-board-registry-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      await FS.writeJson(FS.resolvePath('.landing-lock.json', registryRoot), {
        acquiredAt: new Date(Date.now() - 12 * 60 * 1_000).toISOString(),
        durable: false,
        holder: '/peer-worktree',
        label: 'land feat/peer',
        landing: true,
        phases: [
          {
            endedAt: new Date(Date.now() - 11 * 60 * 1_000).toISOString(),
            name: 'integrating',
            startedAt: new Date(Date.now() - 12 * 60 * 1_000).toISOString(),
          },
          { name: 'host proof', startedAt: new Date(Date.now() - 11 * 60 * 1_000).toISOString() },
        ],
        pid: Platform.runtimeProcess.pid,
        scopedHolds: [{ pid: Platform.runtimeProcess.pid, token: 'peer-token' }],
      })
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/quiet', head: 'a'.repeat(40), path: worktreePath }]),
        },
      })

      const report = await board({ ...quietMachine, registryRoot, run })
      const rendered = formatBoardReport(report)

      Expect(report.verdict).toContain('landing lock held by peer-worktree (host proof for 11m)')
      Expect(rendered).toContain('held for 12m by a landing')
      Expect(rendered).toContain('integrating: 1m')
      Expect(rendered).toContain('host proof: 11m so far')
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
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

  Test("names a peer worktree's registered lane and does not attribute it to this checkout", async () => {
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
      await FS.writeJson(FS.resolvePath('resource-android-emulator_emulator-5554.lease', registryRoot), {
        command: 'agent app-dev Android AVD Tao_Agent_Pixel_1 (auto-started, headless)',
        id: 'android-lease',
        name: 'android-emulator:emulator-5554',
        pid: process.pid,
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
      Expect(formatBoardReport(report)).toContain(
        'device android-emulator:emulator-5554 held by agent app-dev Android AVD Tao_Agent_Pixel_1 (auto-started, headless)',
      )
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test('reports retained and quarantined emulator fences after parent exit without pruning them', async () => {
    const registryRoot = await mkTestDir('tao-board-retention-')
    const worktreePath = await mkTestDir('tao-board-worktree-')
    try {
      const run = fakeGitRun({
        [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
          stdout: porcelainListing([{ branch: 'feat/retained', head: 'c'.repeat(40), path: worktreePath }]),
        },
      })
      for (const quarantined of [false, true]) {
        const serial = quarantined ? 'emulator-5556' : 'emulator-5554'
        const name = `android-emulator:${serial}`
        const path = FS.resolvePath(`resource-android-emulator_${serial}.lease`, registryRoot)
        const original: MachineResourceOwner = {
          command: 'agent app-dev Android',
          id: `exited-parent-${serial}`,
          name,
          pid: 2 ** 30,
          repositoryRoot: `${worktreePath}/.`,
          startedAt: '2020-01-01T00:00:00.000Z',
        }
        await FS.writeJson(path, original)
        const retained = await MachineResources.retain({
          owners: [original],
          processes: quarantined ? [] : [{ command: 'emulator', pid: 2 ** 29, startedAt: 'emulator-start' }],
          quarantined,
          reason: 'shutdown remains unproved',
          registryRoot,
        })

        const report = await board({ ...quietMachine, registryRoot, run })
        const resource = report.machine.resources.find(entry => entry.owner.name === name)

        Expect(resource?.live).toBe(true)
        Expect(resource?.owner.id).toBe(retained.id)
        Expect(resource?.owner.pid).toBe(quarantined ? 2 ** 30 : 2 ** 29)
        Expect(resource?.owner.repositoryRoot).toBe(await FS.realPath(worktreePath))
        Expect(resource?.owner.retention?.quarantined).toBe(quarantined)
        Expect(report.verdict).toContain(name)
        Expect(formatBoardReport(report)).toContain(`device ${name} held by agent app-dev Android`)
        Expect(formatBoardReport(report)).toContain(
          `(${quarantined ? 'quarantined' : 'retained'}; generation ${retained.id})`,
        )
        Expect(await FS.readJson<MachineResourceOwner>(path)).toEqual(original)
      }
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
      // hash and its `.devenv/profile`-less toolchain are exactly what a fresh read of that same
      // empty tree computes.
      const currentTreeHash = await GreenTree.hashTree(worktreePath, run)
      const currentToolchain = await GreenTree.toolchain(worktreePath, run)
      await GreenTree.record(
        worktreePath,
        'verify-changed',
        { at: '2026-01-01T00:00:00.000Z', logRoot: 'old', toolchain: currentToolchain, treeHash: 'stale-hash' },
        [],
      )
      await GreenTree.record(
        worktreePath,
        'verify',
        { at: '2026-06-01T00:00:00.000Z', logRoot: 'new', toolchain: currentToolchain, treeHash: currentTreeHash },
        [],
      )

      const report = await board({ ...quietMachine, registryRoot, run })

      Expect(report.worktrees[0]?.verification?.lane).toBe('verify')
      Expect(report.worktrees[0]?.verification?.status).toBe('current')
    } finally {
      await FS.remove(registryRoot)
      await FS.remove(worktreePath)
    }
  })

  Test(
    'reports a tree that still matches but a toolchain that has since changed, distinctly from a match',
    async () => {
      const registryRoot = await mkTestDir('tao-board-registry-')
      const worktreePath = await mkTestDir('tao-board-worktree-')
      try {
        const run = fakeGitRun({
          [routeKey('git', ['worktree', 'list', '--porcelain'], Repo.getRoot())]: {
            stdout: porcelainListing([{ branch: 'feat/retooled', head: '4'.repeat(40), path: worktreePath }]),
          },
        })
        const currentTreeHash = await GreenTree.hashTree(worktreePath, run)
        await GreenTree.record(
          worktreePath,
          'verify',
          {
            at: '2026-06-01T00:00:00.000Z',
            logRoot: 'new',
            toolchain: 'a-toolchain-this-checkout-no-longer-has',
            treeHash: currentTreeHash,
          },
          [],
        )

        const report = await board({ ...quietMachine, registryRoot, run })

        Expect(report.worktrees[0]?.verification?.lane).toBe('verify')
        Expect(report.worktrees[0]?.verification?.status).toBe('toolchain-changed')
      } finally {
        await FS.remove(registryRoot)
        await FS.remove(worktreePath)
      }
    },
  )

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
